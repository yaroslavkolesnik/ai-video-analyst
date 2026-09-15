/**
 * The finished document: everything the pipeline learned about one recording,
 * in the shape a reader (or the UI, or the Markdown export) consumes.
 *
 * Like `DraftGuide`, this is built by our own code and never parsed back from a
 * model, so it carries types rather than a zod schema.
 */
import type {
  ClarificationRequest,
  DiscardedAttempt,
  MissingStep,
  StepFlag,
  Verdict,
} from './draft.js';

export const GUIDE_SCHEMA_VERSION = 'guide/1';

export type GuideStatus = 'ok' | 'ok_with_warnings' | 'needs_clarification' | 'declined';

export type GuideSource = {
  filename: string;
  durationSec: number;
  /**
   * Of the source file. It is what lets the delivery notes prove a result came
   * from the exact recording in the repository, and not a re-take.
   */
  sha256: string;
};

export type FinalStep = {
  index: number;
  instruction: string;
  t_start: number;
  t_end: number;
  /** "0:07" - the form a reader can match against a video scrubber. */
  timestamp_label: string;
  screenshot_url: string;
  /** Never null: a step that could not be checked carries a verdict saying so. */
  verification: Verdict;
  flags: StepFlag[];
  notes: string[];
};

export type GuideDocument = {
  schema_version: typeof GUIDE_SCHEMA_VERSION;
  status: GuideStatus;
  decline_reason: string | null;
  title: string;
  app_label: string;
  source: GuideSource;
  steps: FinalStep[];
  discarded: DiscardedAttempt[];
  missing_steps: MissingStep[];
  clarifications: ClarificationRequest[];
  warnings: string[];
  verified_ratio: number;
  has_success_state: boolean;
  /**
   * The state the recording opened on, observed rather than assumed, or `null`
   * when it never showed one. A reader needs it: A.mp4 runs for eleven seconds
   * before its first event, so a guide built from it silently began wherever
   * the demonstrator happened to be.
   */
  starting_state: string | null;
};
