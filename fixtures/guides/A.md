# Export filtered orders to CSV

In an orders management table.

⚠️ **Ready, with warnings** — see the notes below before following it.

**4 of 5 steps** confirmed against frames from the recording (`verified_ratio` 0.80).

## Warnings

- Step 4 is contradicted by the recording: In both Frame 1 and Frame 2, the 'Include customer email' checkbox remains unchecked.

## Steps

### 1. Select Shipped from the Status dropdown.

`0:11` · ✅ verified

![Step 1](../../public/frames/A/e1-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Shipped”
- **Verdict:** Frame 1 shows the Status dropdown set to 'All statuses', and Frame 2 shows 'Shipped' selected in the Status dropdown, filtering the orders.
- **Frames:** `frames/A/e1-shot.png`, `frames/A/e1-after.png`

</details>

### 2. Select Last 30 days from the Date range dropdown.

`0:24` · ✅ verified

![Step 2](../../public/frames/A/e5-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Last 30 days”
- **Verdict:** Frame 1 shows the Date range dropdown set to 'Last 7 days', and Frame 2 shows that 'Last 30 days' has been selected, updating the order results.
- **Frames:** `frames/A/e5-shot.png`, `frames/A/e5-after.png`

</details>

### 3. Click the Export CSV button in the upper right corner.

`0:28` · ✅ verified

> 🔇 done silently — easy to miss, and the result changes without it

![Step 3](../../public/frames/A/e7-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** Frame 1 shows the 'Export CSV' button in the upper right corner, and Frame 2 shows the cursor clicking it, which opens the 'Export filtered orders' modal.
- **Frames:** `frames/A/e7-shot.png`, `frames/A/e7-after.png`

</details>

### 4. Check the Include customer email checkbox inside the export modal.

`0:30` · ❌ contradicted by the recording

> 🔇 done silently — easy to miss, and the result changes without it

![Step 4](../../public/frames/A/e8-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Include customer email”
- **Verdict:** In both Frame 1 and Frame 2, the 'Include customer email' checkbox remains unchecked.
- **Frames:** `frames/A/e8-shot.png`, `frames/A/e8-after.png`

</details>

### 5. Click the Export CSV confirmation button inside the modal dialog.

`0:34` · ✅ verified

![Step 5](../../public/frames/A/e9-shot.png)

<details><summary>How this step was checked</summary>

- **Read from the screen:** “Export CSV”
- **Verdict:** The frames show the mouse cursor positioned over and clicking the 'Export CSV' button within the 'Export filtered orders' modal dialog.
- **Frames:** `frames/A/e9-shot.png`, `frames/A/e9-after.png`

</details>

## Abandoned attempts

These were tried in the recording and then replaced. They are **not** part of the steps above, and are listed so the correction is visible rather than silently dropped.

<details><summary>Show what was tried</summary>

- At `0:17`: Select 'Last 7 days' from the Date range dropdown.
  - Replaced by: Select 'Last 30 days' from the Date range dropdown, replacing 'Last 7 days'.

</details>

---

Built from `A.mp4` (44.2 s), sha256 `473b933751213858…`.

Each step above was checked on its own against two frames cut from that file — one where the control is still visible, one where its effect should be. No step was written from narration alone.

