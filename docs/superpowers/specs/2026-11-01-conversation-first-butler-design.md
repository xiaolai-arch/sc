# Study Coach 对话优先版设计（2026-11-01）

## 一句话

把六页工作台改成 Claude / Codex 桌面端形态：左栏是对话与项目，中间是和管家的对话，右侧是可折叠项目面板；管家在对话里创建项目、排计划、写记录、设提醒，并会主动发起检查。

## 为什么

现在的产品是 dashboard-first：用户要在管家、今日安排、记录、学习、复盘、设置之间切换，自己组织信息。用户真正想要的是 conversation-first：

- 进入 app 直接新建对话，告诉管家「我想考研」；
- 管家收集信息、创建项目，然后统筹、规划、记录、提醒；
- 用户只需要说「我想做什么」「我做了什么」；
- 管家会主动检查进度。

现有能力已经覆盖了工具循环、流式思考、workspace/vault、任务/笔记/记忆/提醒读取；缺的是：对话持久化、管家创建项目/任务/提醒的工具、主动检查、以及对话优先的壳。

## 已定决策

- **B 布局**：左侧对话/项目列表，中间对话，右侧可折叠项目面板。
- **右侧面板**：计划 / 记录 / 复盘 / 提醒；练习保留一个入口。
- **主动检查选 2**：到点由管家主动发起检查消息/新对话，不只是通知 + 下次追问。
- **直接做完整后端**：不是只做 UI mock。
- **视觉风格**：暖中性色、左导航 + 右工作区、减少卡片和边框、正文 13px 以上；沿用已确认的 mockup。
- **对话优先 onboarding**：第一条对话代替创建表单；管家问「你想让我帮你管理什么」，收集信息后创建项目。
- **设置收进用户菜单**：不再占用主导航。

## Builder calls（可被 reviewer 质疑）

- 对话存本地 `userData/conversations/`，不放进 vault；项目数据继续在 vault。
- **不持久化 reasoning**；只持久化最终文本和工具步骤摘要。实时思考仍然显示；历史对话不保存思维链。
- 检查对话每天一条（「今天的检查 · 11/1」），不按项目分裂；问题覆盖所有活跃项目。
- 面板默认是只读摘要 + 「让管家处理」按钮；笔记详情/练习可以用弹层打开，不在面板里做完整编辑器。
- 设置用弹层复用现有 `SettingsPage`。
- 主动检查使用现有 notifications 的 morning/evening 时间；自定义提醒仍发通知；budget 的 `proactiveSessionsPerDay` 限制主动检查次数。
- 模型上下文只带最近 N 条可见消息（建议 20 条 / 约 12k 字符）；更早的信息靠工具和 memory。
- 应用关闭窗口后继续留在托盘运行；从托盘 Quit 才退出。macOS 已经如此，Windows/Linux 需要改 `window-all-closed` 行为。

## Builder check 决策（2026-11-01）

1. **提醒保持 vault-global，不按项目拆分。** `Reminder` 不增加 `workspaceId`；`reminders.md`、scheduler、`getReminders()` 和 `set_reminder` 工具都保持全局。右侧面板的「提醒」tab 显示全局列表，标题标注「全部提醒」；项目面板的其他 tab 仍是当前项目。
2. **对话的 `workspaceId` 是唯一权威。** 一次对话只能属于一个项目；所有 send 和工具默认使用 `conversation.workspaceId`。renderer 发送时只传 `conversationId`，不再独立传 `workspaceId`。点击左栏的项目会打开该项目的最近对话，或新建一条已关联该项目的对话；不会把当前对话改到另一个项目。项目 pill、右侧面板和对话上下文始终一致。
3. **桌面端首次安装不再自动 seed demo vault。** 新用户从空项目和欢迎对话开始；现有已 seed 的用户保留数据。web 原型的「先看看示例」仍可显式 seed；e2e 用对话创建项目或显式 seed。检查上下文只包含实际存在的项目。
4. **检查去重和预算是耐久的，不依赖内存。** check-in 消息带 `trigger: 'morning' | 'evening' | 'custom'`；当天检查对话里已有同 trigger 的消息就跳过。`proactiveSessionsPerDay` 用当天 check-in 消息数计数。模板回退也计数；模型完全失败、没有产生消息时不计数。不需要新的 state 文件。
5. **移除 morning 的自动 `planFirstEmptyWorkspace`。** 早晨触发只做主动检查；计划由管家在对话里创建（`create_task`，后续可选 `plan_workspace`）。托盘的手动「生成计划」可以保留为显式动作，但不再自动执行。
6. **欢迎消息是 renderer 空状态，不是持久化消息。** 「＋ 新对话」先创建 renderer 里的 draft，不写入存储；第一条用户消息发送时才创建 conversation。`ConversationStore.list` 过滤没有消息的对话。已有项目但没有对话的用户，打开时看到欢迎 draft，不自动生成空对话。
7. **检查通知不泄露具体内容。** 通知标题固定「管家想和你聊聊今天的进度」；body 只用通用摘要（例如「今天还有 2 个任务未完成，点开看看」），不包含任务标题、笔记内容或检查正文。检查消息先生成并持久化，再发通知；点击通知打开对应 check-in 对话。模型失败时用模板检查消息再通知。

## 目标

- 用户进入 app 默认看到对话壳；可以新建对话、查看最近对话、切换项目。
- 第一条对话可以完成「收集信息 → 创建项目」；创建后项目出现在左栏，右侧面板自动打开。
- 对话持久化：刷新/重启后对话列表和消息还在；新对话可以接着历史上下文聊。
- 管家能通过工具创建 workspace、创建任务、写笔记、更新任务、设置提醒、读取计划和记忆。
- 右侧项目面板实时显示当前项目的计划 / 记录 / 复盘 / 提醒；管家写数据后自动刷新。
- 到点主动检查：生成一条管家消息，发系统通知；点击通知打开 app 和对应对话；用户回复后可以继续更新任务/记录。
- 设置弹层、练习弹层继续可用。
- 桌面优先；窄屏至少能聊天和看面板。
- 本地优先、无账号/服务器/遥测；不把对话、reasoning、API key 写到日志。

## 非目标

- 不做云端同步、账号、多设备。
- 不做 IM 通道、多人协作。
- 不做 Books / Mastery / 多 agent 编排。
- 不重写 workspace/vault 数据模型；项目仍然是 workspace。
- 不做完整移动端 App。
- 不做模型自动总结长对话（v1 只做最近 N 条 + 工具补充）；长对话压缩后续再加。
- 不做 reasoning 的长期归档。

## 反目标

- 重新引入六页主导航或全局中间列表。
- 让用户必须自己创建 workspace、自己排任务才能开始。
- 主动检查变成打扰：不尊重 DND/关闭通知/预算，或重复检查。
- 对话丢失、跨对话串消息、或历史上下文污染新对话。
- 把 reasoning、API key、工具原始结果写进持久化文件或日志。
- 项目面板变成一个微型六页应用，什么都要在面板里编辑。
- 改坏现有流式思考、练习、复盘、设置和 vault 行为。

## 用户流程

### 1. 第一次打开

- 显示对话壳：左栏只有「＋ 新对话」和空的「最近对话 / 项目」，中间是管家的欢迎消息：
  「你好，我是你的管家。你想让我帮你管理什么？比如考研、英语、一个项目，或者生活作息。」
- 用户输入「我想考研」。
- 管家追问：目标院校/专业、考试科目、每天可用时间、当前进度。
- 信息够了以后，管家调用 `create_workspace` 创建项目，并在对话里给出项目卡片（名称、目标、科目、下一步）。
- 项目出现在左栏「项目」；右侧面板自动打开；管家继续用 `create_task` 创建第一批任务，或用 `plan_workspace`（如果实现）生成计划。
- 不需要单独的表单页；旧的 `WorkspaceOnboarding` 不再作为入口。

### 2. 新建对话 / 历史对话

- 「＋ 新对话」创建一个未命名对话；第一条用户消息后自动用前 20–24 字命名。
- 左栏「最近对话」按更新时间排序；显示标题、最后一条消息摘要、项目标签、时间。
- 点击历史对话加载消息；滚动到底部；输入框继续该对话。
- 对话可以关联一个 workspace；关联后聊天 header 显示项目 pill，右侧面板显示该项目。
- 点击左栏「项目」会打开该项目最近的一条对话，或新建一条已关联该项目的对话；**不会把当前对话改到另一个项目**，避免写错项目。
- 一个项目可以有多条对话；一条对话在创建项目后关联到新项目。对话的 `workspaceId` 是发送和工具调用的唯一权威。

### 3. 日常使用

- 用户：「今天数学卡在极限」「记一下：晚上 9 点复盘」「帮我把明天排一下」。
- 管家通过工具更新任务/笔记/提醒，并在对话里给出简短结果卡片或文字确认。
- 右侧面板刷新；用户不需要离开对话去页面里操作。
- 用户问「我今天完成得怎么样」时，管家读取计划/记录/复盘并回答。

### 4. 主动检查

- 到达 morning/evening 时间（或用户设置的检查时间），调度器触发检查。
- 检查服务读取今天所有活跃项目的任务、最近记录/复盘、提醒，生成一条管家消息：
  「早上好。今天考研有 3 个任务，英语 1 个；昨晚你提到极限卡住，今天要不要先做 25 分钟极限？」
- 如果模型不可用，使用模板检查消息。
- 持久化为当天「今天的检查 · 11/1」对话；如果当天已有检查对话，追加到同一条。
- 发送系统通知；点击通知打开 app 并选中该对话。
- 用户回复「数学做完了，英语没动」，管家可以 `update_task` / `write_note`，并追问下一步。
- 预算：`proactiveSessionsPerDay` 用完后不再主动发起；DND/通知关闭时不发。
- 应用在托盘运行期间可以检查；完全退出后不检查。窗口关闭后应用继续在托盘运行（macOS 默认；Windows/Linux 调整）。

### 5. 项目面板

- 面板 header：项目名 + 项目切换 + 收起按钮。
- Tabs：计划 / 记录 / 复盘 / 提醒。
- 计划：今天任务、进度、最近完成；每项可「让管家调整」。
- 记录：最近笔记；点击打开笔记详情弹层（复用 NotePane），或「让管家改」。
- 复盘：最近复盘摘要 + 「开始复盘」按钮（打开复盘表单弹层/面板内表单）。
- 提醒：**全局提醒列表**（时间、标签、开关），标题标注「全部提醒」；「让管家设提醒」。
- 面板底部/header 的「练习」入口打开练习弹层（复用 LearningPane）。
- 面板默认只读；写入主要通过对话。

### 6. 设置

- 左栏底部用户菜单 → 设置。
- 设置以弹层/覆盖层打开，复用现有 SettingsPage（模型、预算、通知、启动）。
- 通知的 morning/evening 同时作为主动检查时间；文案可改为「检查时间」。
- 预算的「每日主动会话次数」限制主动检查；「每日 token 上限」继续作为预算提示。
- 关闭设置回到对话，不丢失当前对话状态。

### 7. 练习

- 项目面板的「练习」入口打开练习弹层。
- 复用现有 PracticeList / LearningPane；答题、判分、解析、错题记录不变。
- 用户也可以在对话里说「给我出 3 道极限题」，管家通过工具/文本提供（如果工具支持；否则引导到练习弹层）。

## 布局与视觉

### App shell

- 左栏 208–220px：品牌、`＋ 新对话`、最近对话、项目、底部用户菜单。
- 中间对话区：header（标题、项目 pill、模型状态、面板开关）+ 消息区 + composer。
- 右侧项目面板 280–320px：可折叠；收起后对话占满。
- 背景暖中性 `#f7f6f3`，面板/卡片 `#fff` / `#fbfbfa`，分隔线 `#ece9e4`，主色 `#0071e3`。
- 字号：正文 13–14px；标题 18–22px；元信息 10–12px；导航 12–13px。
- 减少大卡片和边框；列表用分隔线和留白；只给项目卡片/结果卡片用轻卡片。

### 对话

- 欢迎状态：头像 + 一句欢迎 + 3–4 个建议 prompt（「我想考研」「帮我排今天的优先级」「记一下…」）。
- 消息：用户右侧蓝色气泡；管家左侧无气泡或浅底；工具步骤/思考块沿用现有 `ReasoningBlock`。
- 项目创建成功：对话内显示项目卡片（项目名、目标、科目/时间、下一步按钮「打开项目面板」）。
- 计划/记录/提醒写入成功：可以直接用文字确认；重要的创建（项目/计划）用卡片。
- Composer 固定底部；流式期间禁用发送；显示模型状态（模板/真实模型）。

### 项目面板

- Header：项目名、项目切换下拉、收起 `›`。
- Tabs 一行 4 个：计划 / 记录 / 复盘 / 提醒；练习入口放在 header 右侧或 tab 行的末尾。
- 计划：进度条 + 今日任务列表（checkbox、标题、时长、状态）；「让管家调整」小按钮。
- 记录：最近 8–10 条笔记；点击打开弹层；「让管家记一条」。
- 复盘：最近复盘/连续天数 + 「开始复盘」。
- 提醒：时间 + 标签 + 开关；「让管家设提醒」。
- 面板空状态：一句话 + 一个让管家处理的按钮。

### 窄屏

- `< 900px`：左栏变成顶部抽屉/横向列表；面板变成从右侧滑入的抽屉；对话全宽。
- 项目面板默认收起；点击 header 的项目 pill 打开。
- Composer 保持在底部安全区。

## 架构

### 1. 对话存储

新增 `ConversationStore`（main）：

```ts
type ConversationKind = 'chat' | 'check-in';

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: Array<{ id: string; name: string; label: string; status: 'running'|'done'|'failed'; detail?: string }>;
  source?: 'user' | 'butler' | 'check-in';
  /** Present on check-in assistant messages; used for durable dedupe/budget. */
  trigger?: 'morning' | 'evening' | 'custom';
}

interface Conversation {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

interface ConversationSummary {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  updatedAt: string;
  preview: string;
}
```

- 存储：`<userData>/conversations/<id>.json`，0600；`list` 扫描目录读 summary，**过滤没有消息的对话**；写入用原子替换。
- **不持久化 reasoning**；工具步骤只存 label/status/detail（detail 已脱敏）；不存原始工具参数/结果。
- 标题：第一条用户消息截前 20–24 字；检查对话默认「今天的检查 · MM/DD」。
- **`conversation.workspaceId` 是项目归属的唯一权威**；renderer 的发送只带 `conversationId`，main 从对话读取 workspace。
- 切换 vault 时，对话仍属于 app userData（不随 vault 迁移）；项目数据随 vault。
- 旧 `state.json` 的 `onboarded` 可以保留但不再作为入口判断；已有项目但没有对话的用户，打开时显示 renderer 欢迎 draft，不自动创建空对话。
- 「＋ 新对话」在 renderer 里先创建 draft；第一条用户消息发送时才写入 ConversationStore。

### 2. IPC / preload

新增 `ConversationApi`：

```ts
listConversations(): Promise<ConversationSummary[]>;
getConversation(id: string): Promise<Conversation | null>;
createConversation(input?: { workspaceId?: string; title?: string; kind?: ConversationKind }): Promise<Conversation>;
deleteConversation(id: string): Promise<void>;
```

- `SendMessageInput` 增加 `conversationId?: string`；`SendMessageResult` 可返回 `conversationId`。`workspaceId` 变为 legacy/兼容字段：有 conversationId 时以对话的 `workspaceId` 为准；没有 conversationId 时用它创建/绑定一条新对话。
- `createConversation({ workspaceId })` 用于「点项目 → 新对话」的场景；普通「＋ 新对话」不传 workspaceId，由管家创建项目后回填。
- `stream` 仍然用现有 requestId 事件通道；对话的 user/assistant 消息由 main 持久化，renderer 在完成后 reload 当前对话。
- 新增 `study-coach:conversations:changed` 事件：检查/主动更新时通知 renderer 刷新对话列表；payload 包含 `conversationId`。
- preload 暴露 conversations API + 订阅；web mock 实现同一接口。
- 旧 `completeWorkspaceOnboarding`/`needsOnboarding` 从主流程移除或保留为兼容；新的 onboarding 是对话。

### 3. Butler 历史与持久化

- `ButlerServiceImpl` 注入 `ConversationStore`（或通过 context 传入）。
- `send`/`stream`：
  1. 读取 `conversationId`；没有则用 legacy `workspaceId` 创建对话。
  2. **从对话读取 `workspaceId` 作为本次 `gatherContext` 和所有工具的默认 workspace**；renderer 传来的 workspaceId 不再覆盖它。
  3. 把用户消息写入对话（除非是 check-in）。
  4. 构建模型消息：system prompt + 最近 N 条历史（user/assistant text）+ 新用户消息。
  5. 跑现有工具循环。
  6. 把最终 assistant 文本 + 工具步骤写入对话；更新 title/workspaceId/updatedAt。
  7. 返回结果（含 conversationId）。
- 历史窗口：最近 20 条或 ~12k 字符；超出截断，不影响持久化。工具结果不回放；需要时模型再调用工具。
- 对话关联 workspace：`create_workspace` 工具成功后，butler 把当前 conversation 的 `workspaceId` 设为新项目；renderer reload 后选中它并打开面板。
- `checkIn`：新增 `ButlerService.checkIn` 或 `ProactiveCheckInService` 调用同一个模型/提示构建；不写入用户消息，只写 assistant 检查消息。

### 4. 工具扩展

`createButlerTools()` 增加：

- `create_workspace`：name/kind/goal/description → `workspaceService.createWorkspace`；返回 `{ workspaceId, name }`，butler 把当前对话的 `workspaceId` 回填为新项目。
- `create_task`：workspaceId/title/subject/durationMin/acceptance/due? → `workspaceService.createTask`；workspaceId 默认取 `conversation.workspaceId`。
- `set_reminder`：time/label/enabled? → 新的 `WorkspaceService.createReminder` / `updateReminder`；**提醒保持 vault-global，没有 workspaceId**。
- 可选 `plan_workspace`：用现有 `WorkspacePlanner` 生成并落任务；如果注入 planner 成本高，v1 用 `create_task` 由模型自己排。
- 保留 `get_today_plan`、`write_note`、`update_task`、`get_memory`；所有工具的默认 workspace 都来自 `conversation.workspaceId`。
- 工具执行后的事件里带足够信息让 UI 刷新：`tool-result` 的 `name`/`detail`；重要创建（workspace）在对话里显示卡片。
- `WorkspaceService` 增加提醒写入方法（vault `reminders.md` 已有 parser/serializer，补 service 方法即可）。

### 5. 主动检查

新增 `ProactiveCheckInService`（main）：

- 输入：scheduler trigger（morning/evening/custom）、context、butler/model client、conversation store、settings、budget。
- 流程：
  1. 检查通知开关、DND、`proactiveSessionsPerDay`、当天是否已有同 `trigger` 的 check-in 消息。
  2. 收集活跃 workspace 的任务、最近笔记/复盘、提醒、memory。
  3. 找/创建当天 check-in 对话（`kind: 'check-in'`，title `今天的检查 · MM/DD`）。
  4. 构建检查 prompt（system + 上下文 + 「主动检查用户」），调用模型；失败/无 key 用模板。
  5. 持久化带 `trigger` 的 assistant 消息；发送 `conversations:changed` 事件；再发系统通知。
- Scheduler：
  - 复用 morning/evening 触发点；新增 `onCheckIn` 回调，由 check-in service 决定是否通知（scheduler 不再为 morning/evening 直接发固定通知）。
  - **移除 morning 的自动 `planFirstEmptyWorkspace`**；计划由对话里的 `create_task` 产生。托盘手动「生成计划」可保留。
  - 通知 payload 增加 `conversationId`；`createElectronNotificationSink` 支持点击打开窗口并通知 renderer 选中对话。
  - 保留自定义 reminder 通知；不与 morning/evening 重复。
- 预算/去重：
  - 持久化在 check-in 消息的 `trigger` 上：当天已有 `morning` / `evening` 消息就跳过；重启后仍然有效。
  - `proactiveSessionsPerDay` 用当天 check-in 消息数计数；超过后跳过，不发通知。
  - 模板回退产生的消息也计数；模型完全失败、没有产生消息时不计数。
  - DND/通知关闭时跳过；不消耗预算。
- 后台：
  - 窗口关闭后 app 留在托盘（macOS 默认；Windows/Linux 修改 `window-all-closed`，从托盘 Quit 才退出）。
  - 完全退出后不检查；启动时如果错过检查时间，可按现有 scheduler 的 catch-up-once 语义补一次（可选）。
- 安全：检查消息不包含 API key；工具结果不出现在通知里。
- 通知内容：标题固定「管家想和你聊聊今天的进度」；body 只用通用摘要（例如「今天还有 2 个任务未完成，点开看看」），不包含任务标题、笔记内容或检查正文。检查消息先生成并持久化，再发通知。

### 6. UI 状态

- 新 shell 状态：
  - `conversations`, `activeConversationId`, `activeConversation`
  - `workspaces`, `selectedWorkspaceId`（跟随 active conversation 或用户点项目）
  - `panelOpen`, `panelTab: 'plan'|'records'|'review'|'reminders'`
  - `settingsOpen`
- 数据 hook：扩展 `useWorkspaceData` 或新增 `useConversationData`；项目计划/记录/复盘/提醒继续用现有数据/API。
- 对话切换：加载 conversation；如果是空对话，显示欢迎；发送后 reload 当前对话和对话列表。
- 项目创建：main 更新 conversation.workspaceId；renderer reload 后选中新项目、打开面板；对话内显示项目卡片（可由 tool-result + 文本渲染）。
- 检查事件：`conversations:changed` -> reload list；如果当前窗口打开且未在输入，可提示/自动选中（建议只更新列表 + 通知，不强制切换，避免打断）。
- 设置弹层：复用 `SettingsPage`，关闭后 reload settings/model label。
- 练习弹层：复用 `LearningPane`/`PracticeList`，关闭后 reload practice。

### 7. 迁移

- 现有 workspace/vault 数据不变；项目列表来自 `listWorkspaces`。
- **桌面端首次安装不再自动 seed demo vault**；新用户从空项目 + 欢迎 draft 开始。现有已 seed 的用户保留数据。
- web 原型的「先看看示例」仍可显式 seed；e2e 用对话创建项目或显式 seed。
- 现有 `onboarded` 用户：打开时显示欢迎 draft（不自动创建空对话），项目仍出现在左栏。
- 旧 `WorkspaceOnboarding` 表单移除或仅保留给「先看看示例」；web mock 可以保留示例入口。
- 旧六页 nav 删除；`ShellView` 的状态可以移除或只保留 settings/practice 弹层状态。
- 现有 e2e/onboarding 测试改写成对话优先流程。
- 旧 chat 内存消息不迁移（没有持久化历史）；新对话从头开始。

## 组件与文件方向

- 新增 `src/main/conversations/`：store、records、paths。
- 新增 `src/main/check-in/`：proactive check-in service、prompt/template。
- 扩展 `src/main/butler/tools.ts`、`butler-service.ts`、`create-butler-service.ts`。
- 扩展 `src/main/workspace/create-workspace-service.ts`、`src/shared/workspace.ts`：提醒写入。
- 扩展 `src/main/ipc.ts`、`src/preload/index.ts`、`src/shared/ipc.ts`。
- 扩展 `src/main/scheduler/*`、`src/main/tray.ts`、`src/main/index.ts`。
- 新 renderer shell：`ConversationShell`（或重构 `Workspace.tsx`）、`ConversationSidebar`、`ConversationList`、`ProjectPanel`、`ProjectSwitcher`、`SettingsModal`、`PracticeModal`。
- 复用 `ChatPane` / `Composer` / `ReasoningBlock` / `NotePane` / `LearningPane` / `ReviewPane` / `SettingsPage` 的内部组件。
- 更新 `web/mock-api.ts`：conversations、createMock stream 创建项目、检查对话示例、panel 数据。
- 更新 tests/renderer、tests/web、tests/main、e2e。

## 测试与验收

### 单元/集成

- ConversationStore：create/list/get/append/update/delete、原子写、title、workspace link、空对话过滤、损坏文件容错、0600。
- Butler history：历史注入顺序、最近 N 条截断、用户/assistant 持久化、create_workspace 后链接、检查消息不写用户消息、**发送和工具使用 conversation.workspaceId 而不是 renderer 的 workspaceId**。
- Tools：create_workspace、create_task、set_reminder、existing tools、未知工具/失败路径、workspace 上下文、全局提醒没有 workspaceId。
- Workspace reminders：create/update/toggle、vault 序列化、去重、全局读取。
- ProactiveCheckIn：morning/evening、DND/关闭、预算、**重启后仍不重复（trigger 持久化）**、模板回退计数、失败不计数、通用通知文案、conversationId。
- Onboarding/seed：桌面首次安装不自动 seed；已有项目显示欢迎 draft；web「先看看示例」显式 seed。
- Scheduler：新增 check-in trigger 不重复、catch-up、notification click 回调。
- IPC/preload：conversations API、changed event、stream conversationId、错误脱敏。
- UI：新对话、历史切换、项目创建后面板打开、面板四 tab、设置弹层、练习弹层、窄屏。
- Web mock：模拟「我想考研」创建项目、检查对话、conversation list。

### E2E

- 对话优先 onboarding：打开 app → 欢迎消息 → 输入「我想考研」→ fake model 调用 create_workspace/create_task → 左侧出现项目、右侧面板显示计划 → 对话继续。
- 历史对话：新建对话 → 发送 → 刷新/重启 → 对话仍在。
- 检查：用 fake scheduler/触发一次 check-in → 通知/对话出现 → 点击打开 → 回复 → 任务更新。
- 设置/练习弹层仍可打开。
- 保留流式思考块断言（fake codex JSONL）。

### 验收命令

- `npm run typecheck && npm test`
- `npm run build`
- `npm run test:e2e`
- `npm run package`（发布前）
- Web 原型：`npm run dev:web` + ego 浏览器逐页/逐流截图。

## 实施顺序

1. **ConversationStore + conversations IPC/preload + web mock**（先让 web 原型能新建/切换/持久化对话）。
2. **Conversation-first shell**：左栏对话/项目、聊天、空状态、欢迎、设置入口；移除六页 nav。
3. **Butler history + create_workspace/create_task/set_reminder 工具 + workspace link**；项目面板接真实数据。
4. **ProactiveCheckInService + scheduler + notification click + 托盘后台**。
5. **设置/练习弹层、迁移、窄屏、测试/e2e/package**。

每个阶段 `npm run typecheck && npm test`；e2e 在 3/4/5 后跑。

## 留给实现者的决定

- 对话文件是每条一个 JSON 还是单个 JSON；优先每条一个，避免整文件重写。
- 对话历史窗口具体条数/字符数；建议 20 条 / 12k 字符。
- 检查对话是每天一条还是每个触发一条；建议每天一条。
- 面板 tab 的只读程度；建议只读摘要 + 「让管家处理」，笔记/练习用弹层。
- 是否增加 `plan_workspace` 工具；建议 v1 用 `create_task`，planner 作为下一步。
- 托盘在 Windows/Linux 的默认行为；建议保留后台运行，托盘 Quit 退出。
- 通知点击后是否自动切换对话；建议打开 app 并选中 check-in 对话，但不抢当前输入焦点。
- 旧 `onboarded` 字段的迁移/清理方式。

## 验收

- 用户第一次打开可以只靠对话创建项目，不需要表单；桌面首次安装没有 demo 项目。
- 左栏有对话和项目；对话持久化，切换/重启不丢；空对话不出现在历史列表。
- 对话的 workspace 是唯一权威：切换项目不会把当前对话写到另一个项目。
- 右侧项目面板可收起，四个 tab 显示当前项目的计划/记录/复盘，以及全局提醒；管家写数据后自动刷新。
- 管家能创建项目、创建任务、写笔记、设提醒，并在对话里给出清晰结果。
- 到点主动检查会生成对话消息和通知；重启后同一天同一 trigger 不重复；点击通知能打开对应对话；用户回复后管家能更新任务/记录。通知文案不泄露任务/笔记内容。
- 设置/练习仍可用；流式思考块、工具步骤、真实 CLI 流式不回归。
- `npm run typecheck && npm test`、`npm run build`、`npm run test:e2e` 全绿；发布前 `npm run package` 通过。
