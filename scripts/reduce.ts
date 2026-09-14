/**
 * Reduces a saved timeline to a draft guide and prints it. No network, no key.
 *
 *   npm run reduce -- fixtures/timelines/A.json
 *
 * The timeline is re-validated against the contract on the way in, so a fixture
 * that has drifted from the schema fails here rather than three stages later.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { reduceTimeline } from '../src/modules/authoring/reduce.js';
import { RawTimelineSchema } from '../src/schemas/timeline.js';

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === undefined) {
    throw new Error('Usage: npm run reduce -- <path-to-timeline.json>');
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

  console.error(
    `status ${draft.status}  steps ${draft.steps.length}  discarded ${draft.discarded.length}  ` +
      `missing ${draft.missing_steps.length}  clarifications ${draft.clarifications.length}  ` +
      `unverifiable ${draft.unverifiable.length}  success ${draft.has_success_state}`,
  );

  process.stdout.write(`${JSON.stringify(draft, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
