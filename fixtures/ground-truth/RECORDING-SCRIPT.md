# Recording script & pre-registered expectations

Written **before** any pipeline run, deliberately. Once the product has been run
on these videos it becomes impossible to tell a genuine expectation from a
rationalised one, and the evidence is worth nothing. Nothing in this file may be
edited after the first pipeline run — actual results go in `DELIVERY_NOTES.md`
instead.

## Setup for every take

- `npm run demo-app` → record **http://localhost:4173/** in a normal Chrome window
  (no MCP/extension tab groups: their coloured label shows up in the frame).
- Window ≥ 1280 px wide. Below that the model cannot reliably read the UI text.
- Click **Reset filters** before each take. It clears filters, unticks the
  checkbox and hides the success banner.
- One speaker, English, whole take under 2 minutes.
- Keep the pointer still for ~1s after each click. Frames are sampled at 1 FPS;
  a click and its effect inside the same 300 ms can land between two frames.
- Let the success banner stay on screen ~3s at the end. It is the visible
  success state, and it prints the exported column list — that text is what the
  grounding pass reads back.

Verified row counts (checked in-browser 2026-09-12):

| Status | Date range | Rows |
|---|---|---|
| All statuses | All time | 12 |
| Shipped | All time | 6 |
| Shipped | Last 7 days | 2 |
| Shipped | Last 30 days | 4 |
| Pending | All time | 4 |
| Pending | Last 30 days | 3 |
| Cancelled | All time | 2 |

---

## Video A — the normal case

Contains all three things the brief asks for: a necessary silent action, a
mistaken choice that gets corrected, and a visible success state.

| # | Action | Say out loud |
|---|---|---|
| 1 | — | "I'll export our shipped orders from the last month." |
| 2 | Status → **Shipped** (12 → 6) | "First I filter by status, Shipped." |
| 3 | Date range → **Last 7 days** (6 → 2) | "Then the date range, last seven days." |
| 4 | Date range → **Last 30 days** (2 → 4) | "Actually no, I need the last thirty days, not seven." |
| 5 | Click **Export CSV** (dialog, "4 orders") | "Now export." |
| 6 | Tick **Include customer email** | **say nothing — this is the silent step** |
| 7 | Click **Export CSV** in the dialog | "And that's the file." |
| 8 | Let the banner sit ~3s | — |

The silent step is not cosmetic: with it the CSV has an Email column, without it
it does not. A reader who follows a guide that dropped step 6 produces a
measurably different file. That makes "did the guide keep the silent step?" an
objective check, not a matter of taste.

**Pre-registered expectation — `status: ok`**

- 5 steps: Shipped filter, Last 30 days, open Export, tick Include customer
  email, confirm Export.
- **Last 7 days must NOT appear as a step.** It belongs in `discarded`, marked
  as superseded by Last 30 days.
- **Last 30 days must appear as a step** — the final chosen setting survives.
- The checkbox step is present and flagged `silent_action`.
- `has_success_state: true`, banner reading `Exported 4 orders to
  orders-shipped-last30days.csv`.
- `missing_steps: []`, `clarifications: []`.
- All steps `supported` by grounding. `verified_ratio: 1.0`.

---

## Video B — one changed setting

Same operation, one setting different and the sequence reordered. This is the
brief's regression check: the guide must change in exactly this one place and
nowhere else.

| # | Action | Say out loud |
|---|---|---|
| 1 | Date range → **Last 30 days** (12 → 8) | "Starting with the date range this time, last thirty days." |
| 2 | Status → **Pending** (8 → 3) | "And I want the pending ones." |
| 3 | Click **Export CSV** (dialog, "3 orders") | "Export." |
| 4 | Tick **Include customer email** | say nothing |
| 5 | Click **Export CSV** in the dialog | "Done." |

**Pre-registered expectation — `status: ok`**

- 5 steps, no mistake and so an empty `discarded`.
- Status step reads **Pending**, not Shipped.
- Filters appear in the recorded order: date range first.
- Banner: `Exported 3 orders to orders-pending-last30days.csv`.
- Diffed against A, the only substantive differences are the status value, the
  order of the two filter steps, and the row count. Anything else differing is
  a finding to report.

---

## Video C — a critical step cut out

Record A, then cut the middle in any editor: the take must jump from "Status →
Shipped" straight to a screen where **Last 30 days is already selected and 4
rows are showing**, with the date-range click never visible.

**Pre-registered expectation — `status: needs_clarification`**

- A `missing_steps` entry with `severity: "critical"`, positioned after the
  status step, describing that the row count dropped and the date range changed
  with no visible cause.
- **No invented click.** The words "Last 30 days" may appear in a gap warning,
  but there must be no numbered step claiming the user clicked it. A numbered
  step here is a straight failure of the brief and gets reported as one.
- The remaining steps still come through and are still grounded.

---

## Video D — narration contradicts the screen

| # | Action | Say out loud |
|---|---|---|
| 1 | Status → **Pending** | **"I'm setting the status to Shipped."** |
| 2 | Date range → Last 30 days (→ 3) | "Last thirty days." |
| 3 | Export → tick checkbox → confirm | "Export." |

**Pre-registered expectation — `status: needs_clarification`**

- The step describes what the **screen** shows (Pending), not what was said.
- One `clarifications` entry quoting both sides: spoken "Shipped" vs screen
  "Pending".
- That step must not be counted as verified.
- Getting Shipped into the step text, silently and with no question raised, is
  the exact failure mode the brief is testing for.

---

## Video E — should be refused

Two unrelated operations in one take: first export a CSV, then use
**Mark shipped** on a Pending row to change an order's status. No narration
tying them together.

**Pre-registered expectation — `status: declined`**

- `decline_reason: "multiple_operations"` (`is_single_operation: false`).
- No guide produced.
- Grounding is never called — check the metrics panel shows **0 API calls** for
  that stage. Refusing after paying for verification would be a design bug, not
  just a wasted cent.

---

## What counts as a failure

Recorded here so it cannot be softened later:

1. Any numbered step the recording does not visibly show.
2. `Last 7 days` surviving into A's recommended path.
3. `Last 30 days` missing from A's recommended path.
4. The silent checkbox step missing from A or B.
5. Claimed success where no banner was shown.
6. C producing a complete guide with no critical gap flagged.
7. D taking the narrator's word over the screen.
8. E producing a guide instead of declining.
