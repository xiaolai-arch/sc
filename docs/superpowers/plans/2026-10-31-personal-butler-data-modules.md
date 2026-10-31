# 个人管家工作台：真实数据层模块计划

**Goal:** 把当前 demo 工作台接到真实本地数据层：workspace / 任务 / 笔记 / 复盘 / 记忆 / 提醒，以及真实的管家模型调用。保留本地优先、Obsidian 兼容和 API key 不进日志的约束。

**Contract:** `src/shared/workspace.ts` + `src/shared/ipc.ts` 已由协调者提交。所有模块只实现契约，不擅自改契约；缺接口先向协调者提问。

**Base:** `feat/personal-butler-data`（master 的个人管家 UI 版本）。

## Global Constraints

- 本地优先：无账号、无服务器、无遥测；除用户配置的模型 API 外不发网络请求。
- Vault 是唯一事实源：markdown + YAML frontmatter；索引/缓存可删除重建。
- 永不自动删除用户笔记；删除只移到 `.trash/`。
- API key 只在 Electron `safeStorage`；不得写日志、测试快照或明文配置。
- TypeScript strict；每个模块结束运行 `npm run typecheck && npm test`；提交一次。
- 测试不联网；模型测试用 `FakeModelClient`。
- 每个 worker 只改自己模块的目录；共享契约只读。

## Module 1 — `workspace-vault`（agent: zcode）

**Owns:** `src/main/workspace/**`（替换占位 `create-workspace-service.ts`）、`tests/main/workspace-*.test.ts`

**Change:**
- 实现 `createWorkspaceService(root: string): WorkspaceService`，基于本地 vault。
- 建议布局：`workspaces/<id>/workspace.md`、`workspaces/<id>/tasks/YYYY-MM-DD.md`、`workspaces/<id>/notes/*.md`、`workspaces/<id>/memory.md`、`workspaces/<id>/reminders.md`（或等价 markdown/YAML 布局，必须 Obsidian 可读）。
- 实现 `listWorkspaces`、`createWorkspace`、`getWorkspaceSnapshot`、`createTask`、`updateWorkspaceTask`、`createNote`、`updateNote`、`getMemory`、`getReminders`、`submitReview`。
- 复用 `src/main/vault/note.ts` 的 `parseNote`/`serializeNote`；路径安全（禁止 `../` 逃逸）；并发写入用原子临时文件 + rename。
- 初始 vault 可包含与 `demoData` 等价的示例 workspaces（考研/英语/项目/生活），让 UI 有真实内容。

**Acceptance:**
- `npx vitest run tests/main/workspace-*.test.ts` 覆盖：创建 workspace、创建/更新任务、创建/更新笔记、复盘落盘、记忆/提醒读取、路径逃逸拒绝、重启后仍能读回。
- `npm run typecheck && npm test` 通过。
- 报告提交 hash 和 vault 布局。

## Module 2 — `desktop-services-ipc`（agent: codex）

**Owns:** `src/main/context.ts`、`src/main/ipc.ts`、`src/main/settings/**`、`src/main/state-store.ts`、`src/preload/index.ts`、`src/main/index.ts`、`tests/main/ipc-*.test.ts`、`tests/main/settings-*.test.ts`

**Change:**
- 实现 JSON state store 与 SettingsService（默认 vault 路径、provider、budget、notifications、launchAtLogin；API key 用 safeStorage，测试用内存 secret store）。
- `context.ts` 创建 `createWorkspaceService(vaultRoot)` 与 `createButlerService(vaultRoot)`（两个 factory 目前是占位；只调用，不实现）。
- `ipc.ts` 注册 `StudyCoachApi` 的新方法：workspaces/snapshot/tasks/notes/memory/reminders/sendMessage，以及保留旧 bootstrap/settings/today-plan 方法；preload 用 `ipcRenderer.invoke` 暴露同名方法。
- 统一错误序列化；不把 key 写进错误/log。
- 测试用 fake `WorkspaceService` / `ButlerService`；不依赖真实 Electron UI。

**Acceptance:**
- `npx vitest run tests/main/ipc-*.test.ts tests/main/settings-*.test.ts` 覆盖 handler 参数、错误、preload channel、secret 不回显。
- `npm run typecheck && npm test` 通过；报告提交 hash 和 channel 列表。

## Module 3 — `butler-agent`（agent: claude）

**Owns:** `src/main/agent/**`、`src/main/butler/**`（替换占位 `create-butler-service.ts`）、`tests/main/butler-*.test.ts`

**Change:**
- 实现 `ModelClient`（AI SDK 或注入的 `generate`）+ `FakeModelClient`；测试不联网。
- 实现 `ButlerService`：根据 `SendMessageInput` 取 workspace/task 上下文，调用模型，返回 `SendMessageResult`；无 API key 时返回模板回复。
- 实现最小工具集（可直接调用 `WorkspaceService`）：`get_today_plan`、`write_note`、`update_task`、`get_memory`；工具调用失败要降级为文本回复，不抛到 UI。
- 提示词明确角色：老师 / 规划 / 记录 / 督促，回答中文。

**Acceptance:**
- `npx vitest run tests/main/butler-*.test.ts` 覆盖 fake、无 key、工具调用、失败降级、usage。
- `npm run typecheck && npm test` 通过；报告提交 hash 和工具列表。

## Module 4 — `renderer-wiring`（agent: opencode）

**Owns:** `src/renderer/shell/**`、`web/mock-api.ts`、`tests/renderer/workspace*.test.tsx`、`tests/web/mock-api.test.ts`

**Change:**
- 新增数据 hook（如 `useWorkspaceData`），通过 `window.studyCoach` 调用 `listWorkspaces`/`getWorkspaceSnapshot`/`createTask`/`updateWorkspaceTask`/`createNote`/`updateNote`/`getMemory`/`getReminders`/`send`；替换 `Workspace.tsx` 对 `demoData` 的直接 import。
- 保留 demo 数据作为浏览器 mock 的种子：`web/mock-api.ts` 实现新 API（workspaces/snapshot/tasks/notes/memory/reminders/send），数据来自 `demoData` 或 `web/demo-data.ts`；Electron 下由 preload 提供真实 API。
- 加载/错误/重试状态；记忆/提醒显示；聊天发送走 API（mock 返回固定文案）。
- 现有 6 个 workspace 测试继续通过；新增至少：切换 workspace、创建任务、创建笔记、发送管家消息。

**Acceptance:**
- `npx vitest run tests/renderer/workspace*.test.tsx tests/web/mock-api.test.ts` 覆盖上述流程。
- `npm run typecheck && npm test && npm run build:web` 通过；报告提交 hash。

## Module 5 — `integration-scheduler`（wave 2，协调者或空闲 agent）

**Owns:** `src/main/scheduler/**`、`src/main/tray.ts`、`src/main/context.ts` 的最终接线、`tests/main/scheduler-*.test.ts`、最终 e2e

**Change:**
- 合并 1-4 后把真实 `WorkspaceService` / `ButlerService` 接进 context；解决冲突。
- 实现提醒/check-in 调度（早间计划、晚间复盘、免打扰、错过补一次），与复盘记忆联动。
- 全量 `npm test`/`typecheck`/`build`；Electron e2e 冒烟。
- 只在合并后的集成分支上改；不重写各模块内部。

**Acceptance:**
- 全量 51+ tests 通过；typecheck/build 通过；调度器测试覆盖 catch-up/DND；报告合并后的提交。

## Dispatch

- 每个模块一个 Orca Task；worktree `new-top-level`，base `feat/personal-butler-data`。
- 模块 1/2/3/4 可并行；模块 2/3 只通过契约 factory 连接，不跨目录改代码。
- 模块 5 在 1-4 完成并合并后启动。
- 每个 worker 在 worktree 内提交；报告 commit hash、测试输出、遗留风险。
- 远端仓库在 GitHub 登录后创建；每个模块合并后本地提交并推送。

## Dispatch log (2026-10-31)

- Run: `run_cd1ae7afebca`
- Coordinator handle: `term_f7fb4d18-03fe-46f7-9609-9ca43a903cb8`
- Module 1 `task_41b4d05c392b` / zcode / `ctx_9432316ba158` / worktree `module-1-workspace-vault` — **done** (commits `f6c046e`, `2f6ac96`, `9328064`; merged `f6e8b4c`; 147 tests/typecheck/build pass)
- Module 2 `task_ef6f6cb1b903` / codex / `ctx_e4b01e0095e5` / worktree `module-2-desktop-ipc` — **done** (commits `bbc1c3a`, `3b67b75`, `dc24397`; merged `a0b35db`; 70 tests/typecheck/build pass)
- Module 3 `task_64e84a0c2fe0` / claude / `ctx_d74c9357838d` / worktree `module-3-butler-agent` — **done** (commits `8c08409`, `7e2c582`, `ba3a3bc`; merged `7bc8a11`; 103 tests/typecheck/build pass)
- Module 4 `task_0ea8cffe8515` / opencode / `ctx_19a72b17dfb1` / worktree `module-4-renderer-wiring` — **done** (commits `1e510d9`, `c10cf48`, `3f50119`; merged `b12551a`; 112 tests/typecheck/build:web pass)
- Module 5 `task_436e4ace0a8a` / codex / `ctx_bcc36b347e42` / worktree `module-5-integration` — **done** (commits `fed16c1`, `7db7c8f`, `03096b8`, `17782bc`; merged `32869d2`; startup wiring `25e1290`; 173 tests/typecheck/build pass)
- Worktree root: `/Users/Admin/orca/workspaces/OrcaProject/`
- GitHub remote: pending a repo URL or `gh auth login`; local commits continue.
