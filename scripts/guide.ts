/**
 * The command-line face of the pipeline.
 *
 *   npm run guide -- fixtures/videos/A.mp4 [--timeline path] [--model id] [--refresh] [--json]
 *
 * The chain itself lives in `src/pipeline.ts`; this file only decides where
 * artefacts come from and go. Cached ones - the saved timeline, the phrased
 * guide, the verdicts - are reused by default, so re-running a recording that
 * has not changed costs nothing and needs no key.
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGeminiClient } from '../src/modules/gemini.js';
import { GROUNDING_MODEL } from '../src/modules/grounding.js';
import { renderGuideMarkdown } from '../src/modules/markdown.js';
import { formatMetrics } from '../src/modules/metrics.js';
import { FileVerdictCache } from '../src/modules/verdict-cache.js';
import { runPipeline, type PipelineEvent } from '../src/pipeline.js';
import type { PhrasedGuide } from '../src/schemas/draft.js';
import { RawTimelineSchema, type RawTimeline } from '../src/schemas/timeline.js';

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');

function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolveHash(hash.digest('hex')))
      .on('error', rejectHash);
  });
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** The phrasing input is the ordered list of (id, observation): same input, same sentences. */
function phrasingInputMatches(cached: PhrasedGuide, timeline: RawTimeline): boolean {
  const cachedIds = cached.steps.map((step) => `${step.event_id} ${step.observation}`).join('\n');
  const liveIds = timeline.events
    .filter((event) => event.kind === 'ui_action' && event.visible && event.superseded_by === null)
    .map((event) => `${event.id} ${event.observation}`)
    .join('\n');

  return cachedIds === liveIds;
}

function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** The value that follows `--flag` is an argument, not the video path. */
function positional(args: string[], valueFlags: string[]): string | undefined {
  const taken = new Set<number>();
  for (const flag of valueFlags) {
    const index = args.indexOf(flag);
    if (index !== -1) taken.add(index + 1);
  }
  return args.find((arg, index) => !arg.startsWith('--') && !taken.has(index));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const refresh = args.includes('--refresh');
  const asJson = args.includes('--json');

  const input = positional(args, ['--timeline', '--model']);
  if (input === undefined) {
    throw new Error(
      'Usage: npm run guide -- <path-to-video> [--timeline path] [--model id] [--refresh] [--json]',
    );
  }

  // One model for the whole run. The free-tier allowance is per model per day, so
  // this is how a recording is deliberately spent against a different day's quota;
  // it is never switched mid-run, because a verdict cache key carries the model.
  const model = argValue(args, '--model') ?? GROUNDING_MODEL;

  const videoPath = resolve(process.cwd(), input);
  const video = basename(videoPath, extname(videoPath));
  const guidesDir = resolve(projectRoot, 'fixtures/guides');
  const timelinePath = resolve(
    process.cwd(),
    argValue(args, '--timeline') ?? resolve(projectRoot, 'fixtures/timelines', `${video}.json`),
  );
  const phrasedPath = resolve(guidesDir, `${video}.phrased.json`);
  const markdownPath = resolve(guidesDir, `${video}.md`);

  const savedTimeline = refresh ? null : await readJson<unknown>(timelinePath);
  const parsed = savedTimeline === null ? null : RawTimelineSchema.safeParse(savedTimeline);
  if (parsed !== null && !parsed.success) {
    throw new Error(`${timelinePath} does not match the timeline contract.`);
  }
  const timeline = parsed?.data;

  const savedPhrased = refresh ? null : await readJson<PhrasedGuide>(phrasedPath);
  const phrased =
    savedPhrased !== null && timeline !== undefined && phrasingInputMatches(savedPhrased, timeline)
      ? savedPhrased
      : undefined;

  const cache = await FileVerdictCache.open(
    resolve(projectRoot, 'fixtures/verdicts'),
    video,
    model,
    { refresh },
  );

  const ai = createGeminiClient();
  const report = (event: PipelineEvent): void => {
    if (event.type === 'stage_start') console.error(`${event.stage.padEnd(12)}...`);
    else if (event.type === 'stage_done') {
      console.error(
        `${event.stage.padEnd(12)}${(event.wallMs / 1000).toFixed(1).padStart(5)}s  ${event.detail}`,
      );
    } else if (event.type === 'stage_skipped') {
      console.error(`${event.stage.padEnd(12)}    -   skipped: ${event.reason}`);
    } else if (event.type === 'retry') {
      console.error(
        `  retry ${event.attempt} in ${(event.delayMs / 1000).toFixed(1)}s: ${event.message.slice(0, 90)}`,
      );
    } else if (event.type === 'note') {
      console.error(`  ! ${event.message}`);
    }
  };

  const result = await runPipeline(
    ai,
    {
      videoPath,
      timeline,
      phrased,
      verdictCache: cache,
      model,
      framesRoot: resolve(projectRoot, 'public/frames'),
      sha256: await sha256(videoPath),
    },
    report,
  );

  await cache.save();
  await mkdir(guidesDir, { recursive: true });
  if (result.document.steps.length > 0) {
    await writeFile(phrasedPath, `${JSON.stringify(result.phrased, null, 2)}\n`, 'utf8');
  }
  if (timeline === undefined) {
    await mkdir(resolve(projectRoot, 'fixtures/timelines'), { recursive: true });
    await writeFile(timelinePath, `${JSON.stringify(result.timeline, null, 2)}\n`, 'utf8');
  }

  const markdown = renderGuideMarkdown(result.document, { imageBasePath: '../../public/' });
  await writeFile(markdownPath, `${markdown}\n`, 'utf8');

  console.error('');
  console.error(formatMetrics(result.metrics));
  console.error('');
  console.error(`saved       ${markdownPath}`);
  console.error('');

  process.stdout.write(
    asJson
      ? `${JSON.stringify({ document: result.document, metrics: result.metrics }, null, 2)}\n`
      : `${markdown}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
