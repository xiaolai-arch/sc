# Module 2 — workspace-planner report

## Status

Complete. Implemented the workspace planning service and its shared contract without touching UI, IPC, context, or other module directories.

## What changed

- `src/shared/planning.ts`
  - `WorkspacePlan { workspaceId, date, tasks, generatedBy }`
  - `WorkspacePlanTask { title, subject, durationMin, acceptance }`
  - `WorkspacePlanner.plan({ workspaceId, date?, availableMinutes? })`
- `src/main/planning/prompt.ts`
  - JSON-only Chinese planning prompt including workspace goal/description, recent notes, relevant memory, date, and available minutes.
- `src/main/planning/parse.ts`
  - Extracts fenced or bare JSON from model output (including CLI preamble/trailing prose).
  - Validates 1–5 tasks; requires non-empty title/subject/acceptance and positive duration.
  - Trims text, accepts numeric-string durations, rounds/clamps duration to 5–600 minutes, drops duplicates.
  - Returns `generatedBy: 'agent'` for usable model output; `null` triggers fallback.
- `src/main/planning/template.ts`
  - Deterministic fallback from the workspace goal (then description/name), split into at most 5 tasks.
  - Distributes available minutes across template tasks and returns `generatedBy: 'template'`.
- `src/main/planning/workspace-planner.ts`
  - `WorkspacePlannerImpl` and `createWorkspacePlanner({ modelClient, workspaceService, now? })`.
  - Loads the workspace snapshot, calls the injected `ModelClient`, and falls back to the template on prose, empty/truncated JSON, invalid task sets, missing model, or model errors.
  - Defaults date to the local current date and available time to 120 minutes.
- `src/main/planning/index.ts`
  - Public module exports.
- `tests/main/planning-workspace-planner.test.ts`
  - Covers valid JSON, fenced JSON, prose/empty/truncated fallback, model error, no-model fallback, prompt context, task validation/clamping/dedupe/limit, template behavior, generatedBy, default date/time, and invalid date input.

## Commits

- `f0a3636` — `feat(planning): add plan contracts, prompt, parser, and template`
- `cc83e6f` — `feat(planning): add workspace planner service and tests`

## Verification

- `npx vitest run tests/main/planning-*.test.ts` — 20/20 passed.
- `npm run typecheck` — passed (`tsconfig.node.json` + `tsconfig.web.json`).
- `npm test` — 32 files, 201/201 tests passed.
- Tests are offline and use `FakeModelClient`; no network calls.

## Risks / follow-ups

- The planner returns a plan but intentionally does not persist tasks. Wave 2 wiring must either create tasks through `WorkspaceService.createTask` when the user accepts a plan or add an explicit persist step.
- Model-provided task durations are validated individually but not rescaled to the available-minute budget. A model can return tasks totaling more than `availableMinutes`; the prompt asks it not to, and totals are not enforced.
- Template titles are goal fragments split on punctuation. This is deterministic and useful for fallback, but can read less action-oriented than model output. A per-workspace-kind template can improve this later.
- `generatedBy` uses `'agent' | 'template'`, matching the existing `DailyPlan` convention.
- No shared IPC/API surface was added; Wave 2 owns that integration.
