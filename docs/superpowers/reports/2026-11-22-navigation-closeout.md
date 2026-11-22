# 导航收尾：统一“项目”命名与底部通知中心（2026-11-22）

**分支：** `xiaolai/iter29-nav`
**依据：** 规范 `docs/superpowers/specs/2026-11-15-personal-assistant-core-redesign.md` §8.3（建议导航）、§8.4；审计 `docs/superpowers/reports/2026-11-21-second-iteration-plan.md` §1.5 两条仍标“部分实现”的条目。
**范围：** 只做命名与一个新增的只读视图；未改数据字段、存储路径或路由，无迁移，未动 `package.json` / `package-lock.json` / `CHANGELOG.md`。

---

## 1. 一个名字：“项目”

全仓（`src/`、`web/`、`tests/`、`e2e/`）现在 `grep -rn "工作区"` 为 **0 命中**。内部标识（`workspaceId`、`Workspace`、`workspaces`、文件名、`mode: 'workspace'`）一律保留，只改用户能看到的字符串。

### 1.1 渲染层（用户可见）

| 文件:行 | 位置 | 改动 |
| --- | --- | --- |
| `src/renderer/shell/NavigationSidebar.tsx:655` | 侧栏项目分组标题 | 工作区 → 项目 |
| `src/renderer/shell/NavigationSidebar.tsx:660` | “全部”按钮的 `aria-label` | 全部工作区 → 全部项目 |
| `src/renderer/shell/NavigationSidebar.tsx:777` | 底部新建按钮 | 新建工作区 → 新建项目 |
| `src/renderer/shell/NavigationSidebar.tsx:471` | 对话行兜底标签 | 工作区 → 项目 |
| `src/renderer/shell/GlobalSearchDialog.tsx:22` | 搜索结果类型标签 | 工作区 → 项目 |
| `src/renderer/shell/GlobalSearchDialog.tsx:189,193,196` | 搜索结果上下文兜底 | 工作区 → 项目 |
| `src/renderer/shell/KnowledgePage.tsx:566,574` | 表单标签、全局选项 | 所属工作区 → 所属项目；所有工作区 → 所有项目 |
| `src/renderer/shell/LearningPane.tsx:204` | 空态 | 这个工作区还没有练习。 → 这个项目还没有练习。 |
| `src/renderer/shell/LongPlanPage.tsx:502` | 项目名兜底 | 工作区 → 项目 |
| `src/renderer/shell/LongPlanPage.tsx:605,754` | 表单错误、空态提示 | …一个工作区 → …一个项目 |
| `src/renderer/shell/LongPlanPage.tsx:1016` | 表单标签 | 工作区 → 项目 |
| `src/renderer/shell/MemoryPage.tsx:39,44,50` | 副标题、筛选 `aria-label`、选项 | 全部/按工作区 → 全部/按项目 |
| `src/renderer/shell/PracticeSetDialog.tsx:85,176` | 内部注释（“全部工作区”）、校验错误 | 全部工作区 → 全部项目；缺少工作区信息 → 缺少项目信息 |
| `src/renderer/shell/ProjectSections.tsx:1113,1219` | 记忆表单错误、`aria-label` | 请选择一个工作区 → 请选择一个项目；新记忆工作区 → 新记忆项目 |
| `src/renderer/shell/ReviewPage.tsx:174,181,187,244,250` | 副标题、筛选、表单标签与选项 | 工作区 → 项目 |
| `src/renderer/shell/ReviewRecords.tsx:47` | 其他项目提示 | 其他工作区 → 其他项目 |
| `src/renderer/shell/SchedulePage.tsx:24,209` | 建议 prompt、空态说明 | 各工作区/工作区里的任务 → 各项目/项目里的任务 |
| `src/renderer/shell/Workspace.tsx:439,1347,1425,1524` | 首页副文案、新建草稿、计划错误、加载失败标题 | 工作区 → 项目 |
| `src/renderer/shell/schedule.ts:72` | 时间表条目标签兜底 | 工作区 → 项目 |
| `src/renderer/shell/demoData.ts:460,461` | 演示数据筛选标签 | 全部工作区 → 全部项目 |
| `src/shared/attachments.ts:55,56` | 对话权限模式与说明（Composer 可见） | 工作区内修改 → 项目内修改；在工作区之上… → 在项目之内… |

### 1.2 模型提示与工具说明（阿咲会说出/会被用户看到）

这些字符串会作为工具说明或上下文进入模型，并可能出现在对话里，因此一并统一：

- `src/main/butler/prompt.ts:134,141,149` — 上下文里的 `工作区：` / `当前工作区：` / `当前工作区 ID：` → `项目…`
- `src/main/butler/template.ts:37,43` — 模板回执
- `src/main/butler/tools.ts:309,320,390,546,574,581,608,621,625,628,642,739,746,777,1089,1307`（16 处）— 工具描述、参数说明、`ToolInputError` 文案（如“当前项目不支持写入提醒。”“请让用户切到「项目内修改」后再试。”）
- `src/main/butler/butler-service.ts:744` — “本地项目服务未连接，无法执行工具。”
- `src/main/agent/cli-agent-client.ts:462,464` — 本机 CLI 原生提示词
- `src/main/planning/prompt.ts:30,53,57,60` — 规划提示词
- `src/main/plans/prompt.ts:90,91,93` — 长期计划提示词
- `src/main/memory/synthesize.ts:96` — 记忆合成来源行
- `src/main/ipc.ts:318-1210`（35 处，集中在 `requireCreateWorkspace` / `requireUpdateWorkspace` / `requireCreateTask` / `requireCreateNote` / `requireCreatePracticeSet` / `requireUpdateMemory` / `requirePlanWorkspace` / `requireCreateLongPlan` / `knowledgeWorkspace` 等校验函数）与 `src/main/knowledge/create-knowledge-service.ts:115` — IPC 参数校验错误（“项目 ID不能为空。”“所属项目无效。”等）
- `src/main/plans/long-plan-service.ts:326`、`src/main/context.ts:1315` — “项目不存在。 / 项目服务尚未初始化。”
- `web/mock-api.ts:428,546,1737,2570,2659,2666` — 浏览器原型回执与错误

### 1.3 测试与 e2e（仅随文案同步，未改断言语义）

`tests/renderer/{composer,mistake-review,navigation,practice-ui,project-editing,project-page,project-preferences,review-backfill,target-countdown,weekly-overview,workspace}.test.tsx`、`tests/main/{butler-conversation,butler-service,ipc-handlers,ipc-memory,ipc-preload,ipc-services,ipc-workspaces,long-plan-service,planning-countdown,planning-workspace-planner}.test.ts`、`tests/web/mock-api.test.ts`，以及 `e2e/{feature-smoke,qa-learning-flows,qa-learning-surfaces,qa-profile-and-strict}.spec.ts` 里引用的旧文案同步为“项目”。

### 1.4 刻意保留的“工作区”

| 位置 | 理由 |
| --- | --- |
| 内部标识：`workspaceId`、`Workspace`、`workspaces`、`WorkspaceService`、`workspaceSnapshots`、文件名 `useWorkspaceData.ts`、权限 `mode: 'workspace'` | 约束要求：不改数据字段/存储路径，无迁移 |
| `tests/main/*` 中“项目 ID不能为空。”等断言的**语义** | 文案已随 `src/main/ipc.ts` 更新，断言跟着改；没有保留旧词 |
| 审计报告、规范文档里的历史描述（`docs/superpowers/**`） | 历史报告记录当时的代码事实，不改写历史；本报告即当前事实 |

> 说明：`Workspace.tsx:1516` 的 “从本地 vault 读取项目、任务和记录。” 在本次改动前就是“项目”，属于审计里提到的“空态已写项目”，与侧栏旧名不一致；现在两处已一致。

---

## 2. 通知中心

### 2.1 位置

- 侧栏底部一行，紧挨“设置”齿轮：`src/renderer/shell/NavigationSidebar.tsx:904-924`（`aria-label="打开通知中心"` 在 908，红点 914），图标为新增的 `BellIcon`（`src/renderer/ui/icons.tsx:187`）。
- 点击打开浮层面板 `src/renderer/shell/NotificationCenter.tsx`（`role="dialog"`、`aria-label="通知中心"`），宽 `max-w-sm`、高 `max-h-[70vh]`，在 1366×768 下不会挤占正文（见 §3）。
- 状态与调用点：`src/renderer/shell/Workspace.tsx:2096-2108`；红点依据 `Workspace.tsx:457-470`（60 秒时钟）；打开入口 `openNotifications`（`Workspace.tsx:1259`）。

### 2.2 数据来源（全部只读，复用现有 store）

| 行类型 | 来源 | 规则 |
| --- | --- | --- |
| 提醒 | `api.getReminders()`（`useWorkspaceData.ts` 已有） | `enabled`、生命周期状态 `pending / fired / postponed / failed`；`done` 不显示；延后时间替换今天的时间；只在重复日显示；过了当天时刻，或“上次投递在更早的一天且未完成”都算待处理（后者标为过期） |
| 承诺 | 新增只读通道 `listPendingCommitments({ byDate })` → `CommitmentService.pending()`（`src/main/commitments/service.ts:203`） | 只取 `status === 'open'` 且 `due <= 今天`；今天到期不标过期，早于今天标过期 |
| 静音 | `settings.notifications.snoozedUntil`（`Workspace.tsx` 已加载） | 仅当 `isMutedOn(snoozedUntil, today)` 时显示 `已静音至 M 月 D 日`（当天到期显示“今天已静音，明天恢复”），点击跳到提醒页恢复 |

选择器是纯函数 `collectNotifications()`（`src/shared/notifications.ts:82`），面板和侧栏红点都用它，因此二者不可能不一致。侧栏红点只在 `items.length > 0` 时绘制（`NavigationSidebar.tsx:914`）；没有计数、没有伪造条目。

### 2.3 每一行都能落到可行动的地方

| 行 | 点击后 |
| --- | --- |
| 提醒 | 打开“提醒”页（开关、延后、标为完成、重启用都在那儿） |
| 承诺 | 落到对话并预填 `关于承诺「…」：`（承诺的 `record/resolve` 是阿咲的对话工具，UI 只读承诺） |
| 静音 | 打开“提醒”页，其“主动检查”卡片可“恢复提醒” |
| 右下角“打开今日” | 今日页 |

关闭方式：右上“关闭”、`Esc`、点击遮罩。面板不写任何数据。

### 2.4 空态

`digest.items.length === 0` 时只显示一行居中文字 **“暂时没有需要处理的事”**（`NotificationCenter.tsx:119-122`），无列表、无红点（`notification-center.test.tsx` 的 “renders an honest empty state” 同时断言列表不存在与红点不存在）。

### 2.5 主进程只读通道（不写入）

- 通道：`IPC_CHANNELS.listPendingCommitments = 'study-coach:commitments:pending'`（`src/main/ipc.ts:181-182`，追加在末尾以保持既有通道位置）
- 校验：`requirePendingCommitments`（`src/main/ipc.ts:797-802`），日期必须是 `YYYY-MM-DD`
- 桥接：handler 在 `src/main/ipc.ts:1468-1469`，preload 在 `src/main/ipc.ts:1990`；契约 `PromiseApi` 在 `src/shared/ipc.ts:192-194`
- 上下文：`context.api.listPendingCommitments` 投影为 `CommitmentSummary`（`summarizeCommitment`，`src/main/commitments/service.ts:31`）；`AppContext.commitments` 只读暴露
- 浏览器原型 `web/mock-api.ts` 同合同实现，状态新增 `commitments: []`，不预置假数据

---

## 3. 窄屏 1366×768

- 浮层是 `fixed inset-0` 的遮罩 + 居中的 `max-w-sm` 面板，`h-screen` 外壳宽度不变；侧栏和聊天列在面板打开前后几何尺寸相同。
- 面板高 `max-h-[70vh]`，768px 高时约 537px，正文区可滚动。
- e2e `e2e/viewport-layout.spec.ts` 新增一步：在两个目标尺寸（1366×768、1440×900）打开通知中心后断言
  - 外壳仍是两列（侧栏 + 正文），正文只有一列；
  - 正文列宽度与打开前一致（`closeTo(..., PX)`）；
  - 面板盒完全落在视口内（宽/高/左/上均不越界）；
  - 文档与 body 仍无横向溢出；
  - `关闭通知中心` 可关闭。
- 该 e2e 需要构建+Electron，本次未执行（见 §4）；jsdom 渲染测试证明结构与文案，几何断言留给 `npm run test:e2e`。

---

## 4. 测试与验证

实际执行的命令与结果（本机 Windows，工作树 `xiaolai/iter29-nav`）：

```text
> npm run typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

> npm run typecheck:e2e
> tsc --noEmit -p e2e/tsconfig.json
（无输出，退出码 0）

> npx vitest run --no-file-parallelism
 Test Files  192 passed (192)
      Tests  1899 passed | 2 skipped (1901)
  Duration  237.55s
```

说明：本机并行跑全套时，vitest 偶尔有 worker 因 `exit code 134/3221226505`（Windows 上的内存耗尽）在 *starting state* 崩溃，崩溃的文件本身并未失败（同一文件单独或串行跑均通过）。串行跑全套（`--no-file-parallelism`）得到上面 192/1899 全绿的结果，本报告以此为准。

新增测试：

- `tests/shared` 等价位置 `tests/renderer/notifications.test.ts`（9 条）——纯选择器：空输入、未到点/已过点、停用/已完成/非重复日、漏投递、延后（未来/过去）、承诺（今天/过期/未来/done）、排序、静音边界、`snoozeLabel`。
- `tests/renderer/notification-center.test.tsx`（4 条，jsdom）——(a) 底栏出现“通知中心”且与“设置”同一行；(b) 无数据时只显示“暂时没有需要处理的事”且无红点；(c) 一条过期提醒 + 一条今日承诺同时列出，点击分别落到提醒页与对话；(d) 静音行文案与“恢复提醒”入口。
- `tests/main/notifications.test.ts`（3 条）——真实 vault：只返回 open 且 `due <= byDate`、空 vault 返回空数组、空日期报错。
- `tests/main/ipc-handlers.test.ts` 新增一条——通道校验：合法日期透传、空/错格式/非对象在 IPC 边界拒绝。
- `tests/main/ipc-preload.test.ts`、`tests/main/ipc-handlers.test.ts` 的通道表与新通道同步（通道集合仍与 `IPC_CHANNELS` 逐项相等）。
- 既有导航测试 `tests/renderer/navigation.test.tsx`（18 条）全部通过；其中“项目列表保持在导航滚动区之外”改为按 DOM 结构定位分组标题，因为演示库里本就有一个名为“项目”的项目（`demoData.ts:90`），按文本会命中两个节点。

刻意未执行：`npm run test:e2e`（需先 `npm run build` 起 Electron；本任务是 UI 结构与文案，e2e 断言已写好并类型检查通过）。建议合并前在 CI 跑一次。

---

## 5. 遗留 / 未做

- 通知中心目前只有“待处理”两类与静音；没有“已读/归档”，也不做计数徽标——审计要求不伪造数量。
- 承诺的“结案”仍只在对话里完成（`record_commitment` / `resolve_commitment`）；本次没有给渲染层加写通道，避免两套事实源。
- 主进程 `ipc.ts` 的 IPC 错误前缀、模型提示词中仍保留英文 `workspace` 作为参数名（`workspaceId`），这是数据字段，属约束范围之外。
