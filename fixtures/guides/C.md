# Filter orders by status and date range and export to CSV

In an orders management table.

❓ **Needs clarification** — something in the recording is unresolved.

**1 of 5 steps** confirmed against frames from the recording (`verified_ratio` 0.20).

## Warnings

- Step 1 is not confirmed by the two frames checked: In Frame 2, the Status dropdown still displays 'All statuses' rather than 'Shipped', and no menu is open. The step may still be correct - this says the frames did not establish it, not that the instruction is wrong.
- Step 2 was never checked against its frames ({"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}).
- Step 3 was never checked against its frames ({"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}).
- Step 4 was never checked against its frames ({"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}).

> **Start from this state.** Initial table view displays filters set to Status: "All statuses", Date range: "All time", and indicates "Showing 12 of 12 orders". This is what the recording showed before the first action, read off the screen rather than assumed.

## Steps

### 1. Select "Shipped" from the Status dropdown menu.

`0:09` · frames don't show this

Checked against two sampled frames only. The step may still be correct — read this as *unconfirmed*, not as *wrong*.

![Step 1](../../public/frames/C/e2-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “All statuses”
- **Verdict:** In Frame 2, the Status dropdown still displays 'All statuses' rather than 'Shipped', and no menu is open.
- **Frames:** `frames/C/e2-shot.png`, `frames/C/e2-after.png`

</details>

### 2. Select "Last 30 days" from the Date range dropdown menu.

`0:13` · not checked

> 🔇 done silently — easy to miss, and the result changes without it

![Step 2](../../public/frames/C/e4-shot.png)

<details><summary>How this step was checked</summary>

- **Verdict:** This step was never checked against its frames.
- **Not checked:** {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
- **Frames:** `frames/C/e4-shot.png`, `frames/C/e4-after.png`

</details>

### 3. Click the "Export CSV" button above the table.

`0:16` · not checked

![Step 3](../../public/frames/C/e6-shot.png)

<details><summary>How this step was checked</summary>

- **Verdict:** This step was never checked against its frames.
- **Not checked:** {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
- **Frames:** `frames/C/e6-shot.png`, `frames/C/e6-after.png`

</details>

### 4. Check the "Include customer email" checkbox in the "Export filtered orders" modal dialog.

`0:19` · not checked

> 🔇 done silently — easy to miss, and the result changes without it

![Step 4](../../public/frames/C/e7-shot.png)

<details><summary>How this step was checked</summary>

- **Verdict:** This step was never checked against its frames.
- **Not checked:** {"error":{"code":503,"message":"This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.","status":"UNAVAILABLE"}}
- **Frames:** `frames/C/e7-shot.png`, `frames/C/e7-after.png`

</details>

### 5. Click the "Export CSV" confirmation button inside the modal dialog.

`0:21` · confirmed on frames

> 🔇 done silently — easy to miss, and the result changes without it

![Step 5](../../public/frames/C/e8-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** The cursor is positioned over and clicks the 'Export CSV' button within the modal dialog.
- **Frames:** `frames/C/e8-shot.png`, `frames/C/e8-after.png`

</details>

---

Built from `C.mp4` (29.3 s), sha256 `9e0cfad1d869422f…`.

Each step above was checked on its own against two frames cut from that file — one where the control is still visible, one where its effect should be. No step was written from narration alone.

