# Delivery notes

**Screencast → How-To.** Upload a short screen recording of one operation in a
browser app; get a numbered guide with timecodes and screenshots, where every
step has been checked back against the frames it came from.

> **Status.** Deployed and running at **https://ai-video-analyst.onrender.com**.
> Recordings A and C have been run end to end on the free tier, and a new,
> previously unseen recording (saving a Word document) was processed live on the
> deployed service after the project moved to the **Gemini Paid Tier** — 5
> requests, 0 retries, 1.45 ¢. The free tier was the blocker: it bills failed
> `503`s as requests, and one 29-second video consumed a model's entire day on
> 2026-09-15 (§3, *Free tier → Paid Tier*). With the blocker gone, **B, D, E and
> A's confirming re-run were run on 2026-09-16**: 22 requests, 0 retries, 8.2 ¢
> for all four. E and D met their core expectations; **A's re-run and B did not**
> — the `t_end` timing defect survived its prompt fix, and on D grounding confirmed
> a checkbox that its own frame shows unticked. §2 records all of it. Two demo videos — the live Paid Tier
> run, and a free-tier run surviving a `503` — are attached to the submission form
> as local files. **No number in this document is
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
| **A** | Filter → mistaken date range → corrected → **silent** checkbox → export | base flow, silent action, correction, visible success | `ok`, 5 steps, `verified_ratio 1.0` | 2026-09-13 (3.7-flash): `ok_with_warnings`, 5 steps, `verified_ratio 0.80`. **Confirming re-run 2026-09-16 (3.8-flash): identical outcome — FAILED to reach `1.0`**, step 4 again unconfirmed — **see below** |
| B | Same operation, one setting changed, filters reordered | regression: the guide must differ in exactly one place | `ok`, differs from A only in the status value and step order | **FAILED on status** — steps match exactly (date range first, Pending, empty `discarded`, banner "Exported 3 orders"), but `needs_clarification` with `verified_ratio 0.40`: three real actions left unconfirmed by early frames — **see below** |
| **C** | A with the middle cut out | flag a missing critical step, invent nothing | `needs_clarification`, critical `MissingStep`, **no invented click** | **FAILED** — draft `status: ok`, 5 steps, `missing_steps: []`, and step 2 is a click the recording never shows — **see below** |
| D | Narration says "Shipped", screen shows Pending | not merely summarising speech | `needs_clarification` + clarification quoting both sides | **Passed on the narration check, with a grounding false positive** — `needs_clarification`, step 1 reads Pending, one clarification quoting "Shipped" vs "Pending"; `verified_ratio 0.40`, and step 4 marked *confirmed* on a frame showing the checkbox unticked — **see below** |
| E | Two unrelated operations in one take | refuse rather than guess | `declined`, `multiple_operations`, **grounding never called** | **Passed** — `declined`, `multiple_operations`, phrasing/frames/grounding all skipped: 1 request in total, 1.07 ¢ |

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
it. The confirming re-run was attempted twice on 2026-09-15 (`--refresh`,
`gemini-3.7-flash`) and both attempts died on `503 UNAVAILABLE`. **It ran on
2026-09-16 on the Paid Tier** (`--refresh`, `gemini-3.8-flash`, 62.2 s, 7
requests, 0 retries, 2.56 ¢).

**The fix did not work.** The re-run reproduced the original result exactly:
`ok_with_warnings`, `verified_ratio 0.80`, step 4 unconfirmed with the verdict
*"the checkbox labeled 'Include customer email' remains unchecked despite the
cursor hovering over it"*. Observation placed the checkbox at `t_end: 32` — the
same second as before the prompt told it to err late. The `starting_state` block
did arrive ("Status set to 'All statuses', Date range set to 'All time'…"), so the
prompt was read; the timing instruction simply did not move the timestamp. Asking
the model for a one-to-two-second buffer is not a reliable fix, and the stronger
remedy — adding the buffer in code when frames are cut, rather than asking for
it — is not implemented. The same defect is what failed B below.

The 2026-09-13 artefacts were overwritten by the re-run in the working tree;
the originals are in git history.

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

### New recording — saving a Word document (live, Paid Tier)

The brief asks for new input, not a replay of the fixtures. A recording the
pipeline had never seen — saving a document in Word — was uploaded to the
deployed service on the Paid Tier and processed end to end on camera, on
`gemini-3.8-flash`. It has no entry in `RECORDING-SCRIPT.md`, so it is reported
as an observed run, not as a pass against a pre-registered expectation.

| Figure | Value (from the metrics panel) |
|---|---|
| Requests | **5** |
| Retries | **0** |
| First readable step | **22.3 s** |
| Steps confirmed against frames | **2 of 3** — `verified_ratio 0.67` |
| Cost | **$0.0145 (1.45 ¢)** |

The transport was clean: zero retries, against twenty requests spent on C's 29
seconds a day earlier. Verification was not clean, and is not presented as such —
one of three steps was not confirmed by its frames, and the guide carries that
badge rather than hiding it.

### Recordings B, D and E — run on the Paid Tier, 2026-09-16

All three on `gemini-3.8-flash`, captured with `--json` to files so the metrics
could not be lost the way C's were. Each suspicious verdict was checked against
frames cut locally from the recording with the project's own `ffmpeg-static` —
no requests.

**E — passed.** `declined`, `decline_reason: multiple_operations`. Reduce stopped
the run after Observation: phrasing, frames and grounding all report
`skipped`, and the metrics show 1 request in total. Refusing cost 1.07 ¢, and
nothing was paid for verification of a guide that was then thrown away.

One defect in the output: the Markdown for a declined recording still carries
the generic footer — *"Each step above was checked on its own against two
frames…"* over a document with no steps, and *"The recording never shows the
operation completing"* although Observation reported a success banner at 0:05.
Both sentences are wrong for a refusal. Not fixed.

**D — passed on what it tests, with a grounding false positive.** The step reads
*Select "Pending" from the Status dropdown*, and the guide asks: *At 0:06 the
narrator said "I am setting the status to Shipped." but the screen shows "Status
selected is Pending." Which was intended?* The screen won and the disagreement is
surfaced, so failure mode 7 did not occur. The pre-registered "that step must not
be counted as verified" held — but only because grounding happened to reject it;
no code rule excludes a conflicted step from verification.

Verification went wrong in both directions:

| Step | Verdict | Frame check |
|---|---|---|
| 1. Status → Pending | *frames don't show this* | the "after" frame is at 8 s and shows `All statuses`; at 9.5 s the dropdown reads **Pending**, `Showing 4 of 12`. The action happened; the frame was early |
| 3. Export CSV | *frames don't show this* | "after" at 14 s shows no dialog; at 15.5 s **Export filtered orders** is open. Same cause |
| 4. Include customer email | **confirmed on frames** | the "after" frame shows the checkbox **empty**. The verdict text — *"displays the checkbox control, and Frame 2 shows the cursor hovering over it"* — describes a control being present, not being ticked |

Step 4 is the more serious of the two findings. A false *unconfirmed* costs the
reader some trust; a false *confirmed* is the product vouching for something its
own evidence does not show. The grounding prompt accepts "the control is there
and the pointer is near it" as support, and it should not. Not fixed.

**B — failed on status.** The steps are exactly what the expectation asks for:
five of them, date range first, **Pending** rather than Shipped, empty
`discarded`, banner *Exported 3 orders to orders-pending-last30days.csv*.
Diffed against the re-run of A, the substantive differences are the status value,
the filter order and the row count — and one more: A marks *open the export
dialog* as silent while B marks *confirm the export* as silent, although both
takes narrate those moments. That flag is Observation's `spoken: false`, and it
is not stable across two near-identical recordings.

The status is not what was expected: `needs_clarification`, `verified_ratio 0.40`,
below the 0.60 threshold. Step 2 (Pending) was *not confirmed* on an "after"
frame at 13 s that still shows `All statuses`; at 14 s the recording shows
**Pending** and `Showing 3 of 12`. Steps 1 and 4 came back *inconclusive* with
verdicts that name the cause themselves — *"The frames capture the moment before
the selection occurs"*. Every step in B is correct; the guide is flagged because
the evidence frames are cut a second too early, the same `t_end` defect as A.

### What counts as a failure

Recorded in `RECORDING-SCRIPT.md` before any run, so it could not be softened:

| # | Failure mode | Status |
|---|---|---|
| 1 | Any numbered step the recording does not visibly show | **Observed on C, 2026-09-15** — step 2 claims a Date range click that is not in the recording. Not observed on A (re-run), B or D: every step there was checked against frames and happened |
| 2 | `Last 7 days` surviving into A's recommended path | Not observed, in either run of A — it is in `discarded`, marked superseded |
| 3 | `Last 30 days` missing from A's recommended path | Not observed, in either run of A — present as step 2 |
| 4 | The silent checkbox step missing from A or B | Not observed — present and flagged `silent_action` in both A runs and in B |
| 5 | Claimed success where no banner was shown | Not observed — A, B and D each report the banner the recording shows |
| 6 | C producing a complete guide with no critical gap flagged | **Observed, 2026-09-15** — `missing_steps: []`, draft `status: ok` |
| 7 | D taking the narrator's word over the screen | Not observed, 2026-09-16 — step says Pending, clarification quotes both sides |
| 8 | E producing a guide instead of declining | Not observed, 2026-09-16 — `declined`, `multiple_operations`, grounding not called |

Beyond the list, three defects surfaced on 2026-09-16 that it did not anticipate
and that are recorded with the same weight: the `t_end` prompt fix did not hold
(A, B, D); grounding confirmed an unticked checkbox (D); and `silent_action` is
assigned inconsistently between near-identical takes (A, B).

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

**One honesty about pricing:** recording A ran on `gemini-3.7-flash`, whose
published rate we have not verified, so A's costs are priced at the
`gemini-3.8-flash` list price and the metrics panel says so on screen rather than
passing the figure off as exact. Recording C and the live Word run used
`gemini-3.8-flash` itself, whose rate is verified (`config/pricing.ts`), so their
cost is priced at the model's own rate.

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
| New recording (Word save), full run | **1.45 ¢** | measured on the Paid Tier, `gemini-3.8-flash`, deployed service — 5 requests, 0 retries, first readable step at 22.3 s |
| A re-run, B, D, E | **8.17 ¢** | measured on the Paid Tier, 2026-09-16 — table below |
| Full A–E total | **not stated** | C's cost was never captured; adding a guessed C to four measured runs would make the total part invented |

### Measured — Paid Tier, `gemini-3.8-flash`, 2026-09-16

One uninterrupted CLI run per recording (`npm run guide -- <video> --json`),
caches bypassed for A with `--refresh` and empty for B, D and E. Stdout and
stderr were written to files, so every figure below is read back from a saved
log rather than a terminal.

| Recording | Length | Wall | Requests | Retries | Tokens in / out | First step | Cost |
|---|---|---|---|---|---|---|---|
| A (re-run) | 44.2 s | 62.2 s | 7 | 0 | 26 261 / 1 584 | 28.9 s | **2.56 ¢** |
| B | 26.8 s | 61.4 s | 7 | 0 | 21 036 / 1 873 | 24.6 s | **2.28 ¢** |
| D | 24.8 s | 45.0 s | 7 | 0 | 20 479 / 1 944 | 18.0 s | **2.26 ¢** |
| E | 21.1 s | 17.8 s | 1 | 0 | 6 809 / 1 502 | — (declined) | **1.07 ¢** |
| **Total** | | **186.4 s** | **22** | **0** | | | **8.17 ¢** |

Per stage the shape is the same on every guide-producing run: Observation
10.2–18.4 s and 1.17–1.47 ¢, phrasing 2.0–3.3 s and 0.09 ¢, grounding 25.4–35.4 s
for five steps and 1.00 ¢. Grounding is still the slowest stage and Observation
the most expensive one. Observation measured 311–323 input tokens per second of
video, which confirms
`MEDIA_RESOLUTION_HIGH` held on every request.

**Against the free-tier runs.** A on 2026-09-13 needed 14 requests, 7 of them
retries, and ~126 s of composite wall time for 2.7 ¢. The same recording on the
Paid Tier needed 7 requests, 0 retries and 62 s, for 2.56 ¢. The cost is the same
work at the same list price; the time and the request count halved because none
of it was spent waiting on `503`s. Across 22 requests on 2026-09-16 there was not
one retry. Rebuilding all four guides from the saved artefacts afterwards took
0 requests.

**A product gap this exposed:** `RunMetrics` is assembled per stage and then
rendered to stdout and to the SSE stream, and nowhere else. A run whose console
output is lost leaves its artefacts behind — timeline, guide, verdict cache — but
not the measurement of what they cost. Writing `RunMetrics` next to the guide it
describes is a small change and is **not** implemented here; it is recorded as a
finding rather than fixed mid-stream.

### Free tier is not zero cost

A and C ran on the free tier and were billed at $0; their figures above are what
the same work costs at published rates, because free credits are an allowance,
not an absence of cost. Two limits shaped the project until the move to the Paid
Tier, and belong in any estimate:

- **20 requests per model per day**, and **failed `503`s consume the allowance
  too**. `gemini-3.8-flash`'s entire day was spent on retries during one outage,
  which is why the working model became `gemini-3.7-flash` for the rest of the
  free-tier period.
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
price table: at list price C's work is worth well under three cents. The price
was never the problem; the tier was.

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

### Free tier → Paid Tier

**The Gemini free tier is not a production path, and instability is billed.** The
allowance is counted in *requests*, not in answers. A `503 UNAVAILABLE` — the
model reporting it has no capacity right now — consumes an attempt exactly like a
successful generation does, and `callWithRetry` makes up to four attempts per
call. Three days of runs (2026-09-13, -14, -15) each lost most of their allowance
this way, and 2026-09-15 made the ratio unambiguous: **a 29-second recording
needing about 7 requests consumed all 20 of a model's day**, and returned 2 of 5
verifications for it. With a hard ceiling of 20 requests a day and `503 High
Demand` answers that spend it, a pipeline cannot be run predictably — neither in
a test matrix nor in front of a user. Availability, not price, is the binding
constraint. At list price the same work is worth under three cents.

**The decision: move to the Paid Tier.** A $5 balance was put on the key. That is
the smallest spend that removes the constraint outright: no daily request
ceiling, and a video that costs about a cent and a half instead of a model-day.
The effect was immediate and measured on the first run after the switch — the
live Word recording completed with **5 requests and 0 retries** for **1.45 ¢**,
against **20 requests** of allowance consumed by C's 29 seconds on the free tier.

The cost model did not change, only who pays: the list-price figures in this
section were always the real cost of the work, and on the Paid Tier they are
simply the bill. At the measured rate, $5 covers on the order of three hundred
recordings like the Word run.

**What it bought next.** The remaining fixtures — B, D, E and A's confirming
re-run — were run the following day in one sitting: 22 requests, 0 retries,
8.17 ¢. Stable infrastructure did not make the results better; it made them
*available*, and two of the four are failures (§2). **No figure in this document
was produced by any means other than a command that actually ran**, which is the
only reason those failures, and the one on recording C, are legible as failures
at all.

---

## 4. AI tools & verification

### Models

| Stage | Model | Configuration |
|---|---|---|
| Observation | `gemini-3.8-flash` | `fps: 1`, `MEDIA_RESOLUTION_HIGH`, `temperature: 0`, structured output |
| Phrasing | `gemini-3.8-flash` | text only, no video, `temperature: 0` |
| Grounding | `gemini-3.8-flash` | 2 inline PNGs per request, `MEDIA_RESOLUTION_HIGH`, `temperature: 0` |

Those are the defaults. `gemini-3.8-flash` was the planned model and is the one
whose price is verified. On the free tier the defaults moved to `3.7-flash` for a
while when 3.8's daily quota was exhausted; with the Paid Tier they are back on
`3.8-flash`, which is what the live Word run used. A `--model <id>` flag sets one
model for a whole run — never mid-run, because the model is part of the verdict
cache key, so a failover
half-way through a video would miss verdicts already paid for. **Recording C was
run on `gemini-3.8-flash` and recording A's attempts on `gemini-3.7-flash`**, and
the two therefore are not directly comparable on cost.

The model id is a single constant per stage, and a pre-tool-use hook asks for
confirmation before any change to it — quota is per model, so switching looks
like a fix while silently invalidating the measured figures. For the same reason
the choice of model is left to a person, not to a failover rule.

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

**Observed, not only unit tested.** The second demo video was recorded on the
free tier during a `503 High Demand` episode. The run does not crash: `callWithRetry`
(`modules/gemini.ts`) classifies the `503` as capacity, `pipeline.ts` emits a
`retry` event over SSE, and the progress row on screen reads *retrying in N s —*
followed by the server's message, until the delayed attempt goes through. The
user sees what is happening instead of a spinner that has silently stalled.

### How the output was checked — three independent layers

**1. Offline unit tests — 82 tests, no network, no key, deterministic.**
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
cause was the `t_end` timestamp, and softening the badge would have hidden that.
(The prompt-side `t_end` fix was expected to turn the badge green on a re-run; the
2026-09-16 re-run showed it did not — §2.) The change worth making is to the
wording: a contradicted step should say what was and was not established, rather
than implying the instruction is wrong.

### Two gaps found by following, not by testing

- **No starting state is stated.** The guide opens at step 1 and assumes the
  filters sit at `All statuses` / `All time`. A reader arriving with filters
  already set gets a different row count and a different export. The pipeline is
  right not to invent a "reset the filters" step — no such click is in the
  recording — but a *precondition line*, which is not a step, would close this.
  It has since been added: A's 2026-09-16 re-run opens with *Start from this
  state* — Status 'All statuses', Date range 'All time', 12 of 12 orders.
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

### Paying for availability

The single decision with the largest effect on the product was not in the code.
The free tier looked like the sensible default for a test task — the work costs
cents at list price — and it turned out to be the wrong tier for anything that
has to run when asked. 20 requests per model per day, `503 High Demand` answers
that are billed as attempts, and a retry policy that therefore spends the day
faster the harder it tries: over three days that combination blocked the test
matrix and made a live demo a gamble.

The options were to engineer around it — more caching, cross-model failover,
running at night — or to remove it. Engineering around it would have added code
whose only purpose was to survive a pricing tier, and cross-model failover would
have broken the verdict cache and made cost figures incomparable (§4). A $5
balance removed it. The first run after the switch finished with 0 retries at
1.45 ¢.

The tradeoff is explicit: a user of this product pays roughly a cent and a half
per recording in API cost, plus hosting. For a tool whose output replaces a person
writing a how-to by hand, that is not a number worth optimising before the
product's own failures (§2, recording C) are fixed.

### Refusals cost nothing

A declined recording never reaches phrasing, frames or grounding. Refusing after
paying to verify a guide we are about to throw away would be a design bug, not
just a wasted cent — and recording E exists to check it. On 2026-09-16 it did:
phrasing, frames and grounding all `skipped`, 1 request, 1.07 ¢ for the refusal.

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
| Free tier: 20 requests/model/day, `503`s billed | Cache verdicts by frame bytes; then move to the Paid Tier | Offline development, resumable runs, reproducible demo; a live run with 0 retries |
| Model timestamps accurate to ~1 s | Separate `screenshot_t` from `t_start` | Screenshots show the control before it is activated |
| Screen recorders write variable frame rates | Read `avg_frame_rate`, not `r_frame_rate` | A.mp4 reports 29.97 nominal and is actually 7.0 |
| LLM output is not reproducible | All judgement in pure functions | The product's core claims are unit-tested, not asserted |

### What was cut

Cut order agreed in advance: **deployment → Markdown export → recording B.**
Grounding was never on that list — without it the whole claim disappears.

Nothing on the list ended up cut: deployment **done** (below), Markdown export
**done**, recording B **run** (2026-09-16, §2). Running locally is one
`npm install` and one `npm run dev`.

### Deployment — Render, and the one non-obvious setting

**Live at https://ai-video-analyst.onrender.com**, running stably; the new Word
recording in §2 was processed on this deployment.

The server runs as a plain Node web service. Nothing in the code
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

---

## Appendix — reproducing this

```bash
npm test                                           # 82 tests, offline, no key
npm run guide -- fixtures/videos/A.mp4             # 0 requests, ~4 s, from cache
npm run guide -- fixtures/videos/A.mp4 --refresh   # ignores caches, spends quota
npm run dev                                        # server; PORT= to move it off 3000
```

Or skip the local setup: **https://ai-video-analyst.onrender.com**.

`fixtures/timelines/`, `fixtures/guides/` and `fixtures/verdicts/` are committed,
so A's guide — including every verdict and the evidence quoted for it — rebuilds
from a clean clone with no API access at all.

**Demo videos** — the live Paid Tier run on the new Word recording, and the
free-tier run recovering from a `503` — are attached to the submission form as
local files.

### Known open items

Stated rather than dropped, as the brief asks:

1. **Recording C's invented click is not fixed.** Diagnosis and the two candidate
   fixes (prompt-side and code-side gap detection) are in §2.
2. **The `t_end` timing defect is not fixed.** The prompt-side fix did not move
   the timestamp on A's re-run; the same early "after" frames failed B's status
   and two of D's verdicts.
3. **Grounding can confirm what its frame does not show.** D's step 4 was marked
   confirmed on a frame with the checkbox unticked.
4. **`silent_action` is not stable** between near-identical takes (A vs B).
5. **A declined recording's Markdown carries the step-guide footer**, including a
   false "never shows the operation completing" (E).
6. **`RunMetrics` is not persisted.** Metrics live only in stdout and the SSE
   stream, which is why C's cost is `not captured` (§3). The 2026-09-16 runs were
   captured only because their output was redirected to files by hand.
