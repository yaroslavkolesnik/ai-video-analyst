/**
 * The authoring contract: what a guide looks like before anyone has written a
 * sentence of it.
 *
 * The `DraftGuide` itself has no zod schema, unlike `RawTimeline`. Nothing
 * outside this codebase ever produces one - it is built by pure code from an
 * already-validated timeline, so a parser for it would validate our own output
 * against our own types and prove nothing.
 *
 * The phrasing response at the bottom of this file is the exception: that one
 * does come back from a model, so it gets the same two-mirror treatment as the
 * timeline contract.
 */
import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

import type { EventTarget } from './timeline.js';

export const DRAFT_SCHEMA_VERSION = 'draft/1';

export type DraftStatus = 'ok' | 'ok_with_warnings' | 'needs_clarification' | 'declined';

export type DeclineReason =
  | 'not_a_screen_recording'
  | 'multiple_operations'
  | 'low_operation_confidence'
  | 'no_visible_steps';

/**
 * `conflict`      - narration and screen disagreed here; the step is not counted as verified.
 * `after_gap`     - the recording jumped just before this step.
 * `silent_action` - performed without a word said. The brief's hardest case: necessary,
 *                   easy to miss, and invisible to anything that summarises speech.
 */
export type StepFlag = 'conflict' | 'after_gap' | 'silent_action';

export const VERDICT_RESULTS = ['supported', 'contradicted', 'unclear'] as const;

export type VerdictResult = (typeof VERDICT_RESULTS)[number];

/** Filled in by the grounding pass (module 4). */
export type Verdict = {
  event_id: string;
  result: VerdictResult;
  /** On-screen text the verdict relied on. */
  evidence_text: string | null;
  reasoning: string;
  frames: { shot: string; after: string };
  /**
   * Why no verdict could be obtained, when none could - a spent quota, a request
   * that never succeeded. Null means the model actually looked.
   *
   * Not in the originally approved `Verdict`. Without it, "the model looked and
   * was unsure" and "we never got to ask" collapse into the same `unclear`, and
   * those are different facts for a reader and for `verified_ratio`.
   */
  unavailable_reason: string | null;
};

export type DraftStep = {
  /** 1-based, and the order the guide is read in. */
  index: number;
  /** The single source of truth for where this step came from. */
  event_id: string;
  t_start: number;
  t_end: number;
  screenshot_t: number;
  /** The raw observation. Still not prose - phrasing (module 3b) turns it into an instruction. */
  observation: string;
  target: EventTarget | null;
  /** Narration heard near this step. Context for the reader, never a source of steps. */
  notes: string[];
  flags: StepFlag[];
  /** Filled in by phrasing (module 3b). */
  instruction: string | null;
  /** Filled in by grounding (module 4). */
  verification: Verdict | null;
};

export type DiscardedAttempt = {
  event_id: string;
  t_start: number;
  observation: string;
  superseded_by_event_id: string;
  /** What replaced it, so the reader can see the correction rather than a hole. */
  superseded_by_observation: string;
};

export type MissingStep = {
  /** The step this gap follows; null when the recording was already mid-operation. */
  after_step_index: number | null;
  t_gap: number;
  what_changed: string;
  severity: 'critical' | 'minor';
};

export type ClarificationRequest = {
  event_id: string;
  t: number;
  question: string;
  spoken_claim: string;
  screen_shows: string;
};

export type DraftGuide = {
  schema_version: typeof DRAFT_SCHEMA_VERSION;
  status: DraftStatus;
  decline_reason: DeclineReason | null;
  /** Order = order in the guide. */
  steps: DraftStep[];
  /** Abandoned mistakes, kept out of the recommended path but not hidden. */
  discarded: DiscardedAttempt[];
  missing_steps: MissingStep[];
  clarifications: ClarificationRequest[];
  /** Ids of events that assert something about the screen that was not visible. */
  unverifiable: string[];
  has_success_state: boolean;
  /**
   * What was already on screen when the recording opened, quoted from the
   * first `ui_state` that precedes every action - or `null` when the recording
   * never showed one. Never a step: it describes a state the user found, not
   * something they did, and `reduce.ts` has no edge from a `ui_state` to the
   * numbered list.
   */
  starting_state: string | null;
  /**
   * Reader-facing warnings. Not in the originally approved `DraftGuide`, added
   * during implementation: reduce is where a warning is decided (rule 6 and the
   * minor-gap branch of rule 7), and re-deriving the same conditions in assembly
   * would be two copies of one rule, drifting apart.
   */
  warnings: string[];
};

/**
 * The same guide after module 3b, with every step's `instruction` written.
 *
 * Deliberately not a new `schema_version`: phrasing fills a field that was
 * already there and changes nothing else about the shape. What it does change is
 * the type - `instruction` is no longer nullable - so the stages after it cannot
 * forget to handle an unphrased step.
 */
// `Omit` rather than an intersection: `DraftGuide & { steps: PhrasedStep[] }`
// leaves `steps` an intersection of two array types, and `.map` on that resolves
// to the draft's element type, quietly handing back a nullable instruction.
export type PhrasedStep = Omit<DraftStep, 'instruction'> & { instruction: string };

export type PhrasedGuide = Omit<DraftGuide, 'steps'> & { steps: PhrasedStep[] };

/**
 * What the phrasing model is allowed to return: one sentence per id it was given,
 * and nothing else. It cannot describe a step, only word one - the ids it may use
 * were fixed by `reduce.ts` before this request was built.
 */
export const PhrasingResponseSchema = z.object({
  steps: z.array(
    z.object({
      event_id: z.string().min(1),
      instruction: z.string().min(1),
    }),
  ),
});

export type PhrasingResponse = z.infer<typeof PhrasingResponseSchema>;

const PHRASED_STEP_FIELD_ORDER = ['event_id', 'instruction'];

/** Hand-written mirror of `PhrasingResponseSchema`, sent as `responseSchema`. */
export const PHRASING_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    steps: {
      type: Type.ARRAY,
      description: 'Exactly one entry per step given, in the same order, with the same ids.',
      items: {
        type: Type.OBJECT,
        properties: {
          event_id: {
            type: Type.STRING,
            description: 'Copied verbatim from the step this sentence words.',
          },
          instruction: {
            type: Type.STRING,
            description: 'One imperative English sentence telling the reader what to do.',
          },
        },
        required: PHRASED_STEP_FIELD_ORDER,
        propertyOrdering: PHRASED_STEP_FIELD_ORDER,
      },
    },
  },
  required: ['steps'],
  propertyOrdering: ['steps'],
};

/**
 * What a grounding request may answer: the judgement, the evidence for it, and
 * the reasoning. `event_id` and the frame paths are added by code - the model is
 * shown one step in isolation and is not asked to repeat what we already know.
 */
export const GroundingResponseSchema = z.object({
  result: z.enum(VERDICT_RESULTS),
  evidence_text: z.string().nullable(),
  reasoning: z.string().min(1),
});

export type GroundingResponse = z.infer<typeof GroundingResponseSchema>;

const GROUNDING_FIELD_ORDER = ['result', 'evidence_text', 'reasoning'];

/** Hand-written mirror of `GroundingResponseSchema`, sent as `responseSchema`. */
export const GROUNDING_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    result: {
      type: Type.STRING,
      format: 'enum',
      enum: [...VERDICT_RESULTS],
      description: 'Whether the frames support, contradict, or neither confirm nor deny the claim.',
    },
    evidence_text: {
      type: Type.STRING,
      nullable: true,
      description:
        'On-screen text quoted exactly as it appears in the frames, or null if none could be read.',
    },
    reasoning: {
      type: Type.STRING,
      description: 'One or two sentences saying what in the frames led to this answer.',
    },
  },
  required: GROUNDING_FIELD_ORDER,
  propertyOrdering: GROUNDING_FIELD_ORDER,
};
