---
name: run-observation
description: Use before sending any recording to Gemini - running a video through Ingestion and Observation, reading the token counts back, and handling 429/503. Triggers on "прогін відео", "запусти A.mp4", npm run observe, or any quota, rate-limit or model-availability question.
---

# Running a recording through Observation

```bash
npm run observe -- fixtures/videos/A.mp4
```

Writes `fixtures/timelines/<name>.json` and prints the timeline to stdout.
Ingestion validates and uploads; Observation is the single Gemini call.

## Before spending a request

The free tier allows **20 requests per model per day**
(`GenerateRequestsPerDayPerProjectPerModel`), and **failed 503s consume it too**.
This is not theoretical: `gemini-3.8-flash`'s daily quota was spent on 2026-09-13
diagnosing a spell of 503s, which is why the working model is now
`gemini-3.7-flash`.

So: think before each run, and do not "just try again" in a loop. `callWithRetry`
in `src/modules/gemini.ts` already throws `DailyQuotaExhaustedError` on the first
per-day violation rather than burning three more attempts on it.

**When the quota runs out: stop and ask the user about billing. Never switch the
model on your own** — quota is per model, so switching looks like a fix while
silently invalidating the verified pricing and the measured numbers in
`HANDOFF.md`. A hook asks for confirmation on any model-id edit for this reason.

## Reading the result

- `integrity: clean` means the timeline is structurally sound: unique ids,
  `superseded_by` resolving forward, timestamps inside the recording. Anything
  else is reported, never repaired — it is the signal that the contract slipped.
- **Verify the media resolution from the token count.** `MEDIA_RESOLUTION_HIGH`
  costs roughly **288 input tokens per second of video** at `fps: 1`
  (44.2 s → ~13 400). A number near a quarter of that means the request silently
  fell back to LOW, and at LOW the model cannot read the UI text this product is
  about.
- Wall time and tokens go into the phase report as measured figures.

## Known traps

- Screen recorders write **variable frame rates**: `ingestion.ts` reads
  `avg_frame_rate` because `r_frame_rate` claimed 29.97 on a file averaging 7.00.
- Output varies slightly between runs even at `temperature: 0` — a narration
  event present in one run may be absent in the next. Note it rather than
  treating a single run as definitive.
- Reading the timeline back offline costs nothing: `npm run reduce -- fixtures/timelines/A.json`
  needs no key and no network.
