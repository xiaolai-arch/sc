# ASAKI 核心改造验收缺口审计（2026-11-21）

**规范：** `docs/superpowers/specs/2026-11-15-personal-assistant-core-redesign.md` 第 10 节
**代码：** `master` @ `e52c0c9`（任务列出的 15 个提交 0206107…e52c0c9 均已在 HEAD 历史中）
**方式：** 逐条阅读验收标准，在 `src/` 与 `tests/` 中找实现和测试；未改动产品代码、`src/` 或 `tests/`。

## 基线（本次实测）

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | 通过，退出码 0（`tsc --noEmit -p tsconfig.node.json` + `tsconfig.web.json`） |
| `npm test` | 通过，退出码 0：161 个测试文件，1313 passed，2 skipped（共 1315），0 failed；Vitest 5.0.5，耗时 32.12s |

没有失败测试，因此没有测试名需要列出。

**状态口径：** DONE = 找到实现，且有测试直接覆盖该行为；PARTIAL = 实现存在但某个子行为没有测试证明，或用户可见部分缺失；MISSING = 未找到实现。

**汇总：** DONE 13 / PARTIAL 5 / MISSING 0（共 18 条）。

---

## P0：可靠对话（4 DONE / 1 PARTIAL / 0 MISSING）

| # | 验收标准 | 状态 | 证据（文件:行 / 测试名） | 最小修复 |
| --- | --- | --- | --- | --- |
| 1 | 同一回复生成中依次打开今日、知识库、设置、另一对话，再返回，回复继续且不串消息 | PARTIAL | 运行由主进程独立持有：`src/main/butler/conversation-runs.ts:116-123`；渲染层用模块级注册表，导航不会清空：`src/renderer/shell/conversation-runs.ts:303-307`、`:543-544`；发送时先登记 run 再发请求且不 await：`src/renderer/shell/Workspace.tsx:696-728`；换页只切 section：`src/renderer/shell/Workspace.tsx:1115-1125`。测试覆盖“今日安排”中途导航：`tests/renderer/navigation-runs.test.tsx:67`；覆盖“新对话/另一对话”：`:98`。**缺：** 测试没有在生成中打开“知识库”和“设置”，也没有两个对话同时生成以证明“不串消息”。 | 扩展 `tests/renderer/navigation-runs.test.tsx`：在同一条 gated 回复中依次点击“知识库”“设置”、切到另一对话再返回，断言未调用 `cancelRun`/`cancelStream`，且答案只落在原对话。S |
| 2 | 点击停止只取消指定运行，保留部分输出和已执行结果 | DONE | 只中止目标 controller 并保留 partialText：`src/main/butler/conversation-runs.ts:295-305`；取消后的 done 保留文本：`:265-268`；中止时持久化部分回复并发出 `canceled: true`：`src/main/butler/butler-service.ts:422-436`；停止只作用于当前对话的 run：`src/renderer/shell/Workspace.tsx:983-990`。测试：`tests/main/conversation-runs.test.ts:70`、`tests/main/butler-conversation.test.ts:342`、`tests/renderer/conversation-runs.test.ts:150`。 | 无 |
| 3 | 关闭再打开应用，不出现永远“运行中”的残留状态 | DONE | 加载持久化文件时把活动 run 标为 `interrupted`：`src/main/butler/conversation-runs.ts:138-179`；渲染层恢复的快照永不当作 live：`src/renderer/shell/conversation-runs.ts:272-283`、`:488-509`。测试：`tests/main/conversation-runs.test.ts:87`、`tests/renderer/conversation-runs.test.ts:196`、`tests/renderer/navigation-runs.test.tsx:125`。 | 无 |
| 4 | 有持续事件的长回复不会被当作无活动超时；进程退出和超时有不同提示 | DONE | 看门狗区分总时长/启动/无活动：`src/main/agent/cli-agent-client.ts:178-240`；每个 stdout/stderr chunk 都 `touch()` 重置空闲计时：`:764-777`；三种提示文案不同（`:202-234`）；进程退出是“退出码”提示：`:1292-1297`。测试：`tests/main/cli-timeouts.test.ts:36`（持续输出不触发无活动超时）、`:19`（启动超时）、`tests/main/cli-agent-client-stream.test.ts:226`（退出码拒绝）。 | 无 |
| 5 | CLI 有真实工具事件时可看到开始和结果；没有推理摘要时不显示虚构内容 | DONE | 原生工具开始/结果事件：`src/main/agent/cli-agent-client.ts:921-950`；只在 CLI 协议真的发送 reasoning 时才转发（`tests/main/cli-agent-client-stream.test.ts:73`、`:126`）；无文本且非流式的思考行不渲染：`src/renderer/shell/TraceFlow.tsx:104`；文本到达前只显示“正在思考…”占位：`:174-181`。测试：`tests/main/cli-agent-client-stream.test.ts:441`、`:529`、`:576`、`:607`、`tests/renderer/trace-flow.test.tsx:229`。 | 无 |

---

## P1：本机 CLI 设置（3 DONE / 2 PARTIAL / 0 MISSING）

| # | 验收标准 | 状态 | 证据（文件:行 / 测试名） | 最小修复 |
| --- | --- | --- | --- | --- |
| 1 | 本机 Codex 配置引用的目录可以显示模型名；支持重新扫描 | PARTIAL | 读取 `model_catalog_json` 并解析模型名：`src/main/agent/cli-model-config.ts:163-205`；测试：`tests/main/cli-model-config.test.ts:19`（断言 `GPT-6.1 Mini` 与来源文件）、`tests/main/local-cli-discovery.test.ts:108`（扫描结果附带 catalog）。重新扫描按钮与强制刷新已实现：`src/renderer/settings/SettingsPage.tsx:243-245`、`:839`；`src/renderer/local-cli-models.ts:68-100`。**缺：** 没有任何测试点击“重新扫描”并断言第二次扫描结果被采用（`load(true)` 的刷新路径未被覆盖）。 | 在 `tests/renderer/settings-models.test.tsx` 用变化的 `scanLocalClis` mock，点击“重新扫描”，断言列表/模型选项更新。S |
| 2 | Claude 别名与自定义映射可以显示，默认继承不被 ASAKI 覆盖 | DONE | 读取 `settings.json` 的 `model`、`ANTHROPIC_MODEL`、三个别名映射：`src/main/agent/cli-model-config.ts:251-312`；测试：`tests/main/cli-model-config.test.ts:71`。继承时不写 `provider.model`：`src/renderer/settings/SettingsPage.tsx:768-800`；测试：`tests/renderer/settings-models.test.tsx:99`；切换 agent 清除旧 model 覆盖：`:173`。 | 无 |
| 3 | 配置损坏或列表为空仍可选择 CLI 默认；不伪称“没有模型” | DONE | 目录损坏/为空只产生 warning 并保留 config 默认：`src/main/agent/cli-model-config.ts:180-205`、`:397-401`；测试：`tests/main/cli-model-config.test.ts:57`、`:162`。UI 始终提供“继承 CLI 默认”并展示 warning：`src/renderer/settings/SettingsPage.tsx:800-807`；测试：`tests/renderer/settings-models.test.tsx:144`。 | 无 |
| 4 | 切换 CLI 不重置旧会话的历史和已有运行配置 | PARTIAL | 会话存在 `userData/conversations`，与 provider 无关：`src/main/context.ts:237`；每会话 model/permissions 单独持久化：`src/main/conversations/conversation-store.ts:354-382`；测试：`tests/main/conversation-store.test.ts:184`、`:205`。provider 变化只重建 service：`src/main/context.ts:499-509`；测试：`tests/main/integration-context.test.ts:119`。**缺：** 没有测试在已有会话（含消息、`model`、`permissions`）时把 `provider.agent` 从 codex 切到 claude，并断言历史与配置不变。 | 在 `tests/main/integration-context.test.ts` 增加：建会话+消息+model+permissions → `updateSettings({ provider: local-cli claude })` → 重新读取会话，断言完全不变。S |
| 5 | 页面不需要填 API Key、命令和型号才能完成最常见配置 | DONE | 默认 provider 就是本机 codex、命令预填：`src/main/settings/defaults.ts:5-7`；本机 CLI 模式不显示 API Key：`tests/renderer/settings.test.tsx:211`；模型默认“继承 CLI 默认”、不写 `model`：`tests/renderer/settings-models.test.tsx:99`；命令有默认值且扫描可自动填入：`src/renderer/settings/SettingsPage.tsx:1002`；扫描“使用 Claude Code”后自动填入 `claude`：`tests/renderer/settings.test.tsx:325`、`:388`。 | 无 |

---

## P2：个人映射与目标闭环（4 DONE / 1 PARTIAL / 0 MISSING）

| # | 验收标准 | 状态 | 证据（文件:行 / 测试名） | 最小修复 |
| --- | --- | --- | --- | --- |
| 1 | 用户更新每天可用时间后，下次规划参考新值并展示来源 | PARTIAL | 新值优先级（input → workspace → default）：`src/main/planning/workspace-planner.ts:49-62`；prompt 写出分钟数和来源：`src/main/planning/prompt.ts:35-40`、来源标签 `:84-85`；结果携带 `availableMinutesSource`：`src/shared/planning.ts:27-29`。测试：`tests/main/plan-closure.test.ts:44`（60→45 分钟后 prompt 只含 45 分钟，并断言 source=`workspace`）。**缺：** `src/renderer` 中没有任何地方渲染 `availableMinutesSource`（全目录 grep 只在 `src/main`、`src/shared` 命中）；“展示来源”只存在于给模型的 prompt 和 `plan_workspace` 结构化工具结果（`src/main/butler/tools.ts:325-331`），最终是否展示取决于模型措辞。 | 在用户可见的规划路径（今日安排头部或 `plan_workspace` 工具行）确定性显示“来自项目设置的每天可用时间”，并加渲染测试。S |
| 2 | 重复加入同一计划条目不创建重复任务 | DONE | 按 `planId + planItemId + title` 在整工作区查重并复用已有任务：`src/main/workspace/create-workspace-service.ts:443-462`；测试：`tests/main/plan-closure.test.ts:70`（第二次 createTask 返回同一 id，快照中只有 1 条）。 | 无 |
| 3 | 今日完成状态能反映到长期目标进度 | DONE | 任务更新后同步 `longPlans.setItemDone`（含撤销）：`src/main/context.ts:739-751`；测试：`tests/main/plan-closure.test.ts:97`（done→true，pending→false）。 | 无 |
| 4 | 模型不可用时，已设置的时间提醒仍正常工作 | DONE | Scheduler 只依赖 `getReminders`/`notify`，不依赖 model client：`src/main/scheduler/scheduler.ts:50-55`、`:215`、`:263-281`；测试：`tests/main/scheduler-reminders.test.ts:245`（无模型配置仍投递）。 | 无 |
| 5 | 个人事实可纠错、过期和删除，不把模型猜测永久当作事实 | DONE | 模型来源默认 `candidate`：`src/main/memory/profile-service.ts:82-142`；编辑后提升为 `user/confirmed` 且合并重复：`:144-201`；过期/恢复/删除：`:204-213`。测试：`tests/main/profile-service.test.ts:44`（猜测保持 candidate）、`:62`（编辑提升且只留一份）、`:74`（过期/恢复/删除）、`:90`（拒绝覆盖手改文件）。 | 无 |

---

## P3：导航与首页（2 DONE / 1 PARTIAL / 0 MISSING）

| # | 验收标准 | 状态 | 证据（文件:行 / 测试名） | 最小修复 |
| --- | --- | --- | --- | --- |
| 1 | 打开应用就能判断下一步要做什么，以及最近有什么提醒 | DONE | 首页“接下来/最近提醒/目标进度”三块：`src/renderer/shell/TodayOverview.tsx:75-179`；测试：`tests/renderer/today-overview.test.tsx:20`（三个 region、可勾选任务、目标进度文案）；`:58`（今日页同样呈现）。 | 无 |
| 2 | 1440×900 和 1366×768 下正文不被侧栏挤压；窄屏不强行并排三栏 | PARTIAL | 单列布局，正文区 `min-w-0`：`src/renderer/shell/Workspace.tsx:1445-1453`；页面正文上限 980px：`src/renderer/shell/PageFrame.tsx:55`；侧栏默认 280、范围 264–420：`src/renderer/shell/NavigationSidebar.tsx:154-158`、`:775-783`；桌面单列测试在 1024 宽度：`tests/renderer/mobile-drawers.test.tsx:104`（只有一个 complementary，无右侧面板）。**缺：** 没有 1366×768 或 1440×900 的渲染验证；“不被挤压”在 jsdom 中无法计算真实布局，这两个尺寸 **not verified**。 | 加 Playwright 视口检查（两个尺寸下无横向溢出、单侧栏+正文、无三栏），或在 jsdom 做这两个宽度的类名断言；仅当失败才改布局。M |
| 3 | 原有项目、笔记、计划、复盘和提醒均有入口 | DONE | 导航分组含 今日/日常/知识库/我的资料/今日安排/长期计划/复盘/记忆/提醒：`src/renderer/shell/NavigationSidebar.tsx:91-115`；项目/工作区列表：`:636-700`；笔记在项目记录区（`tests/renderer/project-page.test.tsx:164`）和知识库笔记面板（`tests/renderer/knowledge-note-pane.test.tsx:82`）。测试：`tests/renderer/today-overview.test.tsx:36`（所有旧页面入口都在）、`tests/renderer/navigation.test.tsx:153`（项目入口）、`:230`（记忆页筛选）。 | 无 |

---

## Recommended next slice

1. **P0 navigation-continuity regression (S)** — extend `tests/renderer/navigation-runs.test.tsx` so one gated answer survives opening 今日 / 知识库 / 设置 / 另一对话 and back, asserts no `cancelRun`/`cancelStream`, and asserts text never crosses conversations. Files: `tests/renderer/navigation-runs.test.tsx` (test only).
2. **P1 CLI-switch continuity and rescan tests (S)** — add a test that changes `provider.agent` from codex to claude while a conversation with messages, `model` and `permissions` exists and re-reads it unchanged; add a second-scan test for “重新扫描”. Files: `tests/main/integration-context.test.ts`, `tests/renderer/settings-models.test.tsx` (test only unless the test exposes a reset).
3. **P2 deterministic availability-source display (S)** — surface `WorkspacePlan.availableMinutesSource` in a user-visible plan surface (today/schedule header or the `plan_workspace` tool row) instead of relying on model prose, with a renderer or main test. Files: `src/main/butler/tools.ts`, `src/renderer/shell/SchedulePage.tsx` (or `TodayOverview.tsx`), plus its test.
4. **P3 exact-viewport verification at 1366×768 and 1440×900 (M)** — add an e2e viewport check for no horizontal overflow, one sidebar plus content column, and no three-column grid; fix layout only if it fails. Files: `e2e/` (new or existing spec), possibly `src/renderer/shell/PageFrame.tsx` or `src/renderer/shell/NavigationSidebar.tsx`.
