/**
 * The Observation contract: what the model is allowed to say about a recording.
 *
 * Two mirrors of the same shape live here on purpose:
 *   - `zod` schemas   - the only thing allowed to turn a model response into a
 *                       typed value. Nothing downstream parses raw JSON.
 *   - `Schema` object - the Gemini `responseSchema` (an OpenAPI subset) sent
 *                       with the request. Written by hand rather than generated
 *                       from zod, because generators emit constructs that
 *                       subset rejects. `tests/schemas.test.ts` is what keeps
 *                       the two from drifting apart.
 */
import { Type, type Schema } from '@google/genai';
import { z } from 'zod';

export const SCHEMA_VERSION = 'timeline/1';

/**
 * `ui_action` is the only kind that can ever become a numbered step. The other
 * four exist so the model has somewhere truthful to put an observation it would
 * otherwise be tempted to dress up as an action.
 */
export const EVENT_KINDS = ['ui_action', 'ui_state', 'narration', 'gap', 'success_state'] as const;

export const EventTargetSchema = z.object({
  element_label: z.string().nullable(),
  element_kind: z.string().nullable(),
  value: z.string().nullable(),
});

export const ConflictSchema = z.object({
  spoken_claim: z.string(),
  screen_shows: z.string(),
});

export const ObservedEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(EVENT_KINDS),
  t_start: z.number(),
  t_end: z.number(),
  screenshot_t: z.number(),
  visible: z.boolean(),
  spoken: z.boolean(),
  observation: z.string().min(1),
  target: EventTargetSchema.nullable(),
  superseded_by: z.string().nullable(),
  conflict: ConflictSchema.nullable(),
  confidence: z.number().min(0).max(1),
});

export const AppContextSchema = z.object({
  app_label: z.string(),
  operation_label: z.string(),
  operation_confidence: z.number().min(0).max(1),
  is_single_operation: z.boolean(),
  is_screen_recording: z.boolean(),
});

/**
 * Exactly what the model returns. `schema_version` is deliberately absent: it
 * is our envelope, not an observation, and asking a model to reproduce a
 * constant only creates one more way for a response to be wrong.
 */
export const ObservationPayloadSchema = z.object({
  app_context: AppContextSchema,
  events: z.array(ObservedEventSchema),
  global_notes: z.array(z.string()),
});

export const RawTimelineSchema = ObservationPayloadSchema.extend({
  schema_version: z.literal(SCHEMA_VERSION),
});

export type EventTarget = z.infer<typeof EventTargetSchema>;
export type EventConflict = z.infer<typeof ConflictSchema>;
export type ObservedEvent = z.infer<typeof ObservedEventSchema>;
export type AppContext = z.infer<typeof AppContextSchema>;
export type ObservationPayload = z.infer<typeof ObservationPayloadSchema>;
export type RawTimeline = z.infer<typeof RawTimelineSchema>;

const nullableString = (description: string): Schema => ({
  type: Type.STRING,
  nullable: true,
  description,
});

const eventTargetSchema: Schema = {
  type: Type.OBJECT,
  nullable: true,
  description: 'The on-screen control this event acts on, or null when the event has no single target.',
  properties: {
    element_label: nullableString("The control's visible label, copied from the screen exactly as written."),
    element_kind: nullableString('What kind of control it is: button, dropdown, checkbox, text input, link, table row.'),
    value: nullableString('The value chosen, typed or toggled, as it appears on screen.'),
  },
  required: ['element_label', 'element_kind', 'value'],
  propertyOrdering: ['element_label', 'element_kind', 'value'],
};

const conflictSchema: Schema = {
  type: Type.OBJECT,
  nullable: true,
  description:
    'Filled in only when narration and screen disagree. Never resolve the disagreement; record both sides.',
  properties: {
    spoken_claim: { type: Type.STRING, description: 'What the narrator said.' },
    screen_shows: { type: Type.STRING, description: 'What the screen actually shows.' },
  },
  required: ['spoken_claim', 'screen_shows'],
  propertyOrdering: ['spoken_claim', 'screen_shows'],
};

const EVENT_FIELD_ORDER = [
  'id',
  'kind',
  't_start',
  't_end',
  'screenshot_t',
  'visible',
  'spoken',
  'observation',
  'target',
  'superseded_by',
  'conflict',
  'confidence',
];

const observedEventSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    id: { type: Type.STRING, description: 'Stable identifier: "e1", "e2", ... in emission order.' },
    kind: { type: Type.STRING, format: 'enum', enum: [...EVENT_KINDS] },
    t_start: { type: Type.NUMBER, description: 'Seconds from the start of the recording when the event begins.' },
    t_end: { type: Type.NUMBER, description: 'Seconds from the start when its effect is fully visible on screen.' },
    screenshot_t: {
      type: Type.NUMBER,
      description:
        'Seconds from the start: the single most useful frame for a reader who has to find this control.',
    },
    visible: {
      type: Type.BOOLEAN,
      description: 'True only if the action or its result can literally be seen in the frames.',
    },
    spoken: { type: Type.BOOLEAN, description: 'True if the narrator described this event out loud.' },
    observation: { type: Type.STRING, description: 'What is observable, stated neutrally. Not an instruction.' },
    target: eventTargetSchema,
    superseded_by: nullableString(
      'The id of a later event that undoes, reverses or replaces this one; null otherwise.',
    ),
    conflict: conflictSchema,
    confidence: {
      type: Type.NUMBER,
      minimum: 0,
      maximum: 1,
      description: 'Confidence in the observation itself, not in its importance.',
    },
  },
  required: EVENT_FIELD_ORDER,
  propertyOrdering: EVENT_FIELD_ORDER,
};

const APP_CONTEXT_FIELD_ORDER = [
  'app_label',
  'operation_label',
  'operation_confidence',
  'is_single_operation',
  'is_screen_recording',
];

/** Hand-written mirror of `ObservationPayloadSchema`, sent as `responseSchema`. */
export const OBSERVATION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    app_context: {
      type: Type.OBJECT,
      properties: {
        app_label: {
          type: Type.STRING,
          description: 'The application described generically, e.g. "an orders management table".',
        },
        operation_label: {
          type: Type.STRING,
          description: 'The single operation being performed, e.g. "export filtered orders to CSV".',
        },
        operation_confidence: { type: Type.NUMBER, minimum: 0, maximum: 1 },
        is_single_operation: {
          type: Type.BOOLEAN,
          description: 'False if the recording contains more than one unrelated operation.',
        },
        is_screen_recording: {
          type: Type.BOOLEAN,
          description: 'False if this is not a recording of a screen at all.',
        },
      },
      required: APP_CONTEXT_FIELD_ORDER,
      propertyOrdering: APP_CONTEXT_FIELD_ORDER,
    },
    events: {
      type: Type.ARRAY,
      description: 'Every observed event, in chronological order.',
      items: observedEventSchema,
    },
    global_notes: {
      type: Type.ARRAY,
      description: 'Observations about the recording as a whole that belong to no single event.',
      items: { type: Type.STRING },
    },
  },
  required: ['app_context', 'events', 'global_notes'],
  propertyOrdering: ['app_context', 'events', 'global_notes'],
};
