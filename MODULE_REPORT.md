# Module 5 — integration-scheduler 报告

**Worker:** codex · **Base:** `feat/personal-butler-data` @ `af5121f`（Modules 1-4 已合并）
**Branch:** `xiaolai/module-5-integration` · **状态:** 完成，未合并、未推送

## Commits

| Hash | Subject |
| --- | --- |
| `fed16c1` | feat(scheduler): add DND-aware triggers and butler planner |
| `7db7c8f` | feat(tray): show today progress and gate notifications |
| `03096b8` | feat(context): wire real workspace, butler and planner services |

## 改动范围

只改以下 Target 文件；未触碰 `src/shared/workspace.ts`、`src/shared/ipc.ts`、renderer 或 `src/main/index.ts`。

```
src/main/scheduler/time.ts            HH:MM / 跨午夜 DND / 通知状态纯函数
src/main/scheduler/scheduler.ts       早间、晚间、Reminder 调度；catch-up-once；去重；失败重试
src/main/scheduler/planner.ts         butler-backed 今日计划 JSON 提示词、解析与校验
src/main/scheduler/app-scheduler.ts   绑定 AppContext 的生产形态 scheduler
src/main/scheduler/index.ts           模块导出
src/main/tray.ts                      tray 进度/下一项/通知门控 + 可注入 controller + Electron 适配器
src/main/context.ts                   真实 workspace/butler 注入、vault/provider/key 变化重建、planner 接线
tests/main/scheduler-*.test.ts        调度器单测（4 个文件）
tests/main/integration-*.test.ts      真实 vault/butler 工厂、vault 切换、tray 集成（2 个文件）
```

## 集成要点

### context.ts

- 初始与运行期都通过真实 `createWorkspaceService(vaultRoot)` 创建 workspace，并把它作为 `workspaceService` 注入 `createButlerService(vaultRoot, { workspaceService, provider, apiKey, now })`。
- `provider` 来自 `SettingsService`；API key 每次构造时从 `SecretStore.getApiKey()` 读取，只存在于主进程内存，不写回 settings、不进入日志。
- `updateSettings` 检测 `vaultPath` 或 `provider` 变化后重建两个服务；`setApiKey` 后重建 butler；`refreshServices()` 提供显式重建。
- 新增 `workspaceServiceFactory` / `butlerServiceFactory` / `modelClient` 测试缝，不改变生产默认行为。
- `generateTodayPlan` 主路径改为 `createTodayPlanPlanner({ butler })`：提示词要求纯 JSON，解析并校验后以 `generatedBy: 'agent'` 落盘。无 key/模型返回非 JSON 时保留确定性模板回退，保证离线 UI 可用。
- 现有 `getTodayPlan` / `updateTask` / settings / IPC 行为保持兼容（Module 2 的 3 个 context 测试仍通过）。

### scheduler

- 早间 `notifications.morning`、晚间 `notifications.evening`、vault 全局 `Reminder` 三类触发。
- 每个触发以 `${date}:${kind}:${id}` 在进程内去重：同一 tick、连续 tick、重复 `start()` 都不会重复通知。
- 机器睡眠/应用晚启动后，第一次达到触发时间的 tick 补发一次；之后不再补发。
- DND 支持跨午夜窗口（`23:00`→`07:30`）；DND 或全局通知关闭时不消费触发，窗口结束后补发一次。
- 通知 sink 抛错不消费触发，后续 tick 可重试一次。
- Reminder 读取失败不阻塞早间/晚间；与早间/晚间同分钟的 reminder 视为重复并被内置 check-in 覆盖（seed vault 正好镜像了这两条）。
- `createContextScheduler(context, …)` 的早间回调只在该日尚无计划时调用 `generateTodayPlan()`，避免重启后覆盖用户计划或重复模型调用。
- `start()` 默认 30 秒轮询，可停止；定时器 `unref()`，不阻止进程退出。

### tray.ts

- `summarizeTodayPlan`：今日完成数/总数/百分比/下一项（优先 `in-progress`，其次 `pending`）。
- tooltip 与 macOS menu-bar title 展示今日进度和下一项。
- 菜单包含打开、今日进度、下一项、生成今日计划、晚间复盘、通知状态（已开启/免打扰中/已关闭）、设置、退出。
- `createTrayController` 注入 tray/menu 适配器，读取失败时 fail-closed 为“通知：已关闭”。
- `createElectronTray` / `createElectronNotificationSink` 懒加载 Electron，Node 测试导入本模块不会触碰 Electron runtime。

## 验收对照

| 要求 | 覆盖 |
| --- | --- |
| 早间/晚间触发 | `scheduler-triggers.test.ts`、`integration-context.test.ts` |
| DND 窗口（含跨午夜） | `scheduler-dnd.test.ts`、`integration-tray.test.ts` |
| 睡眠/错过补一次 | `scheduler-triggers.test.ts`（06:00 → 13:00）、`scheduler-dnd.test.ts`（DND 结束后补发） |
| 无重复通知 | 连续 tick、重复 `start()`、同分钟 reminder 去重测试 |
| Reminder 支持 | `scheduler-reminders.test.ts` |
| 真实 workspace + butler 注入 | `integration-context.test.ts` |
| vaultPath 变化重建 | `integration-context.test.ts`（vault A/B 隔离、未变化不重建、key/provider 变化） |
| tray 进度/下一项/通知门控 | `integration-tray.test.ts` |

## Test output

依赖：worktree 初始没有 `node_modules`，已执行 `npm install`（192 packages，`package-lock.json` 无变化）。

```text
$ npx vitest run tests/main/scheduler-*.test.ts tests/main/integration-*.test.ts
 Test Files  6 passed (6)
      Tests  25 passed (25)

$ npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（通过，无错误）

$ npm test
 Test Files  29 passed (29)
      Tests  173 passed (173)

$ npm run build
out/main/index.js    98.08 kB
out/preload/index.js  2.77 kB
out/renderer/...      884.83 kB
（main / preload / renderer 全部构建成功）
```

原有 147 tests + 本模块 26 tests = 173 tests，全部离线（FakeModelClient / 临时 vault / 注入 tray），无真实通知或网络请求。

## 残留风险 / 后续

1. **生产入口未接线（按 ownership 保留）**：`src/main/index.ts` 不在本模块 Target 内，因此没有在 app ready 后实例化 scheduler/tray。接线方式已准备好：`createContextScheduler({ context, notify: await createElectronNotificationSink() }).start()` 与 `createElectronTray({ getPlan: context.api.getTodayPlan, getSettings: context.settings.get, actions: { onOpen: showWindow, onQuit: app.quit, onGeneratePlan: context.api.generateTodayPlan, onOpenSettings: showSettings } })`。需要 Module 5 之外的入口改动或协调者授权。
2. **去重状态只在进程内**：同一天重启应用后，已达时间的早间/晚间可能再次通知。彻底跨重启去重需要把已投递 key 写入 `AppState`（会改动 state-store 契约/结构）或单独状态文件。
3. **跨日补发语义**：当前只补发“今天”的触发。若应用整夜休眠到次日，昨晚的晚间复盘不会在次日补发；早间计划会正常补发。
4. **真实 provider HTTP 未覆盖**：测试全部注入 FakeModelClient；Anthropic/OpenAI-compatible/Ollama 的实际请求与工具调用格式仍需联网冒烟。
5. **Electron tray/通知未在 CI 执行**：headless 环境只验证构建与纯函数/注入 controller；`createElectronTray` 的动态 `import('electron')`、图标与 `Notification.isSupported()` 需在真实桌面冒烟。
6. **Planner 依赖模型遵守 JSON 格式**：模型返回散文时安全回退到模板计划（`generatedBy: 'template'`），不会把非结构化内容写进 `DailyPlan`。
7. **同分钟 reminder 被内置 check-in 覆盖**：为保证无重复通知，`Reminder.time` 等于 `notifications.morning` 或 `notifications.evening` 时该 reminder 不单独通知；用户可改 reminder 时间。
