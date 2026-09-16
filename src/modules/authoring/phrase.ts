/**
 * Module 3b - Phrasing.
 *
 * Turns each fixed step into one sentence a reader can follow. It sees no video
 * and no frames, only the observations `reduce.ts` already selected.
 *
 * The structural guarantee is the point of this module. The request carries a
 * closed list of ids; the response is accepted only if it returns the same ids,
 * the same count and the same order. So this pass **cannot** add a step, drop
 * one, merge two or reorder them - not because the prompt forbids it, but
 * because a response that did any of those fails validation and never reaches
 * the guide. The worst it can do is word a sentence badly, and a human sees that.
 */
import type { GoogleGenAI } from '@google/genai';

import { callWithRetry } from '../gemini.js';
import {
  PHRASING_RESPONSE_SCHEMA,
  PhrasingResponseSchema,
  type DraftGuide,
  type DraftStep,
  type PhrasedGuide,
  type PhrasedStep,
  type PhrasingResponse,
} from '../../schemas/draft.js';

export const PHRASING_MODEL = 'gemini-3.8-flash';

/** One structural retry, as agreed: a second disagreement is a stage failure, not a third try. */
export const PHRASING_MAX_ATTEMPTS = 2;

const SYSTEM_PROMPT = `You are wording the steps of a how-to guide whose steps have already been chosen.
You are not deciding what the steps are. That decision is made and closed.

You receive a JSON list of steps. Each has an "event_id" and an "observation"
describing what was seen on screen, and may have a "target" naming the control.

For each step, write ONE imperative English sentence telling the reader what to do.

  - Address the reader directly: "Select Shipped from the Status dropdown."
  - Name controls exactly as they are labelled in the observation or target.
    Do not rename, translate or tidy a label.
  - Keep any value, count or file name exactly as written.
  - Add nothing that is not in the observation: no reason why, no mention of what
    comes next, no UI detail you were not given, no advice.
  - No step numbers, no "then", no "first" - order is already fixed elsewhere.

Return exactly one object per step you were given: the same "event_id" values, in
the same order, the same number of them. Never add, merge, split, drop or reorder
a step. If an observation is unclear, word it plainly and literally; do not guess
at what was meant.`;

export type PhrasingErrorCode =
  | 'empty_response'
  | 'invalid_json'
  | 'schema_mismatch'
  | 'step_mismatch';

export class PhrasingError extends Error {
  readonly code: PhrasingErrorCode;

  constructor(code: PhrasingErrorCode, message: string) {
    super(message);
    this.name = 'PhrasingError';
    this.code = code;
  }
}

export type PhrasingUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

export type PhrasingResult = {
  guide: PhrasedGuide;
  usage: PhrasingUsage;
  wallMs: number;
  /** Attempts lost to 429/503 before the model answered at all. */
  transportRetries: number;
  /** Answers that were well-formed but did not word the steps they were given. */
  structuralRetries: number;
  apiCalls: number;
  model: string;
};

export type PhraseOptions = {
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  /** Called when a response was well-formed but did not match the steps it was asked to word. */
  onStructuralRetry?: (attempt: number, problem: string) => void;
  /** Overrides `PHRASING_MODEL`. The free-tier quota is per model per day. */
  model?: string;
};

/** Exactly what the model is shown - no ids it could not have been given, no extra context. */
function toPromptStep(step: DraftStep): { event_id: string; observation: string; target: DraftStep['target'] } {
  return { event_id: step.event_id, observation: step.observation, target: step.target };
}

/**
 * The guarantee, as a pure function: the response must word the steps it was
 * given, all of them, once each, in order. Returns null when it does.
 */
export function findStepMismatch(steps: DraftStep[], response: PhrasingResponse): string | null {
  const expected = steps.map((step) => step.event_id);
  const received = response.steps.map((step) => step.event_id);

  if (received.length !== expected.length) {
    return `expected ${expected.length} steps, received ${received.length}`;
  }

  const duplicates = received.filter((id, index) => received.indexOf(id) !== index);
  if (duplicates.length > 0) {
    return `repeated event_id ${[...new Set(duplicates)].join(', ')}`;
  }

  for (const [index, expectedId] of expected.entries()) {
    const receivedId = received[index];
    if (receivedId !== expectedId) {
      return `step ${index + 1} should be "${expectedId}" but is "${receivedId ?? '(missing)'}"`;
    }
  }

  return null;
}

function parseResponse(text: string | undefined): PhrasingResponse {
  if (text === undefined || text.trim() === '') {
    throw new PhrasingError('empty_response', 'The model returned no text.');
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new PhrasingError(
      'invalid_json',
      `The model returned text that is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const parsed = PhrasingResponseSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new PhrasingError('schema_mismatch', `The response does not match the contract: ${details}`);
  }

  return parsed.data;
}

/** Writes the instruction for every step of a draft. A declined draft has no steps and costs nothing. */
export async function phraseGuide(
  ai: GoogleGenAI,
  draft: DraftGuide,
  options: PhraseOptions = {},
): Promise<PhrasingResult> {
  const emptyUsage: PhrasingUsage = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, totalTokens: 0 };
  const model = options.model ?? PHRASING_MODEL;

  if (draft.steps.length === 0) {
    return {
      guide: { ...draft, steps: [] },
      usage: emptyUsage,
      wallMs: 0,
      transportRetries: 0,
      structuralRetries: 0,
      apiCalls: 0,
      model,
    };
  }

  const stepsForPrompt = draft.steps.map(toPromptStep);
  const startedAt = Date.now();

  let transportRetries = 0;
  let structuralRetries = 0;
  let apiCalls = 0;
  let correction = '';
  let lastProblem = '';
  let usage = emptyUsage;
  let phrased: PhrasingResponse | null = null;

  for (let attempt = 1; attempt <= PHRASING_MAX_ATTEMPTS; attempt += 1) {
    const { value: response, retries } = await callWithRetry(
      () =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [{ text: `${correction}Steps:\n${JSON.stringify(stepsForPrompt, null, 2)}` }],
            },
          ],
          config: {
            systemInstruction: SYSTEM_PROMPT,
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: PHRASING_RESPONSE_SCHEMA,
          },
        }),
      options.onRetry,
    );

    transportRetries += retries;
    apiCalls += retries + 1;

    const metadata = response.usageMetadata;
    usage = {
      inputTokens: usage.inputTokens + (metadata?.promptTokenCount ?? 0),
      outputTokens: usage.outputTokens + (metadata?.candidatesTokenCount ?? 0),
      cachedTokens: usage.cachedTokens + (metadata?.cachedContentTokenCount ?? 0),
      totalTokens: usage.totalTokens + (metadata?.totalTokenCount ?? 0),
    };

    const candidate = parseResponse(response.text);
    const problem = findStepMismatch(draft.steps, candidate);
    if (problem === null) {
      phrased = candidate;
      break;
    }

    lastProblem = problem;
    if (attempt < PHRASING_MAX_ATTEMPTS) {
      structuralRetries += 1;
      options.onStructuralRetry?.(attempt, problem);
      // The retry says what was wrong. At temperature 0 a verbatim re-send is the
      // same request and returns the same answer; naming the mismatch is the only
      // thing that makes a second attempt worth its cost. It weakens no guarantee:
      // the check below is what enforces the contract, not the wording above.
      correction =
        `A previous attempt was rejected: ${problem}. ` +
        `Return exactly one object per step below, with these event_id values, in this order.\n\n`;
    }
  }

  if (phrased === null) {
    throw new PhrasingError(
      'step_mismatch',
      `The phrasing pass did not word the steps it was given (${lastProblem}). ` +
        `Nothing was written to the guide.`,
    );
  }

  // Positional, not keyed by id: `findStepMismatch` has already proved the two
  // lists line up, so index i of one is index i of the other.
  const written = phrased.steps;
  const steps: PhrasedStep[] = draft.steps.map((step, index) => {
    const sentence = written[index];
    if (sentence === undefined) {
      throw new PhrasingError('step_mismatch', `No sentence was returned for step ${step.event_id}.`);
    }
    return { ...step, instruction: sentence.instruction };
  });

  return {
    guide: { ...draft, steps },
    usage,
    wallMs: Date.now() - startedAt,
    transportRetries,
    structuralRetries,
    apiCalls,
    model,
  };
}
