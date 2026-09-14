/**
 * Reduces a saved timeline and words its steps, then prints the guide as a
 * reader would meet it.
 *
 *   npm run phrase -- fixtures/timelines/A.json
 *
 * The rendering below is a development read-out, not the product's export: the
 * real one is assembled with screenshots and verification badges in a later
 * stage. It exists so a human can judge the sentences on their own.
 */
import 'dotenv/config';

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createGeminiClient } from '../src/modules/gemini.js';
import { phraseGuide } from '../src/modules/authoring/phrase.js';
import { formatTimestamp, reduceTimeline } from '../src/modules/authoring/reduce.js';
import type { PhrasedGuide } from '../src/schemas/draft.js';
import { RawTimelineSchema } from '../src/schemas/timeline.js';

const FLAG_LABELS: Record<string, string> = {
  conflict: 'narration disagreed with the screen',
  after_gap: 'the recording jumps just before this step',
  silent_action: 'done without a word said',
};

function render(guide: PhrasedGuide): string {
  const lines: string[] = [];

  lines.push(`Status: ${guide.status}${guide.decline_reason === null ? '' : ` (${guide.decline_reason})`}`);
  lines.push('');

  for (const step of guide.steps) {
    lines.push(`${step.index}. ${step.instruction}   [${formatTimestamp(step.t_start)}]`);
    for (const flag of step.flags) {
      lines.push(`     - ${FLAG_LABELS[flag] ?? flag}`);
    }
    for (const note of step.notes) {
      lines.push(`     note: ${note}`);
    }
  }

  const missingByStep = (index: number | null): string[] =>
    guide.missing_steps
      .filter((missing) => missing.after_step_index === index)
      .map(
        (missing) =>
          `  [${missing.severity} gap at ${formatTimestamp(missing.t_gap)}] ${missing.what_changed}`,
      );

  const gapLines = [null, ...guide.steps.map((step) => step.index)].flatMap(missingByStep);
  if (gapLines.length > 0) {
    lines.push('', 'Missing steps:', ...gapLines);
  }

  if (guide.clarifications.length > 0) {
    lines.push('', 'Questions:');
    for (const clarification of guide.clarifications) {
      lines.push(`  - ${clarification.question}`);
    }
  }

  if (guide.discarded.length > 0) {
    lines.push('', 'Abandoned attempts (not part of the recommended path):');
    for (const attempt of guide.discarded) {
      lines.push(
        `  - at ${formatTimestamp(attempt.t_start)}: ${attempt.observation}`,
        `    replaced by: ${attempt.superseded_by_observation}`,
      );
    }
  }

  if (guide.unverifiable.length > 0) {
    lines.push('', `Could not be verified on screen: ${guide.unverifiable.join(', ')}`);
  }

  if (guide.warnings.length > 0) {
    lines.push('', 'Warnings:', ...guide.warnings.map((warning) => `  - ${warning}`));
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === undefined) {
    throw new Error('Usage: npm run phrase -- <path-to-timeline.json>');
  }

  const raw = await readFile(resolve(process.cwd(), input), 'utf8');
  const parsed = RawTimelineSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new Error(`${input} does not match the timeline contract: ${details}`);
  }

  const draft = reduceTimeline(parsed.data);
  console.error(`reduce      status ${draft.status}  steps ${draft.steps.length}  (offline)`);

  const ai = createGeminiClient();
  const result = await phraseGuide(ai, draft, {
    onRetry: (attempt, delayMs, error) => {
      console.error(
        `  retry ${attempt}: ${error instanceof Error ? error.message.slice(0, 110) : String(error)}` +
          ` - waiting ${(delayMs / 1000).toFixed(1)}s`,
      );
    },
    onStructuralRetry: (attempt, problem) => {
      console.error(`  structural retry ${attempt}: ${problem}`);
    },
  });

  console.error(
    `phrasing    ${(result.wallMs / 1000).toFixed(1)}s  ${result.model}  ` +
      `${result.apiCalls} call(s), ${result.transportRetries} transport / ` +
      `${result.structuralRetries} structural retries  ` +
      `in ${result.usage.inputTokens} / out ${result.usage.outputTokens} tokens`,
  );
  console.error('');

  process.stdout.write(`${render(result.guide)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
