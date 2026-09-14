---
name: phase-report
description: Use when finishing an agreed phase of this project - verify, update HANDOFF.md, and write the stop-and-report the user expects. Triggers on "фаза завершена", "звіт по фазі", finishing any module the phase agreement covers, or before handing work back for acceptance.
---

# Closing a phase

Work here goes phase by phase, and a phase ends with a stop and a report — never
with the next phase started on momentum.

## 1. Verify before claiming anything

```bash
npx tsc --noEmit      # must exit 0
npm test              # must be green
```

Run the phase's own script too (`npm run observe -- …`, `npm run reduce -- …`)
and quote the real output. No number goes in the report that was not printed by
a command in this session.

## 2. Update HANDOFF.md

It is the file the next session reads first, so it must describe the state that
now exists:

- the status line at the top (date + which phase ended);
- the phase's section: what was written, file by file, one line each;
- anything measured (wall time, tokens, counts) under the verified-facts section
  — with the date, so a later session knows how old it is;
- the agreed next task, and what must NOT be written yet.

Record a phase as accepted only after the user has said so. Until then it is
"written, awaiting acceptance".

## 3. Report, in this shape

1. **What was written** — a table of file → role.
2. **Decisions taken, with the reason for each.** Not what the code does — why
   this way and not the obvious alternative.
3. **Measured numbers** — wall time, tokens, cost arithmetic, test counts.
4. **Against the pre-registered expectations**, when the phase produced an artefact
   for a test video: line by line against `fixtures/ground-truth/RECORDING-SCRIPT.md`.
5. **Disputed calls** — every place the implementation departed from the letter
   of `docs/ARCHITECTURE.md`, stated plainly enough that the user can overrule it.
   Silent departures are the failure mode this section exists to prevent.

## What not to do

- Do not write the next phase's code, however obvious it looks.
- Do not soften a failure into a warning. A failed expectation is reported as a
  failure, in the report and in `DELIVERY_NOTES.md`.
- Do not commit. The user does that by hand (a hook enforces it).
