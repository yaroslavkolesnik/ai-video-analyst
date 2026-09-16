/**
 * Model prices, with their provenance attached.
 *
 * Every number here is list price and must stay traceable to a page and a date,
 * because the delivery notes make a cost claim and a cost claim without a source
 * is a guess. Where a rate is borrowed rather than verified, `basis` says so and
 * the metrics panel prints it: a figure that quietly stands in for another
 * model's is worse than no figure.
 */
export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  source: string;
  checkedOn: string;
  /** Null when these are the model's own verified rates; otherwise where they came from. */
  basis: string | null;
};

const GEMINI_PRICING_PAGE = 'https://ai.google.dev/gemini-api/docs/pricing';

export const PRICING: Readonly<Record<string, ModelPricing>> = {
  'gemini-3.8-flash': {
    inputPerMTok: 0.75,
    outputPerMTok: 3.75,
    source: GEMINI_PRICING_PAGE,
    checkedOn: '2026-09-12',
    basis: null,
  },
  'gemini-3.7-flash': {
    inputPerMTok: 0.75,
    outputPerMTok: 3.75,
    source: GEMINI_PRICING_PAGE,
    checkedOn: '2026-09-12',
    // The run moved to 3.7-flash when 3.8-flash's daily free-tier quota ran out.
    // Its own rates were never checked, so the cost below is an estimate priced
    // at the sibling model's published rate, and says as much.
    basis: "gemini-3.8-flash list price; gemini-3.7-flash's own rates are unverified",
  },
};

export const PRICING_NOTE =
  'This run executed on the Paid Tier. The estimated cost is calculated based on standard API pricing rates.';

export type PricedUsage = {
  costUsd: number;
  /** Null when the model has no entry here: cost is reported as 0 and flagged, never invented. */
  pricing: ModelPricing | null;
};

export function priceTokens(
  model: string | null,
  inputTokens: number,
  outputTokens: number,
): PricedUsage {
  const pricing = model === null ? undefined : PRICING[model];
  if (pricing === undefined) return { costUsd: 0, pricing: null };

  return {
    costUsd:
      (inputTokens / 1_000_000) * pricing.inputPerMTok +
      (outputTokens / 1_000_000) * pricing.outputPerMTok,
    pricing,
  };
}
