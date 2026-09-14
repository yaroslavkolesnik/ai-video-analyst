/**
 * Runs Ingestion + Observation against one recording and saves the raw timeline.
 *
 *   npm run observe -- fixtures/videos/A.mp4
 *
 * The saved JSON is the artefact the rest of the pipeline is built against: the
 * authoring stage is written to fit real observations and is unit-tested on
 * these files, offline.
 */
import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGeminiClient } from '../src/modules/gemini.js';
import { ingestVideo } from '../src/modules/ingestion.js';
import { observe } from '../src/modules/observation.js';

const projectRoot = resolve(fileURLToPath(import.meta.url), '../..');

async function main(): Promise<void> {
  const input = process.argv[2];
  if (input === undefined) {
    throw new Error('Usage: npm run observe -- <path-to-video>');
  }

  const videoPath = resolve(process.cwd(), input);
  const name = basename(videoPath, extname(videoPath));
  const outputPath = resolve(projectRoot, 'fixtures/timelines', `${name}.json`);

  const ai = createGeminiClient();

  const ingestionStartedAt = Date.now();
  const asset = await ingestVideo(ai, videoPath);
  const ingestionMs = Date.now() - ingestionStartedAt;

  console.error(
    `ingestion   ${(ingestionMs / 1000).toFixed(1)}s  ` +
      `${asset.width}x${asset.height}  ${asset.durationSec.toFixed(1)}s  ` +
      `${asset.fps.toFixed(2)} fps  ${(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB`,
  );
  for (const warning of asset.warnings) {
    console.error(`  warning: ${warning}`);
  }

  const result = await observe(ai, asset, {
    onRetry: (attempt, delayMs, error) => {
      console.error(
        `  retry ${attempt}: ${
          error instanceof Error ? error.message.slice(0, 120) : String(error)
        } - waiting ${(delayMs / 1000).toFixed(1)}s`,
      );
    },
  });

  console.error(
    `observation ${(result.wallMs / 1000).toFixed(1)}s  ${result.model}  ` +
      `${result.retries} retries  ` +
      `in ${result.usage.inputTokens} / out ${result.usage.outputTokens} / ` +
      `cached ${result.usage.cachedTokens} tokens`,
  );
  console.error(`  events: ${result.timeline.events.length}`);
  if (result.integrity.length === 0) {
    console.error('  integrity: clean');
  } else {
    for (const problem of result.integrity) {
      console.error(`  integrity: ${problem}`);
    }
  }

  await mkdir(resolve(projectRoot, 'fixtures/timelines'), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(result.timeline, null, 2)}\n`, 'utf8');
  console.error(`saved       ${outputPath}`);

  process.stdout.write(`${JSON.stringify(result.timeline, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
});
