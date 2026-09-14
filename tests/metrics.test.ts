/**
 * Metrics carry the cost claim the delivery notes make, so the pricing and the
 * provenance attached to it are tested like any other output.
 */
import { describe, expect, it } from 'vitest';

import { PRICING, priceTokens } from '../src/config/pricing.js';
import { MetricsCollector, formatMetrics } from '../src/modules/metrics.js';

describe('priceTokens', () => {
  it('prices a known model at its published rate', () => {
    const { costUsd } = priceTokens('gemini-3.8-flash', 1_000_000, 1_000_000);

    expect(costUsd).toBeCloseTo(0.75 + 3.75, 10);
  });

  it('reports zero and no pricing for a model it has no rate for', () => {
    const { costUsd, pricing } = priceTokens('some-model-we-never-checked', 1_000_000, 0);

    expect(costUsd).toBe(0);
    expect(pricing).toBeNull();
  });

  it('says out loud when a rate is borrowed from another model', () => {
    expect(PRICING['gemini-3.7-flash']?.basis).toContain('unverified');
    expect(PRICING['gemini-3.8-flash']?.basis).toBeNull();
  });

  it('keeps a source and a date on every rate', () => {
    for (const [model, pricing] of Object.entries(PRICING)) {
      expect(pricing.source, model).toMatch(/^https:\/\//);
      expect(pricing.checkedOn, model).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('MetricsCollector', () => {
  it('records one entry per stage, in the order they ran', () => {
    const metrics = new MetricsCollector();
    metrics.begin('reduce')();
    metrics.begin('phrasing')({ model: 'gemini-3.8-flash', inputTokens: 1000, outputTokens: 500 });

    expect(metrics.finish().stages.map((stage) => stage.stage)).toEqual(['reduce', 'phrasing']);
  });

  it('totals cost, calls and retries across stages', () => {
    const metrics = new MetricsCollector();
    metrics.begin('observation')({
      model: 'gemini-3.8-flash',
      inputTokens: 1_000_000,
      outputTokens: 0,
      apiCalls: 3,
      retries: 2,
    });
    metrics.begin('grounding')({
      model: 'gemini-3.8-flash',
      inputTokens: 0,
      outputTokens: 1_000_000,
      apiCalls: 5,
      retries: 1,
    });

    const run = metrics.finish();
    expect(run.totalCostUsd).toBeCloseTo(4.5, 10);
    expect(run.totalApiCalls).toBe(8);
    expect(run.totalRetries).toBe(3);
  });

  it('charges nothing for a stage that made no request', () => {
    const metrics = new MetricsCollector();
    metrics.begin('frames')();

    expect(metrics.finish().totalCostUsd).toBe(0);
  });

  it('leaves time-to-first-step unset until a step is readable', () => {
    const metrics = new MetricsCollector();
    metrics.begin('reduce')();

    expect(metrics.finish().timeToFirstStepMs).toBeNull();

    const second = new MetricsCollector();
    second.markFirstStep();
    expect(second.finish().timeToFirstStepMs).not.toBeNull();
  });

  it('takes its provenance line from a model the run actually used', () => {
    const metrics = new MetricsCollector();
    metrics.begin('phrasing')({ model: 'gemini-3.7-flash', inputTokens: 10, outputTokens: 10 });

    expect(metrics.finish().pricing.checkedOn).toBe('2026-09-12');
    expect(metrics.finish().pricing.note).toContain('free credits are not a zero operating cost');
  });

  it('formats a read-out that names the borrowed rate', () => {
    const metrics = new MetricsCollector();
    metrics.begin('grounding')({ model: 'gemini-3.7-flash', inputTokens: 11_828, outputTokens: 289 });

    const text = formatMetrics(metrics.finish());
    expect(text).toContain('grounding');
    expect(text).toContain('priced at');
    expect(text).toContain('https://ai.google.dev/gemini-api/docs/pricing');
  });
});
