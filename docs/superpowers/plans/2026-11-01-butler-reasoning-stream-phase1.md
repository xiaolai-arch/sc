# 管家实时思考流 Phase 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先实现管家思考流的主进程层：claude/codex CLI 的流式解析、butler 的 `stream()` 事件循环和对应测试；不碰 UI/IPC。

**Architecture:** `CliAgentClient` 增加 `stream()`，把 claude 的 `stream-json` 和 codex 的 `--json` 逐行解析成 reasoning/text 事件；`ButlerServiceImpl.stream()` 在现有工具循环上转发事件，并把工具轮文字降级为 narration、最终答案只取最后一轮。Phase 2 再把 `stream()` 接到 shared 接口、IPC/preload 和渲染层。

**Tech Stack:** TypeScript strict、Vitest、Node `child_process`、现有 `ButlerServiceImpl` / `ModelClient` / `WorkspaceService`。

**Spec:** `docs/superpowers/specs/2026-11-01-butler-reasoning-stream-design.md`

> **Update (2026-11-01):** 用户要求继续打通 Electron 全链路，因此本计划在实施时把 `ButlerService.stream`、IPC 事件通道和 preload bridge 一并接上；Web 端 mock 已先在 `2026-11-01-butler-reasoning-stream-web-first.md` 中完成并验收。当前 333 个单测 + Electron e2e 通过。

## Global Constraints

- 每个任务结束运行 `npm run typecheck && npm test`。
- 测试不联网；CLI 用注入的 fake `CliStreamRunner` / fake `ModelClient`。
- Phase 1 不修改 `src/shared/workspace.ts` 的 `ButlerService` 接口、`src/main/ipc.ts`、preload、renderer、`web/mock-api.ts`、`e2e/`。
- 只对 local-cli 的 claude/codex 流式；zcode/opencode 和非流式 client 回退到 `complete()`。
- codex 流式参数包含 `-c model_reasoning_effort=medium`。
- 显式失败事件（codex `turn.failed`/`error`、claude `result.is_error`）是终止信号，不再调用 `complete()`。
- 进程退出码 0 但没有可用事件时，回退一次 `complete()`。
- reasoning/narration/text 不写日志、不落盘；butler 发出的 `error.message` 过 `redactSecrets`。
- 工具轮文字是 `narration`，不进入 `done.text`；`done.text` 只含最后一轮无工具调用的答案。
- 类型、函数名、字段名必须与下面 Interfaces 完全一致。

## Review Focus

1. **CLI 输出混有 banner/hook/半行 JSON**：解析器必须忽略非 JSON 行，并在 chunk 边界缓存半行；否则 reasoning 或最终答案会被丢掉。
2. **模型输出 fenced JSON 信封**：不得把 ```json 原文流给用户；工具轮文字必须变成 narration，而不是答案。
3. **流式中途失败**：已经发出过增量后再失败，不能静默结束或重复调用 `complete()` 生成两份回答；必须发 error + 模板 done。
4. **多轮工具循环**：usage 必须累加；最终答案只取最后一轮；narration 不能覆盖或混入 `done.text`。
5. **非流式 provider**：zcode/opencode/API client 走 `complete()` 时也必须发一个 text 事件和 done，不能挂起或抛 "stream not implemented"。

---

### Task 0: 建立独立 worktree 并提交设计/计划文档

**Files:**
- Create: `docs/superpowers/specs/2026-11-01-butler-reasoning-stream-design.md`（从主 worktree 移入）
- Create: `docs/superpowers/plans/2026-11-01-butler-reasoning-stream-phase1.md`（本文件，从主 worktree 移入）

**Interfaces:**
- Consumes: 主 worktree `/Users/Admin/orca/projects/OrcaProject` 的 `feat/v1-completion` @ `86d1b6a`。
- Produces: worktree `/Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream`，分支 `feat/butler-reasoning-stream`。

- [ ] **Step 1: 创建 worktree**

```bash
git -C /Users/Admin/orca/projects/OrcaProject worktree add \
  -b feat/butler-reasoning-stream \
  /Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream \
  feat/v1-completion
```

- [ ] **Step 2: 把两份文档移动到新 worktree**

```bash
mkdir -p /Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream/docs/superpowers/specs
mkdir -p /Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream/docs/superpowers/plans
mv /Users/Admin/orca/projects/OrcaProject/docs/superpowers/specs/2026-11-01-butler-reasoning-stream-design.md \
   /Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream/docs/superpowers/specs/
mv /Users/Admin/orca/projects/OrcaProject/docs/superpowers/plans/2026-11-01-butler-reasoning-stream-phase1.md \
   /Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream/docs/superpowers/plans/
```

- [ ] **Step 3: 在 worktree 内提交文档**

```bash
cd /Users/Admin/orca/workspaces/OrcaProject/butler-reasoning-stream
git add docs/superpowers/specs/2026-11-01-butler-reasoning-stream-design.md \
        docs/superpowers/plans/2026-11-01-butler-reasoning-stream-phase1.md
git commit -m "docs: add butler reasoning stream design and phase 1 plan"
```

Expected: commit 成功，`git status --short` 为空。

---

### Task 1: CLI 流式适配（claude / codex）

**Files:**
- Create: `src/shared/butler-stream.ts`
- Modify: `src/main/agent/model-client.ts`
- Modify: `src/main/agent/cli-agent-client.ts`
- Test: `tests/main/cli-agent-client-stream.test.ts`

**Interfaces:**
- Consumes: 现有 `ModelClient`、`ModelRequest`、`ModelResponse`、`ModelToolCall`、`parseCliResponse`、`CliAgentClient`。
- Produces:
  - `ModelStreamEvent = { type: 'reasoning'; text: string } | { type: 'text'; text: string }`
  - `StreamingModelClient extends ModelClient { stream(request: ModelRequest, onEvent: (event: ModelStreamEvent) => void): Promise<ModelResponse> }`
  - `supportsStreaming(client: ModelClient): client is StreamingModelClient`
  - `CliStreamRunner` 与 `CliAgentClientOptions.streamRunner?: CliStreamRunner`
  - `CliAgentClient implements StreamingModelClient`
  - `src/shared/butler-stream.ts` 中的 `ButlerStreamEvent` / `ButlerStreamListener` / `BUTLER_TOOL_LABELS` / `butlerToolLabel(name)`

- [ ] **Step 1: 写失败测试**

创建 `tests/main/cli-agent-client-stream.test.ts`，至少覆盖：

```ts
import { CliAgentClient, type CliStreamRunner } from '../../src/main/agent/cli-agent-client';
import type { ModelStreamEvent } from '../../src/main/agent/model-client';

function scriptedStream(lines: string[], code = 0): CliStreamRunner {
  return async (_command, _args, _input, _options, onLine) => {
    for (const line of lines) onLine(line);
    return { stdout: '', stderr: '', code };
  };
}

test('claude streams reasoning and text deltas', async () => {
  const events: ModelStreamEvent[] = [];
  const client = new CliAgentClient(
    { kind: 'local-cli', agent: 'claude', command: 'claude' },
    {
      streamRunner: scriptedStream([
        JSON.stringify({ type: 'system', subtype: 'hook_started' }),
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'thinking_delta', thinking: '先看计划' }
          }
        }),
        JSON.stringify({
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: '你好' }
          }
        }),
        JSON.stringify({
          type: 'result',
          result: '你好',
          usage: { input_tokens: 10, output_tokens: 2 }
        })
      ])
    }
  );

  const result = await client.stream(
    { messages: [{ role: 'user', content: '你好' }] },
    (event) => events.push(event)
  );

  expect(events).toEqual([
    { type: 'reasoning', text: '先看计划' },
    { type: 'text', text: '你好' }
  ]);
  expect(result.text).toBe('你好');
  expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 2 });
});
```

再增加这些测试（同一文件）：

- `claude buffers a tool envelope and returns tool calls`：文本 delta 是 ```json {"text":"我先记一下","toolCalls":[{"name":"write_note","arguments":{"title":"极限","body":"..."}}]} ```；断言 `events` 里没有包含 `"toolCalls"` 的 text 事件，`result.toolCalls?.[0]` 是 `{ id: 'cli-call-1', name: 'write_note', arguments: {...} }`，`result.text` 是 `我先记一下`。
- `claude streams plain text immediately`：文本 delta 是 `你`；断言 `events` 包含 `{ type: 'text', text: '你' }`。
- `codex streams reasoning and parses agent_message envelope`：两行 `item.completed`（`reasoning` 和 `agent_message`，agent_message 文本是 fenced envelope），加 `turn.completed`；断言 reasoning 事件、无原始 JSON text、`result.toolCalls` 正确、usage 正确。
- `codex plain agent_message emits one text event`：agent_message 是普通文本 `你好`；断言 `events` 包含一个 `{ type: 'text', text: '你好' }`。
- `zcode falls back to one text event`：`streamRunner` 不应被调用，`runner` 返回 `'fallback text'`；断言 `events` 是 `[{ type: 'text', text: 'fallback text' }]`。
- `explicit failure is terminal and does not call complete`：codex 行 `{"type":"turn.failed","error":{"message":"boom"}}`，`code: 1`；断言 `stream` reject `/boom/`，且注入的 `runner` 调用次数为 0。
- `exit 0 with no events falls back to complete`：`streamRunner` 返回 code 0 空输出；`runner` 返回 `'fallback'`；断言 `events` 有一个 text 事件且 `result.text === 'fallback'`。
- `nonzero exit after deltas rejects`：先发一个 reasoning 行，再 `code = 1`；断言 reject，且不会调用 `complete()`。
- `malformed fenced block is emitted as plain text`：claude 文本 delta 是 ``` ```json not-json ``` ```；断言 text 事件是原文，不抛错。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/cli-agent-client-stream.test.ts`
Expected: FAIL，提示 `client.stream is not a function` 或类型/导出缺失。

- [ ] **Step 3: 创建 `src/shared/butler-stream.ts`**

```ts
export type ButlerStreamEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'narration'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-start'; id: string; name: string; label: string }
  | { type: 'tool-result'; id: string; name: string; ok: boolean; label: string; detail?: string }
  | { type: 'error'; message: string }
  | { type: 'done'; text: string; usage?: { inputTokens: number; outputTokens: number } };

export type ButlerStreamListener = (event: ButlerStreamEvent) => void;

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

- [ ] **Step 4: 修改 `src/main/agent/model-client.ts`**

在 `ModelResponse` 后加入：

```ts
export type ModelStreamEvent =
  | { type: 'reasoning'; text: string }
  | { type: 'text'; text: string };

export interface StreamingModelClient extends ModelClient {
  stream(
    request: ModelRequest,
    onEvent: (event: ModelStreamEvent) => void
  ): Promise<ModelResponse>;
}

export function supportsStreaming(client: ModelClient): client is StreamingModelClient {
  return typeof (client as Partial<StreamingModelClient>).stream === 'function';
}
```

- [ ] **Step 5: 修改 `src/main/agent/cli-agent-client.ts` 的参数与 runner**

- `AgentConfig` 增加 `streamArgs?: string[]`。
- `claude` 增加 `streamArgs: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages']`。
- `codex` 增加 `streamArgs: ['exec', '--json', '--skip-git-repo-check', '-c', 'model_reasoning_effort=medium', '-']`。
- 新增导出类型：

```ts
export type CliStreamRunner = (
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number },
  onLine: (line: string) => void
) => Promise<CliRunResult>;
```

- `CliAgentClientOptions` 增加 `streamRunner?: CliStreamRunner`。
- 实现 `defaultStreamRunner`：`spawn`、按行切分 stdout（保留半行缓冲，兼容 `\r\n`）、超时 `SIGTERM`、close 时 flush 最后一行、返回 `{ stdout, stderr, code }`。

- [ ] **Step 6: 实现 `CliAgentClient.stream()`**

类声明改为 `implements StreamingModelClient`。`stream()` 逻辑：

- 没有 `streamArgs`（zcode/opencode）：`const result = await this.complete(request); if (result.text.trim()) onEvent({ type: 'text', text: result.text.trim() }); return result;`
- 有 `streamArgs`：构建 prompt（复用 `buildPrompt`），args 用 `streamArgs`，input 按 `stdin` 规则；用 `this.options.streamRunner ?? defaultStreamRunner`。
- 逐行 `JSON.parse`，忽略解析失败/未知事件。
- claude：
  - `type === 'stream_event'` 且 `event.type === 'content_block_delta'`：
    - `delta.type === 'thinking_delta'` → `onEvent({ type: 'reasoning', text: delta.thinking })`
    - `delta.type === 'text_delta'` → 交给 `EnvelopeTextGate`
  - `type === 'result'`：记录 `result` 文本、`usage.input_tokens` / `usage.output_tokens`；`result.is_error === true` 时设置 explicitFailure。
- codex：
  - `item.completed` + `item.type === 'reasoning'` → reasoning 事件
  - `item.completed` + `item.type === 'agent_message'` → 用 `parseCliResponse(item.text)` 直接解析，文本作为最终/工具轮文本（不逐字流）
  - `turn.completed` → 记录 usage
  - `type === 'turn.failed'` 或 `type === 'error'` → 设置 explicitFailure
- `EnvelopeTextGate`：
  - `push(delta, emitText)`：缓冲直到首个非空白字符可判断；不是 `{` / `` ` `` → flush 并转发后续；否则继续缓冲。
  - `finish()`：用 `parseCliResponse`；有信封返回 `{ text, toolCalls }`；否则返回 `{ text: buffer }`。
- 流结束：
  - explicitFailure → throw `new Error(redactSecrets(detail))`
  - code !== 0 且没有任何 reasoning/text 事件 → `await this.complete(request)`，发一个 text 事件，返回
  - code !== 0 且已有事件 → throw
  - code === 0 且没有任何事件/文本 → `await this.complete(request)`，发一个 text 事件，返回；仍为空则 throw
  - 否则返回 `{ text: finalText, usage, ...(toolCalls.length ? { toolCalls } : {}) }`
- 注意：工具轮信封的 `text` 不要在 `stream()` 里发 text 事件；只放在返回的 `ModelResponse.text` 里，由 butler 决定 narration。

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run tests/main/cli-agent-client-stream.test.ts`
Expected: PASS。

- [ ] **Step 8: 运行类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 9: 提交**

```bash
git add src/shared/butler-stream.ts src/main/agent/model-client.ts src/main/agent/cli-agent-client.ts tests/main/cli-agent-client-stream.test.ts
git commit -m "feat(agent): stream claude and codex CLI output"
```

---

### Task 2: Butler 流式循环

**Files:**
- Modify: `src/main/butler/butler-service.ts`
- Test: `tests/main/butler-service-stream.test.ts`

**Interfaces:**
- Consumes: `ButlerStreamEvent` / `ButlerStreamListener` / `butlerToolLabel`（Task 1）、`StreamingModelClient` / `supportsStreaming`（Task 1）、现有 `ButlerServiceImpl.send()` 的 context/prompt/tool 逻辑。
- Produces: `ButlerServiceImpl.stream(input: SendMessageInput, onEvent: ButlerStreamListener): Promise<SendMessageResult>`（暂不加入 `ButlerService` 接口）。

- [ ] **Step 1: 写失败测试**

创建 `tests/main/butler-service-stream.test.ts`。测试辅助：

```ts
import type { ModelRequest, ModelResponse, ModelStreamEvent, StreamingModelClient } from '../../src/main/agent/model-client';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { ButlerServiceImpl } from '../../src/main/butler/butler-service';
import type { ButlerStreamEvent } from '../../src/shared/butler-stream';
import type { Workspace, WorkspaceService, WorkspaceSnapshot } from '../../src/shared/workspace';

class ScriptedStreamingClient implements StreamingModelClient {
  readonly calls: ModelRequest[] = [];
  constructor(private readonly script: Array<{ events: ModelStreamEvent[]; response: ModelResponse }>) {}
  async complete(): Promise<ModelResponse> {
    throw new Error('complete should not be called');
  }
  async stream(request: ModelRequest, onEvent: (event: ModelStreamEvent) => void): Promise<ModelResponse> {
    this.calls.push(request);
    const next = this.script.shift();
    if (!next) throw new Error('no scripted round');
    for (const event of next.events) onEvent(event);
    return next.response;
  }
}
```

Workspace stub（用 `as unknown as WorkspaceService` 避免实现全部方法）：

```ts
const workspace: Workspace = {
  id: 'ws-exam', name: '考研', kind: 'exam', color: '#ef4444',
  goal: '2027 上岸', description: '考研复习'
};
const snapshot: WorkspaceSnapshot = {
  workspace, tasks: [], notes: [], memory: [], reminders: []
};
const workspaceService = {
  listWorkspaces: async () => [workspace],
  getWorkspaceSnapshot: async () => snapshot,
  getMemory: async () => [],
  createNote: async (input: { title: string; body: string }) => ({
    id: 'n1', workspaceId: 'ws-exam', title: input.title, subject: '考研',
    tags: [], updated: '2026-11-01', summary: '', body: input.body, related: []
  }),
  updateWorkspaceTask: async (input: { taskId: string; status: string }) => ({
    id: input.taskId, workspaceId: 'ws-exam', title: 't', subject: 's',
    durationMin: 30, acceptance: 'a', status: input.status
  })
} as unknown as WorkspaceService;
```

测试用例：

- `streams reasoning, narration, tool steps and final answer`：
  - 第一轮 `events: [{ type: 'reasoning', text: '先想' }]`，`response: { text: '我先记一下', usage: { inputTokens: 5, outputTokens: 2 }, toolCalls: [{ id: 'c1', name: 'write_note', arguments: { title: '极限', body: '等价无穷小' } }] }`
  - 第二轮 `events: [{ type: 'reasoning', text: '再想' }, { type: 'text', text: '记好了' }]`，`response: { text: '记好了', usage: { inputTokens: 3, outputTokens: 4 } }`
  - 断言事件类型序列：
    `['reasoning', 'narration', 'tool-start', 'tool-result', 'reasoning', 'text', 'done']`
  - 断言 `narration.text === '我先记一下'`，`done.text === '记好了'`，`done.usage` 是 `{ inputTokens: 8, outputTokens: 6 }`。
- `falls back to complete for non-streaming clients`：`FakeModelClient(['模板回答'])`；断言事件是 `[{ type: 'text', text: '模板回答' }, { type: 'done', text: '模板回答' }]`。
- `emits error and template done when the model throws`：scripted client 的 `stream` 抛 `new Error('model exploded')`；断言有一个 `error` 事件，且 `done.text` 非空、不是 `model exploded`。
- `continues after a failed tool call`：第一轮调用未知工具 `no_such_tool`，第二轮最终答案；断言 `tool-result.ok === false`，且最终 `text`/`done` 正常。
- `stops at maxToolSteps with template reply`：`maxToolSteps: 1`，两轮都返回 toolCalls；断言 `done.text` 是模板回复（不等于模型文本）。
- `sums usage across rounds`：与第一个用例相同，断言 `done.usage` 是累加值。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run tests/main/butler-service-stream.test.ts`
Expected: FAIL，提示 `service.stream is not a function`。

- [ ] **Step 3: 实现 `ButlerServiceImpl.stream()`**

在 `butler-service.ts` 增加导入：

```ts
import type { ButlerStreamEvent, ButlerStreamListener } from '../../shared/butler-stream';
import { butlerToolLabel } from '../../shared/butler-stream';
import { supportsStreaming, type ModelResponse, type ModelStreamEvent } from '../agent/model-client';
import { redactSecrets } from '../ipc';
```

实现要点：

```ts
async stream(input: SendMessageInput, onEvent: ButlerStreamListener): Promise<SendMessageResult> {
  // 1. 空消息 / 无 modelClient：模板回复，发 text + done，返回
  // 2. gatherContext + messages
  // 3. for step 0..maxToolSteps:
  //    - let streamedText = false
  //    - 如果 supportsStreaming(this.modelClient):
  //        response = await this.modelClient.stream(request, event => {
  //          if (event.type === 'reasoning') onEvent({ type: 'reasoning', text: event.text });
  //          else { streamedText = true; onEvent({ type: 'text', text: event.text }); }
  //        });
  //      否则 response = await this.complete(messages)
  //    - usage 累加
  //    - toolCalls = response.toolCalls ?? []
  //    - 如果 toolCalls.length === 0:
  //        finalText = response.text.trim() || lastText || '我暂时没有整理出回复，请再试一次。'
  //        if (!streamedText && finalText) onEvent({ type: 'text', text: finalText })
  //        onEvent({ type: 'done', text: finalText, usage })
  //        return { text: finalText, usage }
  //    - 如果 step === maxToolSteps: 模板 done，返回
  //    - 如果 response.text.trim(): onEvent({ type: 'narration', text: response.text.trim() })
  //    - push assistant message
  //    - 对每个 toolCall: onEvent tool-start; runTool; onEvent tool-result(ok, detail); push tool message
  // 4. 捕获异常:
  //    - onEvent({ type: 'error', message: redactSecrets(describeError(error)) })
  //    - const fallback = this.failureResult(...)
  //    - onEvent({ type: 'text', text: fallback.text }); onEvent({ type: 'done', text: fallback.text, usage })
  //    - return fallback
}
```

细节：

- `done.text` 只使用最后一轮无 toolCalls 的 `response.text`；不要用中间轮的 narration。
- `usage` 用现有 `sumUsage`。
- `tool-result.detail`：成功时不传（或传 `undefined`）；失败时从 `result.content` 解析 `{ error }`，过 `redactSecrets`。
- 模型异常时如果已经流式发出过 text，不要重复发整段模板 text；只发 error + done（`done.text` 用模板文本，渲染层以 done 为准）。为简化测试，可以在异常分支始终发 `error` + `done`，不发 text；渲染层以 done 显示模板。
- `maxToolSteps` 分支同样发 done，不发 text。
- 保持 `send()` 完全不变。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run tests/main/butler-service-stream.test.ts`
Expected: PASS。

- [ ] **Step 5: 运行全量验证**

Run: `npm run typecheck && npm test`
Expected: typecheck PASS，所有测试 PASS。

- [ ] **Step 6: 提交**

```bash
git add src/main/butler/butler-service.ts tests/main/butler-service-stream.test.ts
git commit -m "feat(butler): add streaming send loop"
```

---

### Task 3: Phase 1 收尾验证

**Files:**
- 无新增；只验证。

**Interfaces:**
- Consumes: Task 1 + Task 2 的实现。
- Produces: 可合并的 `feat/butler-reasoning-stream` Phase 1 分支。

- [ ] **Step 1: 查看 diff 范围**

Run: `git diff --stat feat/v1-completion...HEAD`
Expected: 只包含 `src/shared/butler-stream.ts`、`src/main/agent/model-client.ts`、`src/main/agent/cli-agent-client.ts`、`src/main/butler/butler-service.ts`、两个测试文件和两份文档；没有 UI/IPC/preload/mock/e2e 改动。

- [ ] **Step 2: 全量验证**

Run: `npm run typecheck && npm test`
Expected: PASS。

- [ ] **Step 3: 记录结果**

在 Phase 1 完成时向协调者报告：commit、测试数量、未接线项（`ButlerService` 接口、IPC/preload、renderer、mock、e2e fake 留给 Phase 2，等 Module 6 合并）。

---

## Self-Review

- **Spec coverage:** Phase 1 覆盖设计中的 CLI 流式解析（claude/codex）、信封 gate、显式失败/回退、butler 事件循环、narration/final text、工具步骤、usage 累加、错误脱敏。未覆盖的 UI/IPC/preload/mock/e2e 是设计明确的 Phase 2。
- **Step scan:** 每个任务有失败测试、实现、通过测试、类型检查、提交；没有 TBD 或“自行处理边界”。
- **Type consistency:** `ModelStreamEvent`、`StreamingModelClient`、`CliStreamRunner`、`ButlerStreamEvent`、`butlerToolLabel`、`stream(input, onEvent)` 的命名在各任务中一致。
- **Review Focus:** 五个高风险点分别在 Task 1 的 malformed/partial/envelope/fallback 测试和 Task 2 的多轮/异常/工具失败测试中覆盖。
- **Proportion:** 计划只固定签名、事件顺序和测试断言；具体解析/循环实现留给执行者。
