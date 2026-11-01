# 管家实时思考流 Web-first 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先在浏览器原型里做出 ChatGPT 式思考块：mock 流式 reasoning + 工具步骤 + 最终答案，用 Vite 热更新和 ego 浏览器实时验收；主进程 CLI 流式层后续再接。

**Architecture:** 在共享层定义 `ButlerStreamEvent` 和 `StreamingButlerApi`；`web/mock-api.ts` 实现带延迟的流式 mock；`useWorkspaceData.stream()` 优先调用真实/ mock 的 `stream`，没有时回退到 `send` 并合成事件；`Workspace` 维护流式消息状态，`ChatPane` 用新的 `ReasoningBlock` 展示。Electron 主进程暂时继续走 `send` 回退。

**Tech Stack:** React 19、TypeScript strict、Vite、Vitest、Tailwind v4、ego-browser。

**Spec:** `docs/superpowers/specs/2026-11-01-butler-reasoning-stream-design.md`

## Global Constraints

- 每步结束运行 `npm run typecheck && npm test`。
- 不修改 `src/main/**`、preload、IPC 通道；主进程流式层放到后续。
- `StudyCoachApi` 保持原样；流式能力用 `StreamingButlerApi` 结构化检测，mock 返回 `StudyCoachApi & StreamingButlerApi`。
- Electron 没有 `stream` 时，`useWorkspaceData.stream()` 必须回退到 `send`，发一个 text + done，界面不能报错。
- 工具轮文字用 `narration`，不进入最终答案；`done.text` 只含最后一轮答案。
- mock 流式总时长控制在 300–500ms，便于观察但测试不拖慢。
- 现有 310 个测试保持通过。

## Review Focus

1. **mock 流式太快或太慢**：太快看不到思考过程，太慢拖慢测试；用 20–25ms/块，reasoning 约 4 字/块、答案约 6 字/块。
2. **Electron 没有 stream**：`window.studyCoach.stream` 不存在时必须回退到 `send`，不能让管家对话在 Electron 里直接报错。
3. **最终答案被 narration 污染**：工具轮「我先把这条记下来」必须只出现在过程区，`done.text` 不能包含它。
4. **思考块收起时机**：最终答案第一段 text 到达才收起；工具步骤和 narration 不触发收起。
5. **用户滚动时不被拽回底部**：流式增量很多，只有用户贴着底部时才自动滚动。

---

### Task 1: 共享事件类型 + mock 流式

**Files:**
- Create: `src/shared/butler-stream.ts`
- Modify: `web/mock-api.ts`
- Test: `tests/web/mock-api.test.ts`

**Interfaces:**
- Consumes: `SendMessageInput` / `SendMessageResult`（`src/shared/workspace.ts`）、现有 `butlerReply` / `createNoteInternal` / `persist`。
- Produces:
  - `ButlerStreamEvent`、`ButlerStreamListener`、`StreamingButlerApi`、`BUTLER_TOOL_LABELS`、`butlerToolLabel(name)`
  - `createMockApi(...): StudyCoachApi & StreamingButlerApi`
  - `stream(input, onEvent): Promise<SendMessageResult>`

- [ ] **Step 1: 写失败测试**

在 `tests/web/mock-api.test.ts` 加：

```ts
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';

test('streams reasoning, a tool step and the final reply', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const events: ButlerStreamEvent[] = [];
  const result = await api.stream(
    { workspaceId: 'kaoyan', message: '记一下：今天数学卡在极限' },
    (event) => events.push(event)
  );

  expect(events.some((event) => event.type === 'reasoning')).toBe(true);
  expect(events.some((event) => event.type === 'narration')).toBe(true);
  expect(
    events.some((event) => event.type === 'tool-start' && event.name === 'write_note')
  ).toBe(true);
  expect(events.at(-1)).toEqual({ type: 'done', text: result.text });

  const snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.notes.some((note) => note.title.includes('今天数学卡在极限'))).toBe(true);
});

test('streams a plain answer without a tool step', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  const events: ButlerStreamEvent[] = [];
  const result = await api.stream(
    { workspaceId: 'kaoyan', message: '帮我排一下今天的优先级' },
    (event) => events.push(event)
  );

  expect(events.some((event) => event.type === 'tool-start')).toBe(false);
  expect(events.filter((event) => event.type === 'text').length).toBeGreaterThan(1);
  expect(result.text.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/web/mock-api.test.ts`
Expected: FAIL，`api.stream is not a function` 或类型缺失。

- [ ] **Step 3: 创建 `src/shared/butler-stream.ts`**

```ts
import type { SendMessageInput, SendMessageResult } from './workspace';

export type ButlerStreamEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'narration'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-start'; id: string; name: string; label: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; label: string; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string; usage?: { inputTokens: number; outputTokens: number } };

export type ButlerStreamListener = (event: ButlerStreamEvent) => void;

export interface StreamingButlerApi {
  stream(input: SendMessageInput, onEvent: ButlerStreamListener): Promise<SendMessageResult>;
}

export const BUTLER_TOOL_LABELS: Record<string, string> = {
  get_today_plan: '读取今日计划',
  write_note: '写入笔记',
  update_task: '更新任务',
  get_memory: '读取记忆'
};

export function butlerToolLabel(name: string): string {
  return BUTLER_TOOL_LABELS[name] ?? name;
}
```

- [ ] **Step 4: 修改 `web/mock-api.ts`**

- import `ButlerStreamEvent`、`StreamingButlerApi`、`BUTLER_TOOL_LABELS`。
- `createMockApi` 返回类型改为 `StudyCoachApi & StreamingButlerApi`。
- 把 `send()` 里的记笔记逻辑抽成 `recordNoteIfNeeded(input): { title: string } | null`，`send` 和 `stream` 共用。
- 加 `sleep(ms)` 和 `chunkText(text, size)`（用 `Array.from` 切分，避免拆 surrogate pair）。
- 实现 `stream(input, onEvent)`：
  - reasoning 文本：记笔记类用 `先确认要记录的内容，然后写入当前工作区。`；其他用 `先看今天的任务和最近的记忆，再给出 1-3 个可执行的下一步。`
  - 按 4 字/块、25ms 间隔发 `reasoning`。
  - 如果是记笔记：发 `narration: '我先把这条记下来。'` → `tool-start`（`write_note`）→ `recordNoteIfNeeded(input)` → 120ms → `tool-result ok: true`。
  - 发 `butlerReply(input.message)`，按 6 字/块、20ms 间隔发 `text`。
  - 发 `done`，返回 `{ text: reply }`。

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/web/mock-api.test.ts`
Expected: PASS。

- [ ] **Step 6: 类型检查 + 提交**

Run: `npm run typecheck`
Expected: PASS。

```bash
git add src/shared/butler-stream.ts web/mock-api.ts tests/web/mock-api.test.ts
git commit -m "feat(web): add streaming mock for butler reasoning"
```

---

### Task 2: 渲染层流式状态 + 思考块

**Files:**
- Modify: `src/renderer/shell/types.ts`
- Modify: `src/renderer/shell/useWorkspaceData.ts`
- Modify: `src/renderer/shell/Workspace.tsx`
- Create: `src/renderer/shell/ReasoningBlock.tsx`
- Modify: `src/renderer/shell/ChatPane.tsx`
- Test: `tests/renderer/chat-reasoning.test.tsx`

**Interfaces:**
- Consumes: `ButlerStreamEvent` / `ButlerStreamListener` / `StreamingButlerApi`（Task 1）、现有 `ChatMessage`、`WorkspaceData`、`ChatPane`。
- Produces:
  - `ChatStep` 和扩展后的 `ChatMessage`
  - `WorkspaceData.stream(input, onEvent)`
  - `ReasoningBlock` 组件
  - `ChatPane` 渲染 reasoning + steps

- [ ] **Step 1: 写失败测试**

创建 `tests/renderer/chat-reasoning.test.tsx`：

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  window.studyCoach = createMockApi(localStorage);
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
}

test('shows live reasoning and collapses after the answer starts', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));

  expect(await screen.findByText('正在思考…')).toBeInTheDocument();
  expect(await screen.findByText(/我先按截止时间和精力排/)).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: /思考了 \d+ 秒/ })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /思考了 \d+ 秒/ }));
  expect(screen.getByText(/先看今天的任务和最近的记忆/)).toBeInTheDocument();
});

test('shows tool steps and keeps narration out of the final answer', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '记一下：今天数学卡在极限' }));

  expect(await screen.findByText('写入笔记')).toBeInTheDocument();
  expect(await screen.findByText(/记下了/)).toBeInTheDocument();
  expect(screen.queryByText('我先把这条记下来。')).toBeInTheDocument();
  expect(screen.queryByText(/记下了[\s\S]*我先把这条记下来/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/renderer/chat-reasoning.test.tsx`
Expected: FAIL，找不到「正在思考…」或类型错误。

- [ ] **Step 3: 扩展 `types.ts`**

```ts
export type ChatStep = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  reasoning?: string;
  steps?: ChatStep[];
  streaming?: boolean;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
};
```

- [ ] **Step 4: 扩展 `useWorkspaceData`**

- import `ButlerStreamEvent`、`ButlerStreamListener`、`StreamingButlerApi`。
- `WorkspaceData` 增加：
  ```ts
  stream: (input: SendMessageInput, onEvent: ButlerStreamListener) => Promise<SendMessageResult>;
  ```
- 实现：
  ```ts
  const stream = useCallback(
    async (input, onEvent) => {
      const api = apiOrThrow() as StudyCoachApi & Partial<StreamingButlerApi>;
      let result: SendMessageResult;
      if (typeof api.stream === 'function') {
        result = await api.stream(input, onEvent);
      } else {
        result = await api.send(input);
        onEvent({ type: 'text', text: result.text });
        onEvent({ type: 'done', text: result.text, ...(result.usage ? { usage: result.usage } : {}) });
      }
      await reload();
      return result;
    },
    [reload]
  );
  ```
- 返回对象里加 `stream`；保留 `send`。

- [ ] **Step 5: 修改 `Workspace.sendMessage`**

- 从 `useWorkspaceData()` 解构 `stream`（不再使用 `send`）。
- 生成 `assistantId`，立即追加用户消息和 assistant 占位：
  ```ts
  { id: assistantId, role: 'assistant', text: '', reasoning: '', steps: [], streaming: true }
  ```
- 调用 `stream(input, event => { ... })`：
  - `reasoning`：追加到 `reasoning`，首次设置 `reasoningStartedAt`。
  - `narration`：追加到 `reasoning`，前面加空行。
  - `text`：追加到 `text`，首次设置 `reasoningEndedAt`。
  - `tool-start`：追加 step，状态 `running`。
  - `tool-result`：更新 step 状态（`ok ? 'done' : 'failed'`）和 detail。
  - `error`：`setActionError(event.message)`。
  - `done`：把 `text` 设为 `event.text || current.text`，`streaming=false`，补 `reasoningEndedAt`。
- 异常：设置错误消息，并把占位文本设为「管家暂时没有回应，请稍后再试。」（如果还没有文本）。
- `finally`：`setTyping(false)`。
- 更新消息时用 `setMessages(current => current.map(...))` 按 `assistantId` 定位。

- [ ] **Step 6: 创建 `ReasoningBlock.tsx`**

- 入参：`reasoning?: string`、`steps?: ChatStep[]`、`streaming?: boolean`、`startedAt?: number`、`endedAt?: number`。
- 没有 reasoning 也没有 steps：返回 `null`。
- 头部 button：
  - 有 steps 无 reasoning：`工作过程`。
  - 流式中且 `streaming && !hasAnswer`（没有最终 text）：`正在思考…` + 呼吸点/小转圈。
  - 否则：`思考了 N 秒`（`startedAt`/`endedAt` 计算，最少 1 秒）；没有时间戳时用 `思考过程`。
- 状态：`userOpen` 默认 `null`；`open = userOpen ?? (streaming && !hasAnswer)`。`streaming` 结束后默认收起。
- 展开区：reasoning 文本 `whitespace-pre-wrap`、灰色、`max-h-[240px] overflow-y-auto`；steps 列表每行图标 + label，running 小转圈、done 勾、failed 红点；可选 detail 小字。
- 无障碍：`aria-expanded`、`aria-controls`；`role="status"` 用于「正在思考…」。
- 使用现有 `ChevronDownIcon` / `ChevronRightIcon` / `CheckIcon` / `SparklesIcon`。

- [ ] **Step 7: 修改 `ChatPane`**

- import `ReasoningBlock`。
- assistant 分支：
  ```tsx
  <div className="min-w-0">
    <p className="text-[11px] font-medium text-gray-500">Study Coach</p>
    <ReasoningBlock ... />
    {message.text ? <p className="mt-1 text-[13px] leading-6 text-[#1d1d1f]">{message.text}</p> : null}
  </div>
  ```
- `typing` 提示只在没有 streaming assistant 消息时显示：
  ```tsx
  {typing && !messages.some((message) => message.streaming) ? ... : null}
  ```
- `Composer` 加 `disabled={typing}`。
- 自动滚动：
  - `atBottomRef` 默认 true；容器 `onScroll` 更新（距底部 < 80px）。
  - effect 中只有 `atBottomRef.current` 或最后一条是 user 消息时滚到底。

- [ ] **Step 8: 运行测试确认通过**

Run: `npx vitest run tests/renderer/chat-reasoning.test.tsx`
Expected: PASS。

- [ ] **Step 9: 全量验证 + 提交**

Run: `npm run typecheck && npm test`
Expected: 所有测试 PASS。

```bash
git add src/renderer/shell/types.ts src/renderer/shell/useWorkspaceData.ts \
        src/renderer/shell/Workspace.tsx src/renderer/shell/ReasoningBlock.tsx \
        src/renderer/shell/ChatPane.tsx tests/renderer/chat-reasoning.test.tsx
git commit -m "feat(web): render live butler reasoning and tool steps"
```

---

### Task 3: ego 浏览器实时验收

**Files:**
- 只验证；必要时修 UI。

**Interfaces:**
- Consumes: Task 1 + Task 2；Vite dev server `http://localhost:5174/`。
- Produces: 浏览器验收记录（截图/文字），确认思考块、工具步骤、收起/展开。

- [ ] **Step 1: 确认 dev server 仍在运行**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/`
Expected: `200`。

- [ ] **Step 2: 用 ego-browser 打开并进入示例工作区**

```js
const task = await taskSpace(6);
const page = task.page("p1");
await page.goto("http://localhost:5174/");
await page.waitForLoadState();
// 如果仍在 onboarding，点击「先看看示例工作区」
```

- [ ] **Step 3: 发送「帮我排一下今天的优先级」**

- 观察「正在思考…」出现、reasoning 文本滚动、答案出现后思考块收起为「思考了 N 秒」。
- 点击思考块，确认能展开 reasoning。

- [ ] **Step 4: 发送「记一下：今天数学卡在极限」**

- 观察「写入笔记」步骤 running → done。
- 确认最终答案里有「记下了」，且「我先把这条记下来。」只出现在思考块里。
- 切到「记录」，确认新笔记出现。

- [ ] **Step 5: 截图存档**

用 `page.screenshot({ path: "/tmp/butler-reasoning-web.png" })`，检查视觉：灰色思考块、chevron、步骤图标、长文本滚动、窄屏不溢出。

- [ ] **Step 6: 报告**

向用户报告：web 端已可实时看到 reasoning + 工具步骤；Electron 仍走 `send` 回退；下一步接主进程 claude/codex 流式。

---

## Self-Review

- **Spec coverage:** 本计划覆盖设计中的 UI 展示、narration/最终答案分离、工具步骤、收起时机、非流式回退；IPC/preload/主进程 CLI 流式留在后续。
- **Step scan:** 每个任务有失败测试、实现、通过测试、提交；mock 时序和 UI 细节都有具体值。
- **Type consistency:** `ButlerStreamEvent`、`ButlerStreamListener`、`StreamingButlerApi`、`ChatStep`、`ChatMessage`、`stream(input, onEvent)` 命名一致。
- **Review Focus:** mock 时序、Electron 回退、narration 污染、收起时机、自动滚动均在 Task 1/2 的测试或 Step 中覆盖。
- **Proportion:** 计划只固定接口、事件顺序和关键样式；组件内部实现留给执行者。
