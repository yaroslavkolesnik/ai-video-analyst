/**
 * Module 6a - Metrics.
 *
 * Every stage is timed and priced as it happens rather than summed up at the
 * end. That ordering is the whole point: a total assembled afterwards has no way
 * to say which stage burned the time, and no way to report retries at all - and
 * retries are exactly the cost a brief asking for measured numbers wants to see.
 */
import { PRICING, PRICING_NOTE, priceTokens, type ModelPricing } from '../config/pricing.js';

/**
 * `reduce` and `frames` are not in the architecture's original list because they
 * spend no tokens. They are here anyway: they spend wall time, and the brief
 * measures speed as well as cost.
 */
export type Stage =
  | 'ingestion'
  | 'observation'
  | 'reduce'
  | 'phrasing'
  | 'frames'
  | 'grounding'
  | 'assembly';

export type StageMetric = {
  stage: Stage;
  model: string | null;
  wallMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  apiCalls: number;
  retries: number;
  costUsd: number;
  /** Requests answered from the local cache, which cost nothing. */
  cacheHits: number;
  /** Set when the cost above is priced at another model's published rate. */
  pricingBasis: string | null;
};

export type RunMetrics = {
  totalWallMs: number;
  /** How long until the reader could see a first readable step. */
  timeToFirstStepMs: number | null;
  stages: StageMetric[];
  totalCostUsd: number;
  totalApiCalls: number;
  totalRetries: number;
  pricing: {
    source: string;
    checkedOn: string;
    note: string;
  };
};

export type StageReport = {
  model?: string | null;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  apiCalls?: number;
  retries?: number;
  cacheHits?: number;
};

/** Ends a stage and records what it cost. Returned by `begin`. */
export type EndStage = (report?: StageReport) => StageMetric;

export class MetricsCollector {
  private readonly startedAt: number;
  private readonly recorded: StageMetric[] = [];
  private firstStepAt: number | null = null;

  constructor(now: number = Date.now()) {
    this.startedAt = now;
  }

  begin(stage: Stage, now: number = Date.now()): EndStage {
    const stageStartedAt = now;

    return (report: StageReport = {}): StageMetric => {
      const model = report.model ?? null;
      const inputTokens = report.inputTokens ?? 0;
      const outputTokens = report.outputTokens ?? 0;
      const { costUsd, pricing } = priceTokens(model, inputTokens, outputTokens);

      const metric: StageMetric = {
        stage,
        model,
        wallMs: Date.now() - stageStartedAt,
        inputTokens,
        outputTokens,
        cachedTokens: report.cachedTokens ?? 0,
        apiCalls: report.apiCalls ?? 0,
        retries: report.retries ?? 0,
        costUsd,
        cacheHits: report.cacheHits ?? 0,
        pricingBasis: pricing?.basis ?? null,
      };

      this.recorded.push(metric);
      return metric;
    };
  }

  /** Called once the first step is readable - after phrasing, not before. */
  markFirstStep(now: number = Date.now()): void {
    this.firstStepAt ??= now - this.startedAt;
  }

  get stages(): readonly StageMetric[] {
    return this.recorded;
  }

  /** Time since the run began, readable mid-run without closing the metrics out. */
  get elapsedMs(): number {
    return Date.now() - this.startedAt;
  }

  finish(): RunMetrics {
    // The provenance line comes from whichever priced model this run actually
    // used, so the source and date shown are the ones the numbers came from.
    let priced: ModelPricing | null = null;
    for (const metric of this.recorded) {
      const pricing = metric.model === null ? undefined : PRICING[metric.model];
      if (pricing !== undefined) {
        priced = pricing;
        break;
      }
    }

    return {
      totalWallMs: Date.now() - this.startedAt,
      timeToFirstStepMs: this.firstStepAt,
      stages: [...this.recorded],
      totalCostUsd: this.recorded.reduce((sum, metric) => sum + metric.costUsd, 0),
      totalApiCalls: this.recorded.reduce((sum, metric) => sum + metric.apiCalls, 0),
      totalRetries: this.recorded.reduce((sum, metric) => sum + metric.retries, 0),
      pricing: {
        source: priced?.source ?? 'no priced model was used in this run',
        checkedOn: priced?.checkedOn ?? '-',
        note: PRICING_NOTE,
      },
    };
  }
}

/** A compact, aligned read-out for the terminal. */
export function formatMetrics(metrics: RunMetrics): string {
  const lines: string[] = [];
  const pad = (value: string, width: number): string => value.padEnd(width);

  lines.push(
    `${pad('stage', 12)}${pad('wall', 9)}${pad('calls', 7)}${pad('retries', 9)}` +
      `${pad('in', 9)}${pad('out', 8)}${pad('cached', 8)}cost`,
  );

  for (const stage of metrics.stages) {
    lines.push(
      pad(stage.stage, 12) +
        pad(`${(stage.wallMs / 1000).toFixed(1)}s`, 9) +
        pad(String(stage.apiCalls), 7) +
        pad(String(stage.retries), 9) +
        pad(String(stage.inputTokens), 9) +
        pad(String(stage.outputTokens), 8) +
        pad(String(stage.cacheHits), 8) +
        (stage.costUsd > 0 ? `$${stage.costUsd.toFixed(4)}` : '-'),
    );
  }

  lines.push('');
  lines.push(
    `total ${(metrics.totalWallMs / 1000).toFixed(1)}s, ` +
      `${metrics.totalApiCalls} call(s), ${metrics.totalRetries} retries, ` +
      `$${metrics.totalCostUsd.toFixed(4)}` +
      (metrics.timeToFirstStepMs === null
        ? ''
        : `, first step at ${(metrics.timeToFirstStepMs / 1000).toFixed(1)}s`),
  );

  const basis = metrics.stages.find((stage) => stage.pricingBasis !== null)?.pricingBasis;
  if (basis !== undefined && basis !== null) lines.push(`priced at ${basis}`);
  lines.push(`${metrics.pricing.source} (checked ${metrics.pricing.checkedOn})`);

  return lines.join('\n');
}
