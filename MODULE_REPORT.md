# Module 4 — memory-profile Report

**Worker:** zcode · **Base:** `feat/v1-completion` @ `1071b13` · **Branch:** `xiaolai/v1-memory-profile`

## What was built

A vault-backed `MemoryService` (plan section "Module 4" of
`docs/superpowers/plans/2026-11-01-v1-completion.md`):

| File | Purpose |
| --- | --- |
| `src/shared/memory.ts` | `MemoryService` contract, `MemoryRecord` (kind-tagged `MemoryItem`), `LearnerProfile`, `SynthesizeMemoryInput` / `MemorySynthesisResult` |
| `src/main/memory/create-memory-service.ts` | `createMemoryService({ root, modelClient?, now?, temperature?, maxTokens? })` — `list(workspaceId?)`, `synthesizeFromReview({workspaceId, date, answers})`, `getProfile(workspaceId?)` |
| `src/main/memory/synthesize.ts` | Model-backed synthesis (strict JSON, fenced-JSON tolerant, 1–3 items) + deterministic rule fallback |
| `src/main/memory/records.ts` | `memory.md` codec, superset of the workspace-service one (adds optional `kind`, backwards compatible) |
| `src/main/memory/profile.ts` | Deterministic `LearnerProfile` aggregation for butler prompts |

Behavior highlights:

- **Synthesis:** review answers → 1–3 memory items via injected `ModelClient`
  (the `Butler`-style dependency from the plan is satisfied by `ModelClient`
  injection, matching Module 2's pattern). Items carry `source: "review:<date>"`
  for traceability. Model failures, prose output, or >3 items degrade
  gracefully: rules map `stuck`→weakness, `completed`→strength,
  `tomorrow`→plan (≤3, stuck first). No model configured → pure rules.
- **Persistence:** appends to `workspaces/<id>/memory.md`; YAML frontmatter
  `items` stays the machine source of truth, body stays an Obsidian-readable
  rendering. Existing (seeded) entries are never dropped; exact `source`+`text`
  duplicates are skipped, so re-synthesizing a review is idempotent. Writes go
  through the shared atomic write + in-process mutex helpers.
- **Profile:** `getProfile()` aggregates by kind into weaknesses / strengths /
  preferences / plans buckets (deduped, newest-first, capped at 5) plus a
  one-paragraph Chinese `summary` — deterministic, no model call, safe to
  rebuild per butler prompt.
- **Compatibility:** entries written by the existing `WorkspaceService`
  (no `kind`) read back as `fact`; items written by this service remain
  readable through `WorkspaceService.getMemory` (verified in tests).
- **Safety:** reuses `assertSafeSegment` / `assertIsoDate`; unknown workspaces
  are rejected before any write.

## Commits

- `9330eb2` feat(memory): add vault-backed MemoryService with review synthesis
- (this report)

## Tests

- Targeted: `npx vitest run tests/main/memory-service.test.ts tests/main/memory-profile.test.ts` — **22 passed**
  (synthesis incl. fenced JSON / cap / invalid-output and model-error fallbacks, no-model fallback,
  persistence across instances, append-only, dedupe, workspace filtering, source traceability,
  path & input safety, profile buckets/summary/limits/legacy entries).
- `npm run typecheck` (node + web configs) — **clean**.
- Full `npm test` — **33 files / 203 tests passed**.
- No network in tests; the model is always the repo's `FakeModelClient`.

## Constraints kept

Only the target paths were touched (`src/main/memory/**`, `src/shared/memory.ts`,
`tests/main/memory-*.test.ts`, this report). No edits to `src/shared/ipc.ts`,
`src/main/context.ts`, `src/main/ipc.ts`, `src/renderer/**`, or other modules'
directories. Nothing merged or pushed.

## Risks / notes for Wave 2 (ui-wiring)

- `MemoryService` is **not yet wired** into IPC/context/UI — by design; Wave 2
  module 6 owns that. Suggested surface: `memory:list` / `memory:synthesize` /
  `memory:profile` plus feeding `LearnerProfile.summary` into the butler prompt.
- `list()` sorts newest-first (tie-break by id); `WorkspaceService.getMemory`
  keeps file order — same records, different order.
- Duplicate-guard is exact `source`+`text` match; a user resubmitting an edited
  review on the same day appends a new item (intended: history is append-only).
- Model prompt asks for ≤60-char third-person items and hard-truncates texts at
  200 chars to keep butler prompts small.
