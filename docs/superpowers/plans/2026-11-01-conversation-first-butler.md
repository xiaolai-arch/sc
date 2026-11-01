# Conversation-first Butler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Study Coach 改成对话优先的个人管家：左栏对话/项目，中间管家对话，右侧可折叠项目面板；管家能创建项目、排计划、写记录、设提醒，并主动检查。

**Architecture:** 新增 ConversationStore（local userData）和 conversations IPC；butler 读取对话历史并在工具循环后持久化消息；新增 create_workspace/create_task/set_reminder 工具；scheduler 触发 ProactiveCheckInService 生成检查对话并通知；renderer 用新的 conversation-first shell 替换六页工作台。

**Tech Stack:** TypeScript strict, React 19, Tailwind v4, Electron, Vitest, Playwright, AI SDK tool loop.

**Spec:** `docs/superpowers/specs/2026-11-01-conversation-first-butler-design.md`

## Global Constraints

- 本地优先；对话存 `userData/conversations/`，项目数据继续在 vault；不写日志、不写遥测。
- 不持久化 reasoning；工具步骤只存 label/status/detail；不存原始工具参数/结果。
- 对话的 `workspaceId` 是发送和工具调用的唯一权威；renderer 不独立覆盖。
- 提醒保持 vault-global，不增加 workspaceId。
- 桌面首次安装不自动 seed demo；web「先看看示例」可显式 seed。
- 主动检查去重/预算持久化在 check-in 消息的 `trigger` 上；通知文案不泄露任务/笔记内容。
- 每个任务结束 `npm run typecheck && npm test`；Task 5 后跑 `npm run test:e2e`。
- 不引入新 UI 库；继续用 Tailwind + `src/renderer/ui`。

## Review Focus

1. **跨项目写错数据**：对话切换、项目点击、tool 默认 workspace 必须始终使用 `conversation.workspaceId`。
2. **对话历史污染**：新对话不应带旧对话上下文；历史窗口截断不能重复当前用户消息。
3. **检查重复/打扰**：重启后同一 trigger 不重复；预算/DND/关闭通知都要生效。
4. **空对话/欢迎态**：draft 不写存储；空对话不出现在历史；刷新后当前对话可恢复。
5. **旧六页回归**：设置、练习、复盘、记录、流式思考块不能被新 shell 破坏。

---

### Task 1: Shared conversation contracts + ConversationStore

**Files:**
- Create: `src/shared/conversations.ts`
- Create: `src/main/conversations/conversation-store.ts`
- Test: `tests/main/conversation-store.test.ts`

**Interfaces:**
- Consumes: Node `fs/promises`, `crypto.randomUUID`, `userData` path.
- Produces:
  - `ConversationKind = 'chat' | 'check-in'`
  - `ConversationMessage`, `Conversation`, `ConversationSummary`, `CreateConversationInput`
  - `ConversationStore` with `list()`, `get(id)`, `create(input?)`, `appendMessage(id, message)`, `update(id, mutator)`, `delete(id)`, `linkWorkspace(id, workspaceId)`

- [ ] **Step 1: Write failing tests**

`tests/main/conversation-store.test.ts`:
- creates a conversation with a default title and empty messages; `list()` initially returns `[]` (empty conversations filtered).
- append a user message → title becomes first 20–24 chars; list returns summary with preview.
- append assistant message with steps/trigger → get returns both; updatedAt advances.
- linkWorkspace sets workspaceId; list summary includes it.
- update can change title/workspace/messages; delete removes it.
- corrupt JSON file is ignored by list/get.
- two stores on the same directory see each other’s writes.
- file mode is `0600` (skip on non-POSIX if needed).

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run tests/main/conversation-store.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/shared/conversations.ts`**

```ts
export type ConversationKind = 'chat' | 'check-in';
export type CheckInTrigger = 'morning' | 'evening' | 'custom';

export type ConversationStep = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: ConversationStep[];
  source?: 'user' | 'butler' | 'check-in';
  trigger?: CheckInTrigger;
};

export type Conversation = {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  updatedAt: string;
  preview: string;
};

export type CreateConversationInput = {
  title?: string;
  kind?: ConversationKind;
  workspaceId?: string;
};
```

- [ ] **Step 4: Implement `ConversationStore`**

- Constructor: `new ConversationStore(directory: string, options?: { now?: () => Date; randomId?: () => string })`.
- `list()`: read `*.json`, parse, skip corrupt/empty-message conversations, sort `updatedAt` desc, return summaries.
- `get(id)`: validate id (safe filename), read, parse, return null if missing/corrupt.
- `create(input?)`: default title `新对话`, kind `chat`, `messages: []`, timestamps; write 0600 atomic temp+rename; return.
- `appendMessage(id, message)`: load, push, update `updatedAt`, if title is `新对话` and message.role==='user' set title from text (20–24 chars), write.
- `update(id, mutator)`: load, apply, ensure `updatedAt` if not changed, write.
- `linkWorkspace(id, workspaceId)`: update workspaceId.
- `delete(id)`: rm.
- Use a per-store write queue to avoid concurrent write loss.

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/main/conversation-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/shared/conversations.ts src/main/conversations/conversation-store.ts tests/main/conversation-store.test.ts
git commit -m "feat(conversations): add local conversation store"
```

---

### Task 2: Conversations IPC/preload + web mock

**Files:**
- Modify: `src/shared/ipc.ts`, `src/main/ipc.ts`, `src/main/context.ts`, `src/preload/index.ts`, `web/mock-api.ts`
- Test: `tests/main/ipc-conversations.test.ts`, `tests/main/ipc-preload.test.ts`, `tests/web/mock-api.test.ts`

**Interfaces:**
- Consumes: Task 1 types/store.
- Produces: `ConversationApi` on `StudyCoachApi`:
  ```ts
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(input?: CreateConversationInput): Promise<Conversation>;
  appendConversationMessage(id: string, message: ConversationMessage): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  ```
- `SendMessageInput` adds `conversationId?: string`; `SendMessageResult` adds `conversationId?: string`.

- [ ] **Step 1: Tests**
  - IPC handlers route/validate each conversation method; corrupt input rejected; errors sanitized.
  - Preload bridge invokes the channels and forwards args; `appendConversationMessage` works.
  - Web mock creates/lists/appends/deletes conversations in localStorage; `stream` links created workspace.
- [ ] **Step 2: Implement shared API + channels**
  - Add `ConversationApi` and extend `StudyCoachApi`.
  - Add channels: `listConversations`, `getConversation`, `createConversation`, `appendConversationMessage`, `deleteConversation`; outbound `conversationsChanged` and `conversationsOpen` (constants separate from `IPC_CHANNELS` if preferred).
  - Validate ids/messages; sanitize errors.
- [ ] **Step 3: Context + preload**
  - `AppContext` creates `ConversationStore` at `join(userDataPath, 'conversations')`; expose API methods.
  - Preload bridge implements methods; subscribe to changed/open events if added.
- [ ] **Step 4: Web mock**
  - Store conversations in memory + localStorage; implement CRUD/append.
  - `stream` can create a workspace for “我想考研” and link the conversation; emit tool events.
- [ ] **Step 5: Run tests, typecheck, commit.**

Run: `npx vitest run tests/main/ipc-conversations.test.ts tests/main/ipc-preload.test.ts tests/web/mock-api.test.ts && npm run typecheck`
```bash
git commit -m "feat(conversations): expose conversation IPC and mock"
```

---

### Task 3: Conversation-first shell (web-first, then Electron)

**Files:**
- Create: `src/renderer/shell/ConversationSidebar.tsx`, `src/renderer/shell/ProjectPanel.tsx`, `src/renderer/shell/ProjectSwitcher.tsx`, `src/renderer/shell/SettingsModal.tsx`
- Modify: `src/renderer/shell/Workspace.tsx`, `src/renderer/shell/ChatPane.tsx`, `src/renderer/shell/types.ts`, `src/renderer/shell/useWorkspaceData.ts`, `src/renderer/App.tsx`, `web/mock-api.ts`
- Test: `tests/renderer/conversation-shell.test.tsx`; rewrite `tests/renderer/workspace.test.tsx`; update `tests/renderer/app-shell.test.tsx`.

**Interfaces:**
- Consumes: Task 2 ConversationApi; existing `useWorkspaceData`, `ChatPane`, `ReasoningBlock`.
- Produces:
  - `Workspace` renders conversation-first shell with `conversations`, `activeConversationId`, `selectedWorkspaceId`, `panelOpen`, `panelTab`, `settingsOpen`.
  - New conversation draft (no persisted conversation until first send).
  - Sidebar lists conversations (with project badge) and projects.
  - Panel tabs: plan / records / review / reminders; practice button.
- Steps:
  1. Write renderer tests: welcome draft; new conversation; send message persists/appends; switch conversation; project click opens linked conversation; panel tabs; settings modal opens.
  2. Build shell components; keep chat stream/ReasoningBlock logic.
  3. Renderer-side persistence for this phase: create conversation on first send, append user message, call `stream`, append assistant message with steps; reload list.
  4. Panel uses existing workspace data filtered by selected workspace; reminders global.
  5. Settings modal wraps `SettingsPage`; practice button opens `LearningPane` modal (can be a follow-up step if too large).
  6. Remove six-page nav and old middle-column components from `Workspace` (keep components reusable in panel/modals).
  7. Run tests/typecheck; commit.
- Note: Electron and web both use the same shell; conversation persistence uses the real IPC in Electron and mock in web.

---

### Task 4: Butler history + tools + project linking

**Files:**
- Modify: `src/main/butler/butler-service.ts`, `src/main/butler/tools.ts`, `src/main/butler/create-butler-service.ts`, `src/main/context.ts`, `src/shared/workspace.ts`, `src/main/workspace/create-workspace-service.ts`, `src/renderer/shell/Workspace.tsx`, `web/mock-api.ts`
- Test: `tests/main/butler-conversation.test.ts`, `tests/main/butler-tools.test.ts`, `tests/main/workspace-reminders.test.ts`

**Interfaces:**
- `ButlerService` gets `conversationStore` via factory/context.
- `send`/`stream` load history from `conversationId`; use `conversation.workspaceId` as the default; persist user/assistant messages and steps; update title; return conversationId.
- Tools add:
  - `create_workspace(name, kind, goal, description)`.
  - `create_task(workspaceId?, title, subject, durationMin, acceptance, due?)`.
  - `set_reminder(time, label, enabled?)`.
- `WorkspaceService` adds `createReminder(input)`, `updateReminder(input)`.
- After `create_workspace`, the butler links the conversation and updates the tool context workspace for subsequent calls.
- Renderer stops double-appending messages; reloads conversation after stream.
- Tests: history order/window, workspace authority, tool execution, reminder persistence, project link, no reasoning persisted.

---

### Task 5: Proactive check-ins + scheduler + tray

**Files:**
- Create: `src/main/check-ins/proactive-check-in-service.ts`, `src/main/check-ins/prompt.ts`
- Modify: `src/main/scheduler/scheduler.ts`, `src/main/scheduler/app-scheduler.ts`, `src/main/tray.ts`, `src/main/index.ts`, `src/main/context.ts`, `tests/main/scheduler*.test.ts`
- Test: `tests/main/proactive-check-in.test.ts`, `tests/main/scheduler-check-in.test.ts`, `tests/main/notification-click.test.ts`.

**Interfaces:**
- `SchedulerOptions.onCheckIn?: (trigger: 'morning'|'evening', date: string) => Promise<SchedulerNotification | null>`.
- Remove morning auto-plan from scheduler; keep `planFirstEmptyWorkspace` for tray manual action.
- `ProactiveCheckInService`:
  - checks notification/DND/budget/dedup via today’s check-in messages with trigger;
  - builds context from workspaces/tasks/notes/reviews/reminders/memory;
  - finds/creates day’s check-in conversation;
  - generates model message or template;
  - persists assistant message with `trigger`;
  - returns a generic notification payload with `conversationId`.
- Notification sink accepts click handler; main index shows window and sends `conversations:open` with the id.
- Window close keeps app in tray; tray Quit exits.

---

### Task 6: Settings/practice modals, migration, e2e, package

**Files:**
- Modify: `src/renderer/App.tsx`, `src/renderer/shell/Workspace.tsx`, `src/renderer/settings/SettingsPage.tsx`, `src/main/workspace/seed.ts`, `src/main/index.ts`, `e2e/desktop.spec.ts`, `e2e/fixtures/fake-codex.mjs`, `tests/renderer/*`, `web/mock-api.ts`
- Test: new/updated renderer + e2e.

- [ ] Settings modal + practice modal wired.
- [ ] Desktop seed disabled; web “先看看示例” explicit seed.
- [ ] Old six-page tests removed/rewritten.
- [ ] E2E: welcome → “我想考研” → fake model creates workspace/tasks → sidebar/panel → chat persists after reload.
- [ ] Full verification: typecheck, vitest, build, e2e, package.

---

## Self-Review

- **Spec coverage:** Tasks 1–6 cover conversation store, IPC, shell, butler history/tools, proactive check-ins, settings/practice, seed migration, e2e/package.
- **Step scan:** Each task has files, interfaces, tests, and a concrete deliverable; no TBD.
- **Type consistency:** `Conversation`, `ConversationMessage`, `ConversationSummary`, `ConversationStore`, `ConversationApi`, `appendConversationMessage`, `conversationId`, `trigger` are reused consistently.
- **Review Focus:** workspace authority (Task 4 tests), history isolation (Task 4), check-in dedupe (Task 5), empty draft/history (Task 3), old surfaces (Task 6).
- **Proportion:** The plan fixes contracts and tests; implementation details remain for the executor.
