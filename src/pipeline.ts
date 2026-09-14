/**
 * The whole chain, in one place.
 *
 * The CLI and the server are both thin wrappers over this: two copies of the
 * pipeline would drift, and then a bug fixed in the demo would survive in the
 * command line. Progress is reported through a callback so the same run can be
 * printed to a terminal or streamed to a browser without knowing which.
 *
 * Nothing here decides anything about the guide. It wires stages together,
 * times them, and prices them.
 */
import { rm } from 'node:fs/promises';
import { basename } from 'node:path';

import type { GoogleGenAI } from '@google/genai';

import { assembleGuide } from './modules/assemble.js';
import { phraseGuide } from './modules/authoring/phrase.js';
import { reduceTimeline } from './modules/authoring/reduce.js';
import { extractFrames } from './modules/frames.js';
import { groundSteps } from './modules/grounding.js';
import { ingestVideo, probeVideo } from './modules/ingestion.js';
import { MetricsCollector, type RunMetrics, type Stage } from './modules/metrics.js';
import { observe } from './modules/observation.js';
import type { VerdictCache } from './modules/grounding.js';
import type { PhrasedGuide, Verdict } from './schemas/draft.js';
import type { GuideDocument } from './schemas/guide.js';
import type { RawTimeline } from './schemas/timeline.js';

export type PipelineEvent =
  | { type: 'stage_start'; stage: Stage }
  | { type: 'stage_done'; stage: Stage; wallMs: number; detail: string }
  | { type: 'stage_skipped'; stage: Stage; reason: string }
  | { type: 'retry'; stage: Stage; attempt: number; delayMs: number; message: string }
  | { type: 'note'; message: string }
  /** The first moment a reader could be shown something real. */
  | { type: 'first_step'; atMs: number };

export type PipelineInput = {
  videoPath: string;
  /**
   * Pre-computed artefacts, used instead of spending requests on them again.
   * The CLI passes these from disk; the server has none on a fresh upload.
   */
  timeline?: RawTimeline | undefined;
  phrased?: PhrasedGuide | undefined;
  verdictCache?: VerdictCache | undefined;
  framesRoot: string;
  sha256: string;
  /**
   * One model for the whole run, or the per-stage defaults when absent.
   *
   * Deliberately not per stage: the free-tier allowance is counted per model per
   * day, so the reason to override this is to spend a different model's day - and
   * a run split across two models cannot be read as one measurement afterwards.
   */
  model?: string | undefined;
  /** Delete the video when the run is finished - true for uploads, not for repository fixtures. */
  deleteSourceWhenDone?: boolean;
};

export type PipelineResult = {
  document: GuideDocument;
  timeline: RawTimeline;
  /** Returned so a caller can persist it; phrasing is the expensive part to redo. */
  phrased: PhrasedGuide;
  metrics: RunMetrics;
};

export async function runPipeline(
  ai: GoogleGenAI,
  input: PipelineInput,
  onEvent: (event: PipelineEvent) => void = () => {},
): Promise<PipelineResult> {
  const metrics = new MetricsCollector();
  const filename = basename(input.videoPath);

  const retryReporter =
    (stage: Stage) =>
    (attempt: number, delayMs: number, error: unknown): void => {
      onEvent({
        type: 'retry',
        stage,
        attempt,
        delayMs,
        message: error instanceof Error ? error.message.slice(0, 160) : String(error),
      });
    };

  let timeline = input.timeline;
  let durationSec: number;

  if (timeline === undefined) {
    onEvent({ type: 'stage_start', stage: 'ingestion' });
    const endIngestion = metrics.begin('ingestion');
    const asset = await ingestVideo(ai, input.videoPath);
    const ingestion = endIngestion();
    durationSec = asset.durationSec;
    onEvent({
      type: 'stage_done',
      stage: 'ingestion',
      wallMs: ingestion.wallMs,
      detail: `${asset.width}x${asset.height}, ${asset.durationSec.toFixed(1)}s, ${(
        asset.sizeBytes / 1024 / 1024
      ).toFixed(1)} MB`,
    });
    for (const warning of asset.warnings) onEvent({ type: 'note', message: warning });

    onEvent({ type: 'stage_start', stage: 'observation' });
    const endObservation = metrics.begin('observation');
    const observed = await observe(ai, asset, {
      onRetry: retryReporter('observation'),
      ...(input.model === undefined ? {} : { model: input.model }),
    });
    const observation = endObservation({
      model: observed.model,
      inputTokens: observed.usage.inputTokens,
      outputTokens: observed.usage.outputTokens,
      cachedTokens: observed.usage.cachedTokens,
      apiCalls: observed.retries + 1,
      retries: observed.retries,
    });
    timeline = observed.timeline;
    for (const problem of observed.integrity) {
      onEvent({ type: 'note', message: `integrity: ${problem}` });
    }
    onEvent({
      type: 'stage_done',
      stage: 'observation',
      wallMs: observation.wallMs,
      detail: `${observed.timeline.events.length} events`,
    });
  } else {
    onEvent({ type: 'stage_skipped', stage: 'ingestion', reason: 'timeline supplied' });
    onEvent({ type: 'stage_skipped', stage: 'observation', reason: 'timeline supplied' });
    durationSec = (await probeVideo(input.videoPath)).durationSec;
  }

  onEvent({ type: 'stage_start', stage: 'reduce' });
  const endReduce = metrics.begin('reduce');
  const draft = reduceTimeline(timeline);
  const reduce = endReduce();
  onEvent({
    type: 'stage_done',
    stage: 'reduce',
    wallMs: reduce.wallMs,
    detail: `${draft.status}, ${draft.steps.length} steps, ${draft.discarded.length} discarded`,
  });

  let phrased: PhrasedGuide = { ...draft, steps: [] };
  let verdicts: Verdict[] = [];

  if (draft.steps.length === 0) {
    // A refusal never reaches a model again. Paying to verify a guide we are
    // about to decline would be a design bug, not just a wasted cent.
    onEvent({ type: 'stage_skipped', stage: 'phrasing', reason: 'no steps to word' });
    onEvent({ type: 'stage_skipped', stage: 'frames', reason: 'no steps to illustrate' });
    onEvent({ type: 'stage_skipped', stage: 'grounding', reason: 'no steps to verify' });
  } else {
    if (input.phrased !== undefined) {
      phrased = input.phrased;
      onEvent({ type: 'stage_skipped', stage: 'phrasing', reason: 'reused from cache' });
    } else {
      onEvent({ type: 'stage_start', stage: 'phrasing' });
      const endPhrasing = metrics.begin('phrasing');
      const result = await phraseGuide(ai, draft, {
        onRetry: retryReporter('phrasing'),
        ...(input.model === undefined ? {} : { model: input.model }),
        onStructuralRetry: (attempt, problem) => {
          onEvent({ type: 'note', message: `phrasing retry ${attempt}: ${problem}` });
        },
      });
      const phrasing = endPhrasing({
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        cachedTokens: result.usage.cachedTokens,
        apiCalls: result.apiCalls,
        retries: result.transportRetries + result.structuralRetries,
      });
      phrased = result.guide;
      onEvent({
        type: 'stage_done',
        stage: 'phrasing',
        wallMs: phrasing.wallMs,
        detail: `${phrased.steps.length} steps worded`,
      });
    }

    // Steps only become readable once they have been worded, so this is the
    // earliest honest moment to claim the reader has something.
    metrics.markFirstStep();
    onEvent({ type: 'first_step', atMs: metrics.elapsedMs });

    onEvent({ type: 'stage_start', stage: 'frames' });
    const endFrames = metrics.begin('frames');
    const pairs = await extractFrames(input.videoPath, phrased.steps, durationSec, {
      outputRoot: input.framesRoot,
    });
    const frames = endFrames();
    onEvent({
      type: 'stage_done',
      stage: 'frames',
      wallMs: frames.wallMs,
      detail: `${pairs.length * 2} PNG`,
    });

    onEvent({ type: 'stage_start', stage: 'grounding' });
    const endGrounding = metrics.begin('grounding');
    const grounded = await groundSteps(ai, phrased.steps, pairs, {
      ...(input.verdictCache === undefined ? {} : { cache: input.verdictCache }),
      ...(input.model === undefined ? {} : { model: input.model }),
      onRetry: retryReporter('grounding'),
    });
    const grounding = endGrounding({
      model: grounded.model,
      inputTokens: grounded.usage.inputTokens,
      outputTokens: grounded.usage.outputTokens,
      cachedTokens: grounded.usage.cachedTokens,
      apiCalls: grounded.apiCalls,
      retries: grounded.retries,
      cacheHits: grounded.cacheHits,
    });
    verdicts = grounded.verdicts;

    if (grounded.quotaExhausted) {
      onEvent({
        type: 'note',
        message:
          'The daily free-tier quota ran out mid-run. Unchecked steps are marked unclear, never supported.',
      });
    }
    onEvent({
      type: 'stage_done',
      stage: 'grounding',
      wallMs: grounding.wallMs,
      detail: `${grounded.verdicts.filter((v) => v.result === 'supported').length}/${
        grounded.verdicts.length
      } supported, ${grounded.cacheHits} cached`,
    });
  }

  onEvent({ type: 'stage_start', stage: 'assembly' });
  const endAssembly = metrics.begin('assembly');
  const document = assembleGuide({
    guide: phrased,
    verdicts,
    context: timeline.app_context,
    source: { filename, durationSec, sha256: input.sha256 },
  });
  const assembly = endAssembly();
  onEvent({
    type: 'stage_done',
    stage: 'assembly',
    wallMs: assembly.wallMs,
    detail: `${document.status}, verified_ratio ${document.verified_ratio.toFixed(2)}`,
  });

  // The local copy survives until here on purpose: grounding cuts its frames
  // from it rather than downloading the video back.
  if (input.deleteSourceWhenDone === true) {
    await rm(input.videoPath, { force: true });
  }

  return { document, timeline, phrased, metrics: metrics.finish() };
}
