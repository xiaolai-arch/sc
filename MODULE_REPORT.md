# Module 8 — legacy-cleanup (v1) report

**Base:** `feat/v1-completion` @ `6025859` (module 6 merge `ea7b2da` plus the
butler reasoning-stream commits `227ce1b`/`6025859`)
**Worktree:** `v1-legacy-cleanup`
**Scope:** legacy `ExamProfile`/`DailyPlan` convergence onto the generic
workspace model; removal of the orphaned today/review/exam-onboarding UI; tray
and scheduler migration; browser mock and e2e fixture alignment.

## What changed

### 1. Orphaned legacy UI removed / migrated

- `TaskCard`, `Timer` and `timer-logic` moved from `src/renderer/today/` to
  `src/renderer/shell/` because `PlanPane` (live) still uses them. `TaskCard` is
  now typed on `WorkspaceTask`/`UpdateWorkspaceTaskInput`, so `PlanPane` passes
  workspace tasks directly and the `toStudyTask` conversion is gone.
- Deleted `src/renderer/today/TodayPage.tsx` and
  `src/renderer/review/ReviewDialog.tsx` (nothing mounted them since module 6).
- Deleted `src/renderer/onboarding/Onboarding.tsx`, the exam-profile onboarding
  form that only fed the removed `completeOnboarding` API.

### 2. Legacy type/API surface retired

- Removed `ExamProfile`, `SubjectConfig` and `DailyPlan` from
  `src/shared/types.ts`; deleted `src/shared/profile.ts` and
  `src/shared/demo.ts`.
- Removed `completeOnboarding`, `getTodayPlan`, `generateTodayPlan`,
  `updateTask` and `UpdateTaskInput` from `StudyCoachApi`, the IPC channel
  table/handlers, the preload bridge and the context implementation.
- Deleted `src/main/scheduler/planner.ts` (the butler-backed TodayPlanPlanner)
  and its re-exports.
- `AppState` is now `{ onboarded, settings }`. Learning content lives only in
  the vault. Old `state.json` files still hydrate because unknown keys are
  ignored and are rewritten without the legacy fields.

### 3. Live consumers migrated to workspace/planning services

- **Tray:** `TrayControllerOptions.getPlan(): DailyPlan | null` became
  `getTasks(): WorkspaceTask[]`; `summarizeTodayPlan` became
  `summarizeWorkspaceTasks`. `src/main/index.ts` aggregates tasks across all
  workspaces and the “生成今日计划” action calls the workspace planner.
- **Scheduler:** `createContextScheduler`'s morning hook now calls the shared
  `planFirstEmptyWorkspace(context)` helper: it plans into the first workspace
  with no tasks and persists the returned tasks via the workspace service. The
  tray action uses the same helper, so task generation has one code path.
- **Web mock:** `web/mock-api.ts` now implements only the post-cleanup
  `StudyCoachApi` (onboarding is workspace-based; tasks go through
  `createTask`/`updateWorkspaceTask`; reviews/practice/memory/search unchanged).
- **E2E:** `e2e/support/launch.ts` seeds a state file with only
  `onboarded`/`settings`; `e2e/fixtures/fake-codex.mjs` comments now describe
  the workspace planner. No selectors or user flows changed.

### 4. Tests

Deleted with the code they covered:

- `tests/renderer/today.test.tsx` (7), `tests/renderer/review.test.tsx` (7),
  `tests/renderer/onboarding.test.tsx` (2)
- `tests/main/scheduler-planner.test.ts` (5), `tests/shared/profile.test.ts` (2)

Migrated/kept behavior tests:

- `tests/renderer/timer.test.ts` now imports the shell `timer-logic`; task
  completion and review saving remain covered by `tests/renderer/workspace.test.tsx`.
- `tests/main/integration-tray.test.ts` asserts summary/tooltip/menu/DND/failure
  behavior over `WorkspaceTask[]`.
- `tests/main/integration-context.test.ts` covers model-backed workspace
  planning and morning planning into an empty workspace (plus no duplicate
  model call on the next tick).
- `tests/main/ipc-context.test.ts` covers bootstrap/API-key handling and task
  persistence in a real vault across a context restart.
- `tests/main/ipc-preload.test.ts` locks the 30-channel post-cleanup surface.
- `tests/web/mock-api.test.ts` covers workspace onboarding and workspace task
  updates.

## Removed public API/type surface (explicit)

| Kind | Name | Where |
| --- | --- | --- |
| type | `ExamProfile` | `src/shared/types.ts` |
| type | `SubjectConfig` | `src/shared/types.ts` |
| type | `DailyPlan` | `src/shared/types.ts` |
| type | `UpdateTaskInput` | `src/shared/ipc.ts` |
| API method | `StudyCoachApi.completeOnboarding(profile)` | `src/shared/ipc.ts` |
| API method | `StudyCoachApi.getTodayPlan()` | `src/shared/ipc.ts` |
| API method | `StudyCoachApi.generateTodayPlan()` | `src/shared/ipc.ts` |
| API method | `StudyCoachApi.updateTask(input)` | `src/shared/ipc.ts` |
| function | `validateExamProfile` | `src/shared/profile.ts` (file deleted) |
| constant | `DEMO_PROFILE` | `src/shared/demo.ts` (file deleted) |
| interface | `TodayPlanPlanner` | `src/main/scheduler/planner.ts` (file deleted) |
| interface | `TodayPlanPlannerOptions` | `src/main/scheduler/planner.ts` (file deleted) |
| function | `buildTodayPlanPrompt` | `src/main/scheduler/planner.ts` (file deleted) |
| function | `parseTodayPlanReply` | `src/main/scheduler/planner.ts` (file deleted) |
| function | `createTodayPlanPlanner` | `src/main/scheduler/planner.ts` (file deleted) |
| IPC channel | `study-coach:bootstrap:complete-onboarding` | `src/main/ipc.ts` |
| IPC channel | `study-coach:today-plan:get` | `src/main/ipc.ts` |
| IPC channel | `study-coach:today-plan:generate` | `src/main/ipc.ts` |
| IPC channel | `study-coach:today-plan:update-task` | `src/main/ipc.ts` |
| state field | `AppState.profile` | `src/main/state-store.ts` |
| state field | `AppState.plan` | `src/main/state-store.ts` |
| state field | `AppState.reviews` | `src/main/state-store.ts` |
| function | `summarizeTodayPlan` → `summarizeWorkspaceTasks` | `src/main/tray.ts` |
| option | `TrayControllerOptions.getPlan` → `getTasks` | `src/main/tray.ts` |
| component | `TodayPage` | `src/renderer/today/TodayPage.tsx` (deleted) |
| component | `ReviewDialog` | `src/renderer/review/ReviewDialog.tsx` (deleted) |
| component | `Onboarding` (exam profile) | `src/renderer/onboarding/Onboarding.tsx` (deleted) |
| export | `DEMO_PLAN`, `DEMO_PROFILE` re-export | `web/mock-api.ts` |

`TaskCard`, `Timer` and `timer-logic` still exist but moved from
`src/renderer/today/` to `src/renderer/shell/`; `TaskCard` now takes
`WorkspaceTask` + `UpdateWorkspaceTaskInput` instead of `StudyTask` +
`UpdateTaskInput`.

Added: `summarizeWorkspaceTasks` (`src/main/tray.ts`) and
`planFirstEmptyWorkspace` (`src/main/scheduler/app-scheduler.ts`, re-exported
from `src/main/scheduler/index.ts`).

## Commits

- `47614fc` refactor(renderer): converge task card and timer into the workspace shell
- `37d5335` refactor(main): drive the tray from workspace tasks and the planner
- `385e8ee` refactor(main): plan the morning through the workspace planner
- `5fe1070` refactor: remove the legacy exam-profile and daily-plan surface
- (this report)

## Verification (final tree)

- `npm run typecheck` — pass (node + web).
- `npm test` — **310 tests pass** (40 files; base was 333, minus the 23 retired
  legacy tests).
- `npm run build` — pass (main/preload/renderer bundles).
- `npm run test:e2e` — **1 passed** (`e2e/desktop.spec.ts`, real Electron with
  the fake CLI; onboarding → today task → butler reasoning).

## Risks / follow-ups

- **Tray scope:** the tray summarizes every task returned by all workspace
  snapshots, matching the in-app 今日安排 view. `WorkspaceTask.due` is not used
  to filter by date; a workspace with old open tasks keeps contributing to the
  count until tasks are completed/skipped.
- **Morning automation:** `planFirstEmptyWorkspace` only plans a workspace that
  has zero tasks. It does not regenerate stale or partially-used task lists;
  users regenerate explicitly from 今日安排.
- **Old state files:** `profile`/`plan`/`reviews` keys in an existing
  `state.json` are ignored and dropped on the next write. `onboarded` must be an
  explicit boolean (workspace onboarding has written it since module 6); a very
  old state file that implied onboarding from `profile` alone will show
  onboarding once.
- **Removed UI:** any external automation that invoked the deleted IPC channels
  will get “no handler”; the renderer/preload/web mock were updated together.
- No new dependencies; no network in tests. `src/shared/butler-stream.ts`,
  `src/renderer/shell/{ReasoningBlock,ChatPane,types}.tsx|ts`,
  `src/main/agent/**` and `src/main/butler/**` are untouched from the base
  commit.
