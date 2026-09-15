/**
 * Renders a finished guide as Markdown.
 *
 * The design rule here is the product's whole argument: what the pipeline could
 * not confirm is shown, not hidden. Every step carries the verdict it earned and
 * the frame it was judged on, a contradiction is printed in the step it belongs
 * to, and abandoned attempts sit in the document rather than being quietly
 * dropped. A guide that admits "I could not confirm this step" is more useful
 * than one that states it confidently and is wrong.
 */
import { formatTimestamp } from './authoring/reduce.js';
import type { StepFlag } from '../schemas/draft.js';
import type { FinalStep, GuideDocument, GuideStatus } from '../schemas/guide.js';

const STATUS_LINE: Record<GuideStatus, string> = {
  ok: '✅ **Ready to follow** — every step was confirmed against the recording.',
  ok_with_warnings: '⚠️ **Ready, with warnings** — see the notes below before following it.',
  needs_clarification: '❓ **Needs clarification** — something in the recording is unresolved.',
  declined: '⛔ **Declined** — no guide was produced from this recording.',
};

/**
 * What the badge says is what was *established*, never a judgement on the
 * instruction. The difference is not cosmetic: following A’s guide by hand on
 * 2026-09-14 produced the documented result, and skipping the one step wearing
 * the old "contradicted by the recording" badge silently dropped a column from
 * the export. A reader who takes a verdict about two sampled frames as a verdict
 * about the step loses something real.
 *
 * "not checked" is a fourth state rather than a wording change. The data has
 * always separated "the model looked and was unsure" from "we never asked"
 * (`unavailable_reason`), and the badge was the one place that distinction was
 * being thrown away.
 */
const VERDICT_BADGE = {
  supported: 'confirmed on frames',
  contradicted: "frames don't show this",
  unclear: 'frames inconclusive',
  not_checked: 'not checked',
} as const;

/**
 * The starting state is the one thing a recording almost never shows: A.mp4 runs
 * for eleven seconds before its first event, and those seconds produced nothing
 * observable at all. So this is not derived from the timeline - there is nothing
 * to derive it from - and it deliberately does not claim the app was in its
 * default view. It states the limitation instead, which is true of every
 * recording, names no control we never saw used, and is never a numbered step.
 */
const PRECONDITION_UNKNOWN_TITLE = 'Starting state was not recorded.';
const PRECONDITION_UNKNOWN_BODY =
  'This guide begins at the first visible action. If your view already has ' +
  'filters applied, the counts shown here will differ.';

const PRECONDITION_KNOWN_TITLE = 'Start from this state.';
const PRECONDITION_KNOWN_BODY =
  'This is what the recording showed before the first action, read off the ' +
  'screen rather than assumed.';

/** Observed when the recording showed one, and an honest gap when it did not. */
function preconditionLine(startingState: string | null): string {
  const observed = startingState?.trim();
  return observed === undefined || observed === ''
    ? `> **${PRECONDITION_UNKNOWN_TITLE}** ${PRECONDITION_UNKNOWN_BODY}`
    : `> **${PRECONDITION_KNOWN_TITLE}** ${observed} ${PRECONDITION_KNOWN_BODY}`;
}

/** The badge alone is one phrase; a contradiction needs the sentence too. */
const UNCONFIRMED_NOTE =
  'Checked against two sampled frames only. The step may still be correct — ' +
  'read this as *unconfirmed*, not as *wrong*.';

/** A step we never asked about must not wear the badge of one we asked and could not settle. */
function badgeFor(verdict: FinalStep['verification']): string {
  if (verdict.unavailable_reason !== null) return VERDICT_BADGE.not_checked;
  return VERDICT_BADGE[verdict.result];
}

const FLAG_LABEL: Record<StepFlag, string> = {
  silent_action: '🔇 done silently — easy to miss, and the result changes without it',
  after_gap: '✂️ the recording jumps just before this step',
  conflict: '🗣️ the narration said something different here',
};

export type MarkdownOptions = {
  /**
   * Prefix put in front of each frame's path. Frames are served from `public/`,
   * so a document written next to the repository root wants `public/`, and one
   * two directories down wants `../../public/`.
   */
  imageBasePath?: string;
};

function renderStep(step: FinalStep, imageBase: string): string[] {
  const lines: string[] = [];
  const verdict = step.verification;

  lines.push(`### ${step.index}. ${step.instruction}`);
  lines.push('');
  lines.push(`\`${step.timestamp_label}\` · ${badgeFor(verdict)}`);
  lines.push('');

  if (verdict.result === 'contradicted') {
    lines.push(UNCONFIRMED_NOTE);
    lines.push('');
  }

  for (const flag of step.flags) {
    lines.push(`> ${FLAG_LABEL[flag]}`);
    lines.push('>');
  }
  for (const note of step.notes) {
    lines.push(`> 🗒️ ${note}`);
    lines.push('>');
  }
  if (lines[lines.length - 1] === '>') lines.pop();
  if (step.flags.length > 0 || step.notes.length > 0) lines.push('');

  lines.push(`![Step ${step.index}](${imageBase}${step.screenshot_url})`);
  lines.push('');

  lines.push('<details><summary>How this step was checked</summary>');
  lines.push('');
  if (verdict.evidence_text !== null) {
    lines.push(`- **Read from the screen:** “${verdict.evidence_text}”`);
  }
  lines.push(`- **Verdict:** ${verdict.reasoning}`);
  if (verdict.unavailable_reason !== null) {
    lines.push(`- **Not checked:** ${verdict.unavailable_reason}`);
  }
  lines.push(`- **Frames:** \`${verdict.frames.shot}\`, \`${verdict.frames.after}\``);
  lines.push('');
  lines.push('</details>');
  lines.push('');

  return lines;
}

export function renderGuideMarkdown(doc: GuideDocument, options: MarkdownOptions = {}): string {
  const imageBase = options.imageBasePath ?? 'public/';
  const lines: string[] = [];

  const title = doc.title.charAt(0).toUpperCase() + doc.title.slice(1);
  lines.push(`# ${title}`, '');
  lines.push(`In ${doc.app_label}.`, '');
  lines.push(STATUS_LINE[doc.status], '');

  if (doc.decline_reason !== null) {
    lines.push(`**Reason:** \`${doc.decline_reason}\``, '');
  }

  if (doc.steps.length > 0) {
    const confirmed = doc.steps.filter((step) => step.verification.result === 'supported').length;
    lines.push(
      `**${confirmed} of ${doc.steps.length} steps** confirmed against frames from the recording ` +
        `(\`verified_ratio\` ${doc.verified_ratio.toFixed(2)}).`,
      '',
    );
  }

  // Questions come before the steps: a reader should meet them before acting on
  // instructions they might contradict.
  if (doc.clarifications.length > 0) {
    lines.push('## Questions before you start', '');
    for (const clarification of doc.clarifications) {
      lines.push(`- ${clarification.question}`);
    }
    lines.push('');
  }

  if (doc.warnings.length > 0) {
    lines.push('## Warnings', '');
    for (const warning of doc.warnings) {
      lines.push(`- ${warning}`);
    }
    lines.push('');
  }

  if (doc.steps.length > 0) {
    // Above the steps and outside the ordered list: it is a limitation, not a step.
    lines.push(preconditionLine(doc.starting_state), '');
    lines.push('## Steps', '');

    // Missing steps are printed where they belong in the sequence, so the hole is
    // visible at the point a reader would fall into it.
    const gapsAfter = (index: number | null): string[] =>
      doc.missing_steps
        .filter((missing) => missing.after_step_index === index)
        .flatMap((missing) => [
          `> ⛔ **Something is missing here** (${missing.severity}, around ` +
            `\`${formatTimestamp(missing.t_gap)}\`). ${missing.what_changed}`,
          '>',
          '> The recording does not show what caused this, and no step was invented to explain it.',
          '',
        ]);

    lines.push(...gapsAfter(null));
    for (const step of doc.steps) {
      lines.push(...renderStep(step, imageBase));
      lines.push(...gapsAfter(step.index));
    }
  }

  if (doc.discarded.length > 0) {
    lines.push('## Abandoned attempts', '');
    lines.push(
      'These were tried in the recording and then replaced. They are **not** part of the ' +
        'steps above, and are listed so the correction is visible rather than silently dropped.',
      '',
    );
    lines.push('<details><summary>Show what was tried</summary>', '');
    for (const attempt of doc.discarded) {
      lines.push(`- At \`${formatTimestamp(attempt.t_start)}\`: ${attempt.observation}`);
      lines.push(`  - Replaced by: ${attempt.superseded_by_observation}`);
    }
    lines.push('', '</details>', '');
  }

  lines.push('---', '');
  lines.push(
    `Built from \`${doc.source.filename}\` (${doc.source.durationSec.toFixed(1)} s), ` +
      `sha256 \`${doc.source.sha256.slice(0, 16)}…\`.`,
    '',
  );
  lines.push(
    'Each step above was checked on its own against two frames cut from that file — ' +
      'one where the control is still visible, one where its effect should be. ' +
      'No step was written from narration alone.',
    '',
  );
  if (!doc.has_success_state) {
    lines.push('The recording never shows the operation completing, so this guide does not claim it did.', '');
  }

  return lines.join('\n');
}
