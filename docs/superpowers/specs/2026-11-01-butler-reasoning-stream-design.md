# 管家实时思考流设计（2026-11-01）

## 一句话

在管家对话里，像 ChatGPT 一样实时显示推理过程和工具步骤；先支持本地 CLI 的 **claude** 和 **codex**，答案继续以流式输出。

## 为什么

现在管家对话是一次性返回：用户发出消息后只看到「正在输入…」，等整轮模型 + 工具循环跑完才拿到最后一段文字。中间模型想了什么、调用了哪些工具、为什么这么安排，全部不可见。

这带来两个问题：

- 用户无法判断管家是否理解了当前工作区，尤其当它要读计划、写笔记、改任务时。
- 长回答等待时间长，界面没有过程反馈，体验像卡住。

项目已经有 CLI agent 的结构化工具协议（claude / codex / zcode / opencode），但报告里明确记录「流式输出未实现」。这次补上 claude/codex 的流式思考与文本，其他 provider 保持现状。

## 已定决策

- **只做 local-cli 的 claude / codex**。zcode、opencode、Anthropic/OpenAI-compatible/Ollama 先不做流式，走非流式回退。
- **codex 的 reasoning effort 显式设为 `medium`**（`-c model_reasoning_effort=medium`）。实测不设置时经常没有 reasoning item，设置后稳定出现；medium 在成本和延迟之间取平衡。
- **展示形态是 ChatGPT 式**：思考时展开并实时滚动；答案开始后收成「思考了 N 秒」，点击可展开；工具步骤放进同一个思考块。
- **现有 `send()` 保持不变**。调度器、复盘合成等非交互调用继续走一次性返回，不受流式改造影响。
- **实现顺序**：主进程流式层先在独立 worktree 做；UI/IPC 接线等 v1 的 module 6（ui-wiring）合并后再合，避免和 wave 2 撞车。

## 目标

- 交互式管家对话中，claude 的 thinking 逐 token 显示，codex 的 reasoning 在生成后立即显示（当前 codex 版本是整块到达）。
- 答案文本流式显示；claude 的普通回答逐字出现，codex 的最终消息整块出现。
- 工具调用以步骤条形式显示：读取今日计划、写入笔记、更新任务、读取记忆；失败步骤标红。
- 保留现有工具协议和工具集合，不改变模型看到的工具 schema。
- 浏览器 mock 能演示同样的流式体验，方便无 Electron 环境验收。
- 所有测试不联网；CLI 用注入的 fake runner。

## 非目标

- 不做 zcode / opencode 的流式 JSON 解析。
- 不做 API provider 的流式 reasoning（接口预留，后续可加）。
- 不做对话持久化、多会话、停止生成、重新生成。
- 不做 markdown / 代码块渲染，回答仍是纯文本（与现在一致）。
- 不改变工具协议语义、工具集合或工具权限。
- 不把 reasoning 写入 vault、日志或 telemetry。

## 反目标

- 把原始 fenced JSON 工具信封流给用户看。
- 为了流式改坏 `send()`，或让调度器误走 CLI 流式路径。
- 旧请求的 delta 混进新消息（必须用 requestId 隔离）。
- 流式失败时静默丢消息；必须有文本回退和可见错误提示。
- 在思考块里展示 API key、系统提示词或工具原始结果中的敏感字段。

## 用户看到的体验

1. 用户发送消息后，立即出现一条管家消息占位：
   - 顶部是「正在思考…」的折叠条，默认展开；
   - 下面是灰色思考文本，随模型输出滚动；
   - 工具调用发生时，思考文本下方追加步骤行：`读取今日计划`（转圈）→ `完成`（勾）。
2. 答案开始输出时，思考块自动收起为「思考了 8 秒」，右侧有 chevron；点击可重新展开。
3. 答案逐字出现（claude）或整块出现（codex），和现有消息样式一致。
4. 如果 provider 不支持流式（zcode/opencode/API），只显示「正在思考…」，最后一次性显示答案，不显示思考文本。如果这次确实执行了工具，答案上方显示一个紧凑的「工作过程」步骤块（只有步骤，没有思考文本）；没有工具就不显示块。
5. 模型失败时，显示模板回复 + 一条轻量错误提示，不把堆栈或 key 暴露给用户。

## 架构

### 0. 共享类型

新增 `src/shared/butler-stream.ts`，避免把流式细节塞进 `workspace.ts`：

```ts
export type ButlerToolStep = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
};

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
```

`ButlerService`（`src/shared/workspace.ts`）增加：

```ts
export interface ButlerService {
  send(input: SendMessageInput): Promise<SendMessageResult>;
  stream(input: SendMessageInput, onEvent: ButlerStreamListener): Promise<SendMessageResult>;
}
```

`StudyCoachApi` 自动继承 `stream`。`SendMessageResult` 不变，最终结果仍返回 `text` 和 `usage`；流式事件只用于过程展示。

### 1. 模型层：可选的流式能力

`src/main/agent/model-client.ts`：

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
```

- `ModelClient` 不变，`stream` 是可选能力。
- `CliAgentClient` 实现 `StreamingModelClient`；zcode/opencode 也实现该方法，但内部退回 `complete()`，最后一次性发一个 `text` 事件。
- `AiSdkModelClient` 这次不实现 `stream`；butler 会回退到 `complete()`。

### 2. CLI 流式适配（claude / codex）

`src/main/agent/cli-agent-client.ts` 增加：

```ts
export type CliStreamRunner = (
  command: string,
  args: string[],
  input: string,
  options: { cwd: string; timeoutMs: number },
  onLine: (line: string) => void
) => Promise<CliRunResult>;
```

`CliAgentClientOptions` 增加 `streamRunner?: CliStreamRunner`。默认实现用 `spawn` 读取 stdout，按行回调；超时、退出码、stderr 处理与现有 `defaultRunner` 一致。

#### 2.1 agent 参数

```ts
const AGENT_CONFIG = {
  claude: {
    args: ['-p', '--output-format', 'text'],
    streamArgs: ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'],
    stdin: true
  },
  codex: {
    args: ['exec', '--skip-git-repo-check', '-'],
    streamArgs: ['exec', '--json', '--skip-git-repo-check', '-c', 'model_reasoning_effort=medium', '-'],
    stdin: true
  },
  zcode: { args: ['-p'], stdin: false },
  opencode: { args: ['--prompt'], stdin: false }
};
```

#### 2.2 claude 解析

逐行 `JSON.parse`，忽略解析失败和非流事件：

- `type === 'stream_event'` 且 `event.type === 'content_block_delta'`：
  - `event.delta.type === 'thinking_delta'` → `reasoning` 事件，文本为 `event.delta.thinking`
  - `event.delta.type === 'text_delta'` → `text` 事件，文本为 `event.delta.text`
- `type === 'result'`：记录 `result` 文本、`usage.input_tokens` / `usage.output_tokens`，作为最终回退。
- `system`、`assistant`、`message_*`、`content_block_start/stop`、`thinking_tokens` 忽略。
- 忽略 claude 自己的 `tool_use` block；butler 工具仍走 fenced JSON 信封。

#### 2.3 codex 解析

逐行 `JSON.parse`：

- `type === 'item.completed'`：
  - `item.type === 'reasoning'` → `reasoning` 事件（整块），文本为 `item.text`
  - `item.type === 'agent_message'` → 文本进入信封解析（见 2.4）
  - 其他 item（`command_execution` 等）忽略
- `type === 'turn.completed'`：记录 `usage.input_tokens` / `usage.output_tokens`
- `thread.started`、`turn.started`、未知事件忽略。
- 兼容未来版本的 `item.started` / `item.updated`：如果 `item.type === 'reasoning'` 且带 `text`，同样作为 reasoning 事件发出（增量或快照由实现按文本差量处理；当前版本不会出现）。

#### 2.4 文本信封与工具调用

现有协议：不需要工具时直接输出回答；需要工具时只输出一个 fenced JSON 块：

```json
{"text":"给用户看的说明","toolCalls":[{"name":"get_today_plan","arguments":{}}]}
```

流式下不能把原始 JSON 块展示给用户，因此实现 `EnvelopeTextGate`：

- 收到 text delta 后，直到能判断前缀为止先缓冲：
  - 首个非空白字符不是 `{` 或 `` ` `` → 这是普通回答，立刻 flush 缓冲并转发后续所有 text delta。
  - 首个非空白字符是 `{` 或 `` ` `` → 继续缓冲到流结束。
- 流结束时调用现有 `parseCliResponse`：
  - 解析出信封 → 把 `envelope.text` 作为一个 text 事件发出，`toolCalls` 作为本轮结果；不展示原始块。
  - 解析失败 → 把缓冲原文作为一个 text 事件发出。
- codex 的 `agent_message` 是整块到达，直接调用 `parseCliResponse`，不需要 gate。
- 模型违反协议、在信封前输出散文时：散文已实时显示；解析到信封后，以信封 `text` 作为最终答案替换（butler 的 `done` 事件携带最终文本，渲染层以最终文本为准）。

#### 2.5 回退与错误

- **显式失败事件是终止信号**：codex 的 `error` / `turn.failed` / `item.type === 'error'`，claude 的 `result.is_error === true`，都直接抛错，不再调用 `complete()` 重试。这样不会在模型失败时多花一次调用和超时。
- 如果流式进程还没发出任何 text/reasoning 就非零退出，且不是显式失败事件，调用一次现有 `complete()`，把结果作为单个 text 事件发出；这样旧版 claude、临时 CLI 故障仍能工作。
- 如果进程退出码为 0 但没有任何可用事件（例如 e2e 的 fake codex 只输出纯文本），调用一次 `complete()`；如果仍然为空，抛错。
- 如果已经发出过增量再失败，不重复调用 `complete()`；抛错给 butler，由 butler 走模板回复 + error 事件。
- `zcode` / `opencode` 没有 `streamArgs`：`stream()` 直接 `await complete()`，发出一个 text 事件，返回同一结果。
- **e2e fake 需要同步更新**：`e2e/fixtures/fake-codex.mjs` 要能识别 `--json`，至少输出一个合法的 `item.completed` agent_message；否则 Electron e2e 的管家对话会拿到空回复。更新 fake 属于本次范围。

### 3. Butler 流式循环

`src/main/butler/butler-service.ts` 增加：

```ts
async stream(
  input: SendMessageInput,
  onEvent: ButlerStreamListener
): Promise<SendMessageResult>
```

流程与现有 `send()` 对齐：

1. 空消息 / 无 model client：生成模板回复，发一个 text 事件 + done，返回。
2. `gatherContext`；构造 system/user prompt。
3. 最多 `maxToolSteps` 轮：
   - 如果 `modelClient` 有 `stream`，调用 `stream(request, onModelEvent)`；否则调用 `complete(request)`，把结果作为单个 text 事件发出。
   - reasoning 事件直接转发给 `onEvent`。
   - 本轮有 toolCalls：本轮的文字是工具轮说明（例如「我先记一下」），作为 `narration` 事件发出，不进入最终答案；然后执行工具。
   - 本轮没有 toolCalls：本轮的文字是最终答案，作为 `text` 事件发出，`lastText` 只记录这一段。
   - 累积 usage。
   - 无 toolCalls：发 done（`text = lastText`），返回。
   - 到最大轮数：发 done + 模板回复，返回。
   - 把 assistant 消息和 toolCalls 推入 messages。
   - 对每个 toolCall：
     - 发 `tool-start`（label 来自 `BUTLER_TOOL_LABELS`，未知工具用工具名）。
     - 调用 `runTool`；发 `tool-result`，`ok` 与 `detail` 来自结果。
     - 把 tool 消息推入 messages。
4. 模型异常：
   - 发 `error` 事件（`redactSecrets` 后的消息）。
   - 发 done + 现有 `failureResult` 的模板文本。
   - 返回模板结果。
5. 工具失败：不中断；`tool-result.ok = false`，模型下一轮自行解释。

`send()` 不动；共享的 prompt/context/工具执行逻辑保持不变。可以抽取一个私有 `runToolCall` 供两条路径复用，但不要重写 `send()` 的语义。

### 3.1 敏感信息与展示边界

- reasoning / narration / text 只存在于内存和 IPC，不写日志、vault、settings 或 telemetry。
- error 消息、tool-result 的 detail 在发出前过 `redactSecrets`。
- 成功工具的 detail 只放一句摘要（例如「已写入《标题》」「已更新任务状态」），不放原始 JSON 或完整工具结果。
- reasoning 按模型原文展示，但每个 delta 也过 `redactSecrets`；不做持久化。系统提示词本身不在 reasoning 的展示保证范围内（模型可能转述），但不会主动拼接或展示 prompt。

### 4. IPC / preload

#### 4.1 通道

```ts
export const IPC_CHANNELS = {
  // ...现有通道
  stream: 'study-coach:butler:stream',
  streamEvent: 'study-coach:butler:stream-event'
};
```

- `stream`：`ipcMain.handle`，入参 `{ requestId: string, input: SendMessageInput }`，返回 `SendMessageResult`。
- `streamEvent`：`event.sender.send('study-coach:butler:stream-event', { requestId, event })`。

#### 4.2 主进程 handler

新增 `createButlerStreamHandler(api)`：

```ts
type StreamPayload = { requestId: string; input: SendMessageInput };

return async (event: IpcEventLike, payload: unknown) => {
  const { requestId, input } = requireStreamPayload(payload);
  const sender = event.sender;
  try {
    return await api.stream(input, (streamEvent) => {
      sender.send(IPC_CHANNELS.streamEvent, { requestId, event: streamEvent });
    });
  } catch (error) {
    sender.send(IPC_CHANNELS.streamEvent, {
      requestId,
      event: { type: 'error', message: redactSecrets(describeError(error)) }
    });
    throw error;
  }
};
```

- 只在请求方 `webContents` 上发送事件，不广播。
- 发送前检查 `sender.isDestroyed?.()`；已销毁则忽略。
- 错误继续走现有 sanitize 逻辑（`invokeSafely` / `redactSecrets`）。
- `registerIpcHandlers` 同时注册 `handle` 和这条 stream handler。

#### 4.3 preload bridge

`createStudyCoachBridge(invoke, subscribe?)`：

```ts
type Subscribe = (
  channel: string,
  listener: (payload: unknown) => void
) => () => void;
```

`stream(input, onEvent)`：

1. 生成 `requestId`（`crypto.randomUUID()`）。
2. `subscribe(IPC_CHANNELS.streamEvent, payload => { if (payload.requestId === requestId) onEvent(payload.event); })`，拿到 unsubscribe。
3. `await invoke(IPC_CHANNELS.stream, { requestId, input })`。
4. `finally` 取消订阅；返回值即最终 `SendMessageResult`。

`src/preload/index.ts` 传入 `ipcRenderer.on` / `removeListener` 适配器。没有 `subscribe` 时（旧测试或非 Electron 环境）`stream` 抛错，调用方应使用 `send`。

`StudyCoachApi` 增加 `stream(input, onEvent): Promise<SendMessageResult>`。

`src/main/context.ts` 的 api 对象增加：

```ts
async stream(input, onEvent) {
  return (await getServices()).butler.stream(input, onEvent);
}
```

#### 4.4 通道测试

`tests/main/ipc-preload.test.ts` 的 `IPC_CHANNELS` 快照需要加入两个新通道；bridge 测试增加 `stream` 的订阅、过滤、取消订阅断言。

### 5. 渲染层

#### 5.1 类型

`src/renderer/shell/types.ts`：

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

#### 5.2 useWorkspaceData

增加：

```ts
stream: (input: SendMessageInput, onEvent: ButlerStreamListener) => Promise<SendMessageResult>
```

实现调用 `apiOrThrow().stream(input, onEvent)`，完成后 `reload()`（工具可能写了笔记或改了任务），再返回结果。失败时直接抛给调用方。

#### 5.3 Workspace 状态

`sendMessage(text)`：

1. 追加用户消息。
2. 追加 assistant 占位：`{ id, role: 'assistant', text: '', reasoning: '', steps: [], streaming: true }`。
3. `setTyping(true)`。
4. 调用 `stream(input, event => updateAssistant(event))`。
5. 事件处理（按 `id` 更新对应消息）：
   - `reasoning`：追加 `reasoning`；首次收到时设置 `reasoningStartedAt`。
   - `narration`：工具轮说明，追加到 `reasoning`（前面加一个空行），作为过程文本；不进入最终答案。
   - `text`：追加最终答案 `text`；首次收到时设置 `reasoningEndedAt`（用于时长）。
   - `tool-start`：追加 `steps` 项，状态 `running`。
   - `tool-result`：更新对应 step 的状态和 detail。
   - `error`：设置 `actionError`，不覆盖已有文本。
   - `done`：把 `text` 设为最终文本（只含最后一轮答案，不含 narration），`streaming=false`，`reasoningEndedAt` 若为空则设为当前时间。
6. 正常结束或异常结束都 `setTyping(false)`；异常时如果占位还没有文本，写入「管家暂时没有回应，请稍后再试。」。
7. Composer 以 `disabled={typing}` 传入，流式期间不允许并发发送（requestId 仍保留，防止迟到事件串台）。

注意：`done` 的最终文本优先于增量文本。claude 的信封轮或散文 + 信封场景，最终文本以 `done.text` 为准；普通流式回答两者一致。

#### 5.4 ChatPane / ReasoningBlock

新增 `src/renderer/shell/ReasoningBlock.tsx`：

- 入参：`reasoning?: string`、`steps?: ChatStep[]`、`streaming?: boolean`、`startedAt?`、`endedAt?`。
- 没有 reasoning 也没有 steps：不渲染。
- 只有 steps、没有 reasoning（非流式 provider 执行了工具）：头部显示「工作过程」，不显示时长，默认展开。
- 头部是 button：
  - 流式中且还没有最终答案文本：`正在思考…` + 呼吸点动画；默认展开。
  - 收到最终答案的第一段 `text` 或已结束：`思考了 N 秒`（四舍五入，最少 1 秒）；默认收起。
  - `narration`、`tool-start`、`tool-result` 都不触发收起；工具还在跑时思考块保持展开，除非用户手动收起。
  - 用户手动展开/收起后，本次消息内保持用户选择；新一轮消息重新默认。
- 展开内容：
  - reasoning 文本：`whitespace-pre-wrap`，灰色，`max-h-[240px] overflow-y-auto`，保留换行。
  - 步骤列表：每行一个图标 + label；`running` 显示小转圈，`done` 显示勾，`failed` 显示红色提示；`detail` 可选显示一行小字。
- 使用 `ChevronDownIcon` / `ChevronRightIcon`、`CheckIcon`、`SparklesIcon`，与现有 Apple 风格一致。
- 无障碍：`aria-expanded`、`aria-controls`，思考区 `role="region"`，流式状态 `role="status"`。

`ChatPane` 的 assistant 分支改为：

```tsx
<div>
  <ReasoningBlock ... />
  <p>{message.text}</p>
</div>
```

用户消息不变。

#### 5.5 自动滚动

当前 `useEffect` 每次 messages/typing 变化都滚到底。改成：

- `onScroll` 记录 `isNearBottom`（距底部 < 80px）。
- 新消息、流式增量、typing 变化时，仅当 `isNearBottom` 为 true 才滚到底。
- 用户刚发送消息时强制滚到底一次。
- 不做「回到底部」悬浮按钮，保持范围。

#### 5.6 性能

claude 的 thinking delta 可能上百个。渲染层用一个 requestAnimationFrame 批量合并同一帧内的 reasoning/text 更新，避免每个 delta 一次 React 渲染。若实现复杂，先按 delta 更新；验收标准是无明显卡顿。

### 6. 浏览器 mock

`web/mock-api.ts` 增加 `stream(input, onEvent)`：

- 先根据输入生成固定 reasoning 文本，按 3–6 段用 `setTimeout`（约 30ms）发出 `reasoning` 事件。
- 如果是「记一下 / 记录」消息，发出 `narration`（例如「我先把这条记下来」）→ `tool-start`（`write_note`）→ 执行现有 `createNoteInternal` → `tool-result`。
- 然后发出 `text` 事件（`butlerReply(input.message)`），最后 `done`。
- 使用现有 localStorage 持久化逻辑；`reload` 行为由 `useWorkspaceData.stream` 负责。
- 测试用 fake timers 或 `await` 最终 Promise，避免依赖真实时间。

### 7. 测试

全部不联网，CLI 注入 fake runner。

- `tests/main/cli-agent-client-stream.test.ts`
  - claude：scripted JSONL → reasoning 增量、text 增量、result usage；忽略 system/hook/message 事件。
  - claude：信封文本被 gate 拦截，不泄露原始 JSON；解析出 toolCalls。
  - claude：普通文本前缀立即流式，不等待结束。
  - codex：reasoning item → reasoning 事件；agent_message 信封 → text + toolCalls；turn.completed usage。
  - codex：未知事件忽略；非零退出且无增量时回退 `complete()`。
  - 显式失败事件（codex `turn.failed`/`error`、claude `result.is_error`）直接失败，不调用 `complete()`。
  - 退出码 0 但没有可用事件时回退一次 `complete()`。
  - zcode/opencode：`stream()` 回退为一次 text 事件。
- `tests/main/butler-service-stream.test.ts`
  - FakeStreamingModelClient：两轮（第一轮 toolCall，第二轮文本），断言 reasoning/narration/text 顺序、tool-start/tool-result、usage 累加、done；`done.text` 只含第二轮最终答案，不含第一轮 narration。
  - 无 `stream` 的 FakeModelClient：回退 complete，仍发 text + done。
  - 模型异常：error + done 模板文本。
  - 工具失败：tool-result ok=false，循环继续。
  - 达到 maxToolSteps：done 模板文本。
- `tests/main/ipc-stream.test.ts`
  - handler 校验 requestId/input，事件带同一 requestId，只发给发起方。
  - 异常时发送 sanitized error 并 reject。
- `tests/main/ipc-preload.test.ts` 更新：新通道快照；bridge stream 订阅/过滤/取消订阅。
- `tests/renderer/chat-reasoning.test.tsx`
  - 流式 reasoning 出现并展开；`narration` 和 tool steps 到达时保持展开；最终答案的第一段 text 到达后才收起为「思考了 N 秒」；点击展开。
  - tool steps 的 running → done 状态。
  - 只有 steps、没有 reasoning（非流式 provider 执行了工具）显示「工作过程」；两者都没有时只显示「正在思考…」。
  - 最终 done.text 只包含最后一轮答案，工具轮 narration 不进入答案区。
- `tests/web/mock-api.test.ts` 更新：stream 发出 reasoning + narration + text + done，记笔记仍持久化。
- `e2e`：更新 `e2e/fixtures/fake-codex.mjs` 识别 `--json`，至少输出一个合法的 `item.completed` agent_message；否则 Electron e2e 的管家对话会拿到空回复。
- 现有 `workspace.test.tsx` 的聊天用例仍通过（mock 的 stream 默认有 reasoning，文本断言仍可见）。

### 8. 交付顺序与冲突

- 从当前 `feat/v1-completion` 拉独立 worktree / 分支 `feat/butler-reasoning-stream`。
- 第一阶段：`src/main/agent`、`src/main/butler`、`src/shared/butler-stream.ts`、对应测试。不碰 UI/IPC。
- 第二阶段（v1 module 6 合并后）：`src/shared/workspace.ts`、`src/shared/ipc.ts`、`src/main/ipc.ts`、`src/main/context.ts`、preload、renderer、mock、测试。
- 如果 module 6 还在进行，第二阶段先不合入 `feat/v1-completion`；在 worktree 内完成并 rebase，合并时解决 `ChatPane` / `Workspace` / `ipc.ts` / `mock-api.ts` 的冲突。
- 每个阶段运行 `npm run typecheck && npm test`，各自提交。

## 约束

- TypeScript strict；每阶段 `npm run typecheck && npm test`。
- 不联网；测试用 fake runner / fake stream。
- reasoning 和工具结果只在内存和 IPC 中传递，不写日志、vault、settings 或 telemetry。
- 事件通道只发给发起请求的 `webContents`，requestId 不匹配的事件在 preload 丢弃。
- 现有 `send()` 的行为、返回值和测试保持不变。
- claude 需要较新版本（支持 `--output-format stream-json` 和 `--include-partial-messages`）；旧版走 2.5 的一次性回退。
- codex 需要支持 `exec --json` 的版本；当前安装版本已验证。

## Builder check 决策（2026-11-01）

以下是对独立 reviewer 问题的拍板，均已写回上面的正文：

1. **多轮工具轮的文字**：工具轮的 `text` 作为 `narration` 进入过程区，不进入最终答案；`done.text` 只取最后一轮无工具调用的文字。这样「我先记一下」不会在最终答案出现时消失。
2. **思考块收起时机**：收到最终答案的第一段 `text` 或 `done` 时收起；`narration`、`tool-start`、`tool-result` 不触发收起，工具运行期间保持展开（除非用户手动收起）。
3. **错误与回退**：显式失败事件（codex `turn.failed`/`error`、claude `result.is_error`）是终止信号，不再调用 `complete()`；退出码 0 但无可用事件时回退一次 `complete()`；e2e 的 fake codex 同步更新。
4. **敏感信息**：reasoning 原文展示但每个 delta 过 `redactSecrets`；error 和 tool-result `detail` 脱敏；成功工具的 `detail` 只放一句摘要，不放原始 JSON；所有过程内容不落盘、不写日志。
5. **非流式 provider**：不显示思考文本；如果执行了工具，显示一个只有步骤的「工作过程」块；没有工具就不显示块。

## 留给实现者的决定

- `EnvelopeTextGate` 的具体实现方式（状态机或缓冲字符串），只要满足「不泄露信封、普通文本即时流」。
- reasoning 文本的换行和长文本截断样式（建议保留换行，最大高度 240px）。
- 思考时长的起止口径（建议：首条 reasoning 到首条 text；无 text 时到 done）。
- 是否在 `ReasoningBlock` 里显示工具参数的摘要（建议先不显示，只显示 label 和成功/失败）。
- rAF 批处理的实现细节；如果收益不大，可以按 delta 直接更新。
- 是否为 `stream` 增加 settings 开关（本次不做，默认开启）。

## 验收

- 本地 claude CLI：发一条需要工具的消息，能看到 thinking 逐字出现、工具步骤 running→done、答案逐字出现；思考块在答案开始后收起，点击可展开。
- 本地 codex CLI：同样流程，reasoning 整块出现、答案整块出现；步骤条正确。
- zcode/opencode/API provider：只显示「正在思考…」，最后一次性出答案，无思考块，无报错。
- 浏览器 `npm run dev:web`：mock 能演示 reasoning、工具步骤、最终答案。
- `npm run typecheck && npm test` 全绿。
