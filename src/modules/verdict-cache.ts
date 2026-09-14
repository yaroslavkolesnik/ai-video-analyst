/**
 * An on-disk record of verifications already paid for.
 *
 * The free tier allows twenty requests per model per day and one full run of the
 * five test recordings needs more than that, so re-verifying an unchanged step
 * is not a small waste - it is the difference between finishing a run and not.
 *
 * Keys come from `verdictCacheKey`: the frame bytes, the sentence and the model.
 * Anything that could change the answer changes the key, so a hit is never a
 * stale answer to a different question. The files are committed, which also
 * gives the assembly stage real verdicts to build on with no network at all.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { GroundingResponseSchema, type GroundingResponse } from '../schemas/draft.js';
import type { VerdictCache } from './grounding.js';

export const VERDICT_CACHE_VERSION = 'verdicts/1';

type CacheEntry = GroundingResponse & { cached_at: string };

type CacheFile = {
  schema_version: string;
  video: string;
  model: string;
  entries: Record<string, CacheEntry>;
};

export class FileVerdictCache implements VerdictCache {
  private readonly entries = new Map<string, CacheEntry>();
  private dirty = false;

  private constructor(
    private readonly path: string,
    private readonly video: string,
    private readonly model: string,
  ) {}

  /**
   * Reads the cache for one recording. A missing, unreadable or malformed file is
   * an empty cache, not an error: the worst it can cost is requests we would have
   * made anyway, and a run must never fail because a cache went bad.
   */
  static async open(
    cacheDir: string,
    video: string,
    model: string,
    options: { refresh?: boolean } = {},
  ): Promise<FileVerdictCache> {
    const path = resolve(cacheDir, `${video}.json`);
    const cache = new FileVerdictCache(path, video, model);

    if (options.refresh === true) return cache;

    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch {
      return cache;
    }

    try {
      const parsed = JSON.parse(raw) as CacheFile;
      if (parsed.schema_version !== VERDICT_CACHE_VERSION) return cache;

      for (const [key, entry] of Object.entries(parsed.entries ?? {})) {
        const verdict = GroundingResponseSchema.safeParse(entry);
        if (verdict.success) {
          cache.entries.set(key, { ...verdict.data, cached_at: entry.cached_at });
        }
      }
    } catch {
      return cache;
    }

    return cache;
  }

  get(key: string): GroundingResponse | undefined {
    const entry = this.entries.get(key);
    if (entry === undefined) return undefined;
    const { cached_at: _cachedAt, ...verdict } = entry;
    return verdict;
  }

  set(key: string, value: GroundingResponse): void {
    this.entries.set(key, { ...value, cached_at: new Date().toISOString() });
    this.dirty = true;
  }

  get size(): number {
    return this.entries.size;
  }

  /** Writes only when something new was learned, so a cached run leaves the file untouched. */
  async save(): Promise<boolean> {
    if (!this.dirty) return false;

    const file: CacheFile = {
      schema_version: VERDICT_CACHE_VERSION,
      video: this.video,
      model: this.model,
      entries: Object.fromEntries(this.entries),
    };

    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
    this.dirty = false;
    return true;
  }
}
