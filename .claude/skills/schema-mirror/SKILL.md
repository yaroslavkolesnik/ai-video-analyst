---
name: schema-mirror
description: Use before changing anything the model emits or the pipeline parses - the timeline contract, the observation prompt, or a schema in src/schemas. Triggers on adding or renaming a field, changing an event kind, editing SYSTEM_PROMPT, or a schema_mismatch error from Observation.
---

# Changing the observation contract

`src/schemas/timeline.ts` holds **two hand-maintained mirrors of one shape**:

- the **zod** schema — the only thing allowed to turn a model response into a
  typed value;
- `OBSERVATION_RESPONSE_SCHEMA` — the Gemini `responseSchema`, an OpenAPI subset
  sent with the request. Written by hand because generators emit constructs that
  subset rejects.

They drift silently. A field added to one and not the other either never arrives
or fails to parse, and the error surfaces one stage later as a `schema_mismatch`.

## Change all of these together

1. **zod schema** in `src/schemas/timeline.ts`.
2. **`OBSERVATION_RESPONSE_SCHEMA`** — the same field, plus its entry in the
   matching `required` and `propertyOrdering` arrays. A nullable object needs
   `nullable: true` and must still be listed in `required`, so the model emits it
   as `null` rather than omitting it.
3. **`SYSTEM_PROMPT`** in `src/modules/observation.ts` — if the model has to
   decide something new, the rule for deciding it belongs in the prompt. Field
   descriptions in the schema carry the short version.
4. **`docs/ARCHITECTURE.md`** — the contract is quoted there. When the change
   came from something a real run revealed, record it as a dated amendment with
   the reason, rather than editing the original silently.
5. **Consumers**: `reduce.ts` and `tests/reduce.test.ts`, plus the saved fixtures
   in `fixtures/timelines/` — an older timeline may no longer parse.

## Two settled decisions, so they are not re-litigated

- **`schema_version` is never requested from the model.** It is our envelope: the
  model returns `ObservationPayload`, and code adds the version. Asking a model
  to reproduce a constant only creates a way for the response to be wrong.
- **`src/schemas/draft.ts` has no zod schema on purpose.** A `DraftGuide` is
  built by our own pure code from an already-validated timeline, so a parser
  would validate our output against our own types and prove nothing.

## Verify

```bash
npx tsc --noEmit
npm test
npm run reduce -- fixtures/timelines/A.json   # offline: does the saved fixture still parse?
```

Only then spend an API request on a live run.
