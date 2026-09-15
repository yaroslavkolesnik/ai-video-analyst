/**
 * Assembly settles the final status, and it is the first stage that can - the
 * verified ratio does not exist until frames have been checked. The ladder and
 * the Markdown it produces are both pure, so both are tested offline.
 */
import { describe, expect, it } from 'vitest';

import { assembleGuide, resolveStatus, verifiedRatio } from '../src/modules/assemble.js';
import { renderGuideMarkdown } from '../src/modules/markdown.js';
import type { PhrasedGuide, PhrasedStep, Verdict } from '../src/schemas/draft.js';
import type { AppContext } from '../src/schemas/timeline.js';

const context: AppContext = {
  app_label: 'an orders management table',
  operation_label: 'export filtered orders to CSV',
  operation_confidence: 1,
  is_single_operation: true,
  is_screen_recording: true,
};

const source = { filename: 'A.mp4', durationSec: 44.2, sha256: 'a'.repeat(64) };

function step(eventId: string, index: number, overrides: Partial<PhrasedStep> = {}): PhrasedStep {
  return {
    index,
    event_id: eventId,
    t_start: index * 10,
    t_end: index * 10 + 2,
    screenshot_t: index * 10,
    observation: `observation ${eventId}`,
    target: null,
    notes: [],
    flags: [],
    instruction: `Do the thing for ${eventId}.`,
    verification: null,
    ...overrides,
  };
}

function verdict(eventId: string, result: Verdict['result'], overrides: Partial<Verdict> = {}): Verdict {
  return {
    event_id: eventId,
    result,
    evidence_text: 'Shipped',
    reasoning: 'The frames show the control and its effect.',
    frames: { shot: `frames/A/${eventId}-shot.png`, after: `frames/A/${eventId}-after.png` },
    unavailable_reason: null,
    ...overrides,
  };
}

function guide(overrides: Partial<PhrasedGuide> = {}): PhrasedGuide {
  return {
    schema_version: 'draft/1',
    status: 'ok',
    decline_reason: null,
    steps: [step('e1', 1), step('e2', 2)],
    discarded: [],
    missing_steps: [],
    clarifications: [],
    unverifiable: [],
    has_success_state: true,
    starting_state: null,
    warnings: [],
    ...overrides,
  };
}

describe('verifiedRatio', () => {
  it('counts only supported verdicts', () => {
    expect(verifiedRatio([verdict('e1', 'supported'), verdict('e2', 'contradicted')])).toBe(0.5);
    expect(verifiedRatio([verdict('e1', 'supported'), verdict('e2', 'unclear')])).toBe(0.5);
  });
});

describe('resolveStatus', () => {
  const base = {
    declineReason: null,
    stepCount: 5,
    clarificationCount: 0,
    hasCriticalGap: false,
    warningCount: 0,
    ratio: 1,
  };

  it('is ok when everything was confirmed and nothing was flagged', () => {
    expect(resolveStatus(base)).toBe('ok');
  });

  it('drops to needs_clarification below the verified-ratio threshold', () => {
    expect(resolveStatus({ ...base, ratio: 0.4 })).toBe('needs_clarification');
    expect(resolveStatus({ ...base, ratio: 0.6 })).toBe('ok');
  });

  it('needs clarification when a question was raised', () => {
    expect(resolveStatus({ ...base, clarificationCount: 1 })).toBe('needs_clarification');
  });

  it('needs clarification when a critical step is missing', () => {
    expect(resolveStatus({ ...base, hasCriticalGap: true })).toBe('needs_clarification');
  });

  it('declines when there are no steps', () => {
    expect(resolveStatus({ ...base, stepCount: 0 })).toBe('declined');
  });
});

describe('assembleGuide', () => {
  it('carries the verdict and its frame onto every step', () => {
    const doc = assembleGuide({
      guide: guide(),
      verdicts: [verdict('e1', 'supported'), verdict('e2', 'supported')],
      context,
      source,
    });

    expect(doc.status).toBe('ok');
    expect(doc.verified_ratio).toBe(1);
    expect(doc.steps[0]?.screenshot_url).toBe('frames/A/e1-shot.png');
    expect(doc.steps[0]?.timestamp_label).toBe('0:10');
    expect(doc.title).toBe('export filtered orders to CSV');
  });

  it('keeps a contradicted step and warns instead of deleting it', () => {
    const doc = assembleGuide({
      guide: guide(),
      verdicts: [verdict('e1', 'supported'), verdict('e2', 'contradicted')],
      context,
      source,
    });

    expect(doc.steps).toHaveLength(2);
    // The warning names what the frames did not establish, not a verdict on the
    // step: a reader who reads 'contradicted' as 'do not do this' loses a real
    // column, which is exactly what following A's guide by hand showed.
    expect(doc.warnings.join(' ')).toContain('Step 2 is not confirmed by the two frames checked');
    // Here the ratio itself is what drops the status: 0.5 is under the threshold.
    expect(doc.verified_ratio).toBe(0.5);
    expect(doc.status).toBe('needs_clarification');
  });

  it('never reads as plain ok while a step stands contradicted', () => {
    const doc = assembleGuide({
      guide: guide({ steps: [step('e1', 1), step('e2', 2), step('e3', 3), step('e4', 4), step('e5', 5)] }),
      verdicts: [
        verdict('e1', 'supported'),
        verdict('e2', 'supported'),
        verdict('e3', 'supported'),
        verdict('e4', 'supported'),
        verdict('e5', 'contradicted'),
      ],
      context,
      source,
    });

    // 0.8 clears the verified-ratio threshold, so the ladder alone would say
    // "ok". The warning raised by the contradiction is what stops it.
    expect(doc.verified_ratio).toBe(0.8);
    expect(doc.status).toBe('ok_with_warnings');
  });

  it('says plainly when a step was never checked', () => {
    const doc = assembleGuide({
      guide: guide(),
      verdicts: [
        verdict('e1', 'supported'),
        verdict('e2', 'unclear', { unavailable_reason: 'daily free-tier quota exhausted' }),
      ],
      context,
      source,
    });

    expect(doc.warnings.join(' ')).toContain('never checked');
  });

  it('refuses to assemble a step with no verdict', () => {
    expect(() =>
      assembleGuide({ guide: guide(), verdicts: [verdict('e1', 'supported')], context, source }),
    ).toThrow(/has no verdict/);
  });
});

describe('renderGuideMarkdown', () => {
  const doc = assembleGuide({
    guide: guide({
      steps: [step('e1', 1, { flags: ['silent_action'] }), step('e2', 2)],
      discarded: [
        {
          event_id: 'e3',
          t_start: 17,
          observation: "Selects 'Last 7 days'.",
          superseded_by_event_id: 'e2',
          superseded_by_observation: "Selects 'Last 30 days'.",
        },
      ],
      missing_steps: [
        { after_step_index: 1, t_gap: 15, what_changed: 'The row count changed.', severity: 'critical' },
      ],
      clarifications: [
        {
          event_id: 'e2',
          t: 28,
          question: 'At 0:28 the narrator said "Shipped" but the screen shows "Pending". Which was intended?',
          spoken_claim: 'Shipped',
          screen_shows: 'Pending',
        },
      ],
    }),
    verdicts: [verdict('e1', 'supported'), verdict('e2', 'unclear')],
    context,
    source,
  });

  const markdown = renderGuideMarkdown(doc, { imageBasePath: '../../public/' });

  it('links each screenshot under the given base path', () => {
    expect(markdown).toContain('![Step 1](../../public/frames/A/e1-shot.png)');
  });

  it('shows a badge for every step, including the unverified one', () => {
    expect(markdown).toContain('confirmed on frames');
    expect(markdown).toContain('frames inconclusive');
  });

  it('states the unrecorded starting state above the steps, not as a step', () => {
    const marker = 'Starting state was not recorded.';
    expect(markdown).toContain(marker);
    expect(markdown.indexOf(marker)).toBeLessThan(markdown.indexOf('## Steps'));
    // It must never be numbered: no step heading may carry it.
    expect(markdown).not.toMatch(/### d+. Starting state/);
  });

  it('puts the questions before the steps', () => {
    expect(markdown.indexOf('Questions before you start')).toBeLessThan(markdown.indexOf('## Steps'));
  });

  it('prints the gap in the flow, not in a footnote', () => {
    expect(markdown).toContain('Something is missing here');
    expect(markdown).toContain('no step was invented to explain it');
  });

  it('keeps abandoned attempts visible and out of the steps', () => {
    expect(markdown).toContain('Abandoned attempts');
    expect(markdown).toContain("Selects 'Last 7 days'.");
    expect(markdown).not.toContain("### 3. Selects 'Last 7 days'.");
  });

  it('marks the silent step, which a reader would otherwise skip', () => {
    expect(markdown).toContain('done silently');
  });

  it('records the source file it was built from', () => {
    expect(markdown).toContain('A.mp4');
    expect(markdown).toContain(source.sha256.slice(0, 16));
  });
});
