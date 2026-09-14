/**
 * The phrasing pass makes one structural promise: it words the steps it was
 * given, all of them, once each, in order. `findStepMismatch` is what enforces
 * that, so it is tested directly - offline, with no model involved.
 */
import { describe, expect, it } from 'vitest';

import { findStepMismatch } from '../src/modules/authoring/phrase.js';
import type { DraftStep } from '../src/schemas/draft.js';
import type { PhrasingResponse } from '../src/schemas/draft.js';

function step(eventId: string, index: number): DraftStep {
  return {
    index,
    event_id: eventId,
    t_start: index,
    t_end: index + 1,
    screenshot_t: index,
    observation: `observation ${eventId}`,
    target: null,
    notes: [],
    flags: [],
    instruction: null,
    verification: null,
  };
}

const draftSteps = [step('e1', 1), step('e2', 2), step('e3', 3)];

const response = (ids: string[]): PhrasingResponse => ({
  steps: ids.map((id) => ({ event_id: id, instruction: `Do ${id}.` })),
});

describe('findStepMismatch', () => {
  it('accepts the same ids in the same order', () => {
    expect(findStepMismatch(draftSteps, response(['e1', 'e2', 'e3']))).toBeNull();
  });

  it('rejects an added step', () => {
    expect(findStepMismatch(draftSteps, response(['e1', 'e2', 'e3', 'e4']))).toBe(
      'expected 3 steps, received 4',
    );
  });

  it('rejects a dropped step', () => {
    expect(findStepMismatch(draftSteps, response(['e1', 'e3']))).toBe(
      'expected 3 steps, received 2',
    );
  });

  it('rejects reordered steps', () => {
    expect(findStepMismatch(draftSteps, response(['e1', 'e3', 'e2']))).toBe(
      'step 2 should be "e2" but is "e3"',
    );
  });

  it('rejects an id that was never given', () => {
    expect(findStepMismatch(draftSteps, response(['e1', 'e9', 'e3']))).toBe(
      'step 2 should be "e2" but is "e9"',
    );
  });

  it('rejects one step worded twice', () => {
    expect(findStepMismatch(draftSteps, response(['e1', 'e1', 'e3']))).toBe('repeated event_id e1');
  });

  it('accepts an empty response for an empty draft', () => {
    expect(findStepMismatch([], response([]))).toBeNull();
  });
});
