/**
 * Module 5 - Assembly.
 *
 * Stitches the worded guide together with the verdicts and settles the final
 * status. Pure functions, no I/O: given the same artefacts it always produces
 * the same document, which is what lets the status ladder be tested offline.
 *
 * This is the one place the full ladder from the architecture runs, because it
 * is the first point where `verified_ratio` exists at all. `reduce.ts` decided
 * everything it could before a single frame had been checked; assembly re-runs
 * the decision with the evidence that was missing.
 */
import { THRESHOLDS } from '../config/thresholds.js';
import { formatTimestamp } from './authoring/reduce.js';
import type { PhrasedGuide, Verdict } from '../schemas/draft.js';
import {
  GUIDE_SCHEMA_VERSION,
  type FinalStep,
  type GuideDocument,
  type GuideSource,
  type GuideStatus,
} from '../schemas/guide.js';
import type { AppContext } from '../schemas/timeline.js';

export type AssembleInput = {
  guide: PhrasedGuide;
  verdicts: Verdict[];
  /** For the title and the application's name - the only thing taken from the timeline here. */
  context: AppContext;
  source: GuideSource;
};

export class AssemblyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssemblyError';
  }
}

/** `verified_ratio` from the architecture: only `supported` counts as confirmed. */
export function verifiedRatio(verdicts: Verdict[]): number {
  if (verdicts.length === 0) return 0;
  return verdicts.filter((verdict) => verdict.result === 'supported').length / verdicts.length;
}

/**
 * The full ladder, in order. Computed from the components rather than by
 * upgrading the draft's status, so there is one expression of the rule and not
 * two that can disagree.
 */
export function resolveStatus(input: {
  declineReason: string | null;
  stepCount: number;
  clarificationCount: number;
  hasCriticalGap: boolean;
  warningCount: number;
  ratio: number;
}): GuideStatus {
  if (input.declineReason !== null || input.stepCount === 0) return 'declined';

  if (
    input.clarificationCount > 0 ||
    input.hasCriticalGap ||
    input.ratio < THRESHOLDS.minVerifiedRatio
  ) {
    return 'needs_clarification';
  }

  return input.warningCount > 0 ? 'ok_with_warnings' : 'ok';
}

/**
 * Warnings that only exist once frames have been checked.
 *
 * A contradicted step deliberately raises a warning rather than being deleted:
 * removing it would hide the failure, and the brief asks for failures to be
 * reported. It also means a guide carrying a contradiction can never present
 * itself as a plain `ok` - the warning alone pushes it to `ok_with_warnings`,
 * even when the ratio stays above the threshold.
 */
function groundingWarnings(steps: FinalStep[]): string[] {
  const warnings: string[] = [];

  for (const step of steps) {
    if (step.verification.result === 'contradicted') {
      warnings.push(
        `Step ${step.index} is contradicted by the recording: ${step.verification.reasoning}`,
      );
    } else if (step.verification.unavailable_reason !== null) {
      warnings.push(
        `Step ${step.index} was never checked against its frames (${step.verification.unavailable_reason}).`,
      );
    }
  }

  return warnings;
}

/** Builds the finished document. Everything it states is carried in by an earlier stage. */
export function assembleGuide(input: AssembleInput): GuideDocument {
  const { guide, context, source } = input;
  const verdictByEvent = new Map(input.verdicts.map((verdict) => [verdict.event_id, verdict]));

  const steps: FinalStep[] = guide.steps.map((step) => {
    const verification = verdictByEvent.get(step.event_id);
    if (verification === undefined) {
      // Grounding produces a verdict for every step, including ones it could not
      // check. A gap here is a pipeline bug, not a thing to paper over.
      throw new AssemblyError(`Step ${step.index} (${step.event_id}) has no verdict.`);
    }

    return {
      index: step.index,
      instruction: step.instruction,
      t_start: step.t_start,
      t_end: step.t_end,
      timestamp_label: formatTimestamp(step.t_start),
      screenshot_url: verification.frames.shot,
      verification,
      flags: step.flags,
      notes: step.notes,
    };
  });

  const ratio = verifiedRatio(steps.map((step) => step.verification));
  const warnings = [...guide.warnings, ...groundingWarnings(steps)];

  return {
    schema_version: GUIDE_SCHEMA_VERSION,
    status: resolveStatus({
      declineReason: guide.decline_reason,
      stepCount: steps.length,
      clarificationCount: guide.clarifications.length,
      hasCriticalGap: guide.missing_steps.some((missing) => missing.severity === 'critical'),
      warningCount: warnings.length,
      ratio,
    }),
    decline_reason: guide.decline_reason,
    title: context.operation_label,
    app_label: context.app_label,
    source,
    steps,
    discarded: guide.discarded,
    missing_steps: guide.missing_steps,
    clarifications: guide.clarifications,
    warnings,
    verified_ratio: ratio,
    has_success_state: guide.has_success_state,
  };
}
