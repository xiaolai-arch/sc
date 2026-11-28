# ASAKI Agent Runtime 方案 v2（增量稿）——补齐 spec 六处「待确认」

> 状态：**v0.4 整份获 sc-review「可合并」**（含第七节）；v0.5 仅折入其两条非阻断措辞注记（§7.1/#444 平台细节锚 issue 原文、§7.2 订正对象改为首版 `b4fd3ec`），判断与行号未动 ｜ 分支 `xiaolai/agent-runtime-v2` ｜ 基线 master `ebfd0fd`（2026-11-28，1.3.0 已发）
> 作者：sc-spec ｜ 性质：**增量稿**——只补 v1 未定处，不复述 v1 已定内容，**不动 spec 正文**（`docs/superpowers/specs/2026-11-27-agent-runtime.md`，分支 `xiaolai/agent-runtime-spec` @ `50206b8`）。评审通过、主人拍板后由 sc-spec 折回 spec，逐条替换「spec 填充」标记。
> 修订：v0.3 折入 sc-review 判决的四处行号修正与两条建议；v0.4 折入 sc-lead 2026-11-28 转来的引擎横向选型复核结论（新增第七节：Claude Agent SDK #444 取消段错误作为适配器边界实证；升级复验措辞订正为「打包产物里的 fetch 行为」），三件主人定决策所在章节未动（顺延为第九节）；v0.5 折入 sc-review 对第七节的两条非阻断措辞注记（§7.2 订正对象写明首版 `b4fd3ec`；§7.1 平台细节折回 spec 时锚 issue 原文不锚报告）。
> 输入：方案 v1（`2026-11-27-agent-runtime-plan-v1.md`）、现行 spec、P0–P3 已合入实态（`src/main/runtime/` 13 文件 2430 行）、P3 装配交付报告、P4 在飞（批次 5/5，交付报告未出——本文所有行号按 master `ebfd0fd` 复核；P4 合入后行号重核，预期只有 `tools.ts`/`prompt.ts` 偏移）。
> 阅读方式：每条 = 现状（file:line）→ 建议值（builder 可照做的条款）→ 是否需要主人拍板。第 1 条最关键。

---

## 一、ContextBuilder 的数据边界（spec :165「待 v2 补隐私条款」）

### 现状（全部实测）

1. **ContextBuilder 不存在**：全仓唯一出现是 `pi-engine.ts:93` 的注释（「那是 ContextBuilder 的事」）。PiEngine 只收一个 `systemPrompt` 字符串选项（`pi-engine.ts:94`），没有数据选择层；pi-selftest 传的是静态一行（`pi-selftest.ts:129`）。
2. **Legacy 路径的既有数据面**（这就是 Runtime 要继承/收紧的事实基线）：
   - `gatherContext`（`butler/context.ts:86-99`）：带 workspaceId 时 tasks/memory 按项目快照圈定（`context.ts:136-149`）、knowledge 按项目（`:95`）；profile 全局（`:96` + `:117-124`）；**commitments 全局**（`:97` + `:105-113` → `listSummaries()` 不带任何过滤，`commitments/service.ts:150-163` 读全库 open 条目）。
   - 不带 workspaceId 的会话：加载**全部项目**的 tasks 与 memory 并展平（`context.ts:152-180`）。
   - 提示词各段有帽：任务 ≤10 条（`prompt.ts:54,161`）、记忆 ≤8（`:55,207`）、承诺 ≤3 条每条 ≤120 字（`:57-58,185-186`）、档案 ≤6（`references.ts:10`）、检索 ≤10 条/单条 ≤200 字/总 ≤1200 字（`prompt.ts:64-71,90-109`）、知识 ≤15 主题/笔记 ≤8 条每条 ≤240 字（`context.ts:40-42`）；附件文本单文件 ≤20_000、全轮 ≤80_000（`attachments.ts:10,12`）。
3. **与「只发当前任务需要的片段」（草稿回收 `plan-v1.md:321`）的实测差距**：
   - **承诺跨项目出机**：`selectCommitments` 无项目过滤——未结案承诺原文（≤3 条）无论运行圈定哪个项目都会进提示词（`context.ts:105-113` → `prompt.ts:182-191`）。承诺记录虽有可选 workspaceId（`service.ts:46`），选择时不用它。
   - **无项目会话全量出机**：不选项目时全项目 tasks+memory 展平进提示词（`context.ts:152-180`），只受条数帽约束。
   - 这两条是 Legacy 的现状行为，不是 Runtime 引入的；但 v2 的隐私条款必须对它们表态。
4. **模型可见面不止首条提示词**：查询级工具的返回值会原文回到模型（`pi-engine.ts:202-206` 把 `outcome.result` JSON 化塞回消息；Legacy 循环同样回填）——数据边界必须约束工具回执，否则「只发片段」只守住了入口。工具清单 schema（21 个，`butler-bridge.ts:20-46`）也发模型（无用户数据）。
5. **出机判定现状 = 无**：provider 四族 anthropic / openai-compatible / ollama / local-cli（`shared/types.ts:37-55`）。anthropic 与 openai-compatible 走远端 API（baseURL 任意主机），ollama 默认 `127.0.0.1`（`model-client.ts:188-190`）；local-cli 在本机起 CLI 子进程，**但 `nativeTools: true` 时允许 CLI 自行在 vault 读写、搜索、甚至上网（`types.ts:49-54`）——这条通道天然绕过任何 ContextBuilder**。代码里没有任何「这条数据出了机」的判定或提示。

### 建议值（builder 可照做）

1. **出口三清单**：新增 `src/main/runtime/context-builder.ts`，作为唯一允许构造 Pi 出站载荷的模块（PiEngine 构造注入，替代 pi-selftest 的静态字符串）。出站载荷只允许四类：①系统提示词（固定模板 + 本次任务片段）②用户输入原文 ③附件正文（沿用 20k/80k 现帽）④工具回执。除四类之外，任何字符串不得进入 streamFn 调用。
2. **任务片段圈定**：以 `RunRequest.workspaceIds` 为唯一圈定依据——tasks/memory/knowledge 只取 workspaceIds 内项目；无 workspaceIds 的运行沿用「全项目展平 + 条数帽」现状，但落成明文条款而非隐式行为。
3. **承诺跨项目条款（需主人定）**：建议 = open 承诺仅当 `workspaceId ∈ workspaceIds` 或承诺本身无 workspaceId（全局承诺）时出机；跨项目承诺不出机。Legacy 不经 ContextBuilder（走自己的 `gatherContext`），本条只约束 Runtime 路径、不回改 Legacy——代价是对照期两引擎数据面不同，对拍测试按各自口径断言。
4. **工具回执不额外放量**：查询级工具返回值维持 schema 既有形状（现状已是摘要形，如 `plan_preview` 返回任务清单、`get_today_plan` 返回当日计划）；跨项目只读工具（P4 场景三的周复盘）只读摘要字段不回原文全文，字段帽随 P4 细化，不阻塞本条。
5. **本地/云端同一份数据边界，不按 provider 分叉（技术结论，已定）**：不分叉。理由：(a) 分叉 = 两套上下文两套测试，对照期成本翻倍；(b) 按 provider.kind 判定「本地」不可靠——openai-compatible 可指向本机代理、local-cli+nativeTools 本来就绕过边界；(c) 数据边界的意义是「用户可预期模型看到什么」，可预期性不应随切换模型漂移。**配套文案归主人**（是否加、措辞，见第九节决策 2）：远端 provider 一句、`local-cli`+`nativeTools` 一句。第二句不加，片段条款就是假的——技术侧必须让主人知道这一点，但加不加是产品取舍。
6. **可测条款（验收草案）**：
   - D1 出站审计：脚本模型捕获 streamFn 实参，断言其全部文本只含①-④类；负例——`ContextBuilder` 之外无模块能拿到 workspace 服务（类型层：显式注入窄门面，不传全量 `WorkspaceService`）。
   - D2 圈定断言：临时 vault 建项目 A/B 各写一条 memory 与任务，运行 `workspaceIds=[A]`：出站载荷不含 B 的 memory 原文、任务标题、承诺原文（按第 3 条裁定后口径）。
   - D3 帽断言：造 20 任务/50 记忆/10 承诺的项目，出站载荷任务 ≤10、记忆 ≤8、承诺 ≤3 条每条 ≤120 字（数字直接引用 `prompt.ts` 现有常量，复用不另立一套）。
   - D4 密钥与路径断言：出站载荷不含 API key、不含 vault 绝对路径。
   - D5 工具回执帽：查询级单次返回 ≤8KB，超限截断并注明（现状最大的是 plan_preview 全清单，8KB 够）。
   - D6 nativeTools 文案断言：设置页当且仅当 `local-cli && nativeTools` 渲染第二句文案。

**是否需要主人拍板**：第 3 条（跨项目承诺出机与否）、第 5 条的配套文案（两句加不加与措辞）→ 进「需主人定」（各自独立，不捆包）。其余（出口清单、圈定、同界不分叉、帽子、审计）按技术判断定，不问主人。

---

## 二、RunJournal 落盘形态定稿（spec :68「持久化形态为 spec 填充」）

### 现状（已实现；实现与 spec 草案一致，规范缺的只是成文）

1. 目录 `<userData>/data/runtime-runs/`、一 run 一 `.jsonl`（`run-journal.ts:20-25,50-52`）；文件名净化 + 不安全字符以 sha256 前 12 位消歧（`:32-37`）。append-only；seq 单调守卫，倒退抛错（`:55-63`）；撕尾容忍——末行 JSON 不完整即弃且其后内容视为不可信（`:69-91`，`torn tail` `:86`）。
2. 崩溃恢复 `recover()`（`:98-123`）：末行非 `run.finished` → 追加 `run.interrupted`（消息沿用 `RUN_INTERRUPTED_MESSAGE`，`conversation-runs.ts:13`）。生产未接线（调用方只有测试与 selftest），P4 生产接线后应在启动时跑。
3. 事件字段 = `RunEventPayload` 联合（`contracts.ts:83-107`）+ `runId`/`seq`/`at`（`:137`）；`userInput` 不进事件（`:46,56` 注释）。**事件含业务数据**：`approval.requested.params` 是完整工具参数（`:92-97`）——改期的承诺原文、任务标题都会落 journal。journal 因此不是零业务数据，只是「不是第二份数据库」。
4. **保留期/清理：不存在**（全文件无清理逻辑）。对照先例 `ConversationRunStore` 也只裁 steps 不删运行（`conversation-runs.ts:10,247`）。
5. **发现一处实现缺口（sc-lead 2026-11-28 裁定：本批 P4 带上修）**：`recover()` 不幂等——`:110-111` 判据只认 `run.finished`，`run.interrupted` 结尾的文件每次启动都会再追加一条 marker（测试只断言了一次恢复，`contracts.test.ts:363-385`）。修的时机不是「下一批有空」：崩溃恢复是 RunJournal 存在的理由，一个每次启动都追加重复 marker 的日志正好毁掉它自己的用途——P4 正在生产接线，恢复语义届时就活了，必须带着修。

### 建议值（规范条款）

1. **形态定稿**：上述现状全部升格为规范（目录、一 run 一文件、append-only、seq 守卫、撕尾容忍、净化文件名）；唯一合法的「改写」是 recover() 追加 marker。不上 state-store、不上 SQLite（spec 默认决定 2 维持）。
2. **字段规范**：文件内事件集合 = RunEvent 联合 + runId/seq/at；新增字段必须先进 `contracts.ts` 联合再落盘；userInput 与密钥永不落盘（注释升格为验收——全目录扫描断言，见 R5）。
3. **保留期：30 天或目录内 200 个文件，先到先清**（建议值，主人可改常量）。理由：journal 回答「Agent 做过什么」（方案 §二），是诊断数据不是业务事实；事件含承诺/任务原文（approval.params），无界留存违背最小留存；30 天覆盖「上月排查」。
4. **清理时机**：启动时 recover() 之后同一遍扫描内清理（`RunJournal.pruneOld()`，装配层在 recover 后调用）；运行中不清理（避开与 append 的竞态）。清理判据 = 末行为终态（`run.finished`/`run.interrupted`）且（首行 `at` 早于保留期 或 文件数超限删最旧）。未终态文件永不清（recover 先行保证都已带 marker）。
5. **崩溃恢复判据（规范原文）**：启动扫描每个 `.jsonl`；末行 `type ∈ {run.finished, run.interrupted}` → 无事；否则追加 `run.interrupted`（seq = 末行 seq+1）。**恢复幂等**（本 v2 明确；实现缺口本批 P4 修，见现状 5）。恢复不续跑任务——v1 无恢复执行语义，这是有意的：无法证明中断前模型想做什么，续跑等于放它绕过审批。
6. **journal 不回灌业务**：读取方只允许 `RunController.subscribe`（断线补读）与诊断；查询/晨检/复盘只读领域服务不读 journal（方案 §二「运行日志回答 Agent 做过什么，不回答用户现在有哪些任务」落成禁令）。
7. **可测条款**：R1 recover 幂等（二次 recover 返回空）；R2 撕尾容忍（已有）；R3 seq 倒退拒绝（已有 `contracts.test.ts:464`）；R4 保留期清理（31 天前文件与超限最旧文件消失、未终态文件保留）；R5 userInput/密钥零落盘（全目录扫描断言不含 userInput 子串与 `sk-` 形串）；R6 append 失败不阻断事件扇出且显式暴露——**P4 派单原文确含此条**（「journal.append 扇出修（append 失败仍扇出 + 显式暴露错误，e531 备忘）」，sc-lead 派单 `msg_7251a549ff5c`），非我方推断，验收落这条。

**是否需要主人拍板**：不需要。保留期数字是参数，主人有异议改常量即可，不阻塞。

---

## 三、commit_plan 幂等键：延后条件与强制触发

### 现状

1. 网关去重是**单运行、进程内**的：dedupKey = runId+工具名+canonical 参数+workspace 范围（`tool-gateway.ts:100-107`），finalize 时 `purgeRun`（`run-controller.ts:345`）。跨运行、跨重启零防护。
2. 领域层已有「同计划项不重复建任务」机制：`createTask` 带 `planId+planItemId` 时按 (planId, planItemId, title) 全项目查重、命中即返回已有任务（`create-workspace-service.ts:519-531`，注释自证「button pressed again」场景）。长计划任务在用（`:485`）。**但 `commit_plan` 不传 planId/planItemId**（`plan-tools.ts:174-187` 只传 workspaceId/title/subject/durationMin/acceptance/due）——领域防线对它不生效。
3. 已裁延后（P4 交接单：「本批只在报告给一句评估结论」）。本节就是那个结论。

### 建议值

1. **缺口单列（本节最重要的一条）**：领域层「同计划项不重复建任务」防线对 `commit_plan` 不生效——`createTask` 只有带 `planId+planItemId` 才触发查重（`create-workspace-service.ts:521` 判据 `record.planId !== undefined && record.planItemId !== undefined`），而 `commit_plan` 不传这两个字段（`plan-tools.ts:174-187`），防线从未启动。这不是「幂等键还没做」，是「机制在、接线断了」。
2. **修复第一步，随 P4 落（成本最低窗口，sc-lead 2026-11-28 裁定）**：P4 折入场景二必改工具层——旧 `resolve_commitment` schema 收敛必动 `tools.ts`，新工具 `reschedule_commitment` 的落点按 `plan_preview`/`commit_plan` 先例应在 `runtime/` 侧（与 `plan-tools.ts` 同目录）。**前提条件**：若 P4 派单确认新工具与 `plan-tools.ts` 同文件（或该批触它），顺手让 `commit_plan` 调 `createTask` 时带 `planId = `runtime:${runId}``、`planItemId = 任务序号`——同 runId 的崩溃后重试立即被领域层查重接住（命中即返回已有任务，`create-workspace-service.ts:528-530`），约 5 行；若 P4 把新工具放别处，「顺手」前提失效，字段传递挪到切 Pi 批与幂等键同落。这一步只防「同一次运行的重试」，不防跨运行。
3. **幂等键（跨运行防护）的触发点 = 生产默认引擎切 Pi 的那一批，同批落（可判定，非「接线」）**：P4 明确不切引擎、生产仍走 Legacy，所以 P4 合并**不是**触发点——切 Pi 那一批才是，届时幂等键与切换同批落。触发信号（任一提前出现也提前做）：
   a. 晨检/定时 origin 触发 commit_plan（`RunOrigin` 已含 `morning-check`，`contracts.ts:13`——无人值守无法逐次批准）；
   b. 真实事故：同一请求产生重复任务（两份相同 date+title）；
   c. renderer 增加运行重试/重放入口。
   实现形态（届时照做，约 40 行）：跨运行键改用内容派生（`planId` 从 runId 换成 `runtime:{workspaceId}:{date}:{canonical tasks 摘要}`），仍落 `create-workspace-service.ts:519-531` 既有查重，journal 回执带 taskIds；**不建议**在网关层做跨运行去重表——跨运行状态放网关会引入第二份持久化，违背「去重是 per-run 语义」的现规范（`tool-gateway.ts:152-155` 注释）。
4. **是否需要主人拍板**：不需要。触发点（切 Pi 那批）与三个提前信号全部可判定，且第 2 条已随 P4 落地。

---

## 四、Legacy 退役判据量化（spec P4 行「对照期结束判据：Legacy 退役评估」）

### 现状

1. spec 只有一句「评估」，未量化；P4 派单明确「退役评估只评估不动手」，无审批/无预算两约束维持原状。
2. **关键事实：生产还在 Legacy 上**。`assembleRuntime` 只出现在 pi-selftest 与测试（全仓 grep 证实），生产聊天走 `ButlerService.stream` 直连（`ipc.ts:1811` → `context.ts:1504`）。**「Pi 连续 N 天零回退」目前没有样本**——没有生产运行就没有判据时钟。
3. 可复用的判据资产：验收 11 打包三步（`pi-selftest.ts:109-211`）；验收 12 逐字段对拍（`scenario-plan-pi.test.ts:285`）；验收 13 回滚（`:337` + `engine-selection.test.ts:31`）；路径白名单（`path-whitelist.test.ts`）；Pi 零泄漏（`pi-leak.test.ts`）。
4. 「退役」要拆两层：**(a) LegacyEngine 从装配退役**（Pi 成为唯一生产引擎）——可判；**(b) `ButlerService.stream` 循环体与工具执行器删除**（`tools.ts` 的 `executeButlerTool`/`toModelToolDefinitions` 等）——触 `src/main/butler/`，**越出 Runtime 白名单**，属于另一个 spec。

### 建议值（判据全部可判定，测量源 = RunJournal）

1. **判据时钟条款（本节最重要的一条）**：退役判据的时钟**从生产默认引擎切 Pi 那一刻开始走**。切之前，L1–L6 一律显示「**不适用（无生产样本）**」，而不是「未达标」。这两种状态必须区分：没样本时任何阈值都永远不满足，「未达标」看起来像差一点、「不适用」才诚实地说明根本没开始——混在一起，将来会有人说「你看跑了三个月都满足」而其实一次生产运行都没有。前置事实：生产聊天现在走 Legacy 直连（`ipc.ts:1811` → `context.ts:1504`），`assembleRuntime` 无生产调用（全仓 grep 证实）——切 Pi 是产品翻转，主人批后时钟才走。
2. **判据（时钟走后全部满足，即可退役 LegacyEngine 装配；时钟未走时全部「不适用」）**：
   - L1 运行量：Pi 生产运行 ≥ 100 次（journal `run.started.engineId='pi'` 计数）；
   - L2 零回退：连续 30 天用户可见的「切回 Legacy」操作 = 0（装配层 engineId 已记录，够用）；
   - L3 失败率不劣化：Pi 的 failed 终态占比 ≤ 基线 +2 个百分点（journal 按 `run.finished.state` 统计；「不劣化」比「更优」诚实）。**基线定义**：切换前最近 30 天 Legacy 生产 failed 率——切完 Legacy 没有生产运行，同期比较届时不可算，必须在切换时冻结基线快照；
   - L4 三场景对拍绿：验收 12 逐字段一致 + 场景二/三对拍在最新 master 全绿；
   - L5 打包门：验收 11 三步在最近**两个**发布版的打包产物实跑通过（P2 手测清单的延续）。**前置核查**：评估核 L5 时先核 P2 打包证据（验收 11 的 JSON 结果文件）是否已在库留档——现在没有留档，L5 没有可核对的样本；
   - L6 零 Legacy-only 功能：非目标清单无「仅 Legacy 可用」条目（当前唯一 Legacy-only 是「无审批直执行」——那是语义差异，恰恰是退役的理由而非障碍）。
3. **退役动作**（判据满足后单独一批）：生产装配移除 legacy + 删 `legacy-engine.ts` + Legacy 专属测试迁移；**不删** `ButlerService.stream`（conversation 持久化仍被聊天历史使用，代码删除另立 spec）。该批会触 `butler-service.ts`——按验收 1 白名单口径越界，**需重新裁定白名单**（流程项，非技术项）。
4. **不可退役条件（任一即冻结时钟）**：L4 对拍出现非测试缺陷；L3 连续两周不达标；出现只有 Legacy 能完成的用户场景。
5. **是否需要主人拍板**：判据不需要（全部可测量）；**「判据满足后执行退役」是产品决策**，届时 Needs you。L1=100 次、L2=30 天是可调参数。

---

## 五、resolve 兼两职 → 显式 reschedule 服务方法？（spec 给 builder 决定 7 备选 a）

### 现状

1. `CommitmentService.resolve(input)` 一个方法两种语义：outcome（结掉）/ newDue（改期）（`ResolveCommitmentInput` `commitments/service.ts:64-75`；实现 `:196-245`）。改期下界唯一权威在 resolve 内（`:211-219`，注释自证所有入口都走它）。
2. 调用方四处：旧工具 `resolve_commitment`（`tools.ts:1025`）、提醒页 IPC（`ipc.ts:927-932` → `context.ts:1247` 改期 / `:1251` 结掉）、P4 即将新增的 `reschedule_commitment`（仍调 `resolve({newDue})`）。`newDue` 全仓 32 处引用（src 4 文件 + tests 2 文件）。
3. **真正的语义问题不在方法名，在行为**：`resolve({newDue})` 对一条 done/dropped 的承诺会**静默复活**（status→open、清 resolvedAt，`service.ts:229-232`）——「改期」隐含「复活」，工具 schema（`tools.ts:980`）与提醒页文案都没说这件事。

### 建议值

1. **不做显式 reschedule 服务方法（一致性理由，不是省事理由）**（维持 spec 决定 7 主案）。`resolve` 已是改期的唯一权威入口——服务注释自证「Every entry point goes through resolve」（`service.ts:211-216`），改期下界只在这一个地方判。拆出 `reschedule` 就是造出第二个改期入口，两处各自维护下界校验、迟早漂移——**这正是这一轮在别处反复修掉的那类多入口 bug 的镜像**（`assertIsoDate` 收敛成共享校验让 memory/practice/workspace 三处服务调用同一权威，`workspace/paths.ts`；改期边界收敛为 resolve 单点）。不拆是防止把刚修完的病再种回去。辅助理由两条：(a) P4 正在把**工具层**收敛为 `reschedule_commitment`（schema 移除 newDue）——模型可见面上「结掉」与「改期」已分离，语义不清发生在模型接口层，那里已解决；(b) 服务方法名是内部接口，模型与用户都看不见。成本只作附注，不构成理由：迁移面 = 服务接口 + `context.ts` + `tools.ts` + 32 处 newDue 引用的测试，一批内可完成——能做，但理由不成立时做多少行都不该做。
2. **「复活」语义两个选项都摆平（归主人，见第九节决策 3）**：`resolve({newDue})` 现状对 done/dropped 承诺静默复活（status→open、清 resolvedAt、due 更新，`service.ts:229-232`）——「改期」隐含「复活」，工具 schema（`tools.ts:980`）与提醒页文案都没说这件事，这才是语义不清的实体。保留或拒绝的行为后果两边都写在第九节，本稿不预设结论；无论选哪个，实现侧动作都是把现行为写成契约 + 测试锁定 + `reschedule_commitment` 工具描述加说明（拒绝则改为对已结案承诺报错的条款）。
3. **是否需要主人拍板**：第 2 条（复活保留/拒绝）→ 需主人定，两个选项的后果见第九节。方法名本身不需要。

---

## 六、三个月后回看的三条架构断言（各配可执行检查）

三条断言全部已有代码承载，v2 只补「届时跑什么命令」。复查机制建议：不加定时自动化（团队无 CI 定时先例），由 sc-lead 届期开 item 派 sc-review/qa 一次性实跑并留档，命令如下照抄。

### 断言 1：移除 Pi，业务零改动

- 现有承载：路径白名单（`path-whitelist.test.ts`，env 门控显式基线）；Pi 零泄漏（`pi-leak.test.ts:27` 唯一允许前缀 `main/runtime/engine-pi/`）；关 Pi 后 Legacy 场景一逐字段一致（`scenario-plan-pi.test.ts:337`）。
- **可执行检查**：
  1. `RUNTIME_PATH_WHITELIST_BASE=master npx vitest run tests/main/runtime/path-whitelist.test.ts` → 绿；
  2. `grep -r "pi-agent-core" src/ --include=*.ts` → 仅命中 `src/main/runtime/engine-pi/`；
  3. `npx vitest run tests/main/runtime` 排除 `pi-engine.test.ts`/`pi-leak.test.ts`/`scenario-plan-pi.test.ts` 后 → 全绿（引擎集合不含 pi 时其余 Runtime 行为完好）。
  三个输出留档进复查 item。

### 断言 2：模型不能自授权限

- 现有承载：行为级联合只有 query/confirm，第三级「注册即违规」（`tool-gateway.ts:22`）；标级表唯一权威 `BUTLER_TOOL_LEVELS`（`butler-bridge.ts:20-46`）+ 装配 fail-fast 双向断言（`:93-116`）；审批绑定 invocation+参数、无缓存、参数变即新审批（`tool-gateway.ts:256-280`）；权限门来自 `ButlerToolContext.permissions` 不来自模型参数（`:223-231`）。
- **可执行检查**：
  1. `npx vitest run tests/main/runtime/gateway.test.ts tests/main/runtime/assembly.test.ts` → 绿（负例齐全：未注册工具/未声明级/权限门/审批绑定/装配 fail-fast）；
  2. 静态检查：全部注册工具的 `parameters.properties` 不含 `permissions`/`approved`/`skipApproval` 类键——**建议补一条 10 行的断言测试**（P4 顺手或退役评估批做，本稿只立项不实现）。

### 断言 3：业务结果以服务回执为准

- 现有承载：完成规则 = 有确认级提交且其后无回执 → pending-verification（`run-controller.ts:170-172`）；测试：无回执→待核实（`contracts.test.ts:265`）、有回执→完成（`:283`）、引擎抛错→失败（`:244`）、「失败不说成功」（`legacy-engine.test.ts` / `pi-engine.test.ts` 缝①组）。
- **可执行检查**：
  1. `npx vitest run tests/main/runtime/contracts.test.ts tests/main/runtime/scenario-plan.test.ts` → 绿；
  2. journal 复核脚本（三个月时对任一真实 completed run 的 JSONL 断言：最后一条确认级 `tool.committed` 的 seq < 某条 `service.receipt` 的 seq；约 10 行，随退役评估批落）。

---

## 七、引擎适配器：选型依据与升级复验条件（sc-lead 2026-11-28 折入选型复核结论）

输入：sc-research 引擎横向选型复核——分支 `xiaolai/engine-selection-research` @ `b463663`（报告首版 `b4fd3ec`，`b463663` 是「打包产物复验」措辞修订版），报告 `docs/superpowers/reports/2026-11-28-agent-runtime-engine-selection.md`。**引用按提交号，该分支不合入 master、未推送**。复核结论：留在 Pi，Vercel `ai` 记一号备胎。v2 只折入与 Runtime 设计直接相关的两条：

1. **「取消只在适配器做 abort、不叠别家 agent 运行时」的实证支撑**：`@anthropic-ai/claude-agent-sdk` 跟踪器 **#444**（2026-09-04，open，https://github.com/anthropics/claude-agent-sdk-typescript/issues/444）：Windows win32-x64 上，流式 `query()` 会话在收到 `system`/`init` 后立即调用 `Query.interrupt()`，捆绑的 `claude.exe` 子进程以 3221225477（`0xC0000005`，STATUS_ACCESS_VIOLATION）退出；issue 报告的宿主环境就是 **Electron main process + TypeScript SDK**（issue 细节以 issue 原文为锚——复核报告正文只写「Electron main + Windows」，折回 spec 保留平台细节时同样锚 issue，不锚报告）。同类佐证 **#366**（2026-07-06，open）：interrupt 落在 thinking 阶段报 `error_during_execution` 而非干净取消，宿主抱怨用户看到内部诊断原文。**取消（我们的约束 5）在别家引擎的桌面主进程形态是段错误级故障**——这是不引入第二套 agent 运行时、取消语义收敛在自家适配器（合并信号 abort → `agent.abort()`，`pi-engine.ts:291-294`；取消后引擎不得再发起工具调用，`tool-gateway.ts:216,273`）的实证理由：**干净取消是适配层契约，不是引擎赠送**，v1 取消设计不变。Claude Agent SDK 在该复核里另有四条硬排除（子进程模型、403MB 平台二进制、非 OSI 许可、数据条款），#444 是其中与我们约束正面相撞的一条。将来任何「换/加引擎」评估先核它家跟踪器的 Electron-main + Windows 取消类 issue。
2. **升级复验条件的准确措辞**（订正首版 `b4fd3ec` 的「主进程内」表述；`b463663` 已自行修订，本条按修订后口径收编）：升级 pi pin 或引入新依赖闭包时，要重验的不是「主进程 fetch 行为」，而是「**打包产物里**的 fetch 行为」——undici 全局 dispatcher 污染（pi 跟踪器 #9787 一类「一升级就回来」的问题）在开发机 Node 上不复现是常态，与 P2 打包硬门同一理由：**开发机 Node 跑通不算**。复验形态 = 打包产物实跑一次 `globalThis.fetch` abort/stream 自测，升级前后各一次对照；污染进入 agent-core/pi-ai 闭包且无 workaround → 视同 breaking，走备胎评估（Vercel `ai`，一号备胎，已在依赖树内）。

---

## 八、汇总表

| # | 议题 | 建议值一句话 | 需主人定 |
|---|---|---|---|
| 1 | ContextBuilder 数据边界 | 出站载荷四类白名单 + workspaceIds 圈定 + 帽沿用 prompt.ts 常量；本地/云端同界不分叉（技术已定） | **是**：跨项目承诺出机（决策 1）；两句配套文案（决策 2） |
| 2 | RunJournal 形态 | 现状升格为规范 + 30 天/200 文件保留期 + 启动清理 + recover 幂等（**缺口本批 P4 修**，sc-lead 2026-11-28 裁定） | 否（数字是参数） |
| 3 | commit_plan 幂等键 | 领域防线缺口（不传 planId/planItemId）单列；随 P4 传字段（同 run 防重）；跨运行幂等键 = 切 Pi 那批同批落 | 否（触发点可判定） |
| 4 | Legacy 退役 | 时钟从切 Pi 起算，切前 L1-L6 一律「不适用」非「未达标」；L1-L6 可测判据；退役动作单独一批且白名单需重裁 | 判据否；**执行退役时是** |
| 5 | resolve 兼两职 | 不加显式服务方法——一致性理由：resolve 是唯一权威，拆开=再造第二个改期入口（多入口正是这轮修掉的病）；「改期复活已结案」归主人 | **是**：复活保留还是拒绝（决策 3） |
| 6 | 三条架构断言 | 三条各配 2-3 条可执行命令，届时照抄留档 | 否 |
| 7 | 引擎适配器选型依据 | Claude SDK #444 取消段错误 = 不叠别家 agent 运行时的实证；升级复验盯**打包产物里**的 fetch 行为（非开发机主进程） | 否 |

## 九、需主人定（三件独立决策，互不捆绑；每件给两个选项的实际后果）

### 决策 1：跨项目承诺原文是否出机

现状：未结案承诺的选择**不按项目过滤**（`context.ts:105-113` → `service.ts:150-163` 全库 open），无论对话圈定哪个项目，≤3 条承诺原文都会进提示词发出去。**两个选项都只影响承诺这一类**——无论选哪个，未选项目的任务/记忆在全局闲聊中维持现状全展平（第一节建议 2），不随本决策收紧。

- **选项 A（按项目圈定，Runtime 路径）**：只出 workspaceIds 内的承诺 + 用户没说属于哪个项目的全局承诺；跨项目承诺原文不出机。后果：全局闲聊里问「我还有哪些没做的事」，模型只能答出一部分（有项目归属的跨项目承诺不在提示词里），需要如实说「部分未列出」；对照期 Legacy（不圈定）与 Pi（圈定）数据面不同，对拍测试按各自口径断言。
- **选项 B（维持现状口径）**：所有 open 承诺出机——上限就是现有的截断规则：≤3 条（`prompt.ts:57` `MAX_PROMPT_COMMITMENTS`）、每条原文 ≤120 字（`prompt.ts:58` `MAX_PROMPT_COMMITMENT_TEXT`，经 `clipPromptText` 截断，`prompt.ts:186`），超出的只出一条计数行「还有 N 条未列出」（`prompt.ts:189-190`）。选 B 即「不动现状」，零代码改动；后果：「只发当前任务需要的片段」对承诺这一类不成立；聊天里可能看到与本项目无关的承诺字句。

### 决策 2：设置页两句数据去向文案（加不加与措辞）

技术侧已定：本地/云端同一份数据边界，不分叉。剩下的纯粹是用户读到的说明：

- **选项 A（加两句，建议措辞如下）**：远端 provider 面板显示「使用该模型时，对话内容与所选项目的片段会发送到其服务方」；`local-cli` 且 `nativeTools` 显示「该模式允许 CLI 自行读写本库与联网，不受片段边界约束」。后果：设置页多两行；用户对数据去向有明确预期；nativeTools 的例外被说破，片段条款与实际一致。
- **选项 B（不加）**：后果：片段边界条款对 `nativeTools` 场景事实上失效而用户不知情——文档承诺与实际行为不符。措辞可改，「加不加」必须定。

### 决策 3：`resolve({newDue})` 改期一条已结案承诺——复活还是拒绝

现状：静默复活——`resolve({newDue})` 对 done/dropped 的承诺直接改回 open、清 resolvedAt、更新 due（`service.ts:229-232`）；工具与页面都没说明这个行为。

- **选项 A（保留 + 显式化）**：行为不变，写成契约 + 测试锁定，`reschedule_commitment` 工具描述加「改期一条已完成的承诺会重新打开它」。后果：「那条我还是做了，改到周五」一句话生效，不用先找重开入口；改期是确认级操作，审批卡上用户看得到参数，误复活被批准环节挡一道。
- **选项 B（拒绝）**：改期仅对 open 承诺有效，对已结案承诺报错「请先重开」。后果：语义干净、行为可预期；但「那条我还是做了，改到周五」这条路断掉——「重开」入口现在不存在，要么另做一个（新工具/新方法，又回到多入口问题），要么用户手动改 vault 文件。

三项之外全部按技术判断给出结论，不阻塞。

## 十、折回 spec 的方式（评审通过后执行，本稿不做）

- spec 的「spec 填充」标记逐条由本稿闭合：`:5`（口径说明改为 v2 已补）、`:25`（批次拆分确认——维持 P0-P4，P3 已被装配批替换的事实按 sc-lead 裁定记录）、`:37/:41`（非目标表述）、`:52`（RunRequest 字段确认=现实现）、`:68`（RunJournal 形态=第二节）、`:158`（决定 7 备选 a 关闭=第五节）、`:163/:165`（风险条目删除）。
- P4 在飞批**范围新增两项**（sc-lead 2026-11-28 裁定，随其 P4 派单追加）：第二节现状 5 的 recover 幂等缺口本批修；第三节第 2 条 `commit_plan` 传 `planId`/`planItemId` 随 P4 的 `plan-tools.ts` 改动顺手落。其余范围（场景三 + 场景二 + 生产接线 + references + 退役评估）不受本稿影响，第三、四节的判据就是给它「退役评估结论」直接引用的口径。
