/**
 * The two pure pieces of the grounding pass: what counts as verified, and what
 * makes a cached verdict still answer the question it was asked.
 */
import { describe, expect, it } from 'vitest';

import { summariseVerdicts, verdictCacheKey } from '../src/modules/grounding.js';
import type { Verdict } from '../src/schemas/draft.js';

function verdict(eventId: string, result: Verdict['result']): Verdict {
  return {
    event_id: eventId,
    result,
    evidence_text: null,
    reasoning: 'reasoning',
    frames: { shot: `frames/A/${eventId}-shot.png`, after: `frames/A/${eventId}-after.png` },
    unavailable_reason: null,
  };
}

describe('summariseVerdicts', () => {
  it('counts only supported steps', () => {
    expect(
      summariseVerdicts([verdict('e1', 'supported'), verdict('e2', 'supported')]),
    ).toBe(1);
  });

  it('does not count a contradicted step as verified', () => {
    expect(summariseVerdicts([verdict('e1', 'supported'), verdict('e2', 'contradicted')])).toBe(0.5);
  });

  it('does not count an unclear step as verified', () => {
    expect(summariseVerdicts([verdict('e1', 'supported'), verdict('e2', 'unclear')])).toBe(0.5);
  });

  it('is zero when nothing was verified', () => {
    expect(summariseVerdicts([verdict('e1', 'unclear')])).toBe(0);
    expect(summariseVerdicts([])).toBe(0);
  });
});

describe('verdictCacheKey', () => {
  const shot = Buffer.from('frame one');
  const after = Buffer.from('frame two');
  const instruction = 'Select Shipped from the Status dropdown.';
  const model = 'gemini-3.7-flash';

  it('is stable for the same frames, sentence and model', () => {
    expect(verdictCacheKey(instruction, shot, after, model)).toBe(
      verdictCacheKey(instruction, shot, after, model),
    );
  });

  it('changes when the sentence changes', () => {
    expect(verdictCacheKey(instruction, shot, after, model)).not.toBe(
      verdictCacheKey('Select Pending from the Status dropdown.', shot, after, model),
    );
  });

  it('changes when a frame changes', () => {
    expect(verdictCacheKey(instruction, shot, after, model)).not.toBe(
      verdictCacheKey(instruction, Buffer.from('different pixels'), after, model),
    );
  });

  it('changes when the model changes', () => {
    expect(verdictCacheKey(instruction, shot, after, model)).not.toBe(
      verdictCacheKey(instruction, shot, after, 'gemini-3.8-flash'),
    );
  });

  it('does not confuse the two frames for each other', () => {
    expect(verdictCacheKey(instruction, shot, after, model)).not.toBe(
      verdictCacheKey(instruction, after, shot, model),
    );
  });
});
