# Module 6 — ui-wiring (v1) report

**Base:** `feat/v1-completion` @ `ab9e122`
**Worktree:** `v1-ui-wiring`
**Scope:** shared IPC contracts, main composition root/IPC/preload bridge, renderer shell + pages, browser mock API, tests.

## What changed

### 1. Typed IPC surface (`src/shared/ipc.ts`)

`StudyCoachApi` now exposes the services that Wave 1/2 built, using their own
shared record types:

- **Planner:** `planWorkspace(input)` → `WorkspacePlan` (`src/shared/planning.ts`).
- **Practice:** `listPracticeSets`, `getPracticeSet`, `createPracticeSet`,
  `submitPracticeAnswer`, `getPracticeMistakes`, `getPracticeDue`,
  `listPracticeAttempts` (`src/shared/practice.ts`).
- **Memory:** `listMemory`, `synthesizeMemory`, `getMemoryProfile`
  (`src/shared/memory.ts`).
- **Search:** `searchWorkspace`, `rebuildSearchIndex`
  (`src/shared/search.ts`); `dispose()` stays main-only.
- **Reviews:** `listReviews(input?)` reads persisted review entries
  (`ReviewRecord` = review answers + `date`/`submittedAt`/`workspaceId`).

### 2. Composition root (`src/main/context.ts`, `src/main/index.ts`)

- Builds practice/memory/planner per vault (alongside workspace/butler) and
  rebuilds them when vault/provider/key changes.
- `createSearchService` is registered lazily: the first search/IPC call starts
  the chokidar watcher, so headless/test contexts never leave watchers behind.
  Rebuilds dispose the previous instance; `AppContext.dispose()` stops it and
  `src/main/index.ts` calls it on `before-quit` (the module-5 follow-up).
- `submitReview` persists the review and, for workspace-scoped, non-skipped
  reviews, synthesizes memory best-effort (review record wins if synthesis
  fails).
- `listReviews` reads vault-wide `reviews/` plus `workspaces/<id>/reviews/`,
  newest first, with a clamped limit and path-safe workspace ids.
- Planner/memory receive the same resolved model client as the butler (injected
  fake in tests; missing key → template/rules fallback). No keys are logged or
  persisted.

### 3. IPC + preload (`src/main/ipc.ts`)

14 new channels with argument validators (workspace ids, dates, choices,
question arrays, search queries/limits) and bridge mappings. `src/preload` is
unchanged because it reuses `createStudyCoachBridge`.

### 4. Renderer wiring

- `useWorkspaceData` now loads real practice sets/mistakes/due/attempts, memory
  records, learner profile and persisted reviews, and exposes
  `generatePlan`, `submitPracticeAnswer`, `createPracticeSet`,
  `searchWorkspace`, and workspace-scoped `submitReview`.
- **今日安排:** `PlanPane` adds “生成今日任务”, which calls the planner and
  creates the returned tasks in the current workspace (existing titles are
  skipped so repeated clicks do not duplicate).
- **学习:** `LearningPane` submits each answer over IPC; correctness,
  explanation and the updated mistake book/due date come from the service.
  Mistakes and today’s due list are shown.
- **复盘:** `ReviewPane` shows the learner profile summary, real memory entries,
  today’s due mistakes, and the persisted review entry for the selected date;
  saves are attributed to the selected workspace.
- **记录:** `NotePane` shows a “最近活动” summary of tasks/practice/review
  records and a vault-wide search box. Note hits open in the reader; task,
  practice, memory and review hits stay informational.
- Streak is derived from persisted review dates instead of demo data.

### 5. Browser mock (`web/mock-api.ts`)

The mock now mirrors the extended contract with persistent (localStorage) state:
seeded practice sets, answer scoring plus 1/3/7-day mistakes, memory synthesis
and profile, review records, template planning, and simple in-memory full-text
search. All existing prototype behaviors (onboarding, notes, butler replies,
settings, API-key non-persistence) are preserved.

## Commits

- `2dd1e0c` feat(ipc): expose planner, practice, memory and search contracts
- `83d0a40` feat(renderer): consume planner, practice, memory, search and reviews
- `a5163e3` feat(renderer): add vault search to records and dedupe generated tasks

## Verification

- `npm run typecheck` — pass (node + web).
- `npm test` — **310 tests pass** (41 files; base was 297).
- `npm run build` — pass (main/preload/renderer bundles).
- `npm run test:e2e` — **1 passed** (`e2e/desktop.spec.ts`, real Electron +
  fake codex). No e2e selector changes were required; legacy pages were kept.

New/updated tests:

- `tests/main/ipc-services.test.ts` (new): channel routing/validation, review →
  memory synthesis, best-effort synthesis failure, lazy search + dispose,
  vault review reading.
- `tests/main/ipc-preload.test.ts`: locked channel table and bridge argument
  forwarding for the new surface.
- `tests/renderer/workspace.test.tsx`: planner-generated tasks, real practice
  scoring/mistake book, activity summary and vault search.
- `tests/web/mock-api.test.ts`: practice/mistake/due/attempts, memory
  synthesis/profile, review listing, planning and search in mock mode.

## Risks / follow-ups

- **Planner model path:** production planner/memory reuse the butler’s resolved
  model client. Without credentials they degrade to the deterministic template /
  rule summaries. With a `local-cli` provider, pressing “生成今日任务” or saving
  a review may spawn the configured CLI (same trust boundary as chat).
- **Memory scope:** only workspace-scoped, non-skipped reviews synthesize
  memory (vault-wide reviews are recorded but not attributed to a workspace).
- **Profile scope:** the header profile is aggregated across all workspaces even
  when a workspace filter is active; memory entries themselves are filtered.
- **Plan dedupe:** dedupe is by trimmed task title within the workspace; a
  re-worded model plan can still add new tasks.
- **Search scope:** the IPC search operation is per workspace; the 记录 page
  aggregates results across all workspaces when “全部工作区” is selected.
- **Legacy surfaces:** old `ExamProfile`/`DailyPlan`/`TodayPage`/`ReviewDialog`
  remain in place for module 8; `generateTodayPlan` still uses the legacy
  scheduler planner. The new workspace Today view is the one wired to the
  workspace planner.
- **Test-only stabilization:** `tests/main/workspace-security.test.ts` already
  whitelisted concurrent `workspace-*`/`study-coach-*` mkdtemp entries; it now
  also ignores the other suites’ documented `memory-*`, `practice-*`,
  `search-*`, `settings-*` prefixes to remove a pre-existing parallel flake.
- No files under `src/main/{planning,practice,memory,search,workspace,agent,butler}/**`
  were modified; no dependencies were added.
