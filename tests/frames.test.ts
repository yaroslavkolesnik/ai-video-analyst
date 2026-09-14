/**
 * Frame extraction, checked offline. The timestamp choice is pure and tested as
 * such; the ffmpeg call is tested for real against the recording in the repo,
 * which needs no key and no network.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { FRAME_SETTINGS, extractFrames, planFramePairs } from '../src/modules/frames.js';
import type { DraftStep } from '../src/schemas/draft.js';

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');
const videoA = resolve(projectRoot, 'fixtures/videos/A.mp4');

function step(eventId: string, screenshotT: number, tEnd: number): DraftStep {
  return {
    index: 1,
    event_id: eventId,
    t_start: screenshotT,
    t_end: tEnd,
    screenshot_t: screenshotT,
    observation: 'observation',
    target: null,
    notes: [],
    flags: [],
    instruction: null,
    verification: null,
  };
}

describe('planFramePairs', () => {
  it('takes the shot at screenshot_t and the after at t_end', () => {
    expect(planFramePairs([step('e1', 12, 14)], 44.2)).toEqual([
      { event_id: 'e1', shot_t: 12, after_t: 14, clamped: false },
    ]);
  });

  it('pulls a timestamp past the end back inside the recording', () => {
    const [plan] = planFramePairs([step('e1', 12, 60)], 44.2);

    expect(plan?.after_t).toBeCloseTo(44.2 - FRAME_SETTINGS.endGuardSec, 5);
    expect(plan?.clamped).toBe(true);
  });

  it('pulls a negative timestamp up to zero', () => {
    const [plan] = planFramePairs([step('e1', -3, 5)], 44.2);

    expect(plan?.shot_t).toBe(0);
    expect(plan?.clamped).toBe(true);
  });

  it('keeps one plan per step, in order', () => {
    const plans = planFramePairs([step('e1', 1, 2), step('e2', 3, 4), step('e3', 5, 6)], 44.2);

    expect(plans.map((plan) => plan.event_id)).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('extractFrames, against the real recording', () => {
  const outputRoot = mkdtempSync(resolve(tmpdir(), 'frames-test-'));

  afterAll(() => {
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it('cuts a readable PNG at the capped width', async () => {
    const pairs = await extractFrames(videoA, [step('e1', 12, 14)], 44.2, { outputRoot });

    const pair = pairs[0];
    expect(pair?.shot.slot).toBe('shot');
    expect(pair?.after.slot).toBe('after');
    expect(pair?.shot.publicPath).toBe('frames/A/e1-shot.png');

    const bytes = readFileSync(pair?.shot.path ?? '');
    // PNG signature, then width and height from the IHDR chunk.
    expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.readUInt32BE(16)).toBe(FRAME_SETTINGS.maxWidthPx);
    expect(bytes.readUInt32BE(20)).toBe(688); // 1032 scaled from 1920 to 1280
  }, 30_000);

  it('cuts different frames for the two slots', async () => {
    const pairs = await extractFrames(videoA, [step('e1', 12, 26)], 44.2, { outputRoot });
    const pair = pairs[0];

    const shot = readFileSync(pair?.shot.path ?? '');
    const after = readFileSync(pair?.after.path ?? '');

    expect(shot.equals(after)).toBe(false);
  }, 30_000);
});
