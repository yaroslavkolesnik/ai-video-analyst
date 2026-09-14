/**
 * Module 4a - Frame extraction.
 *
 * Cuts the two stills that let a step be checked against the recording it came
 * from: one where the control is still there to be found, one where its effect
 * is on screen. Nothing here talks to a model; it only produces the evidence the
 * grounding pass argues about.
 *
 * Uses the `ffmpeg-static` binary rather than a system ffmpeg, so the same code
 * runs on this Windows machine and in a Linux container with no host install.
 */
import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { promisify } from 'node:util';

import ffmpegStatic from 'ffmpeg-static';

import type { DraftStep } from '../schemas/draft.js';

/**
 * `ffmpeg-static` is a CommonJS module whose `module.exports` *is* the path
 * string, but it ships an ESM-style `export default` declaration. The two
 * disagree, so the default import arrives typed as the namespace while holding
 * the string. Verified at runtime: it resolves to the bundled ffmpeg binary.
 */
const ffmpegPath = ffmpegStatic as unknown as string | null;

const execFileAsync = promisify(execFile);

export const FRAME_SETTINGS = {
  /**
   * Frames are capped at this width, never upscaled. Wide enough to keep UI text
   * legible, small enough that two of them ride inline in one request.
   */
  maxWidthPx: 1280,
  /** A frame asked for at the very last instant of a file decodes to nothing. */
  endGuardSec: 0.05,
  timeoutMs: 30_000,
} as const;

export type FrameSlot = 'shot' | 'after';

export type FramePlan = {
  event_id: string;
  /** `screenshot_t`: the control is visible and not yet activated. */
  shot_t: number;
  /** `t_end`: the effect of the action is on screen. */
  after_t: number;
  /** Set when a requested timestamp fell outside the recording and was pulled back in. */
  clamped: boolean;
};

export type ExtractedFrame = {
  slot: FrameSlot;
  /** The timestamp actually cut, after clamping. */
  t: number;
  path: string;
  /** Where the server will serve it from, once there is a server. */
  publicPath: string;
  bytes: number;
};

export type FramePair = {
  event_id: string;
  shot: ExtractedFrame;
  after: ExtractedFrame;
};

export type FramesErrorCode = 'ffmpeg_unavailable' | 'ffmpeg_failed' | 'empty_output';

export class FramesError extends Error {
  readonly code: FramesErrorCode;

  constructor(code: FramesErrorCode, message: string) {
    super(message);
    this.name = 'FramesError';
    this.code = code;
  }
}

/**
 * Chooses the timestamps, separately from any I/O, so the choice can be tested
 * without ffmpeg. Both are clamped into the recording: a step whose observation
 * ran past the end of the file still gets a real frame rather than an error.
 */
export function planFramePairs(steps: DraftStep[], durationSec: number): FramePlan[] {
  const last = Math.max(0, durationSec - FRAME_SETTINGS.endGuardSec);
  const clamp = (t: number): number => Math.min(Math.max(t, 0), last);

  return steps.map((step) => {
    const shot_t = clamp(step.screenshot_t);
    const after_t = clamp(step.t_end);
    return {
      event_id: step.event_id,
      shot_t,
      after_t,
      clamped: shot_t !== step.screenshot_t || after_t !== step.t_end,
    };
  });
}

function requireFfmpeg(): string {
  if (ffmpegPath === null) {
    throw new FramesError(
      'ffmpeg_unavailable',
      'ffmpeg-static did not resolve a binary for this platform.',
    );
  }
  return ffmpegPath;
}

async function cutFrame(videoPath: string, t: number, outputPath: string): Promise<number> {
  // `-ss` BEFORE `-i` is an input seek: ffmpeg jumps to the keyframe before the
  // timestamp and decodes forward to it, so this is both fast on long files and
  // frame-accurate. (The architecture's `-q:v 2` is dropped: it is an MJPEG
  // quality flag and means nothing for PNG output.)
  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-ss',
    t.toFixed(3),
    '-i',
    videoPath,
    '-frames:v',
    '1',
    '-vf',
    `scale='min(${FRAME_SETTINGS.maxWidthPx},iw)':-2`,
    '-y',
    outputPath,
  ];

  try {
    await execFileAsync(requireFfmpeg(), args, { timeout: FRAME_SETTINGS.timeoutMs });
  } catch (cause) {
    if (cause instanceof FramesError) throw cause;
    throw new FramesError(
      'ffmpeg_failed',
      `ffmpeg could not cut a frame at ${t.toFixed(2)}s: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  try {
    const { size } = await stat(outputPath);
    if (size === 0) throw new FramesError('empty_output', `ffmpeg wrote an empty frame at ${t}s.`);
    return size;
  } catch (cause) {
    if (cause instanceof FramesError) throw cause;
    throw new FramesError('empty_output', `ffmpeg wrote no frame at ${t.toFixed(2)}s.`);
  }
}

export type ExtractFramesOptions = {
  /** Defaults to `public/frames`, which is gitignored: frames are regenerated per run. */
  outputRoot?: string;
  onFrame?: (event_id: string, slot: FrameSlot, t: number) => void;
};

/**
 * Cuts both frames for every step, one ffmpeg process at a time.
 *
 * Sequential on purpose: an input seek makes each call cost about a seek rather
 * than a decode of the whole file, so ten frames take a second or two - nothing
 * next to the API calls that follow. Cutting them in one multi-output ffmpeg
 * invocation would save that second and buy a command line whose failures are
 * silent.
 */
export async function extractFrames(
  videoPath: string,
  steps: DraftStep[],
  durationSec: number,
  options: ExtractFramesOptions = {},
): Promise<FramePair[]> {
  const videoName = basename(videoPath, extname(videoPath));
  const outputRoot = options.outputRoot ?? resolve(process.cwd(), 'public/frames');
  const outputDir = resolve(outputRoot, videoName);
  await mkdir(outputDir, { recursive: true });

  const plans = planFramePairs(steps, durationSec);

  const pairs: FramePair[] = [];
  for (const plan of plans) {
    const slots: ExtractedFrame[] = [];

    // One file per step and slot, named after both. Two steps that happen to
    // want the same instant each get their own copy: sharing one file would save
    // a sixth of a second and cost the names that make these frames reviewable
    // by eye, which is how this stage is checked.
    for (const [slot, t] of [
      ['shot', plan.shot_t],
      ['after', plan.after_t],
    ] as const) {
      const fileName = `${plan.event_id}-${slot}.png`;
      const path = resolve(outputDir, fileName);

      options.onFrame?.(plan.event_id, slot, t);
      const bytes = await cutFrame(videoPath, t, path);

      slots.push({ slot, t, path, publicPath: `frames/${videoName}/${fileName}`, bytes });
    }

    const [shot, after] = slots;
    if (shot === undefined || after === undefined) {
      throw new FramesError('empty_output', `Both frames are required for step ${plan.event_id}.`);
    }
    pairs.push({ event_id: plan.event_id, shot, after });
  }

  return pairs;
}
