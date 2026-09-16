# Filter orders and export to CSV

In an orders management table.

❓ **Needs clarification** — something in the recording is unresolved.

**2 of 5 steps** confirmed against frames from the recording (`verified_ratio` 0.40).

## Questions before you start

- At 0:06 the narrator said "I am setting the status to Shipped." but the screen shows "Status selected is Pending.". Which was intended?

## Warnings

- Step 1 is not confirmed by the two frames checked: In Frame 2, the Status dropdown still displays 'All statuses' rather than 'Pending', and no dropdown options are visible. The step may still be correct - this says the frames did not establish it, not that the instruction is wrong.
- Step 3 is not confirmed by the two frames checked: Between Frame 1 and Frame 2, the cursor moves into the 'Search customer' input field rather than clicking the 'Export CSV' button. The step may still be correct - this says the frames did not establish it, not that the instruction is wrong.

> **Start from this state.** Initial state: Status is "All statuses", Date range is "All time", Search customer is empty, and count shows "Showing 12 of 12 orders". This is what the recording showed before the first action, read off the screen rather than assumed.

## Steps

### 1. Select "Pending" from the Status dropdown.

`0:06` · frames don't show this

Checked against two sampled frames only. The step may still be correct — read this as *unconfirmed*, not as *wrong*.

> 🗣️ the narration said something different here

![Step 1](../../public/frames/D/e2-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “All statuses”
- **Verdict:** In Frame 2, the Status dropdown still displays 'All statuses' rather than 'Pending', and no dropdown options are visible.
- **Frames:** `frames/D/e2-shot.png`, `frames/D/e2-after.png`

</details>

### 2. Change the Date range dropdown to "Last 30 days".

`0:10` · frames inconclusive

![Step 2](../../public/frames/D/e4-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “All time”
- **Verdict:** Frame 2 shows the Date range dropdown focused, but its value remains 'All time' and no option for 'Last 30 days' is shown yet, indicating the frame was captured at the wrong moment before the selection occurred.
- **Frames:** `frames/D/e4-shot.png`, `frames/D/e4-after.png`

</details>

### 3. Click the "Export CSV" button at the top right of the table.

`0:13` · frames don't show this

Checked against two sampled frames only. The step may still be correct — read this as *unconfirmed*, not as *wrong*.

![Step 3](../../public/frames/D/e6-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** Between Frame 1 and Frame 2, the cursor moves into the 'Search customer' input field rather than clicking the 'Export CSV' button.
- **Frames:** `frames/D/e6-shot.png`, `frames/D/e6-after.png`

</details>

### 4. Check the "Include customer email" checkbox in the export modal.

`0:15` · confirmed on frames

> 🔇 done silently — easy to miss, and the result changes without it

![Step 4](../../public/frames/D/e7-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Include customer email”
- **Verdict:** The export modal displays the "Include customer email" checkbox control, and Frame 2 shows the cursor hovering over it.
- **Frames:** `frames/D/e7-shot.png`, `frames/D/e7-after.png`

</details>

### 5. Click the "Export CSV" button inside the export modal.

`0:16` · confirmed on frames

> 🔇 done silently — easy to miss, and the result changes without it

![Step 5](../../public/frames/D/e8-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** Frame 2 shows the cursor clicking the 'Export CSV' button within the 'Export filtered orders' modal dialog.
- **Frames:** `frames/D/e8-shot.png`, `frames/D/e8-after.png`

</details>

---

Built from `D.mp4` (24.8 s), sha256 `11740ececf074add…`.

Each step above was checked on its own against two frames cut from that file — one where the control is still visible, one where its effect should be. No step was written from narration alone.

