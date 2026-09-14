# Screencast → how-to

Upload a short screen recording of one operation in one browser app. Get back a
how-to a new user can follow: numbered steps, timestamps, a screenshot per step,
and — for every step — a verdict saying whether the recording actually shows it.

The pipeline is deliberately split in two. A model answers *"what is observable
on screen at this second"*; deterministic TypeScript decides *"which steps to
recommend"*. A numbered step can only be born from an event marked
`kind === "ui_action" && visible === true`, so narration has no path into the
step list — not because a prompt forbids it, but because no such edge exists in
`reduce.ts`.

```
MP4 → Ingestion → Observation [Gemini, video] → RawTimeline
    → Reduce [pure TS, 0 requests] → DraftGuide
    → Phrasing [Gemini, text only] → Grounding [frames + Gemini, 1 request/step]
    → Assembly → guide + metrics
```

Full design, including every JSON contract: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
Results, measured cost and known failures: [`DELIVERY_NOTES.md`](DELIVERY_NOTES.md).

---

## Requirements

- **Node.js ≥ 20**
- A Gemini API key — **only for live runs**. Everything in *Reproduce without an
  API key* below works without one.

You do **not** need to install ffmpeg or ffprobe. Both ship as dependencies
(`ffmpeg-static`, `ffprobe-static`) and are resolved from `node_modules`.

## Setup

```bash
npm install
cp .env.example .env      # then put your key in it
```

Get a key from [Google AI Studio](https://aistudio.google.com/apikey).

### Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | for live runs only | — | Read in exactly one place, `createGeminiClient` in `src/modules/gemini.ts`. Every module takes the client as an argument. |
| `PORT` | no | `3000` | Web server port. |

---

## Reproduce without an API key

This is the fastest way to see that the project does what it claims, and it
costs nothing.

```bash
npm test                                 # 76 tests, fully offline
npm run guide -- fixtures/videos/A.mp4   # 0 API requests, ~2 s
```

The second command rebuilds recording A's complete guide — every step, every
screenshot, every verdict with the on-screen text quoted as evidence — from the
committed `fixtures/timelines/`, `fixtures/guides/` and `fixtures/verdicts/`.
Frames are re-cut locally with ffmpeg. Nothing goes over the network.

The tests are the reproducibility claim: narration never becomes a step, an
invisible action never becomes a step, superseded branches are pruned, a gap
becomes a warning and never an invented click, the phrasing pass cannot add,
drop, merge or reorder a step, and a verdict cache key changes when the pixels,
the sentence or the model change.

## Web demo

```bash
npm run dev              # http://localhost:3000
PORT=3177 npm run dev    # if 3000 is taken
```

Upload an MP4, watch per-stage progress stream in over SSE, then read the guide
with verification badges, timestamp chips that seek the embedded video, a
metrics panel and a Markdown export.

> **A real upload spends roughly 7 API requests.** `src/server.ts` calls the
> pipeline **without** the fixture caches, on purpose: the demo has to process
> new input rather than replay a prepared answer. On a free-tier key that is a
> third of a model's daily allowance — see *Free-tier limits* below.

## CLI

| Command | Requests | What it does |
|---|---|---|
| `npm run demo-app` | 0 | Serves the recorded fixture app on `http://localhost:4173/` |
| `npm run observe -- <video>` | 1 | Ingestion + Observation → `fixtures/timelines/<name>.json` |
| `npm run reduce -- <timeline>` | 0 | Reduce only. No key, no network |
| `npm run phrase -- <timeline>` | 1 | Reduce + Phrasing |
| `npm run guide -- <video>` | 0–N | The whole chain → `fixtures/guides/<name>.md` |
| `npm run dev` / `npm start` | — | Web server, with / without watch |
| `npm test` | 0 | vitest |
| `npm run typecheck` | 0 | `tsc --noEmit` |

### `npm run guide` flags

| Flag | Effect |
|---|---|
| `--refresh` | Ignore every cache and re-run the full chain. **Spends quota.** |
| `--json` | Print `{document, metrics}` to stdout instead of the rendered guide |
| `--timeline <path>` | Use a timeline from somewhere other than `fixtures/timelines/` |
| `--model <id>` | Run every model stage on this model instead of the per-stage defaults |

`--model` exists because the free-tier allowance is counted **per model per
day**: it is how one recording is deliberately spent against a different model's
day. One model covers a whole run — it is never switched mid-run, because a
verdict cache key carries the model, so a mid-run switch would invalidate the
verdicts already paid for in that same run.

---

## Layout

```
src/
  pipeline.ts           the whole chain; the CLI and the server are thin wrappers
  server.ts             Express: static files + POST /api/process over SSE
  modules/              ingestion, observation, frames, grounding, assemble,
                        markdown, metrics, verdict-cache, gemini
  modules/authoring/    reduce.ts (pure, no I/O), phrase.ts
  schemas/              zod contracts + hand-written Gemini responseSchema mirrors
  config/               thresholds.ts, pricing.ts (every rate carries its source)
public/                 index.html, app.js, styles.css — no framework, no build step
fixtures/               videos/ timelines/ guides/ verdicts/ ground-truth/ demo-app/
tests/                  76 tests, all offline
```

## Test set

Five recordings against the bundled demo app (`fixtures/demo-app/orders.html`),
each targeting one thing the brief asks for.

| # | Recording | What it proves |
|---|---|---|
| A | Filter → wrong date range → corrected → **silent** checkbox → export | base flow, silent action, correction, visible success |
| B | Same operation, one setting changed, filters reordered | regression: the guide must differ in exactly one place |
| C | A with the middle cut out | flags a missing critical step, invents nothing |
| D | Narration says "Shipped", the screen shows Pending | the screen wins over speech |
| E | Two unrelated operations in one take | refuses instead of guessing |

Expectations for all five were written in
`fixtures/ground-truth/RECORDING-SCRIPT.md` **before the pipeline was ever run**,
and that file is frozen — a pre-tool-use hook blocks writes to it, so an
expectation cannot quietly become a rationalised result. Actual outcomes,
including failures, live in [`DELIVERY_NOTES.md`](DELIVERY_NOTES.md) §2.

## Free-tier limits

- **20 requests per model per day** (`GenerateRequestsPerDayPerProjectPerModel`),
  and **failed `503`s consume the allowance too**.
- One full run of a recording is about 7 requests: 1 observation, 1 phrasing,
  1 per step for grounding.
- `callWithRetry` tells the two kinds of `429` apart: a per-minute limit is
  backed off and retried, a **daily** limit throws immediately rather than
  burning three more attempts proving the day is over.
- Free credits are an allowance, not an absence of cost. Measured token counts
  and list-price figures are in [`DELIVERY_NOTES.md`](DELIVERY_NOTES.md) §3.

## Conventions

- `nodenext` ESM: relative imports carry a `.js` extension even from `.ts`
  sources.
- Only `createGeminiClient` reads the API key; modules take the client as an
  argument.
- `tsconfig` is strict, including `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.
