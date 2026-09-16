# Export filtered orders to CSV

In an orders management table.

⚠️ **Ready, with warnings** — see the notes below before following it.

**4 of 5 steps** confirmed against frames from the recording (`verified_ratio` 0.80).

## Warnings

- Step 4 is not confirmed by the two frames checked: Between Frame 1 and Frame 2, the checkbox labeled 'Include customer email' remains unchecked despite the cursor hovering over it. The step may still be correct - this says the frames did not establish it, not that the instruction is wrong.

> **Start from this state.** The orders table is displayed with Status set to 'All statuses', Date range set to 'All time', and displaying 'Showing 12 of 12 orders'. This is what the recording showed before the first action, read off the screen rather than assumed.

## Steps

### 1. Select 'Shipped' from the Status dropdown filter.

`0:11` · confirmed on frames

![Step 1](../../public/frames/A/e2-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Shipped”
- **Verdict:** In Frame 1, the Status dropdown is set to 'All statuses'. In Frame 2, the Status dropdown has been changed to 'Shipped', filtering the table to only show shipped orders.
- **Frames:** `frames/A/e2-shot.png`, `frames/A/e2-after.png`

</details>

### 2. Select 'Last 30 days' from the Date range dropdown filter.

`0:23` · confirmed on frames

![Step 2](../../public/frames/A/e6-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Last 30 days”
- **Verdict:** Frame 1 shows the 'Date range' dropdown set to 'Last 7 days', while Frame 2 shows it successfully updated to 'Last 30 days'.
- **Frames:** `frames/A/e6-shot.png`, `frames/A/e6-after.png`

</details>

### 3. Click the 'Export CSV' button.

`0:28` · confirmed on frames

> 🔇 done silently — easy to miss, and the result changes without it

![Step 3](../../public/frames/A/e8-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** Frame 1 displays the 'Export CSV' button in the upper right corner, and Frame 2 shows the resulting 'Export filtered orders' modal dialog opened.
- **Frames:** `frames/A/e8-shot.png`, `frames/A/e8-after.png`

</details>

### 4. Click the 'Include customer email' checkbox inside the modal dialog to check it.

`0:30` · frames don't show this

Checked against two sampled frames only. The step may still be correct — read this as *unconfirmed*, not as *wrong*.

> 🔇 done silently — easy to miss, and the result changes without it

![Step 4](../../public/frames/A/e9-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Include customer email”
- **Verdict:** Between Frame 1 and Frame 2, the checkbox labeled 'Include customer email' remains unchecked despite the cursor hovering over it.
- **Frames:** `frames/A/e9-shot.png`, `frames/A/e9-after.png`

</details>

### 5. Click the 'Export CSV' button inside the modal dialog.

`0:33` · confirmed on frames

![Step 5](../../public/frames/A/e10-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** The cursor is positioned directly over and clicks the 'Export CSV' button in the 'Export filtered orders' modal dialog.
- **Frames:** `frames/A/e10-shot.png`, `frames/A/e10-after.png`

</details>

## Abandoned attempts

These were tried in the recording and then replaced. They are **not** part of the steps above, and are listed so the correction is visible rather than silently dropped.

<details><summary>Show what was tried</summary>

- At `0:17`: The user selects 'Last 7 days' from the Date range dropdown filter.
  - Replaced by: The user selects 'Last 30 days' from the Date range dropdown filter.

</details>

---

Built from `A.mp4` (44.2 s), sha256 `473b933751213858…`.

Each step above was checked on its own against two frames cut from that file — one where the control is still visible, one where its effect should be. No step was written from narration alone.

