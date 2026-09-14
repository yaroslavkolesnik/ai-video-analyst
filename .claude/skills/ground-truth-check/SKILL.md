---
name: ground-truth-check
description: Use when comparing a produced artefact - timeline, draft or guide - against the expectations registered before the first run. Triggers on "звір з ground truth", "actual vs expected", writing DELIVERY_NOTES.md, or any claim that a test video passed or failed.
---

# Checking an artefact against its pre-registered expectation

`fixtures/ground-truth/RECORDING-SCRIPT.md` holds what each of videos A–E was
expected to produce, written **before** the pipeline ever ran. That ordering is
the entire evidentiary value of the test set: an expectation edited after seeing
the result is just a rationalised result.

**The file is frozen.** Reading it is normal; writing to it is blocked by a hook.
Actual outcomes go to `DELIVERY_NOTES.md`.

## How to check

1. Read the expectation for that video in `RECORDING-SCRIPT.md` — both its table
   and its "Pre-registered expectation" block.
2. Produce the artefact (`npm run observe`, `npm run reduce`, …).
3. Compare **point by point**, not impressionistically. Each bullet in the
   expectation is a separate pass or fail.
4. Also walk the numbered list under **"What counts as a failure"** at the end of
   that file. Those eight items are the ones that invalidate the whole
   submission, so check them explicitly even when everything else looks right.

## Writing the result

In `DELIVERY_NOTES.md`, per video: the expectation, what actually happened, and
whether it matched. Failures are written down **as failures**, with the output
that shows them. A product that reports its own misses is the thing this brief is
scoring; softening one here costs more than the miss itself.

If an expectation now looks wrong or badly worded, say so in the notes and leave
`RECORDING-SCRIPT.md` untouched.
