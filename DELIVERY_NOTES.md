# Delivery notes

**Screencast → How-To.** Upload a short screen recording of one operation in a
browser app; get a numbered guide with timecodes and screenshots, where every
step has been checked back against the frames it came from.

> **Status.** Recordings A and C have been run end to end. **B, D and E are
> cancelled by decision, not by accident**: the free tier bills failed `503`s as
> requests, one 29-second video consumed a model's entire day on 2026-09-15, and
> the remaining allowance is reserved for processing a new recording live in the
> walkthrough — see *Infrastructure limits* in §3. **No number in this document is
> estimated and presented as measured**; where a figure is extrapolated, it says so
> on the line, where a measurement was lost it says that, and where a recording
> failed its pre-registered expectation it is recorded as a failure — recording C
> did, and §2 says so before it says anything else about it.

```bash
npm install
cp .env.example .env          # add a Google AI Studio key
npm run dev                   # http://localhost:3000

npm test                                  # 82 tests, offline, no key needed
npm run guide -- fixtures/videos/A.mp4    # rebuilds A from cached artefacts, 0 requests
```

---

## 1. Overview & architecture

### The decision everything follows from

**The model perceives. The code decides.**

An LLM answers "what is visible on screen at this second" well, and "which path
should be recommended" unreproducibly. So the pipeline splits along that line:

| Stage | Decided by | Requests | Why there |
|---|---|---|---|
| Ingestion | code | 0 (upload only) | Validation and probing are deterministic |
| Observation | Gemini | 1 | Perception over the video, nothing else |
| **Authoring reduce** | **pure TypeScript** | **0** | The product's judgement, unit-tested offline |
| Phrasing | Gemini | 1 | Wording only, over a closed step list |
| Frames | ffmpeg | 0 | Evidence extraction |
| Grounding | Gemini + frames | 1 per step | One isolated check per claim |
| Assembly | pure TypeScript | 0 | Final status, once `verified_ratio` exists |

### Gemini is isolated from I/O, and from judgement

No module reaches for the API key; `createGeminiClient` is the only place that
reads it, and every stage takes the client as an argument. More importantly, the
stages that *decide* things (`reduce.ts`, `assemble.ts`) are pure functions with
zero I/O, zero network and zero clock. Given the same timeline they always
produce the same guide — which is what makes the central claims testable without
spending a cent.

**The load-bearing consequence:** a numbered step can only be born from an event
with `kind === "ui_action" && visible === true`. A `narration` event has **no
path** into the step list — not because a prompt forbids it, but because no such
edge exists in `reduce.ts`. That is the difference between "we do not invent
clicks" as a promise and as a property, and it is covered by tests that run with
the network off.

The same shape appears in the phrasing pass: the request carries a closed list
of step ids, and a response is accepted only if it returns the same ids, the
same count, in the same order (`findStepMismatch`). That pass is structurally
incapable of adding, merging, dropping or reordering a step. The worst it can do
is word a sentence badly, and a human sees that.

### Caching: a working constraint turned into an asset

The free tier allows 20 requests per model per day, and a full A–E run needs
about 35. Rather than treat that as a blocker, artefacts are cached on disk and
committed:

| Artefact | Path | Key / validity |
|---|---|---|
| Timeline | `fixtures/timelines/<video>.json` | Regenerated only with `--refresh` |
| Phrased guide | `fixtures/guides/<video>.phrased.json` | Reused when the ordered `(event_id, observation)` list matches |
| Verdicts | `fixtures/verdicts/<video>.json` | sha256 of **both frame images + the sentence + the model** |

Hashing the frame *bytes* rather than their timestamps makes invalidation exact:
re-record the video and the key changes even though the timecodes did not; change
the wording and the key changes; leave both alone and the verification is never
paid for twice.

Three things fall out of this, and all three matter more than the saved cents:

1. **A run interrupted by quota resumes** instead of starting over.
2. **The guide for A rebuilds from a clean clone with no API access at all** —
   `npm run guide -- fixtures/videos/A.mp4` completes in ~4 s with 0 requests.
3. **Assembly was developed and tested entirely offline**, against real verdicts
   from a real run rather than fixtures written to pass.

### Layout

```
src/
  pipeline.ts              one chain; the CLI and the server are thin wrappers
  server.ts                Express, static + POST /api/process with SSE
  config/    pricing.ts  thresholds.ts
  modules/   gemini.ts  ingestion.ts  observation.ts  frames.ts  grounding.ts
             verdict-cache.ts  assemble.ts  markdown.ts  metrics.ts
             authoring/  reduce.ts  phrase.ts
  schemas/   timeline.ts  draft.ts  guide.ts
public/      index.html  app.js  styles.css        (no framework, no build step)
fixtures/    videos/  timelines/  guides/  verdicts/  ground-truth/  demo-app/
tests/       82 tests, all offline
```

---

## 2. Test set & results (fixtures A–E)

Five recordings against a purpose-built demo app (`fixtures/demo-app/orders.html`),
each targeting one thing the brief asks for. **Expectations were registered in
`fixtures/ground-truth/RECORDING-SCRIPT.md` before the pipeline was ever run**,
and that file has not been edited since — a pre-tool-use hook now blocks writes
to it, so an expectation cannot quietly become a rationalised result.

| # | Recording | What it proves | Expected | Actual |
|---|---|---|---|---|
| **A** | Filter → mistaken date range → corrected → **silent** checkbox → export | base flow, silent action, correction, visible success | `ok`, 5 steps, `verified_ratio 1.0` | `ok_with_warnings`, 5 steps, `verified_ratio 0.80` — **see below** |
| B | Same operation, one setting changed, filters reordered | regression: the guide must differ in exactly one place | `ok`, differs from A only in the status value and step order | `[TBD]` — not attempted: `gemini-3.7-flash` answered `503` on every attempt at A on 2026-09-15, and B is only meaningful on the same model as A. Now also covered by the reservation below |
| **C** | A with the middle cut out | flag a missing critical step, invent nothing | `needs_clarification`, critical `MissingStep`, **no invented click** | **FAILED** — draft `status: ok`, 5 steps, `missing_steps: []`, and step 2 is a click the recording never shows — **see below** |
| D | Narration says "Shipped", screen shows Pending | not merely summarising speech | `needs_clarification` + clarification quoting both sides | **Cancelled** — allowance deliberately reserved for the live demo (see *Infrastructure limits*) |
| E | Two unrelated operations in one take | refuse rather than guess | `declined`, `multiple_operations`, **grounding never called** | **Cancelled** — allowance deliberately reserved for the live demo. One attempt was made: ingestion succeeded (7.7 s, 21.1 s of video), Observation stopped at `DailyQuotaExhaustedError` |

### Recording A — and the bug the product found in itself

Four of five steps verified. Step 4 — the silent "Include customer email"
checkbox — came back **`contradicted`**, with the evidence quoted from the frame:

> *In both Frame 1 and Frame 2, the 'Include customer email' checkbox remains
> unchecked.*

**This is the most important result in the project, and it is a failure.**

Checked by eye against the extracted frames:

| Frame | Time | What it shows |
|---|---|---|
| `e8-shot.png` | 0:31 | checkbox **empty**, cursor moving toward it |
| `e8-after.png` | 0:32 | checkbox **empty**, cursor beside it |
| `e9-after.png` | 0:36 | checkbox **ticked** |

So the action did happen. What was wrong was the **timestamp**: Observation
reported `t_end: 32`, and the click's visual effect lands after that. Frames are
sampled once per second and a checkbox finishes rendering after the click that
started it, so a `t_end` placed on the click itself systematically captures the
state *before* the action.

Grounding was not wrong. It reported exactly what the two frames it was given
show, and in doing so caught a timestamp error the pipeline had been carrying
silently since the Observation stage.

**How it was fixed — and how it deliberately was not.** The tempting fix is to
widen the frame window, or shift the "after" frame a second later, and watch the
demo go green. That would have made verification weaker precisely where it had
just proven useful. Instead the *cause* was fixed, in the Observation prompt:

> `t_end` — …Add a buffer of one to two seconds past the moment you believe the
> change completes. Frames are sampled once per second, and menus, dialogs,
> checkboxes and row counts finish rendering after the click that started them.
> A `t_end` placed on the click itself lands on the state BEFORE the action,
> which reads as if the action never happened. **Err late, never early.**

Recorded in `ARCHITECTURE.md` as a dated amendment with the evidence that caused
it. **The confirming re-run has still not executed.** It was attempted twice on
2026-09-15 (`--refresh`, `gemini-3.7-flash`, four minutes apart) and both
attempts died at the Observation stage with `503 UNAVAILABLE` on all four
retries — eight requests, no timeline. Expected outcome remains
`verified_ratio 1.0` plus a `starting_state` from the new prompt block. `[TBD]`

The discrepancy is left in this document rather than tidied away. A verification
stage that catches a real defect in its own pipeline, on the first recording it
was pointed at, is stronger evidence that it works than a clean green row.

### Recording C — the invented click, and where the guarantee stops

C is A with the middle cut out: the take jumps from "Status → Shipped" straight to
a screen where "Last 30 days" is already selected, and the click that selected it
was never recorded. The pre-registered expectation was a critical `MissingStep`
and, explicitly, **no numbered step claiming that click**.

**What the pipeline produced instead** (`fixtures/timelines/C.json`,
`fixtures/guides/C.md`, run 2026-09-15 on `gemini-3.8-flash`):

- draft `status: ok`, five numbered steps, `missing_steps: []`, `discarded: []`,
  `clarifications: []`;
- **step 2 reads "Select 'Last 30 days' from the Date range dropdown menu."**

It came from event `e4`, which Observation emitted as
`kind: "ui_action"`, `visible: true`, `confidence: 1`.

**Checked by eye, offline, against frames cut from C.mp4 at 0.25 s intervals** —
no API request involved:

| Time | What the frame shows |
|---|---|
| 13.75 s | Status **Shipped**, Date range **All time**, *Showing 6 of 12*, cursor top-right near the window chrome |
| 14.00 s | Status **Shipped**, Date range **Last 30 days**, *Showing 4 of 12*, cursor bottom-left |

The cut is between those two frames. No dropdown ever opens; the cursor is nowhere
near the Date range control on either side and teleports across the screen. The
click does not exist in the recording, and the model reported seeing it.

**What this actually demonstrates — and what it does not.** Two different things
happened here and conflating them would be the dishonest reading:

- The **pipeline** did not catch the hallucination. It produced a clean-looking
  five-step guide containing a click that never happened, and would have shipped
  it as `status: ok` had the verification stage been reachable that day.
- The **process** did catch it, before a single word of it reached a reader.
  Expectations were registered in `RECORDING-SCRIPT.md` before the first run and
  the file is write-protected by a hook, so "C must not contain a Date range
  step" was a claim made in advance, not a standard invented afterwards to match
  the output. The result was then audited frame by frame against the source
  video — and the audit cost **nothing**: `ffmpeg` sampling at 0.25 s intervals
  is local, offline and free, which is precisely why it can be run on every
  suspicious step without a budget conversation.

That is the product insight worth keeping: **a model's claim about what it saw is
checkable against the file it was given, deterministically and for free.** The
recording is not a black box that only another model can interpret. The frames
are on disk; a disagreement between "the model says a dropdown was clicked" and
"no frame contains an open dropdown" is a mechanical comparison, not a judgement
call. The expensive part of verification — asking a model to read a frame — is
the part we were rationed on; the cheap part is the part that found the defect.

**Why the project's central guarantee did not catch this.** The invariant holds
exactly as designed — a step can only be born from an event with
`kind === "ui_action" && visible === true`, and `reduce.ts` has no edge from
narration to the step list. That guarantee is about *narration*. It says nothing
about an event the model **labels** `visible: true` for an action it never saw.
Reduce behaved correctly on the input it was given; the input was wrong.

The gap detector has the same shape of dependency: `missing_steps` is built
**only** from events with `kind === "gap"` (`reduce.ts:237`). There is no
code-side, model-independent evidence for a cut, so when Observation narrates a
jump as a smooth sequence, nothing downstream can disagree.

**This is a real failure of the brief's central requirement, recorded here as
one.** Two candidate fixes exist and neither has been implemented — the cause is
diagnosed, the remedy is not yet an agreed phase:

1. *Prompt-side*: require `kind: "gap"` whenever a visible state change has no
   visible cause, the way the `t_end` buffer rule was added after A.
2. *Code-side*: derive gap candidates deterministically from consecutive
   `ui_state` deltas with no `ui_action` between them, so the detector stops
   depending on the model volunteering the word "gap". This is the stronger of
   the two, and the more expensive.

One more honest note: C's final document did land on `needs_clarification`, which
matches the expected *status*. It got there for the wrong reason — a
`verified_ratio` of 0.20 caused by the outage below, not by the cut. Had grounding
answered, C would have shipped as a clean `ok` guide containing a click nobody
performed. The status matching by accident is not a pass.

### What counts as a failure

Recorded in `RECORDING-SCRIPT.md` before any run, so it could not be softened:

| # | Failure mode | Status |
|---|---|---|
| 1 | Any numbered step the recording does not visibly show | **Observed on C, 2026-09-15** — step 2 claims a Date range click that is not in the recording |
| 2 | `Last 7 days` surviving into A's recommended path | Not observed — it is in `discarded`, marked superseded |
| 3 | `Last 30 days` missing from A's recommended path | Not observed — present as step 2 |
| 4 | The silent checkbox step missing from A or B | Not observed on A — present and flagged `silent_action` |
| 5 | Claimed success where no banner was shown | Not observed |
| 6 | C producing a complete guide with no critical gap flagged | **Observed, 2026-09-15** — `missing_steps: []`, draft `status: ok` |
| 7 | D taking the narrator's word over the screen | **Not tested** — run cancelled, allowance reserved for the live demo |
| 8 | E producing a guide instead of declining | **Not tested** — run cancelled, allowance reserved for the live demo |

---

## 3. Speed & cost

### Methodology

Metrics are collected **per stage as it runs** (`metrics.ts` wraps every call),
not summed at the end. A total assembled afterwards cannot say which stage burned
the time, and cannot report retries at all — and retries turned out to be half
the request count on a bad afternoon.

Cost is computed from `usageMetadata` returned by each call, priced against a
rate carrying its own source and date (`config/pricing.ts`). Per-video figures
for a full-length recording are **extrapolated from A by token rate**, and every
such figure is labelled.

**One honesty about pricing:** all runs used `gemini-3.7-flash`, whose published
rate we have not verified. Costs below are priced at `gemini-3.8-flash` list
price, and the metrics panel says so on screen rather than passing the figure off
as exact.

### Measured — recording A (44.2 s, 1920×1032, 7.0 fps average)

Each row is measured. The table is a **composite of several runs**, not one
uninterrupted execution: grounding was developed against a cached timeline, so
ingestion and observation did not re-run alongside it.

| Stage | Wall | Calls | Retries | In | Out | Cost |
|---|---|---|---|---|---|---|
| Ingestion | 6.9 s | 0 | 0 | — | — | — |
| Observation | 8.6 s | 1 | 0 | 13 435 | 1 593 | $0.0161 |
| Reduce | <0.1 s | 0 | 0 | — | — | — |
| Phrasing | 19.8 s | 2 | 1 | 670 | 106 | $0.0009 |
| Frames | 2.1 s | 0 | 0 | — | — | — |
| Grounding | 88.7 s | 11 | 6 | 11 828 | 289 | $0.0100 |
| Assembly | <0.1 s | 0 | 0 | — | — | — |
| **Total** | **~126 s** | **14** | **7** | **25 933** | **1 988** | **~$0.027** |

Cached re-run of the same recording: **4.0 s, 0 requests, $0.0000.**

### Where the pre-registered estimate was wrong

The estimate below was written before any run, for a 2-minute video:

| Stage | Pre-registered | Measured rate | Verdict |
|---|---|---|---|
| Observation | ~300 tokens/s of video | **~288 tokens/s** | Held |
| Phrasing | ~$0.004 | $0.0009 for 5 steps | Held (A is short) |
| Grounding | "2 images ≈ 516 tokens" | **~2 366 input tokens per verification** | **Wrong by 4.6×** |

**Why Grounding cost 4.6× the estimate.** The estimate assumed an image is one
tile of ~258 tokens. It is not: at 1280×688 with `MEDIA_RESOLUTION_HIGH` the
image is tiled into many crops, and a request carrying two such frames plus the
prompt measures ~2 366 input tokens. 1280 px was kept rather than reduced — the
verdicts show the model reading "Shipped", "Last 30 days" and the checkbox state
off those frames, so the resolution is doing exactly the work it was chosen for.
The correction is to the estimate, not to the setting.

**Retries are a real line item.** Seven of A's fourteen requests were retries
after `503` and `429`. A cost model that ignores them understates the bill by
half during an outage — which is why `StageMetric` counts them separately as
transport and structural.

### Extrapolated to a full 2-minute recording — *not measured*

| Stage | Tokens (extrapolated) | Cost |
|---|---|---|
| Observation | ~35 200 in / ~3 500 out | ~$0.040 |
| Phrasing (≈8 steps) | ~1 100 in / ~170 out | ~$0.002 |
| Grounding (8 steps × ~2 366) | ~18 900 in / ~460 out | ~$0.016 |
| **Total per video** | | **~$0.058** |

Against the pre-registered ~$0.05.

### Totals in cents

| Figure | Value | Basis |
|---|---|---|
| Recording A, full run | **2.7 ¢** | measured, 2026-09-13 (table above) |
| Recording A, cached re-run | **0.0 ¢** | measured — 0 requests |
| A 2-minute recording | **≈ 5.8 ¢** | *extrapolated by token rate, not measured* |
| Recording C, full run | **not captured** | the run completed but its per-stage metrics were printed to the console only and were lost with the terminal buffer; `metrics.ts` has no file sink, so nothing is recoverable after the process exits |
| Full A–E total | **not applicable** | B, D and E are cancelled and never produced a run; a five-video total would be three-fifths invented |

**A product gap this exposed:** `RunMetrics` is assembled per stage and then
rendered to stdout and to the SSE stream, and nowhere else. A run whose console
output is lost leaves its artefacts behind — timeline, guide, verdict cache — but
not the measurement of what they cost. Writing `RunMetrics` next to the guide it
describes is a small change and is **not** implemented here; it is recorded as a
finding rather than fixed mid-stream.

### Free tier is not zero cost

These runs were billed at $0. The figures above are what the same work costs at
published rates, because free credits are an allowance, not an absence of cost.
Two limits shaped the project and belong in any estimate:

- **20 requests per model per day**, and **failed `503`s consume the allowance
  too**. `gemini-3.8-flash`'s entire day was spent on retries during one outage,
  which is why the working model became `gemini-3.7-flash`.
- Hosting is counted separately and is not in the figures above.

**A second outage, measured: 2026-09-14.** Eight requests bought nothing at all.
Recording A was re-run against `gemini-3.7-flash` and answered
`503 UNAVAILABLE — "This model is currently experiencing high demand"` on all
four attempts (backoff 3.5 s → 7.6 s → 8.2 s). Recording E was then sent to
`gemini-3.8-flash` as a one-request health check and failed the same way
(2.1 s → 4.0 s → 14.0 s), which establishes the outage was **not** specific to
one model. Ingestion succeeded in both cases — a Files API upload is not a
`GenerateRequest` and costs no allowance.

**A third outage, and the sharpest measurement yet: 2026-09-15.** The daily
allowance had reset and `429` was gone. Both models still failed, in two
different ways, and the day produced exactly one completed run:

| Run | Model | Result |
|---|---|---|
| C | 3.8-flash | **completed** in ~13 min wall — but 3 of 5 grounding calls came back `503`, so C shipped with `verified_ratio 0.20` and three steps marked `not checked` |
| E | 3.8-flash | ingestion fine (7.7 s); Observation refused: `DailyQuotaExhaustedError — GenerateRequestsPerDayPerProjectPerModel-FreeTier (limit 20)` |
| A (`--refresh`) | 3.7-flash | `503` × 4 |
| A (`--refresh`, 4 min later) | 3.7-flash | `503` × 4 |

**One 29-second video spent an entire model-day.** C is 29.3 s long and needs
about 7 requests to process. It consumed all 20, because every `503` and every
per-minute `429` inside a retry chain is a request, and a thirteen-minute wall
time on a half-minute video is almost entirely backoff. That ratio — 20 requests
of allowance bought 2 of 5 verifications — is the most concrete statement of the
constraint this project operates under, and it is a stronger argument than the
price table: at list price C's work is worth well under three cents, and no
amount of money was the binding factor.

The two failure modes must not be conflated. `429` with a `PerDay` violation is
an allowance that is gone until midnight Pacific and that `callWithRetry` refuses
to retry at all. `503` is capacity, retried four times and then abandoned.
2026-09-15 produced both, on two different models, within the same hour.

Four attempts per stage is `RETRY_POLICY.maxAttempts`, and the run then stops
rather than looping. That ceiling is the difference between losing 8 requests and
losing a day: the policy exists because the allowance is spent by *attempts*, not
by answers. This is the second independent observation that **availability, not
price, is the binding constraint on the free tier** — and it is why the cost
model counts retries as their own line item instead of folding them into an
average.

### Infrastructure limits — and a deliberate stop

Stated plainly, because the brief asks for unfinished parts to be described
rather than quietly dropped:

**The Gemini free tier is currently unstable, and instability is billed.** The
allowance is counted in *requests*, not in answers. A `503 UNAVAILABLE` — the
model reporting it has no capacity right now — consumes an attempt exactly like a
successful generation does, and `callWithRetry` makes up to four attempts per
call. Three days of runs (2026-09-13, -14, -15) each lost most of their allowance
this way, and 2026-09-15 made the ratio unambiguous: **a 29-second recording
needing about 7 requests consumed all 20 of a model's day**, and returned 2 of 5
verifications for it. Availability, not price, is the binding constraint. At list
price the same work is worth under three cents.

**The decision: stop the background test runs.** Recordings B, D and E are
cancelled rather than retried. The remaining allowance — 12 requests on
`gemini-3.7-flash` — is reserved for one thing: processing a **new, previously
unseen recording live**, end to end, during the walkthrough video. That is a
direct requirement of the brief, it cannot be demonstrated from a cache, and it
is worth more than three more rows in a results table.

The trade is stated rather than hidden. Cancelling B costs the A-vs-B regression
comparison; cancelling D and E leaves the narration-conflict path and the
refusal path unverified on real recordings — all three are implemented, unit
tested offline, and simply never met their video. Those rows stay `[TBD]` and
`Cancelled` in the matrix above instead of being filled with numbers from a run
that did not happen. **No figure in this document was produced by any means other
than a command that actually ran**, which is the only reason the failure on
recording C is legible as a failure at all.

---

## 4. AI tools & verification

### Models

| Stage | Model | Configuration |
|---|---|---|
| Observation | `gemini-3.7-flash` | `fps: 1`, `MEDIA_RESOLUTION_HIGH`, `temperature: 0`, structured output |
| Phrasing | `gemini-3.7-flash` | text only, no video, `temperature: 0` |
| Grounding | `gemini-3.7-flash` | 2 inline PNGs per request, `MEDIA_RESOLUTION_HIGH`, `temperature: 0` |

Those are the defaults. `gemini-3.8-flash` was the planned model and is the one
whose price is verified; the defaults moved to `3.7-flash` when 3.8's daily quota
was exhausted. A `--model <id>` flag sets one model for a whole run — never
mid-run, because the model is part of the verdict cache key, so a failover
half-way through a video would miss verdicts already paid for. **Recording C was
run on `gemini-3.8-flash` and recording A's attempts on `gemini-3.7-flash`**, and
the two therefore are not directly comparable on cost.

The model id is a single constant per stage, and a pre-tool-use hook asks for
confirmation before any change to it — quota is per model, so switching looks
like a fix while silently invalidating the measured figures. For the same reason
the choice of model is left to a person: on 2026-09-15 with 3.8-flash's day spent
and 3.7-flash refusing on capacity, moving D and E onto 3.7-flash would have
consumed the allowance reserved for the A/B regression pair and made the pair
itself unrunnable.

### Structured output, mirrored by hand

Every model response is parsed by a `zod` schema and nothing else. Alongside each
one sits a hand-written Gemini `responseSchema` — the OpenAPI subset the API
accepts — because generators emit constructs that subset rejects. The two are
maintained together deliberately.

`schema_version` is never requested from the model: it is our envelope, and
asking a model to reproduce a constant only creates one more way for a response
to be wrong. The same applies to `event_id` in grounding responses and to frame
paths: the code knows them, so the model is not asked for them.

### Retries: transport vs structural

Two different failures, deliberately separated, and both counted:

- **Transport** — `503` capacity, `429` rate limit. Exponential backoff with
  jitter, and the server's own `RetryInfo.retryDelay` wins when present. A
  **per-day** quota violation is never retried: it throws
  `DailyQuotaExhaustedError` on the first refusal instead of spending three more
  requests proving the day is over.
- **Structural** — the response was well-formed but did not word the steps it
  was given. Retried once, **with the mismatch named in the retry**: at
  `temperature: 0` a verbatim re-send is the same request and returns the same
  answer, so a silent retry only burns quota. The guarantee is unaffected —
  validation is what enforces it, not the wording.

### How the output was checked — three independent layers

**1. Offline unit tests — 76 tests, no network, no key, deterministic.**
They cover the claims that matter rather than the code that is easy to test:
narration never becomes a step; an invisible action never becomes a step;
superseded branches are pruned transitively, including chains and cycles; a gap
becomes a critical warning and never an invented click; every refusal rule; the
phrasing pass cannot add, drop, merge or reorder a step; verdict cache keys
change when the pixels, the sentence or the model change; the full status ladder.
This is the reproducibility claim, and it costs nothing to re-verify.

**2. Grounding — verification built into the product.**
Each step is checked **alone** against two real frames cut from the recording:
one where the control is still visible (`screenshot_t`), one where its effect
should be (`t_end`). Frames of neighbouring steps are never batched into one
request — a model shown several steps at once starts assembling a coherent story
across them, which is the confabulation this stage exists to catch. Each verdict
carries the result, the on-screen text quoted as evidence, the reasoning, and the
two frames it was judged on.

`"unclear"` is an accepted answer and is never counted as confirmation.
`unavailable_reason` separates "the model looked and was unsure" from "we never
got to ask" — a step left unchecked by a spent quota says so explicitly.

This is the brief's *"one example of how you checked their output"*, built in
rather than described — and section 2 shows it earning its place on the first
recording it was pointed at.

**3. Following the guide by hand.** Done on **2026-09-14**, in Chrome against
`npm run demo-app`, working only from `fixtures/guides/A.md` and without
watching A.mp4.

**All five steps completed and the recorded success state was reached.** Each
step named a control that existed, and each produced the effect the guide
implies:

| Step | Followed | Observed on screen |
|---|---|---|
| 1. Status → Shipped | yes | `Showing 6 of 12 orders` |
| 2. Date range → Last 30 days | yes | `Showing 4 of 12 orders` |
| 3. Export CSV, upper right | yes | modal "Export filtered orders", "4 orders match the current filters" |
| 4. Include customer email | yes | checkbox ticked (it is off by default) |
| 5. Export CSV inside the modal | yes | `Exported 4 orders to orders-shipped-last30days.csv` / `Columns: Order ID, Customer, Email, Date, Status, Total` |

### The finding: a correct step wearing a red badge

Step 4 carries **❌ contradicted by the recording**, and following it anyway is
what produces the documented result. Running the same guide a second time with
step 4 skipped exported `Order ID, Customer, Date, Status, Total` — **no Email
column**. The instruction is right; only the timestamp behind its verification
was wrong.

That is a real usability defect, and it belongs to the product rather than to
the recording: **a reader can reasonably take a red badge as "do not do this"**,
and here that reading silently costs them a column. The badge answers "could the
two sampled frames confirm this?", but it is phrased as a judgement on the step.

What it does **not** justify is softening the badge. The verdict was honest, the
cause is the `t_end` fix already made in the Observation prompt, and a re-run is
expected to turn the badge green on its own. The change worth making is to the
wording: a contradicted step should say what was and was not established, rather
than implying the instruction is wrong.

### Two gaps found by following, not by testing

- **No starting state is stated.** The guide opens at step 1 and assumes the
  filters sit at `All statuses` / `All time`. A reader arriving with filters
  already set gets a different row count and a different export. The pipeline is
  right not to invent a "reset the filters" step — no such click is in the
  recording — but a *precondition line*, which is not a step, would close this.
- **Two different controls share the label "Export CSV".** Steps 3 and 5 are
  distinguished only by prose ("in the upper right corner" / "inside the modal
  dialog"). It was unambiguous in practice, and the per-step screenshots settle
  it, but a guide read without images would be thinner here.

No step described something the app does not do, and no step was missing.

---

## 5. Product judgment & tradeoffs

### Failures are shown, not hidden

A contradicted step stays in the guide, is marked, and pulls the status down.
Deleting it would hide exactly what the brief asks to be reported. A product that
says "I could not confirm this step" is more useful than one that states it
confidently and is wrong.

**But saying it badly costs the reader something real.** Following A's guide by
hand (section 4) showed the failure mode: the badge read `contradicted by the
recording`, and a reader can reasonably take that as *do not do this*. Skipping
that step exports the file without the Email column. The verdict was honest; the
wording was a judgement on the instruction when the evidence only concerned two
sampled frames.

So the badge now states what was established, never what to do:

| Verdict | Badge |
|---|---|
| `supported` | confirmed on frames |
| `contradicted` | frames don't show this |
| `unclear` | frames inconclusive |
| `unclear` + `unavailable_reason` | **not checked** |

The fourth row is not a rewording. `unavailable_reason` has always separated
"the model looked and was unsure" from "we never asked" — a step left unchecked by
a spent quota — and the badge was the single place that distinction was being
thrown away. It now has its own state and its own colour.

A contradicted step also carries one visible sentence, outside the `<details>`
block: *"Checked against two sampled frames only. The step may still be correct —
read this as unconfirmed, not as wrong."* Hiding that line behind a disclosure is
what let a correct step read as a forbidden one.

**Nothing about the logic moved.** `verdict.result`, `summariseVerdicts` and the
status ladder are untouched: a contradiction still counts as unverified and still
forces at least `ok_with_warnings`. Only the sentence changed. Softening the
threshold would have weakened the one check that has already caught a real defect.

**A contradiction never reads as a clean `ok`.** On A the ratio alone would have
left the guide at `ok` (0.80 > the 0.60 threshold). A contradicted step raises a
warning, and the warning forces at least `ok_with_warnings`. This was added on
top of the agreed status rule rather than by rewriting it — the existing warnings
mechanism already carried the meaning.

### Refusals cost nothing

A declined recording never reaches phrasing, frames or grounding. Refusing after
paying to verify a guide we are about to throw away would be a design bug, not
just a wasted cent — and recording E exists to check that the metrics panel shows
0 grounding requests for it.

### No framework, and no build step to pay for it

There **is** a UI: `npm run dev` gives an upload page, live per-stage progress
over SSE, and a result view with verification badges, screenshots, timestamp
chips that seek an embedded `<video>`, a metrics panel and Markdown export.

What was deliberately declined is a *framework*. No React, no build step, no
bundler: three static files served by Express. The time that would have gone into
a component library went into the CLI and the caching layer instead, and that
choice paid for itself twice — assembly and the entire Markdown renderer were
built and tested against real cached verdicts with the API quota already
exhausted, and a reviewer can reproduce A's guide from a clean clone with no key
at all.

The trade-off was the framework, never the design. `public/styles.css` is one
hand-written vanilla stylesheet — no Tailwind, no preprocessor, no PostCSS — and
it carries a full design system: three-layer tokens (primitive → semantic →
component), native `@layer` ordering instead of specificity fights, layered
shadows with inset edge highlights, backdrop-filter glass on the small floating
controls only, Lucide icons inlined as `mask-image` data URIs so a glyph inherits
`currentColor` and costs no request, and CSS-only micro-animation with every
`@keyframes` behind `prefers-reduced-motion: no-preference`. Dark is the designed
theme; light is a separately chosen set of token values rather than an inversion,
and every text/background pair was measured in both — the lowest is 4.98:1
against a 4.5:1 target.

`app.js` was not touched. The stylesheet reads run state back out of the DOM that
`app.js` already writes: a finished stage is `li:has(.time:not(:empty))`, and a
retry is the one moment a row is still `.running` while its detail cell has text,
so the progress rail shows five distinct states without the script ever learning
a new class name.

Two accessibility defects surfaced while restyling and are fixed in the same
stylesheet. `index.html` hides the file input with the `hidden` attribute, which
`display: none` removes from the tab order entirely — a keyboard user could not
open the file picker at all; author CSS outranks the UA rule, so the input is
restored as a focusable, pointer-transparent pixel with the ring drawn on
`.dropzone:focus-within`. And nothing on the page had a `:focus-visible` style,
on a page whose primary controls are a `<label>`, chip buttons and `<summary>`
elements. The one dependency added is the webfont link; `display=swap` and a full
system fallback stack mean an offline load renders the complete page in system
type.

The progress stream is not decoration either. A run takes the better part of two
minutes; a page that sits blank for that long is indistinguishable from one that
is lying about the work it is doing.

### Form carrying meaning: the `.gap` marker

A missing step was first drawn as a callout with a coloured left border — the
generic accent-stripe card, and semantically a `<blockquote>` that quoted
nothing. It is now a block bounded by dashed rules above and below, with the
steps continuing after it: a piece of the sequence visibly cut out, which is
exactly what a gap in a recording *is*.

It is a small thing, but it is the same principle as the rest of the project.
The brief asks the product to *flag a missing critical step*; the shape on screen
should carry that meaning, not decorate a paragraph that explains it.

The redesign sharpened the execution without touching the meaning. The two rules
are painted with `repeating-linear-gradient` rather than `border: dashed`, which
buys exact dash length and thickness instead of whatever the engine chooses, and
a scissors glyph sits on the cut so the metaphor is legible before the sentence
is read. The dashes drift only on hover or focus: a static block that explains a
problem should not be moving on its own.

### Constraints turned into properties

| Constraint | Response | What it bought |
|---|---|---|
| Free tier: 20 requests/model/day | Cache verdicts by frame bytes | Offline development, resumable runs, reproducible demo |
| Model timestamps accurate to ~1 s | Separate `screenshot_t` from `t_start` | Screenshots show the control before it is activated |
| Screen recorders write variable frame rates | Read `avg_frame_rate`, not `r_frame_rate` | A.mp4 reports 29.97 nominal and is actually 7.0 |
| LLM output is not reproducible | All judgement in pure functions | The product's core claims are unit-tested, not asserted |

### What was cut

Cut order agreed in advance: **deployment → Markdown export → recording B.**
Grounding was never on that list — without it the whole claim disappears.

Current state: Markdown export **done**; recording B **recorded, cancelled**
(see *Infrastructure limits*); deployment **prepared, see below**. Running locally
is one `npm install` and one `npm run dev`.

### Deployment — Render, and the one non-obvious setting

The server is deployment-ready as a plain Node web service. Nothing in the code
needed changing for it: `src/server.ts` already reads `process.env.PORT` and
`app.listen(PORT)` binds on every interface, so the platform's port assignment
works as-is. There is no `render.yaml`, `Dockerfile` or `Procfile` — the service
is configured from the dashboard:

| Setting | Value |
|---|---|
| Environment | Node (≥ 20, from `engines` in `package.json`) |
| Build command | **`npm install --include=dev`** |
| Start command | `npm start` → `tsx src/server.ts` |
| Environment variable | `GEMINI_API_KEY` — required; `.env` is git-ignored and never ships |

**Why the build command is not plain `npm install`.** This project has no
compile step: `npm start` runs the TypeScript entry point directly through
`tsx`, and `tsx` is a `devDependency`. Render's Node runtime sets
`NODE_ENV=production`, under which `npm install` skips `devDependencies`
entirely — so the build succeeds, the deploy goes green, and the service then
dies at startup with `tsx: not found`. `--include=dev` restores them.

Three fixes were on the table and the cheapest was chosen deliberately: moving
`tsx` into `dependencies` would misdescribe a dev tool as a runtime one, and
adding a real `tsc` → `dist/` build step is the cleanest answer but is a change
to the build contract on the eve of a recording. The build command is a
deployment-side setting and touches no source file, which is why it won.

Two properties of the platform that are worth stating rather than discovering
live: the filesystem is **ephemeral**, so `public/frames/` and `.tmp/uploads/`
are recreated on demand (`frames.ts:180`, `server.ts:45`) but do not survive a
restart — extracted screenshots die with the instance, which is acceptable for a
demo and would not be for a shared guide URL; and a free instance sleeps, so a
cold start lands in front of a run that already takes 30–60 seconds.

Deployment is recorded here as **configured, not yet verified by a live deploy** —
no build log has been read at the time of writing.

---

## Appendix — reproducing this

```bash
npm test                                           # 76 tests, offline, no key
npm run guide -- fixtures/videos/A.mp4             # 0 requests, ~4 s, from cache
npm run guide -- fixtures/videos/A.mp4 --refresh   # ignores caches, spends quota
npm run dev                                        # server; PORT= to move it off 3000
```

`fixtures/timelines/`, `fixtures/guides/` and `fixtures/verdicts/` are committed,
so A's guide — including every verdict and the evidence quoted for it — rebuilds
from a clean clone with no API access at all.

Outstanding before final submission:

1. Re-run A with the amended Observation prompt → confirm `verified_ratio 1.0` (~7 requests)
2. Run B–E and fill in section 2 (~28 requests)
3. Follow A's guide by hand and record the result
4. Fill in the total cost and speed figures across the matrix
