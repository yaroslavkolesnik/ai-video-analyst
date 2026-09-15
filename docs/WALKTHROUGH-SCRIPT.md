# Walkthrough script — 3:00

Recording plan for the submission video. Voiceover in English; the *Screen*
column is stage direction for whoever is recording.

**Record this only after a successful live run.** The brief is explicit: *"The
app must process new input, not return prepared answers for the demo files."*
The 0:12–0:45 segment has to be a real upload, not a cached replay. A run costs
about 7 requests.

---

| Time | Screen | Voiceover |
|---|---|---|
| **0:00–0:12** | A finished guide for A, scrolling slowly through the steps | "You record yourself doing something once. You get back a how-to someone else can actually follow — numbered steps, timestamps, a screenshot each, and a verdict saying whether the recording really shows it." |
| **0:12–0:22** | Empty page; drag `A.mp4` onto the dropzone | "One browser app, one operation, two minutes of video. Drop it in." |
| **0:22–0:45** | Live progress rail: stages, elapsed time, any retries | "Progress is per stage over SSE. A run takes the better part of two minutes — a page that sits blank that long is indistinguishable from one that's lying about the work." |
| **0:45–1:05** | Result view; click a timestamp chip, the video seeks to it | "Every step links back to the second it came from. Click the timestamp, the video seeks there. Nothing here is a summary of what I said out loud." |
| **1:05–1:25** | Expand *How this step was checked* under step 1 | "Each step was checked on its own against two frames cut from the file — one where the control is still visible, one where its effect should be. The verdict quotes the text it read off the screen." |
| **1:25–1:55** | Step 4: the peach badge and the sentence under it | "This one says *frames don't show this*. It used to say *contradicted*. I followed my own guide by hand and skipped that step — the export came out missing a column. The step was right; only the timestamp behind its verification was wrong. So the badge now states what was established, never what to do." |
| **1:55–2:10** | Hover the `not checked` badge | "And *not checked* is its own state. A step nobody asked about, because the daily quota ran out, must not look like one the model looked at and doubted." |
| **2:10–2:30** | Terminal: `npx vitest run -t "never turns narration into a step"` → green | "The guarantee isn't a prompt asking nicely. A step can only come from an event marked visible — narration has no path into the list, because there's no such edge in the code. It's a unit test, offline, no key." |
| **2:30–2:45** | Split: DevTools Network (only `POST /api/process`) beside `gemini.ts` | "The browser only ever posts a file to its own origin. Exactly one place reads the API key, and it runs on the server. No key in the client, and no build step either — three static files." |
| **2:45–3:00** | Metrics panel with the numbers from the run just recorded | "Measured, not promised: [X] seconds end to end, [Y] requests, [Z] dollars at list price. Free tier isn't free — failed retries spend the allowance too, and this report says so." |

---

## Before recording

- [ ] A live run completed without `503`, so the upload segment is genuine
- [ ] `[X]` / `[Y]` / `[Z]` at 2:45 replaced with that run's own figures — never
      numbers carried over from an earlier run
- [ ] `npm run demo-app` is not needed; the guide and the app both come from the
      served page
- [ ] Browser zoom at 100%, window wide enough that the step rows do not wrap

## Deliberate omissions

**"BFF" is not said, and should not be.** The architecture does exactly what the
line at 2:30 describes — the key is read in one server-side place and the client
posts to its own origin — but it is a plain Express server, not a
backend-for-frontend pattern. A term larger than the implementation costs more in
review than an accurate sentence.

**The visual style is never named.** Three minutes are too expensive to spend on
the words "soft neo-brutalism". It does its work at 1:25–1:55 instead: the viewer
sees that an unconfirmed step reads as calm and informative rather than as an
error. That is stronger evidence of design judgement than the label is.

**No architecture diagram.** The pipeline is described in `docs/ARCHITECTURE.md`
for a reader who wants it. On video, the unit test at 2:10 proves more in twenty
seconds than a diagram would.
