/**
 * Module 1 - Ingestion.
 *
 * Takes a local recording, proves it is fit to be analysed, and hands back a
 * reference the model can read. Everything it rejects, it rejects here and by
 * name: a bad input should be a stated reason, never a failure three stages
 * later inside a paid API call.
 *
 * The local file is deliberately *not* deleted here. Grounding cuts its frames
 * from this same local copy rather than downloading the video back, so the
 * caller owns the file's lifetime.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { promisify } from 'node:util';

import { FileState, type GoogleGenAI } from '@google/genai';
import ffprobeStatic from 'ffprobe-static';

const execFileAsync = promisify(execFile);

export const INGESTION_LIMITS = {
  /** Files API accepts inline uploads up to this size. */
  maxSizeBytes: 100 * 1024 * 1024,
  /** The brief says recordings are under two minutes; the slack absorbs trailing silence. */
  maxDurationSec: 150,
  /** Below this width the model reads UI labels unreliably. A warning, not a gate. */
  minWidthPx: 1280,
  uploadTimeoutMs: 60_000,
  uploadPollIntervalMs: 1_000,
} as const;

/** Extension -> MIME. The extension is the claim; ffprobe is the proof. */
const ACCEPTED_EXTENSIONS: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
};

export type IngestionErrorCode =
  | 'file_not_found'
  | 'unsupported_file_type'
  | 'file_too_large'
  | 'probe_failed'
  | 'no_video_stream'
  | 'video_too_long'
  | 'upload_failed'
  | 'upload_timeout';

/** Every rejection carries a code so the HTTP layer can answer 422 rather than 500. */
export class IngestionError extends Error {
  readonly code: IngestionErrorCode;

  constructor(code: IngestionErrorCode, message: string) {
    super(message);
    this.name = 'IngestionError';
    this.code = code;
  }
}

export type MediaAsset = {
  localPath: string;
  /** Gemini Files API URI. */
  fileUri: string;
  mimeType: string;
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  sizeBytes: number;
  /** Conditions that do not disqualify the recording but change how much to trust it. */
  warnings: string[];
};

export type ProbeResult = {
  durationSec: number;
  fps: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  duration?: string;
};

type FfprobeOutput = {
  format?: { duration?: string };
  streams?: FfprobeStream[];
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** ffprobe reports frame rates as the literal ratio "30000/1001". */
function parseFrameRate(ratio: string | undefined): number | null {
  if (ratio === undefined) return null;
  const [numerator, denominator] = ratio.split('/');
  if (numerator === undefined || denominator === undefined) return null;
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0) return null;
  return n / d;
}

/**
 * Reads a local recording's real properties. Exported because grounding needs the
 * duration to clamp frame timestamps, and it cuts frames from the local file
 * without going through `ingestVideo` - there is nothing to upload for that.
 */
export async function probeVideo(localPath: string): Promise<ProbeResult> {
  let raw: string;
  try {
    const { stdout } = await execFileAsync(ffprobeStatic.path, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      localPath,
    ]);
    raw = stdout;
  } catch (cause) {
    throw new IngestionError(
      'probe_failed',
      `ffprobe could not read ${basename(localPath)}: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  let parsed: FfprobeOutput;
  try {
    parsed = JSON.parse(raw) as FfprobeOutput;
  } catch {
    throw new IngestionError('probe_failed', 'ffprobe returned output that is not JSON.');
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  if (video === undefined || video.width === undefined || video.height === undefined) {
    throw new IngestionError('no_video_stream', 'The file contains no video stream.');
  }

  const durationSec = Number(parsed.format?.duration ?? video.duration ?? Number.NaN);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new IngestionError('probe_failed', 'The file reports no usable duration.');
  }

  // avg_frame_rate, not r_frame_rate: screen recorders emit variable frame rates,
  // where the nominal rate says 30 and the file actually holds a third of that.
  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate);
  if (fps === null) {
    throw new IngestionError('probe_failed', 'The file reports no usable frame rate.');
  }

  return {
    durationSec,
    fps,
    width: video.width,
    height: video.height,
    hasAudio: streams.some((stream) => stream.codec_type === 'audio'),
  };
}

async function uploadAndAwaitActive(
  ai: GoogleGenAI,
  localPath: string,
  mimeType: string,
): Promise<string> {
  let file;
  try {
    file = await ai.files.upload({
      file: localPath,
      config: { mimeType, displayName: basename(localPath) },
    });
  } catch (cause) {
    throw new IngestionError(
      'upload_failed',
      `Uploading to the Files API failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const name = file.name;
  if (name === undefined) {
    throw new IngestionError('upload_failed', 'The Files API returned a file without a name.');
  }

  const deadline = Date.now() + INGESTION_LIMITS.uploadTimeoutMs;
  let current = file;
  while (current.state === FileState.PROCESSING) {
    if (Date.now() > deadline) {
      throw new IngestionError(
        'upload_timeout',
        `The uploaded file was still processing after ${INGESTION_LIMITS.uploadTimeoutMs / 1000}s.`,
      );
    }
    await sleep(INGESTION_LIMITS.uploadPollIntervalMs);
    current = await ai.files.get({ name });
  }

  if (current.state !== FileState.ACTIVE) {
    throw new IngestionError(
      'upload_failed',
      `The uploaded file ended in state ${current.state ?? 'unknown'}: ${
        current.error?.message ?? 'no reason given'
      }`,
    );
  }

  const uri = current.uri;
  if (uri === undefined) {
    throw new IngestionError('upload_failed', 'The Files API returned an active file without a URI.');
  }
  return uri;
}

/**
 * Validates a local recording and makes it available to the model.
 * Throws `IngestionError` for anything a user could fix by uploading a different file.
 */
export async function ingestVideo(ai: GoogleGenAI, localPath: string): Promise<MediaAsset> {
  const extension = extname(localPath).toLowerCase();
  const mimeType = ACCEPTED_EXTENSIONS[extension];
  if (mimeType === undefined) {
    throw new IngestionError(
      'unsupported_file_type',
      `${extension || 'A file with no extension'} is not supported. Accepted: ${Object.keys(
        ACCEPTED_EXTENSIONS,
      ).join(', ')}.`,
    );
  }

  let sizeBytes: number;
  try {
    const stats = await stat(localPath);
    if (!stats.isFile()) {
      throw new IngestionError('file_not_found', `${localPath} is not a file.`);
    }
    sizeBytes = stats.size;
  } catch (cause) {
    if (cause instanceof IngestionError) throw cause;
    throw new IngestionError('file_not_found', `${localPath} could not be read.`);
  }

  if (sizeBytes > INGESTION_LIMITS.maxSizeBytes) {
    throw new IngestionError(
      'file_too_large',
      `The file is ${(sizeBytes / 1024 / 1024).toFixed(1)} MB; the limit is ${
        INGESTION_LIMITS.maxSizeBytes / 1024 / 1024
      } MB.`,
    );
  }

  const probed = await probeVideo(localPath);

  if (probed.durationSec > INGESTION_LIMITS.maxDurationSec) {
    throw new IngestionError(
      'video_too_long',
      `The recording is ${probed.durationSec.toFixed(0)}s; the limit is ${
        INGESTION_LIMITS.maxDurationSec
      }s.`,
    );
  }

  const warnings: string[] = [];
  if (probed.width < INGESTION_LIMITS.minWidthPx) {
    warnings.push(
      `low resolution (${probed.width}x${probed.height}): UI text may be read unreliably`,
    );
  }
  if (!probed.hasAudio) {
    warnings.push('no audio track: nothing in the guide can be attributed to narration');
  }

  const fileUri = await uploadAndAwaitActive(ai, localPath, mimeType);

  return {
    localPath,
    fileUri,
    mimeType,
    durationSec: probed.durationSec,
    fps: probed.fps,
    width: probed.width,
    height: probed.height,
    sizeBytes,
    warnings,
  };
}
