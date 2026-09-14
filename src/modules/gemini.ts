/**
 * One place where the Gemini client is built, so that no module reaches for the
 * API key on its own. Modules take the client as an argument; nothing here is a
 * singleton and nothing here reads configuration at import time.
 */
import { ApiError, GoogleGenAI } from '@google/genai';

export class MissingApiKeyError extends Error {
  constructor() {
    super('GEMINI_API_KEY is not set. Copy .env.example to .env and fill it in.');
    this.name = 'MissingApiKeyError';
  }
}

export function createGeminiClient(apiKey = process.env['GEMINI_API_KEY']): GoogleGenAI {
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new MissingApiKeyError();
  }
  return new GoogleGenAI({ apiKey });
}

/** Capacity, not anything a different request would fix. Spikes clear in seconds. */
const CAPACITY_STATUSES = new Set([500, 502, 503, 504]);

const RATE_LIMIT_STATUS = 429;

export const RETRY_POLICY = {
  maxAttempts: 4,
  capacityBaseDelayMs: 2_000,
  /** Per-minute quota. Seconds of backoff are pointless against it. */
  rateLimitBaseDelayMs: 30_000,
  /** Never sleep longer than this on the server's own advice. */
  maxDelayMs: 120_000,
} as const;

/** The failing 503s of a bad afternoon count against the daily quota just like successes do. */
export class DailyQuotaExhaustedError extends Error {
  constructor(detail: string) {
    super(`The model's free-tier daily request quota is exhausted: ${detail}`);
    this.name = 'DailyQuotaExhaustedError';
  }
}

type QuotaFailure = {
  '@type'?: string;
  retryDelay?: string;
  violations?: { quotaId?: string; quotaValue?: string }[];
};

/** The SDK exposes the error body only as a JSON string in `message`. */
function readErrorDetails(error: ApiError): QuotaFailure[] {
  try {
    const body = JSON.parse(error.message) as { error?: { details?: QuotaFailure[] } };
    return body.error?.details ?? [];
  } catch {
    return [];
  }
}

/** "19s", "19.438258125s" */
function parseRetryDelay(details: QuotaFailure[]): number | null {
  const retryInfo = details.find((detail) => detail['@type']?.endsWith('RetryInfo'));
  const seconds = Number.parseFloat(retryInfo?.retryDelay ?? '');
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

function findDailyQuotaViolation(details: QuotaFailure[]): string | null {
  for (const detail of details) {
    for (const violation of detail.violations ?? []) {
      if (violation.quotaId?.includes('PerDay') === true) {
        return `${violation.quotaId} (limit ${violation.quotaValue ?? 'unknown'})`;
      }
    }
  }
  return null;
}

export type RetryReport = {
  /** How many attempts were thrown away before one succeeded. Fed to the metrics panel. */
  retries: number;
};

/**
 * Retries a Gemini call while the failure is a capacity or rate-limit answer.
 * Three things are deliberately never retried:
 *   - a bad request or a schema violation - repeating it returns the same answer
 *     for the same money;
 *   - a daily quota that is already spent - no amount of waiting brings it back
 *     inside this run, and every attempt spends another request;
 *   - anything past `maxAttempts`.
 */
export async function callWithRetry<T>(
  call: () => Promise<T>,
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void,
): Promise<{ value: T } & RetryReport> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= RETRY_POLICY.maxAttempts; attempt += 1) {
    try {
      return { value: await call(), retries: attempt - 1 };
    } catch (error) {
      lastError = error;
      if (!(error instanceof ApiError)) break;

      const details = readErrorDetails(error);
      if (error.status === RATE_LIMIT_STATUS) {
        const daily = findDailyQuotaViolation(details);
        if (daily !== null) throw new DailyQuotaExhaustedError(daily);
      }

      if (attempt === RETRY_POLICY.maxAttempts) break;

      const baseDelayMs =
        error.status === RATE_LIMIT_STATUS
          ? RETRY_POLICY.rateLimitBaseDelayMs
          : CAPACITY_STATUSES.has(error.status)
            ? RETRY_POLICY.capacityBaseDelayMs
            : null;
      if (baseDelayMs === null) break;

      // Exponential backoff with jitter: several clients backing off in lockstep
      // just rebuild the spike they are waiting out. When the server states its
      // own delay, that number wins - it knows when the window reopens.
      const backoffMs = baseDelayMs * 2 ** (attempt - 1) * (1 + Math.random());
      const delayMs = Math.min(parseRetryDelay(details) ?? backoffMs, RETRY_POLICY.maxDelayMs);

      onRetry?.(attempt, delayMs, error);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
