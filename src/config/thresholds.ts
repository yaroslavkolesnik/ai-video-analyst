/**
 * Every number the authoring decisions turn on, in one place.
 *
 * They are constants rather than literals buried in a condition so that the
 * delivery notes can state each one and say why it is where it is. Moving one
 * of these should be a visible product decision, not a diff in a branch.
 */
export const THRESHOLDS = {
  /**
   * Below this, the observer is not confident it identified a single operation
   * at all, and a guide built on it would be confident prose over an unsure
   * reading. Deliberately low: this is a floor for "we understood the recording",
   * not a quality bar. Above it, the honest answer is a guide with warnings.
   */
  minOperationConfidence: 0.35,

  /**
   * Below this share of steps confirmed against their frames, the guide stops
   * presenting itself as ready and asks for clarification instead. Applied by
   * assembly, once grounding has produced verdicts - it cannot be known earlier.
   *
   * 0.6 leaves room for one or two frames that genuinely could not be read in a
   * short recording, while a guide where most steps went unconfirmed is not one
   * a reader should be handed quietly.
   */
  minVerifiedRatio: 0.6,

  /**
   * How far from a step a piece of narration may sit and still be attached to it
   * as a note. Roughly one sentence of speech either side of the click it
   * describes. Wider than this and remarks start migrating onto steps they were
   * never about.
   */
  narrationAttachWindowSec: 5,
} as const;
