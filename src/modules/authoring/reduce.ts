/**
 * Module 3a - Authoring Reduce. The deterministic brain.
 *
 * Pure functions: no I/O, no API calls, no clock, no randomness. The same
 * timeline always reduces to the same draft, which is what makes the product's
 * central claims testable offline rather than assertable in a prompt.
 *
 * The claim that matters: a numbered step can only be born from an event that is
 * `kind === "ui_action"` and `visible === true`. Narration has no path into the
 * step list - not because the model was asked nicely, but because there is no
 * edge in this graph. That is the difference between "we do not invent clicks"
 * as a promise and as a property.
 */
import { THRESHOLDS } from '../../config/thresholds.js';
import {
  DRAFT_SCHEMA_VERSION,
  type ClarificationRequest,
  type DeclineReason,
  type DiscardedAttempt,
  type DraftGuide,
  type DraftStep,
  type MissingStep,
  type StepFlag,
} from '../../schemas/draft.js';
import type { ObservedEvent, RawTimeline } from '../../schemas/timeline.js';

/** "0:07" - the form a reader can match against a video scrubber. */
export function formatTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** A refusal produces no guide at all, only the reason for it. */
function declinedGuide(reason: DeclineReason): DraftGuide {
  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    status: 'declined',
    decline_reason: reason,
    steps: [],
    discarded: [],
    missing_steps: [],
    clarifications: [],
    unverifiable: [],
    has_success_state: false,
    starting_state: null,
    warnings: [],
  };
}

/**
 * The state the user found, as opposed to the ones they created.
 *
 * Qualifying is deliberately strict: a visible `ui_state` that comes before
 * every action in the recording. A `ui_state` that follows an action is that
 action's consequence, and describing it as the starting point would tell a
 * reader to begin where the demonstrator had already finished.
 *
 * Returns null when the recording never showed one - which is the normal case
 * for anything recorded before this rule reached the Observation prompt. The
 * caller renders the honest limitation instead of inventing a default state.
 */
export function findStartingState(events: ObservedEvent[]): string | null {
  const firstAction = events.find((event) => event.kind === "ui_action");
  const cutoff = firstAction === undefined ? Number.POSITIVE_INFINITY : firstAction.t_start;

  const opening = events.find(
    (event) => event.kind === "ui_state" && event.visible && event.t_start < cutoff,
  );

  return opening === undefined ? null : opening.observation;
}

/**
 * Walks the `superseded_by` chain to the event that finally survived it.
 *
 * Returns the event itself when nothing supersedes it, when the chain points at
 * an id that does not exist, or when it closes into a cycle. A broken pointer is
 * not evidence that an action was abandoned, and dropping a visible action over
 * the model's bad bookkeeping is the worse of the two failures; the observation
 * pass reports such pointers separately.
 */
function resolveTerminal(
  event: ObservedEvent,
  byId: ReadonlyMap<string, ObservedEvent>,
): ObservedEvent {
  const seen = new Set<string>([event.id]);
  let current = event;

  while (current.superseded_by !== null) {
    const next = byId.get(current.superseded_by);
    if (next === undefined || seen.has(next.id)) break;
    seen.add(next.id);
    current = next;
  }

  return current;
}

/** Distance from a spoken remark to a step: zero while the step is in progress. */
function temporalDistance(step: DraftStep, event: ObservedEvent): number {
  if (event.t_start >= step.t_start && event.t_start <= step.t_end) return 0;
  return Math.min(
    Math.abs(event.t_start - step.t_start),
    Math.abs(event.t_start - step.t_end),
  );
}

function attachNarration(steps: DraftStep[], narrationEvents: ObservedEvent[]): void {
  for (const narration of narrationEvents) {
    let nearest: DraftStep | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const step of steps) {
      const distance = temporalDistance(step, narration);
      if (distance < nearestDistance) {
        nearest = step;
        nearestDistance = distance;
      }
    }

    if (nearest !== null && nearestDistance <= THRESHOLDS.narrationAttachWindowSec) {
      nearest.notes.push(narration.observation);
    }
  }
}

function buildMissingSteps(
  gapEvents: ObservedEvent[],
  steps: DraftStep[],
  endOfChainSec: number,
): MissingStep[] {
  return gapEvents.map((gap) => {
    const precedingSteps = steps.filter((step) => step.t_start <= gap.t_start);
    const after = precedingSteps[precedingSteps.length - 1];

    return {
      after_step_index: after?.index ?? null,
      t_gap: gap.t_start,
      what_changed: gap.observation,
      // A gap on the way to the outcome means the reader cannot reproduce the
      // result: whatever happened there is load-bearing and was never shown.
      // Only a gap after the operation has already finished is cosmetic.
      severity: gap.t_start <= endOfChainSec ? 'critical' : 'minor',
    };
  });
}

function buildClarifications(events: ObservedEvent[]): ClarificationRequest[] {
  const requests: ClarificationRequest[] = [];

  for (const event of events) {
    const conflict = event.conflict;
    if (conflict === null) continue;

    requests.push({
      event_id: event.id,
      t: event.t_start,
      question:
        `At ${formatTimestamp(event.t_start)} the narrator said "${conflict.spoken_claim}" ` +
        `but the screen shows "${conflict.screen_shows}". Which was intended?`,
      spoken_claim: conflict.spoken_claim,
      screen_shows: conflict.screen_shows,
    });
  }

  return requests;
}

function flagsFor(event: ObservedEvent, isAfterGap: boolean): StepFlag[] {
  const flags: StepFlag[] = [];
  if (event.conflict !== null) flags.push('conflict');
  if (isAfterGap) flags.push('after_gap');
  if (!event.spoken) flags.push('silent_action');
  return flags;
}

/**
 * Turns raw observations into the linear draft of a guide.
 *
 * Discarded events leave the recommended path entirely: they produce no steps,
 * no notes and no success claim. Clarifications are the one deliberate
 * exception - a stated disagreement between speech and screen is reported
 * wherever it occurred, including on a branch that was later abandoned, because
 * quietly dropping one is the exact failure the brief tests for.
 */
export function reduceTimeline(timeline: RawTimeline): DraftGuide {
  const context = timeline.app_context;

  // 1. Refusal gates, before anything else: a recording we will not document is
  //    also a recording we will not pay to verify frame by frame.
  if (!context.is_screen_recording) return declinedGuide('not_a_screen_recording');
  if (!context.is_single_operation) return declinedGuide('multiple_operations');
  if (context.operation_confidence < THRESHOLDS.minOperationConfidence) {
    return declinedGuide('low_operation_confidence');
  }

  const events = [...timeline.events].sort((a, b) => a.t_start - b.t_start);
  const byId = new Map(events.map((event) => [event.id, event]));

  // 2. Transitive pruning of abandoned branches. The last link of a chain
  //    survives, which is how the final chosen setting stays in the guide while
  //    the attempt it replaced does not.
  const supersededIds = new Set<string>();
  const discarded: DiscardedAttempt[] = [];

  for (const event of events) {
    if (event.superseded_by === null) continue;
    const terminal = resolveTerminal(event, byId);
    if (terminal === event) continue;

    supersededIds.add(event.id);

    // Only an action was ever an attempt. A superseded `ui_state` is the
    // consequence of one - it leaves the path silently, because listing it under
    // "what you tried" would describe a row count as something the user did.
    if (event.kind !== 'ui_action') continue;

    discarded.push({
      event_id: event.id,
      t_start: event.t_start,
      observation: event.observation,
      superseded_by_event_id: terminal.id,
      superseded_by_observation: terminal.observation,
    });
  }

  const onPath = events.filter((event) => !supersededIds.has(event.id));

  // 3. The "do not invent clicks" filter. This single predicate is the whole
  //    guarantee; everything below only annotates what it let through.
  const stepEvents = onPath.filter((event) => event.kind === 'ui_action' && event.visible);

  const unverifiable = onPath
    .filter((event) => !event.visible && event.kind !== 'narration' && event.kind !== 'gap')
    .map((event) => event.id);

  const gapEvents = onPath.filter((event) => event.kind === 'gap');

  // A step carries `after_gap` when it is the first one to follow a jump in the
  // recording: it is the step whose preceding context the reader never saw.
  const stepIdsAfterGap = new Set<string>(
    gapEvents.flatMap((gap) => {
      const next = stepEvents.find((event) => event.t_start >= gap.t_start);
      return next === undefined ? [] : [next.id];
    }),
  );

  const steps: DraftStep[] = stepEvents.map((event, position) => ({
    index: position + 1,
    event_id: event.id,
    t_start: event.t_start,
    t_end: event.t_end,
    screenshot_t: event.screenshot_t,
    observation: event.observation,
    target: event.target,
    notes: [],
    flags: flagsFor(event, stepIdsAfterGap.has(event.id)),
    instruction: null,
    verification: null,
  }));

  if (steps.length === 0) return declinedGuide('no_visible_steps');

  attachNarration(
    steps,
    onPath.filter((event) => event.kind === 'narration'),
  );

  // 6. Success is a thing that was shown, or it is nothing.
  const successEvent = onPath.find((event) => event.kind === 'success_state' && event.visible);
  const hasSuccessState = successEvent !== undefined;

  // 4. Gaps.
  const lastStep = steps[steps.length - 1];
  const endOfChainSec = successEvent?.t_start ?? lastStep?.t_start ?? Number.POSITIVE_INFINITY;
  const missingSteps = buildMissingSteps(gapEvents, steps, endOfChainSec);

  // 5. Contradictions.
  const clarifications = buildClarifications(events);

  const warnings: string[] = [];
  if (!hasSuccessState) {
    warnings.push(
      'The recording never shows the operation completing, so this guide does not claim that it did.',
    );
  }
  for (const missing of missingSteps) {
    if (missing.severity === 'minor') {
      warnings.push(
        `Something changed at ${formatTimestamp(missing.t_gap)} that the recording does not show: ${
          missing.what_changed
        }`,
      );
    }
  }

  // 7. Status. Verified ratio is not here: it exists only after grounding, and
  //    assembly applies it to this same ladder.
  const needsClarification =
    clarifications.length > 0 || missingSteps.some((missing) => missing.severity === 'critical');

  const status = needsClarification
    ? 'needs_clarification'
    : warnings.length > 0
      ? 'ok_with_warnings'
      : 'ok';

  return {
    schema_version: DRAFT_SCHEMA_VERSION,
    status,
    decline_reason: null,
    steps,
    discarded,
    missing_steps: missingSteps,
    clarifications,
    unverifiable,
    has_success_state: hasSuccessState,
    starting_state: findStartingState(events),
    warnings,
  };
}
