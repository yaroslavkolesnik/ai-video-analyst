# Export filtered orders to CSV

In an orders management table.

❓ **Needs clarification** — something in the recording is unresolved.

**2 of 5 steps** confirmed against frames from the recording (`verified_ratio` 0.40).

## Warnings

- Step 2 is not confirmed by the two frames checked: In Frame 2, the Status dropdown still displays 'All statuses' rather than 'Pending', meaning the selection was not made. The step may still be correct - this says the frames did not establish it, not that the instruction is wrong.

> **Start from this state.** Starting state: Status is "All statuses", Date range is "All time", Search customer is empty, and table shows "Showing 12 of 12 orders". This is what the recording showed before the first action, read off the screen rather than assumed.

## Steps

### 1. Select "Last 30 days" from the Date range dropdown.

`0:05` · frames inconclusive

![Step 1](../../public/frames/B/e2-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “All time”
- **Verdict:** Between Frame 1 and Frame 2, the cursor moves toward the Date range dropdown, but the dropdown is not yet opened and still displays 'All time'. The frames capture the moment before the selection occurs.
- **Frames:** `frames/B/e2-shot.png`, `frames/B/e2-after.png`

</details>

### 2. Select "Pending" from the Status dropdown.

`0:11` · frames don't show this

Checked against two sampled frames only. The step may still be correct — read this as *unconfirmed*, not as *wrong*.

![Step 2](../../public/frames/B/e4-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “All statuses”
- **Verdict:** In Frame 2, the Status dropdown still displays 'All statuses' rather than 'Pending', meaning the selection was not made.
- **Frames:** `frames/B/e4-shot.png`, `frames/B/e4-after.png`

</details>

### 3. Click the Export CSV button.

`0:16` · confirmed on frames

![Step 3](../../public/frames/B/e6-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** Frame 1 shows the 'Export CSV' button in the upper right, and Frame 2 shows the cursor hovering over and clicking it.
- **Frames:** `frames/B/e6-shot.png`, `frames/B/e6-after.png`

</details>

### 4. Check the "Include customer email" checkbox in the Export filtered orders modal dialog.

`0:18` · frames inconclusive

> 🔇 done silently — easy to miss, and the result changes without it

![Step 4](../../public/frames/B/e7-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Include customer email”
- **Verdict:** The frames show the modal opening and the cursor hovering over the unchecked 'Include customer email' checkbox, but capture the wrong moment to confirm whether the checkbox was actually checked.
- **Frames:** `frames/B/e7-shot.png`, `frames/B/e7-after.png`

</details>

### 5. Click the "Export CSV" confirmation button in the modal dialog.

`0:19` · confirmed on frames

> 🔇 done silently — easy to miss, and the result changes without it

![Step 5](../../public/frames/B/e8-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** The frames show the mouse cursor positioned over and clicking the 'Export CSV' button within the 'Export filtered orders' modal dialog.
- **Frames:** `frames/B/e8-shot.png`, `frames/B/e8-after.png`

</details>

---

Built from `B.mp4` (26.8 s), sha256 `67007b34f9cb2b22…`.

Each step above was checked on its own against two frames cut from that file — one where the control is still visible, one where its effect should be. No step was written from narration alone.

