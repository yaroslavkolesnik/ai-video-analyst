# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read first

`HANDOFF.md` — state, agreed next task, verified facts. Then `docs/ARCHITECTURE.md`
before writing any module. Do not re-derive from memory what they record as verified.

## Two rules that carry the project

**Work strictly phase by phase.** Implement only the agreed phase, then stop and report.
Do not write the next phase's code, however obvious. Surface disputed technical decisions
with the reason rather than taking them silently.

**A numbered step can only be born from an event with `kind === "ui_action" && visible === true`.**
Narration has no path into the step list — not because a prompt asks, but because no such
edge exists in `reduce.ts`. This is what makes "we do not invent clicks" testable.

## Commands

```bash
npm run demo-app                              # recorded fixture app, http://localhost:4173/
npm run observe -- fixtures/videos/A.mp4      # Gemini; spends quota — load run-observation first
npm run reduce  -- fixtures/timelines/A.json  # pure TS, offline, no API key
npm run guide   -- fixtures/videos/A.mp4      # whole chain -> fixtures/guides/A.md; caches keep reruns free
npm run dev                                   # server on :3000 (PORT= to move it); upload + SSE progress
npm test                                      # vitest
npx vitest run -t "never turns narration into a step"   # one test by name
npx tsc --noEmit
```

## Conventions

- `nodenext` ESM: **relative imports carry a `.js` extension** even from `.ts` sources.
- Modules take the `GoogleGenAI` client as an argument; only `createGeminiClient` reads the key.
- Conversation in Ukrainian; code, comments, UI, guide and delivery notes in English.

## Enforced by hooks, not by you

Writing to `fixtures/ground-truth/RECORDING-SCRIPT.md` is denied; `git commit` and `git push`
are denied (the user commits by hand); changing the Gemini model id in `observation.ts` asks
first. Reading any of these is fine.

Skills carry the rest: `run-observation`, `schema-mirror`, `ground-truth-check`, `phase-report`.
