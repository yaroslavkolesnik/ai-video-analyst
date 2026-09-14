/**
 * The product's central claims, asserted offline and deterministically.
 *
 * Every test here runs without a network, a key or a cent. The real recording
 * of video A is included as a saved timeline, so the "normal case" is checked
 * against real model output rather than against a fixture written to pass.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { reduceTimeline } from '../src/modules/authoring/reduce.js';
import { RawTimelineSchema, type ObservedEvent, type RawTimeline } from '../src/schemas/timeline.js';

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');

function loadTimeline(name: string): RawTimeline {
  const raw = readFileSync(resolve(projectRoot, 'fixtures/timelines', `${name}.json`), 'utf8');
  return RawTimelineSchema.parse(JSON.parse(raw));
}

function event(overrides: Partial<ObservedEvent> & Pick<ObservedEvent, 'id'>): ObservedEvent {
  return {
    kind: 'ui_action',
    t_start: 1,
    t_end: 2,
    screenshot_t: 1,
    visible: true,
    spoken: true,
    observation: `observation for ${overrides.id}`,
    target: null,
    superseded_by: null,
    conflict: null,
    confidence: 1,
    ...overrides,
  };
}

function timeline(events: ObservedEvent[], context: Partial<RawTimeline['app_context']> = {}): RawTimeline {
  return {
    schema_version: 'timeline/1',
    app_context: {
      app_label: 'an orders management table',
      operation_label: 'export filtered orders to CSV',
      operation_confidence: 1,
      is_single_operation: true,
      is_screen_recording: true,
      ...context,
    },
    events,
    global_notes: [],
  };
}

describe('refusal gates', () => {
  it('declines a recording that is not a screen recording', () => {
    const draft = reduceTimeline(timeline([event({ id: 'e1' })], { is_screen_recording: false }));

    expect(draft.status).toBe('declined');
    expect(draft.decline_reason).toBe('not_a_screen_recording');
    expect(draft.steps).toEqual([]);
  });

  it('declines a recording holding more than one operation', () => {
    const draft = reduceTimeline(timeline([event({ id: 'e1' })], { is_single_operation: false }));

    expect(draft.status).toBe('declined');
    expect(draft.decline_reason).toBe('multiple_operations');
  });

  it('declines when the observer barely recognised the operation', () => {
    const draft = reduceTimeline(timeline([event({ id: 'e1' })], { operation_confidence: 0.2 }));

    expect(draft.decline_reason).toBe('low_operation_confidence');
  });

  it('declines when nothing visible was ever done', () => {
    const draft = reduceTimeline(
      timeline([event({ id: 'e1', kind: 'narration', visible: false })]),
    );

    expect(draft.decline_reason).toBe('no_visible_steps');
  });
});

describe('a step can only come from a visible action', () => {
  it('never turns narration into a step', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1' }),
        event({
          id: 'e2',
          kind: 'narration',
          visible: false,
          spoken: true,
          t_start: 20,
          t_end: 22,
          observation: 'The narrator says the report is then emailed to the team.',
        }),
      ]),
    );

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e1']);
  });

  it('never turns an invisible action into a step, and reports it as unverifiable', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1' }),
        event({ id: 'e2', visible: false, t_start: 5, observation: 'A filter appears to be applied off-screen.' }),
      ]),
    );

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e1']);
    expect(draft.unverifiable).toEqual(['e2']);
  });

  it('never turns observed state into a step', () => {
    const draft = reduceTimeline(
      timeline([event({ id: 'e1' }), event({ id: 'e2', kind: 'ui_state', t_start: 3 })]),
    );

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e1']);
  });
});

describe('abandoned attempts', () => {
  it('drops a superseded action and keeps the setting it was replaced by', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1', t_start: 5, superseded_by: 'e2', observation: 'Selects Last 7 days.' }),
        event({ id: 'e2', t_start: 9, observation: 'Selects Last 30 days.' }),
      ]),
    );

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e2']);
    expect(draft.discarded).toEqual([
      {
        event_id: 'e1',
        t_start: 5,
        observation: 'Selects Last 7 days.',
        superseded_by_event_id: 'e2',
        superseded_by_observation: 'Selects Last 30 days.',
      },
    ]);
  });

  it('follows a chain to its end, so only the final choice survives', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1', t_start: 1, superseded_by: 'e2' }),
        event({ id: 'e2', t_start: 2, superseded_by: 'e3' }),
        event({ id: 'e3', t_start: 3 }),
      ]),
    );

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e3']);
    expect(draft.discarded.map((attempt) => attempt.superseded_by_event_id)).toEqual(['e3', 'e3']);
  });

  it('keeps an action whose supersession points at an event that does not exist', () => {
    const draft = reduceTimeline(timeline([event({ id: 'e1', superseded_by: 'e99' })]));

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e1']);
    expect(draft.discarded).toEqual([]);
  });

  it('terminates on a cycle instead of looping forever', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1', t_start: 1, superseded_by: 'e2' }),
        event({ id: 'e2', t_start: 2, superseded_by: 'e1' }),
        event({ id: 'e3', t_start: 3 }),
      ]),
    );

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e3']);
  });
});

describe('gaps', () => {
  const withGap = (gapAt: number, successAt: number | null): RawTimeline =>
    timeline([
      event({ id: 'e1', t_start: 1 }),
      event({
        id: 'gap',
        kind: 'gap',
        visible: false,
        spoken: false,
        t_start: gapAt,
        t_end: gapAt,
        observation: 'The row count changed with no visible cause.',
      }),
      event({ id: 'e2', t_start: 20 }),
      ...(successAt === null
        ? []
        : [event({ id: 'done', kind: 'success_state', t_start: successAt, t_end: successAt + 2 })]),
    ]);

  it('flags a gap on the way to the outcome as critical', () => {
    const draft = reduceTimeline(withGap(10, 30));

    expect(draft.missing_steps).toEqual([
      {
        after_step_index: 1,
        t_gap: 10,
        what_changed: 'The row count changed with no visible cause.',
        severity: 'critical',
      },
    ]);
    expect(draft.status).toBe('needs_clarification');
  });

  it('invents no step to explain the gap', () => {
    const draft = reduceTimeline(withGap(10, 30));

    expect(draft.steps.map((step) => step.event_id)).toEqual(['e1', 'e2']);
  });

  it('marks the step that follows a gap', () => {
    const draft = reduceTimeline(withGap(10, 30));

    expect(draft.steps.find((step) => step.event_id === 'e2')?.flags).toContain('after_gap');
    expect(draft.steps.find((step) => step.event_id === 'e1')?.flags).not.toContain('after_gap');
  });

  it('treats a gap after the operation has finished as minor', () => {
    const draft = reduceTimeline(withGap(35, 30));

    expect(draft.missing_steps[0]?.severity).toBe('minor');
    expect(draft.status).toBe('ok_with_warnings');
  });
});

describe('contradictions', () => {
  const conflicted = timeline([
    event({
      id: 'e1',
      t_start: 28,
      conflict: { spoken_claim: 'Shipped', screen_shows: 'Pending' },
    }),
  ]);

  it('raises a clarification quoting both sides', () => {
    const draft = reduceTimeline(conflicted);

    expect(draft.clarifications).toEqual([
      {
        event_id: 'e1',
        t: 28,
        question:
          'At 0:28 the narrator said "Shipped" but the screen shows "Pending". Which was intended?',
        spoken_claim: 'Shipped',
        screen_shows: 'Pending',
      },
    ]);
  });

  it('keeps the step, flags it, and holds the whole guide back', () => {
    const draft = reduceTimeline(conflicted);

    expect(draft.steps).toHaveLength(1);
    expect(draft.steps[0]?.flags).toContain('conflict');
    expect(draft.status).toBe('needs_clarification');
  });
});

describe('success', () => {
  it('warns rather than claiming an outcome it never saw', () => {
    const draft = reduceTimeline(timeline([event({ id: 'e1' })]));

    expect(draft.has_success_state).toBe(false);
    expect(draft.status).toBe('ok_with_warnings');
    expect(draft.warnings).toHaveLength(1);
  });

  it('does not count a success state that was not visible', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1' }),
        event({ id: 'e2', kind: 'success_state', visible: false, t_start: 10 }),
      ]),
    );

    expect(draft.has_success_state).toBe(false);
  });
});

describe('narration notes', () => {
  it('attaches a nearby remark to the step it was about', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1', t_start: 10, t_end: 12 }),
        event({
          id: 'e2',
          kind: 'narration',
          visible: false,
          t_start: 11,
          t_end: 13,
          observation: 'The narrator explains that shipped orders are the ones already sent.',
        }),
      ]),
    );

    expect(draft.steps[0]?.notes).toEqual([
      'The narrator explains that shipped orders are the ones already sent.',
    ]);
  });

  it('leaves a remark made far from any step unattached', () => {
    const draft = reduceTimeline(
      timeline([
        event({ id: 'e1', t_start: 10, t_end: 12 }),
        event({ id: 'e2', kind: 'narration', visible: false, t_start: 90, t_end: 92 }),
      ]),
    );

    expect(draft.steps[0]?.notes).toEqual([]);
  });
});

describe('video A, reduced from the real recording', () => {
  const draft = reduceTimeline(loadTimeline('A'));

  it('produces a clean guide', () => {
    expect(draft.status).toBe('ok');
    expect(draft.decline_reason).toBeNull();
    expect(draft.missing_steps).toEqual([]);
    expect(draft.clarifications).toEqual([]);
    expect(draft.unverifiable).toEqual([]);
  });

  it('keeps the final date range and drops the one it replaced', () => {
    const values = draft.steps.map((step) => step.target?.value);

    expect(values).toContain('Last 30 days');
    expect(values).not.toContain('Last 7 days');
    expect(draft.discarded.map((attempt) => attempt.observation).join(' ')).toContain('Last 7 days');
  });

  it('keeps the silent checkbox step and marks it as silent', () => {
    const checkbox = draft.steps.find((step) => step.target?.element_kind === 'checkbox');

    expect(checkbox).toBeDefined();
    expect(checkbox?.flags).toContain('silent_action');
  });

  it('sees the success state the recording actually showed', () => {
    expect(draft.has_success_state).toBe(true);
    expect(draft.warnings).toEqual([]);
  });

  it('numbers the steps from one, in the order they happened', () => {
    expect(draft.steps.map((step) => step.index)).toEqual(
      draft.steps.map((_, position) => position + 1),
    );
    expect(draft.steps.map((step) => step.t_start)).toEqual(
      [...draft.steps.map((step) => step.t_start)].sort((a, b) => a - b),
    );
  });
});
