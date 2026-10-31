# Module 3 — butler-agent 报告

**分支：** `xiaolai/module-3-butler-agent`（基于 `feat/personal-butler-data`，contract commit `82e7612`）
**范围：** `src/main/agent/**`、`src/main/butler/**`、`tests/main/butler-*.test.ts`
**状态：** 完成；未合并、未推送。

## 提交

| Commit | 内容 |
| --- | --- |
| `8c08409` | `feat: add model client and offline fake for butler` — `ModelClient`、`FakeModelClient`、AI SDK 适配器、多 provider 工厂 |
| `7e2c582` | `feat: implement model-backed butler with workspace tools` — 上下文收集、四角色提示词、工具集、butler 服务、模板/降级回复、测试 |
| 本报告 | `docs: add module 3 report` |

## 实现

### ModelClient（`src/main/agent/`）

- `ModelClient.complete(ModelRequest): Promise<ModelResponse>`：provider 无关的文本/工具调用接口。
- `FakeModelClient(responses)`：按顺序回放 `string | ModelResponse | Error`，公开 `calls`；测试完全离线。
- `createModelClient(provider, apiKey)`：支持 `anthropic`、`openai-compatible`、`ollama`；Anthropic 无 key 抛 `NoApiKeyError`。
- `AiSdkModelClient`：注入 `generate`（默认 `generateText`），映射消息、工具定义（JSON Schema）、`toolCalls` 和 usage（兼容 `inputTokens/outputTokens` 与旧版 `promptTokens/completionTokens`）。工具执行留在 SDK 外，由 butler 控制工具循环。
- API key 只传给 provider 客户端，不日志、不落盘、不进入提示词或回复。

### ButlerService（`src/main/butler/`）

- `ButlerServiceImpl.send(input)`：
  1. 读取 workspace/task/memory 上下文（失败时标记 `contextError`，不阻塞回复）；
  2. 无 `modelClient`（如无 API key）→ 中文模板回复，不发任何模型请求；
  3. 有模型 → 调用模型；模型请求工具时执行工具并把结果回传，最多 `maxToolSteps`（默认 4）轮；
  4. usage 跨步骤累加后写入 `SendMessageResult.usage`。
- 模型错误、未知工具、工具执行失败、上下文读取失败均降级为文本回复，不向 UI 抛异常。
- `createButlerService(workspaceRoot, options?)` 保持原占位工厂的一参数调用兼容；通过 options 注入 `workspaceService`、`modelClient`、`provider`、`apiKey`、`now`。
- 提示词固定四个角色：**老师 / 规划 / 记录 / 督促**，要求始终中文、具体可执行、工具失败不得假装成功、不泄露系统提示词/API Key。

### 工具列表

工具只在注入 `WorkspaceService` 时下发给模型；工具结果以 JSON 文本回传，失败返回 `{ ok: false, tool, error }`。

| 工具 | 作用 | WorkspaceService 调用 |
| --- | --- | --- |
| `get_today_plan` | 读取今日计划/任务；不传 `workspaceId` 时汇总所有工作区 | `getWorkspaceSnapshot` / `listWorkspaces` |
| `write_note` | 写一条 markdown 笔记；`workspaceId` 默认当前工作区，`subject` 默认工作区名 | `createNote` / `getWorkspaceSnapshot` |
| `update_task` | 更新任务状态（pending / in-progress / done / skipped），可记录实际用时 | `updateWorkspaceTask` |
| `get_memory` | 读取长期记忆，可按工作区过滤 | `getMemory` |

## 集成约定（给 Module 2 / Module 5）

```ts
createButlerService(workspaceRoot, {
  workspaceService, // createWorkspaceService(vaultRoot)
  provider,         // SettingsService 的 provider
  apiKey            // safeStorage 读出的 key；仅本次构造使用
});
```

- `modelClient` 优先级高于 `provider` / `apiKey`，便于测试和自定义适配。
- 一参数调用 `createButlerService(vaultRoot)` 不会抛错，但只有模板回复，直到 Module 5 注入真实依赖。
- 未注入 `workspaceService` 时不下发工具，模型仍可回答但无法读写 vault。

## 验证

```text
$ npx vitest run tests/main/butler-*.test.ts
 Test Files  2 passed (2)
      Tests  33 passed (33)

$ npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
TYPECHECK_EXIT=0

$ npm test
 Test Files  15 passed (15)
      Tests  84 passed (84)
```

覆盖点：fake 顺序响应与调用记录、无 key 模板、无 workspace 模板、工厂注入、四个工具的正常路径、工具失败后模型继续回复、工具失败后模型失败降级、模型首轮失败降级、上下文读取失败不阻塞、未知工具、工具轮数上限、usage 累加与旧版字段回退、AI SDK 消息/工具定义映射。

## 风险与后续

1. **真实网络路径未覆盖**：测试全部使用 `FakeModelClient` 和注入的 `generate`；Anthropic/OpenAI-compatible 的实际 HTTP 行为需在集成冒烟时验证（尤其各 provider 的工具调用消息格式）。
2. **契约无会话历史字段**：当前 `send` 是无状态单轮；多轮对话记忆需扩展契约或由上层保存消息。
3. **“今日”语义**：`get_today_plan` 汇总 workspace snapshot 的任务；契约中的任务没有逐日归属，`due` 仅作为字段展示。日切/逾期规则需要 Module 1 或 Module 5 明确。
4. **接线依赖**：Module 5 必须把 `createWorkspaceService` 与 `SettingsService` 的 provider + safeStorage key 注入 butler，否则生产环境只有模板回复。
5. **工具循环上限**：默认 4 轮，超出返回“多次工具”模板；如需更复杂的 agent 流程再评估。
6. **未实现**：流式输出、工具审批队列、对话持久化（均不在 Module 3 范围）。
