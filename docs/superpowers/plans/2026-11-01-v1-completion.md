# Study Coach v1 完成计划

**Goal:** 把“个人管家”从可跑通原型补成完整 v1：agent 能调用工具、计划生成落到 workspace、练习/题库、记忆/画像、搜索/文件监听、桌面打包/e2e/CI，并清理旧考研数据模型。

**Base:** `feat/v1-completion` @ `5459ec0`（首页已简化，今日安排已独立为左侧导航）。

**Spec:** `docs/superpowers/specs/2026-10-31-personal-butler-workspace.md`

## Global Constraints

- 本地优先；vault 是唯一事实源；API key / CLI 凭据不写日志、测试快照或明文配置。
- TypeScript strict；每模块 `npm run typecheck && npm test`；提交一次。
- 测试不联网；模型/CLI 全部用 fake 或注入 runner。
- 每个 worker 只改自己模块的目录；不跨模块改 UI/IPC/context（由 Wave 2 统一接线）。

## Wave 1 — 四个独立后端模块（并行）

### Module 1 — agent-tools（agent: claude）

**Owns:** `src/main/agent/cli-agent-client.ts`、`src/main/butler/**`、`tests/main/cli-agent-client.test.ts`、`tests/main/butler-*.test.ts`

**Change:**
- 为 CLI agent 增加结构化工具协议：prompt 里给出可用工具 JSON schema；CLI 输出一个 fenced JSON 块 `{"text":"...","toolCalls":[{"name":"write_note","arguments":{...}}]}`。
- `CliAgentClient` 解析最后一段 JSON（兼容 codex 的 banner/token 输出），把 toolCalls 映射到 `ModelResponse.toolCalls`；解析失败时退化为纯文本。
- 复用现有 `ButlerServiceImpl` 的工具循环执行 `get_today_plan` / `write_note` / `update_task` / `get_memory`；工具失败降级为文本。
- 测试：codex 转写解析、工具调用、执行、未知工具、解析失败、无工具文本。

**Acceptance:** targeted tests + `npm run typecheck`；不修改 IPC/UI。

### Module 2 — workspace-planner（agent: codex）

**Owns:** `src/main/planning/**`、`src/shared/planning.ts`、`tests/main/planning-*.test.ts`

**Change:**
- `WorkspacePlanner`：输入 workspace goal/最近记录/可用时间，调用 `ModelClient` 生成 1–5 个今日任务；输出 `WorkspacePlan { workspaceId, date, tasks, generatedBy }`。
- 严格 JSON 解析与校验；模型输出散文/空任务时用 workspace goal 生成模板计划（`generatedBy: 'template'`）。
- `createWorkspacePlanner({ modelClient, workspaceService })`；不直接写 UI/context。
- 测试：FakeModelClient 正常 JSON、围栏 JSON、截断/散文回退、任务校验。

**Acceptance:** targeted tests + typecheck.

### Module 3 — practice-service（agent: opencode）

**Owns:** `src/main/practice/**`、`src/shared/practice.ts`、`tests/main/practice-*.test.ts`

**Change:**
- `PracticeService` 基于 vault：题目集/题目/作答记录/错题；`listSets(workspaceId)`、`getSet(id)`、`submitAnswer({questionId, choice})`、`getMistakes(workspaceId)`、`getDue(workspaceId, date)`。
- 间隔重复：答错进入错题，按 1/3/7 天 due；答对降低优先级；持久化在 `workspaces/<id>/practice/`。
- 种子：从现有 demo practice 数据生成一组考研/英语题目；不联网。
- 测试：创建/读取、判分、错题、due、持久化、路径安全。

### Module 4 — memory-profile（agent: zcode）

**Owns:** `src/main/memory/**`、`src/shared/memory.ts`、`tests/main/memory-*.test.ts`

**Change:**
- `MemoryService` 基于 vault：`list(workspaceId?)`、`synthesizeFromReview({workspaceId, date, answers})`、`getProfile(workspaceId?)`。
- 复盘答案 → 通过注入的 ModelClient/Butler 生成 1–3 条可回溯 memory（`source` 指向日期）；无模型时用规则摘要；写入 `workspaces/<id>/memory.md`。
- 画像：从 memory 汇总当前薄弱点/偏好，供管家 prompt 使用。
- 测试：合成、持久化、无模型回退、按 workspace 过滤、来源可追溯。

## Wave 2 — 接线与工程化（Wave 1 合并后）

5. **search-watcher**（zcode）：MiniSearch 全库索引 + chokidar 监听 vault；`src/main/search/**`；测试。
6. **ui-wiring**（opencode）：扩展 `StudyCoachApi`/context/IPC/preload，把 planner/practice/memory/search 接到 `useWorkspaceData`、今日安排、学习、复盘、记录；更新浏览器 mock 与测试。这是唯一改共享 UI/IPC 的模块。
7. **packaging-e2e**（codex）：electron-builder、Playwright e2e（onboarding→今日安排→管家）、GitHub Actions CI、LICENSE、README；真实 provider/CLI 冒烟说明。
8. **legacy-cleanup**（claude）：收敛旧 `ExamProfile`/`DailyPlan`/`TodayPage`/`ReviewDialog` 到通用 workspace 模型；删除或迁移旧页面/测试；确保全量 green。

## Dispatch

- 每个 Wave 1 模块一个 Orca Task；worktree `new-top-level`，base `feat/v1-completion`。
- 四个模块可并行；不允许跨目录。Wave 2 在 Wave 1 合并后启动。
- 每个 worker 在 worktree 内提交，报告 commit、测试、风险。
- Wave 2 顺序：5 (search-watcher) ∥ 7 (packaging-e2e) → 6 (ui-wiring) → 8 (legacy-cleanup)；6/8 都改 UI，7 的 e2e 需要稳定 UI，串行合并避免冲突。

## Dispatch log (2026-11-01)

- Run: `run_ff9c07a5e79e`
- Module 1 `task_ba629b385f83` / claude / `ctx_827b8e26eb3f` / `v1-agent-tools` — **done** (commits `c12475f`, `71a203d`, `1f55a95`; merged `d8571b8`; 204 tests/typecheck/build pass)
- Module 2 `task_bc6c2f97384e` / codex / `ctx_43830f71ec5f` / `v1-workspace-planner` — **done** (commits `f0a3636`, `cc83e6f`, `ad91bc1`; merged `5e5187f`; 264 tests/typecheck/build pass; worker ended without worker_done, released per nextAction)
- Module 3 `task_546103c80b9b` / opencode / `ctx_ab4d64bb4edd` / `v1-practice-service` — **done** (commits `99e9dcf`, `3513aa1`, `f374bd0`; merged `a3a2e43`; 222 tests/typecheck/build pass)
- Module 4 `task_3ac645878ae1` / zcode / `ctx_ec3ad6bf1a9b` / `v1-memory-profile` — **done** (commits `9330eb2`, `431e08f`; merged `b493458`; 244 tests/typecheck/build pass)

### Wave 2 (2026-11-01)

- Run: `run_ff9c07a5e79e` resumed; base `8836fae`（264 tests/typecheck green）
- Module 5 `task_1bde9d51b07f` / zcode / `ctx_2311d116033c` / `v1-search-watcher` — **done** (commits `35e9225`–`c18a54c`; merged; 297 unit tests/typecheck/build pass; `src/main/search/**` + `src/shared/search.ts`; IPC wiring 与 app-quit dispose 留给 ui-wiring)
- Module 7 `task_800fc28572f5` / codex / `ctx_f7f1f4670e03` / `v1-packaging-e2e` — **done** (commits `adf4812`–`a01d225`; merged `cbedfce`; 264 unit tests + 1 e2e/typecheck/build/electron-builder pass; one additive `STUDY_COACH_USER_DATA_DIR` hook in `src/main/index.ts`)
- Module 6 `ui-wiring`（opencode）queued — after module 5 merges
- Module 8 `legacy-cleanup`（claude）queued — after module 6 merges
