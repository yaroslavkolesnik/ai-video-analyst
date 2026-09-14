/**
 * Module 2 - Observation.
 *
 * The only stage that watches the video, and the only stage allowed to say what
 * happened. It does not write documentation, does not rank steps and does not
 * decide anything: it answers "what is observable at this second", and the
 * deterministic code downstream does the deciding.
 *
 * The system prompt below is a contract, not a style guide. Its four load-bearing
 * rules - visibility, speech-vs-screen, superseding, gaps - are the reason the
 * pipeline can later prove it did not invent a click.
 */
import {
  MediaResolution,
  type GenerateContentResponse,
  type GoogleGenAI,
  type Part,
} from '@google/genai';

import { callWithRetry } from './gemini.js';
import type { MediaAsset } from './ingestion.js';
import {
  OBSERVATION_RESPONSE_SCHEMA,
  ObservationPayloadSchema,
  SCHEMA_VERSION,
  type RawTimeline,
} from '../schemas/timeline.js';

export const OBSERVATION_MODEL = 'gemini-3.7-flash';

/**
 * One sampled frame per second. Anything denser multiplies video tokens without
 * making a click easier to see; anything sparser starts losing short actions.
 */
export const OBSERVATION_FPS = 1;

/**
 * HIGH is not a quality preference, it is a requirement: at LOW the model cannot
 * read the UI text this product is entirely about - filter values, button labels,
 * the row count in "Showing N of 12".
 */
export const OBSERVATION_MEDIA_RESOLUTION = MediaResolution.MEDIA_RESOLUTION_HIGH;

const SYSTEM_PROMPT = `You are a screen-recording observer. You do NOT write documentation.
Your only job is to report what is observable in this recording.

Emit a flat, chronologically ordered list of events. For each event:

VISIBILITY — the single most important rule.
  Set "visible": true ONLY if you can literally see the action or its result
  in the video frames. If you believe an action must have happened but you
  cannot see it, set "visible": false and describe it anyway. Never merge an
  inferred action into a visible one.

SPEECH vs SCREEN — these are separate channels. Never let one fill in for
  the other.
  - "spoken": true if the narrator described this event out loud.
  - A necessary action performed in silence is "visible": true, "spoken": false.
    This is normal and important. Report it.
  - If the narrator says one thing and the screen shows another, emit the event
    describing WHAT THE SCREEN SHOWS, and fill "conflict" with what was said.
    Do not resolve the conflict. Do not pick a side.

SUPERSEDING — corrections and abandoned attempts.
  If a later event undoes, reverses or replaces an earlier one, set the earlier
  event's "superseded_by" to the later event's id. Judge by observable effect on
  screen, not by tone of voice. A value typed then cleared, a filter set then
  changed, a dropdown option selected then re-selected: all superseded.

GAPS — jumps in the recording.
  If UI state changes with no visible cause (a cut, a jump, an off-screen action),
  emit an event with kind "gap" describing what changed and what must have
  happened in between. Set "visible": false. Never invent the click that would
  explain it.

TIMESTAMPS — seconds from the start, as numbers (e.g. 7.0, not "00:07").
  t_start  — when the action begins
  t_end    — when its effect is fully visible on screen. Add a buffer of one to
    two seconds past the moment you believe the change completes. Frames are
    sampled once per second, and menus, dialogs, checkboxes and row counts
    finish rendering after the click that started them. A t_end placed on the
    click itself lands on the state BEFORE the action, which reads as if the
    action never happened. Err late, never early.
  screenshot_t — the single most informative moment for a reader who has to
    FIND this control: prefer a frame where the target element is visible and
    not yet activated, with any dropdown or menu already open.

STATE — the visible consequence of an action.
  After any action that changes what the table shows, emit a "ui_state" event
  with the visible count, quoting the on-screen text exactly as it is written
  (for example "Showing 4 of 12"). This is the observable proof that the action
  took effect. If the count is not readable in the frames, say that instead —
  never compute it yourself.

SUCCESS — only if shown.
  Emit kind "success_state" only if the recording visibly shows the operation
  completed (a downloaded file, a confirmation, a changed list). Absence of a
  success state is a valid and expected outcome. Never assert success you did
  not see.

Describe the application generically ("the orders table", "the Status dropdown").
Do not use knowledge of how such apps usually work to fill in anything.`;

export type ObservationErrorCode = 'empty_response' | 'invalid_json' | 'schema_mismatch';

export class ObservationError extends Error {
  readonly code: ObservationErrorCode;

  constructor(code: ObservationErrorCode, message: string) {
    super(message);
    this.name = 'ObservationError';
    this.code = code;
  }
}

export type ObservationUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

export type ObservationResult = {
  timeline: RawTimeline;
  /**
   * Structural problems in an otherwise schema-valid timeline: duplicate ids,
   * `superseded_by` pointing nowhere, timestamps outside the recording. Reported
   * rather than repaired - silently fixing a model's bookkeeping would hide the
   * one signal that says the contract is not holding.
   */
  integrity: string[];
  usage: ObservationUsage;
  wallMs: number;
  /** Attempts discarded to capacity or rate-limit answers before this one succeeded. */
  retries: number;
  model: string;
};

export type ObserveOptions = {
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  /**
   * Which model watches the recording. Defaults to `OBSERVATION_MODEL`; a caller
   * overrides it only to spend a different model's daily allowance, because the
   * free-tier quota is counted per model per day.
   */
  model?: string;
};

function readUsage(response: GenerateContentResponse): ObservationUsage {
  const usage = response.usageMetadata;
  return {
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
    cachedTokens: usage?.cachedContentTokenCount ?? 0,
    totalTokens: usage?.totalTokenCount ?? 0,
  };
}

function checkIntegrity(timeline: RawTimeline, durationSec: number): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const indexById = new Map<string, number>();

  timeline.events.forEach((event, index) => {
    if (seen.has(event.id)) {
      problems.push(`duplicate event id "${event.id}"`);
    }
    seen.add(event.id);
    indexById.set(event.id, index);
  });

  let previousStart = Number.NEGATIVE_INFINITY;
  for (const event of timeline.events) {
    if (event.t_start < previousStart) {
      problems.push(`${event.id}: events are not in chronological order (t_start ${event.t_start})`);
    }
    previousStart = event.t_start;

    if (event.t_end < event.t_start) {
      problems.push(`${event.id}: t_end ${event.t_end} precedes t_start ${event.t_start}`);
    }

    for (const [field, value] of [
      ['t_start', event.t_start],
      ['t_end', event.t_end],
      ['screenshot_t', event.screenshot_t],
    ] as const) {
      if (value < 0 || value > durationSec) {
        problems.push(
          `${event.id}: ${field} ${value} falls outside the recording (0-${durationSec.toFixed(1)}s)`,
        );
      }
    }

    if (event.superseded_by !== null) {
      const target = indexById.get(event.superseded_by);
      if (target === undefined) {
        problems.push(`${event.id}: superseded_by "${event.superseded_by}" matches no event`);
      } else if (target <= (indexById.get(event.id) ?? -1)) {
        problems.push(
          `${event.id}: superseded_by "${event.superseded_by}" points backwards; only a later event can supersede`,
        );
      }
    }
  }

  return problems;
}

/** Watches the recording and returns the raw timeline. No guide, no prose, no decisions. */
export async function observe(
  ai: GoogleGenAI,
  asset: MediaAsset,
  options: ObserveOptions = {},
): Promise<ObservationResult> {
  const videoPart: Part = {
    fileData: { fileUri: asset.fileUri, mimeType: asset.mimeType },
    videoMetadata: { fps: OBSERVATION_FPS },
  };

  // The duration is stated because the model reasons about timestamps in whole
  // seconds and has no other way to know where the recording ends.
  const instruction =
    `This recording is ${asset.durationSec.toFixed(1)} seconds long. ` +
    `Report every observable event in it, in chronological order.`;

  const model = options.model ?? OBSERVATION_MODEL;

  const startedAt = Date.now();
  const { value: response, retries } = await callWithRetry(
    () =>
      ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [videoPart, { text: instruction }] }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          mediaResolution: OBSERVATION_MEDIA_RESOLUTION,
          responseMimeType: 'application/json',
          responseSchema: OBSERVATION_RESPONSE_SCHEMA,
        },
      }),
    options.onRetry,
  );
  const wallMs = Date.now() - startedAt;

  const text = response.text;
  if (text === undefined || text.trim() === '') {
    throw new ObservationError(
      'empty_response',
      `The model returned no text (finish reason: ${
        response.candidates?.[0]?.finishReason ?? 'unknown'
      }).`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new ObservationError(
      'invalid_json',
      `The model returned text that is not JSON: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }

  const parsed = ObservationPayloadSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ObservationError('schema_mismatch', `The response does not match the contract: ${details}`);
  }

  const timeline: RawTimeline = { schema_version: SCHEMA_VERSION, ...parsed.data };

  return {
    timeline,
    integrity: checkIntegrity(timeline, asset.durationSec),
    usage: readUsage(response),
    wallMs,
    retries,
    model,
  };
}
