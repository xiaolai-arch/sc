# ASAKI iter（立项）：Agent Runtime 自研底座 v1 —— Pi 首版执行引擎

> 状态：v2 增量已折入（2026-11-28），待 sc-review 复核 ｜ 分支 `xiaolai/agent-runtime-spec` ｜ 基线 master `62c2ba0`（2026-11-28，全部行号按此复核）
> 方案来源：`docs/superpowers/reports/2026-11-27-agent-runtime-plan-v1.md`（群发原文 + 断点考据与草稿回收）；增量 `docs/superpowers/reports/2026-11-28-agent-runtime-plan-v2.md`（分支 `xiaolai/agent-runtime-v2` @ `a6e8039`，v0.5 定稿，sc-review 判整份可合并）。
> **该方案 v1 群发正文被 API 502 截断**（止于「## 三、我们真正要自研的四」），后半篇从未生成；本 spec 原以已发出部分（方案 §一/§二）为准绳、以同群三轮草稿回收件补后半，未定处标「spec 填充，待方案 v2 确认」（sc-lead 2026-11-27 批准此口径）。**2026-11-28 起 v2 已补齐这些位置**：本版逐条闭合「spec 填充」标记（对应关系见文末「已定 10」），三件产品决策按主人 2026-11-28 裁定全选 A 折入。

## 一句话

在 Electron 主进程自研 `ASAKI Agent Runtime`：我们定义一次任务的生命周期、模型可见数据边界、工具写入条件和失败恢复；Pi（`pi-agent-core`，锁版本）只作第一版可替换执行引擎，负责驱动模型调用工具、回送结果、流式事件。**架构总验收：移除 Pi，界面、领域工具、用户数据、验收用例零改动，只换执行适配器**（方案 v1 开头原文）。

## 为什么

- 主人 2026-11-27 批准立项，指定走 spec 流程（item 61）；实施排在 iter32 收口之后，spec 与 iter32 并行。
- 现状：管家的模型-工具循环长在 `ButlerService.stream`（`src/main/butler/butler-service.ts:275`，循环体 `:338-439`）里，工具执行、权限、重试、中止与业务服务耦合在同一循环；换模型引擎或加第二个入口（晨检、Web）都要复制这套循环。方案要把它抽成可替换的底座。
- 方案点名要守住的两条设计（方案 §二）：**当前时间由一次运行统一提供**（防止工具与 planner 在午夜两侧各算两个「今天」——本仓库已有注入先例：`butler-service.ts` 的 `now` 注入、晨检 provider/now 注入）；**业务结果以服务回执为准**（模型提前说「改好了」不算成功）。

## 首批三场景（顺序固定，方案 §一原文）

| # | 场景 | 逼出的能力 | 用户可见结果（验收以最终数据为准，不以回复措辞为准） |
|---|---|---|---|
| 1 | **安排今天的计划** | 读对项目和日期、调用现有 planner，不让模型重写业务规则 | 满日只排 1 件、最多 10 分钟（`src/main/planning/busy-day.ts:23` 返回 `BUSY_DAY_MINUTES`）；用户明确给 30 分钟则按输入 |
| 2 | **把一条承诺改到周五** | 选中正确记录、校验日期、可靠写入、区分「准备修改」和「已经修改」 | 改期后详情与通知中心同日期；无效日期不写盘 |
| 3 | **总结这一周** | 只读跨项目取事实、区分用户记录与模型推断 | 复盘指出结论来自哪条记录；没有记录就说明没有，不编补 |

## 批次（P0–P4；v2 已确认此拆分）

| 批次 | 内容 | 依赖 |
|---|---|---|
| **P0 底座骨架** | 契约三件套（RunRequest / RunEvent / RunState 六态）+ `EnginePort` + `FakeEngine`（测试里稳定制造失败）+ `RunJournal` + `ToolGateway`（工具注册表、三级行为、去重）；现有管家工具经网关**全部**重新注册（`createButlerTools`，`tools.ts:216`，名单以该函数返回为准；P0 时 19 个，P4 加 `reschedule_commitment` 及 `plan_preview`/`commit_plan`/`weekly_review` 后现为 20 个标级条目 + 三个 runtime 侧工具，见 `butler-bridge.ts:22-50`）；`plan_workspace`（`tools.ts:402`，现在生成+写入一体）拆成**预览（只读）与提交（写入）两个工具** | 无 |
| **P1 场景一 + Legacy 对照** | `LegacyEngine` 包装现有 `ButlerService.stream`（映射 `ButlerStreamEvent`（`src/shared/butler-stream.ts:31`）→ RunEvent）；场景一在 Fake/Legacy 上端到端走通：取消、确认、失败不说成功 | P0 |
| **P2 PiEngine 接入** | `engine-pi` 适配锁定的 `pi-agent-core`（上游 `main` 标 **1.6.1、MIT、Node ≥ 22.19.0**，方案草稿 3/4）；**硬门：打包后的 Windows Electron 里**完成一次流式、一次工具调用、一次取消（开发机 Node 跑通不算）；场景一切到 Pi 与 Legacy 对照；Pi 类型零泄漏 | P0、P1 |
| **P3 场景二：承诺改期** | 改期语义**已存在**，不新增服务方法：`CommitmentService.resolve({ newDue })`（`service.ts:196`；日期校验 `:204-206`；改期下界唯一权威 `:217-219`，注释自证所有入口都走 `resolve`（`:211-216`）；写 due+恢复 open+清 resolvedAt `:229-232`）。v1 做法：新增 `reschedule_commitment` 工具（**确认级**）以后端 `resolve({ newDue })` 为唯一改期路径；旧 `resolve_commitment` 收敛为纯「结掉」语义——工具 schema 移除 `newDue`，网关校验拒绝携带 `newDue` 的旧工具调用（防确认级审批被旁路）；renderer 审批卡（approval.requested → approved/rejected）+ 同名承诺先让用户选。**v2 定：不新增显式 `reschedule` 服务方法**（原「给 builder 决定 7 备选 a」**已关闭**，理由见「已定 9」）。**改期一条已结案承诺会重新打开它——保留并显式化**（2026-11-28 主人裁定 A，见「数据与契约 · 改期与复活」）。 | P0（网关审批）；不依赖 P2，Legacy/Pi 都能跑 |
| **P4 场景三：周总结** | 只读跨项目周复盘工具（来源引用 + 「没有记录就说明没有」）；对照期结束判据：Legacy 退役评估（**v2 量化为 L1–L6，见「Legacy 退役判据」**） | P0；建议在 P2 后 |

**实施状态**：iter32 已收口、本 spec 的 P0–P4 已由 sc-build 实施并合入 master（P4 终批 `eabb196`）。**剩余欠账**：验收 24/27/28/29（见「已定 11」与「风险」），需另派一批。文件交集见「依赖与冲突」。

## 非目标（方案 §一/§二原文 + v2 确认表述）

- 不 fork Pi，不引入完整 Pi Coding Agent（方案 v1 开头）。
- 不做多 Agent 协作、插件市场、任意 shell、全库向量化、自动后台写入（方案 §一）。
- 云同步、多用户/多账号：**v1 不做**（item 61 派单要点；v2 确认此表述——Runtime 的全部持久化都是本机 vault 与 userData，无账号概念，无同步通道）。
- 六个 Orca bot 是研发分工，不复制进用户桌面产品（方案 §一）。
- Runtime 不定义业务规则：「满日排多久」「承诺能改到哪天」仍归领域服务（方案 §二）。
- Pi 的消息类型、错误类型、会话文件格式不进 UI 或 vault（方案 §二③）。
- 模型不能自授权限；不给模型通用文件写入绕过服务（方案 §二④）。
- 聊天记录不当第二份任务/承诺数据库；RunJournal 不记密钥与完整提示词（方案 §二⑤；草稿 4）。
- v1 不拆独立守护进程、不开本地 HTTP 端口，不做独立 CLI / Web 客户端（草稿 5）。
- 首版不注册：删除类、批量改动、对外发送工具（草稿 4 工具契约第三级；`tool-gateway.ts:24` 的行为级联合只有 `'query' | 'confirm'`，第三级类型上不存在）。
- **Journal 不承担恢复执行**：崩溃恢复只补一条 `run.interrupted` 标记，不续跑（无法证明中断前模型想做什么，续跑等于放它绕过审批）。
- **Journal 不跨运行去重**：去重是 per-run 语义（`tool-gateway.ts:223` `purgeRun`）；跨运行幂等键不在 v1 范围（触发条件见「commit_plan 幂等键」）。
- **Runtime 不做用户数据出机的「判定」层**：数据边界由 ContextBuilder 的出口清单保证，不按 provider 分叉（见「ContextBuilder 数据边界」）。

## 数据与契约

### RunRequest（v2 确认：字段 = 现实现，`contracts.ts:57-78`）

`runId`、`sessionId`、发起来源（`origin`: chat / 晨检 / 用户主动操作，`contracts.ts:14`）、项目范围（`workspaceIds`）、用户输入、引擎选择（`engineId`）、预算（`budget.maxModelCalls` / `maxToolCalls`，`contracts.ts:48-51`）、取消信号、本次统一时钟 `now`；P4 增 `readOnly?: boolean`（场景三只读运行，`contracts.ts:77`）。理由（草稿 3 原文）：用户在聊天里说「改到周五」和晨检读到同一句话，权限不能一样。**`userInput` 只进引擎，永不进 RunEvent 与 RunJournal**（`contracts.ts:64-65`）。

### RunEvent 与 RunState（草稿 4 运行契约）

- 事件至少含：`run.started`、`text.delta`、`approval.requested`、`tool.committed`、`tool.failed`、`run.finished`；每条带 `runId` 与**递增序号**。映射参照现有 `ButlerStreamEvent`（`src/shared/butler-stream.ts:31-52`）与 `ModelStreamEvent`（`src/main/agent/model-client.ts:88-105`）。
- 状态六态：**执行中 / 等待确认 / 完成 / 失败 / 取消 / 结果待核实**。**「模型停止输出」≠「任务完成」**（草稿 4 原文）——完成必须由服务回执驱动。
- 客户端只认识 `start` / `subscribe` / `approve` / `cancel` / `getRun`（草稿 4）；断线后按序号补读。

### 工具三级行为（草稿 4 原文，ToolGateway 执行依据）

1. **查询和预览**：可自动执行（读周可用性、生成计划预览）。若现有工具同时会写入，先拆成预览与提交，不能只改工具名把写入当只读。
2. **修改本地数据**：默认展示变更摘要并**确认**；批准绑定这一次操作、这个项目、这组参数；参数变了就重新确认。
3. **删除、批量改动、对外发送**：v1 不注册。

### RunJournal（v2 定稿：形态、字段、保留期、恢复语义）

本地记录每次运行的状态、批准了什么、工具是否提交、如何恢复。**不成为第二份计划/承诺数据库**；默认不记密钥与完整提示词（`RunJournal` 文件头注释即此契约，`run-journal.ts:7-18`）。

**形态（规范条款）**：目录 `<userData>/data/runtime-runs/`，**一 run 一 `.jsonl` 文件**，append-only。文件名由 runId 净化，含不安全字符时以 sha256 前 12 位消歧（`run-journal.ts:32-37`）。seq 在单 run 内单调递增，倒退抛错（`:55-59`）。**撕尾容忍**：末行 JSON 不完整即弃，其后内容视为不可信（`:66-91`）。唯一合法的「改写」是 `recover()` 追加中断标记。**不上 `JsonStateStore`**（`state-store.ts:40` 的缓存-写队列模型面向设置类小对象，运行日志是追加型数据），**不上 SQLite**。

**字段（规范条款）**：文件内事件集合 = `RunEventPayload` 联合（`contracts.ts:107-178`）+ `runId` / `seq` / `at`。新增字段必须先进入 `contracts.ts` 的联合类型再落盘。**事件含业务数据**：`approval.requested.params` 是完整工具参数（`contracts.ts:121`），承诺原文与任务标题会落 journal——因此 journal 不是零业务数据，只是「不是第二份数据库」。`userInput` 与密钥永不落盘。

**保留期（规范条款，数字是参数，主人可改常量）**：**30 天或目录内 200 个文件，先到先清**。清理时机 = 启动时 `recover()` 之后同一遍扫描内（`RunJournal.pruneOld()`，装配层在 recover 后调用）；运行中不清理（避开与 append 的竞态）。清理判据 = 末行为终态（`run.finished` / `run.interrupted`）**且**（首行 `at` 早于保留期 **或** 文件数超限删最旧）；**未终态文件永不清**（recover 先行保证都已带标记）。理由：journal 回答「Agent 做过什么」，是诊断数据不是业务事实；事件含承诺/任务原文，无界留存违背最小留存；30 天覆盖「上月排查」。

**崩溃恢复语义（规范原文）**：启动扫描每个 `.jsonl`；末行 `type ∈ {run.finished, run.interrupted}` → 无事；否则追加 `run.interrupted`（seq = 末行 seq+1，消息沿用 `RUN_INTERRUPTED_MESSAGE`，`conversation-runs.ts:13`）。**恢复必须幂等**：二次 `recover()` 返回空。沿用的是 `ConversationRunStore` 的先例（`conversation-runs.ts:123`）。**恢复不续跑任务**——v1 无恢复执行语义，这是有意的（无法证明中断前模型想做什么，续跑等于放它绕过审批）。

**journal 不回灌业务**：读取方只允许 `RunController.subscribe`（断线补读）与诊断；查询/晨检/复盘只读领域服务、不读 journal。

> **实现缺口（截至基线 `62c2ba0`，本 spec 不谎称已修）**：`recover()`（`run-journal.ts:98-123`）判据 `:111` 只认 `run.finished`，**不认 `run.interrupted`**——以中断标记结尾的文件每次启动都会再追加一条 marker，恢复不幂等。方案 v2 §十原定「随 P4 修」，但 P4 已合入（`eabb196`）而未修。本条作为**未结项**留在 spec：验收 24（见下）即它的判定，需另派一批落地。

> **journal.append 失败不阻断事件扇出**（P4 已实现，`run-controller.ts` 的 delta 链与 finalize 链各包 try/catch；失败写 `record.journalError` + `console.error`，快照暴露 `journalError`）。语义：日志是旁路观察，不能反过来杀死正主事件流；但失败必须可见，不静默吞。

### 引擎适配器

- `PiEngine`：接 `pi-agent-core`（`@earendil-works/pi-agent-core` 1.6.1，`package.json:34` 精确版本），锁定版本依赖，**不 fork、不复制上游源码改名**（草稿 3/5）。
- `LegacyEngine`：包装现有管家（`ButlerService.stream`）作对照与回滚（方案 §二③）。
- `FakeEngine`：测试里稳定制造失败/取消/重复调用（方案 §二③）。
- 只有适配层允许 `import` Pi 包；业务代码出现 `import pi` 即评审打回（草稿 5）。

**取消语义收敛在适配器（v2 第七节，选型实证）**：干净取消是**适配层契约，不是引擎赠送**。合并信号 abort → `agent.abort()`（`engine-pi/pi-engine.ts:289-294`）；取消后网关不得再执行任何工具（`tool-gateway.ts:295-299` 与 `:391-395` 两道）。实证：`@anthropic-ai/claude-agent-sdk` 跟踪器 **#444**（2026-09-04，open，https://github.com/anthropics/claude-agent-sdk-typescript/issues/444）——Windows win32-x64 上，流式 `query()` 会话在收到 `system`/`init` 后立即 `Query.interrupt()`，捆绑的 `claude.exe` 以 3221225477（`0xC0000005`，STATUS_ACCESS_VIOLATION）退出，宿主即 Electron main + TypeScript SDK；**#366**（2026-07-06，open）佐证 interrupt 落在 thinking 阶段报 `error_during_execution` 而非干净取消。**平台细节以 issue 原文为锚**（复核报告正文只写「Electron main + Windows」，不锚报告）。

**升级复验条件（v2 第七节，订正后口径）**：升级 pi pin 或引入新依赖闭包时，要重验的不是「主进程 fetch 行为」，而是「**打包产物里**的 fetch 行为」——undici 全局 dispatcher 污染（pi 跟踪器 #9787 一类「一升级就回来」的问题）在开发机 Node 上不复现是常态，与 P2 打包硬门同一理由：**开发机 Node 跑通不算**。复验形态 = 打包产物实跑一次 `globalThis.fetch` abort/stream 自测，升级前后各一次对照；污染进入 agent-core/pi-ai 闭包且无 workaround → 视同 breaking，走备胎评估（Vercel `ai`，一号备胎，已在依赖树内）。

### ContextBuilder 数据边界（v2 第一节；闭合原 spec 风险节的「待 v2 补隐私条款」）

**出口四类清单**：`src/main/runtime/context-builder.ts` 是**唯一**允许构造 Pi 出站载荷的模块（PiEngine 构造时注入，替代 pi-selftest 的静态字符串）。出站载荷只允许：① 系统提示词（固定模板 + 本次任务片段）② 用户输入原文 ③ 附件正文（沿用 `attachments.ts:10,12` 的 20k/80k 现帽）④ 工具回执。**除四类之外，任何字符串不得进入 streamFn 调用**。`ContextBuilder` 显式注入窄门面，不传全量 `WorkspaceService`（类型层保证，不是约定）。

现状事实（builder 需要知道的基线）：ContextBuilder 目前**不存在**——全仓唯一出现是 `engine-pi/pi-engine.ts:93` 的注释，`PiEngine` 只收 `systemPrompt` 字符串（`:94`），`pi-selftest.ts:129` 传静态一行。Legacy 路径的既有数据面由 `gatherContext`（`butler/context.ts:86`）决定：带 workspaceId 时 tasks/memory/knowledge 按项目圈定（`:95`、`:136-149`），profile 全局（`:96`）；**commitments 全局**（`selectCommitments` 调 `listSummaries()` 无过滤，`butler/context.ts:105-113` → `commitments/service.ts:151-168` 读全库 open）；不带 workspaceId 的会话把**全部项目** tasks+memory 展平（`butler/context.ts:152-180`）。

**任务片段圈定**：以 `RunRequest.workspaceIds` 为唯一圈定依据——tasks/memory/knowledge 只取 workspaceIds 内项目。无 workspaceIds 的运行沿用「全项目展平 + 条数帽」现状，但落成明文条款而非隐式行为。

**帽沿用既有常量，不另立一套**：任务 ≤10（`butler/prompt.ts:54`）、记忆 ≤8（`:55`）、承诺 ≤3 条每条 ≤120 字（`:57-58`、`:185-190`）、知识 ≤15 主题（`butler/context.ts:40-42`）。

#### 跨项目承诺：按项目圈定，跨项目不出机（2026-11-28 主人裁定 A）

出站承诺仅当 `commitment.workspaceId ∈ workspaceIds` **或**承诺本身无 workspaceId（全局承诺）时才出机；**跨项目承诺原文不出机**。承诺记录本就带可选 `workspaceId`（`commitments/service.ts:27`），此前选择时不用它——这是本条要改的唯一一处。

**连带项（必须写清，别让日后的人当 bug 修）**：本条**只约束 Runtime 路径**，不回改 Legacy（Legacy 走自己的 `gatherContext`，不经 ContextBuilder）。因此**对照期 Legacy（不圈定）与 Pi（圈定）的数据面不同，对拍测试按各自口径断言**——这是有意设计，不是缺陷。全局闲聊里问「我还有哪些没做的事」，Pi 引擎只能答出 workspaceIds 内与本项目无关的全局承诺，其余需要如实说「部分未列出」。

#### 本地/云端同一份数据边界，不按 provider 分叉（技术结论，已定）

不分叉。理由：(a) 分叉 = 两套上下文两套测试，对照期成本翻倍；(b) 按 provider kind 判「本地」不可靠——`openai-compatible` 的 `baseURL` 可指向本机代理，`local-cli` + `nativeTools` 本来就绕过边界；(c) 数据边界的意义是「用户可预期模型看到什么」，可预期性不应随切换模型漂移。**配套文案归产品（两句数据的去向说明，见「设置页数据去向文案」）**。

#### 工具回执不额外放量

查询级工具返回值维持 schema 既有形状（现状已是摘要形，如 `plan_preview` 返回任务清单、`get_today_plan` 返回当日计划）；跨项目只读工具（P4 周复盘）只读摘要字段不回原文全文。

### 改期与「复活」语义（v2 第五节 + 2026-11-28 主人裁定 A）

**不做显式 `reschedule` 服务方法**（原「给 builder 决定 7 备选 a」**关闭**，见「已定 9」）。理由是一致性而非省事：`resolve` 已是改期的唯一权威入口——服务注释自证「The one authoritative lower bound for a reschedule. Every entry point goes through `resolve`」（`commitments/service.ts:211-216`），改期下界只在这一处判（`:217-219`）。拆出 `reschedule` 就是造第二个改期入口，两处各自维护下界校验、迟早漂移——**正是这轮在别处反复修掉的那类多入口 bug 的镜像**（`assertIsoDate` 收敛成共享校验让 memory/practice/workspace 三处服务调同一权威，`workspace/paths.ts:44`）。补充两条：(a) P4 已把**工具层**收敛为 `reschedule_commitment`（schema 移除 `newDue`），模型可见面上「结掉」与「改期」已分离；(b) 服务方法名是内部接口，模型与用户都看不见。

**改期一条已结案承诺会重新打开它——保留并显式化（2026-11-28 主人裁定 A）**

行为不变：`resolve({ newDue })` 对 `done`/`dropped` 的承诺直接改回 `open`、删 `resolvedAt`、更新 `due`（`commitments/service.ts:229-232`）。但此前**这是静默行为**——工具 schema 与提醒页文案都没说这件事，这才是语义不清的实体。本裁定把它写成契约：

- **(a) 行为契约（规范原文）**：`resolve({ newDue })` 对一条已结案（`done` / `dropped`）的承诺，把 `status` 置回 `open`、删除 `resolvedAt`、把 `due` 更新到新日期，并返回更新后的承诺。**「改期」对已结案承诺隐含「复活」**，这是设计意图，不是缺陷。
- **(b) 工具描述显式化**：`reschedule_commitment` 的工具描述必须含一句「**改期一条已完成的承诺会重新打开它**」（`tools.ts` 的 `reschedule_commitment` 定义，基线 `:1042-1058`）。
- **(c) 测试锁定**：见验收 25（正向）与验收 26（负向：`resolve({ outcome })` 不得改 `due`）。

为什么保留（owner 的取舍理由，写下来免得日后被当 bug 修）：用户说「那条我还是做了，改到周五」一句话生效，不用先找重开入口；而「重开」入口现在不存在，选 B（拒绝）要么另做一个新工具/新方法（又回到多入口问题），要么让用户手动改 vault 文件。改期是**确认级**操作，审批卡上用户看得到参数，误复活被批准环节挡一道。

### 设置页数据去向文案（v2 第九节决策 2，2026-11-28 主人裁定 A：两句都加）

两句都要有，措辞可微调但两句缺一不可。

| 场景 | 位置 | 文案（规范原文） |
|---|---|---|
| 远端 provider | 「高级：接入方式与 API 凭据」面板内（`SettingsPage.tsx:1312-1327` 的 `<details>` 展开区） | **使用该模型时，对话内容与所选项目的片段会发送到其服务方** |
| `local-cli` 且 `nativeTools` | 「使用 CLI 原生工具（完整 agent 模式）」复选框说明处（`SettingsPage.tsx:1263-1277`） | **该模式允许 CLI 自行读写本库与联网，不受片段边界约束** |

**为什么第二句不能省**：`nativeTools: true`（`shared/types.ts:50-54`）时 CLI 子进程的 cwd 就是 vault（`cli-agent-client.ts:1051`、`:1128`），它用自己的工具读写文件、跑命令、上网——**这条通道天然绕过任何 ContextBuilder**。第二句不加，「只发当前任务需要的片段」这条承诺对 `nativeTools` 场景事实上失效而用户不知情，文档承诺与实际行为不符。

**渲染条件必须是精确条件**：第一句当且仅当所选 provider 走远端（`anthropic` / `openai-compatible`；`ollama` 默认本机 `127.0.0.1`，`model-client.ts:189`；`local-cli` 是本机子进程——三者都不渲染）；第二句当且仅当 `local-cli && nativeTools === true`。**不要用「非 local-cli」近似第一句**，`ollama` 会误报。


## 与现有代码的接缝（基线 `62c2ba0`，行号已于 2026-11-28 全部重核）

**复用不动**：
- 领域服务全套：planner（`src/main/planning/workspace-planner.ts` + `busy-day.ts:23`）、`CommitmentService`（`src/main/commitments/service.ts:68`，改期复用其 `resolve({ newDue })`，见 P3 行）、practice/knowledge/memory/availability。
- vault：用户业务事实唯一来源（方案 §二⑤）。
- 模型接入：`ModelClient`（`src/main/agent/model-client.ts:84`）/ `StreamingModelClient`（`:107`）与 provider 配置（ai-sdk / local-cli 两族，`shared/types.ts:37-55`）——Runtime 的引擎层坐在其上，首版不迁移全部 provider（草稿 5：不同时迁移执行引擎和所有模型供应商，先打通一个已配置、支持工具调用的模型）。
- 上下文收集先例：`gatherContext`（`src/main/butler/context.ts:86`）——Runtime 的 ContextBuilder 按本次任务选材，不整库塞提示词（正式条款见「ContextBuilder 数据边界」）。

**被替换（对照期保留为 LegacyEngine）**：
- 模型-工具循环：`ButlerService.stream`（`butler-service.ts:275`）+ 循环体（`:338-439`，含 `maxToolSteps`（`:98`、`:122`）、`runTool`（`:741`）、中止处理（`:440-455`）、重试（`model-retry.ts`））。
- 工具表与执行器：`createButlerTools`（`tools.ts:216`）/ `toModelToolDefinitions`（`:1412`）/ `executeButlerTool`（`:1424`）——迁到 ToolGateway 注册表下，行为类标级。

**新增**：`src/main/runtime/`（contracts、RunController、EnginePort、ToolGateway、RunJournal）+ `src/main/runtime/engine-pi/`（均已落地）；`reschedule_commitment` 工具（后端复用 `resolve({ newDue })`，不新增服务方法——见 P3 行）+ `resolve_commitment` 工具 schema 收敛（移除 `newDue`，`tools.ts:989`）；renderer 审批卡组件（订阅运行事件，参照现有流订阅 IPC：`src/main/ipc.ts:210-214` 的 stream/cancel/event 三通道与 `:216-220` 的 runs list/cancel）。

**renderer 现状（重要，别照 v1 想象）**：已有取消通道（`ipc.ts:212` cancel-stream）与运行列表（`:217-220`）；但**渲染层至今没有任何审批 UI**（全仓 `src/renderer/` 无 approval/审批引用）——审批卡属于**待建**，不是「补齐」。生产聊天也未切到 RunController（见「Legacy 退役判据」）。v1 补审批卡与按序号补读，重连不新开协议。


## 运行期工程约束（v2 第二/三/四节）

### commit_plan 幂等键（v2 第三节）

**缺口单列（本节最重要的一条）**：领域层「同计划项不重复建任务」防线**对 `commit_plan` 不生效**——`createTask` 只有带 `planId` + `planItemId` 才触发查重（`workspace/create-workspace-service.ts:521` 判据两字段都非 undefined，命中即返回已有任务 `:523-530`），而 `commit_plan` 不传这两个字段（`runtime/plan-tools.ts:174-187` 只传 workspaceId/title/subject/durationMin/acceptance/due）。**这不是「幂等键还没做」，是「机制在、接线断了」。**

**修复第一步（约 5 行）**：`commit_plan` 调 `createTask` 时带 `planId = "runtime:${runId}"`、`planItemId = 任务序号`——同 runId 的崩溃后重试立即被领域层查重接住。只防「同一次运行的重试」，不防跨运行。

> **状态（截至基线 `62c2ba0`）**：方案 v2 §十把这一步派给了 P4（「随 P4 的 `plan-tools.ts` 改动顺手落」），**P4 已合入（`eabb196`）但未落**——`plan-tools.ts:174-187` 仍不传。与 recover 幂等同类：规范已定、实现未做，验收 27 即其判定。

**跨运行幂等（v1 不做，触发点可判定）**：触发点 = **生产默认引擎切 Pi 的那一批，同批落**。P4 明确不切引擎（`index.ts:229-233` 注释：聊天仍走 `ButlerService.stream`），所以 P4 合并**不是**触发点。任一提前信号出现也提前做：① 晨检/定时 origin 触发 `commit_plan`（`RunOrigin` 已含 `morning-check`，`contracts.ts:14`——无人值守无法逐次批准）；② 真实事故：同一请求产生重复任务（两份相同 date+title）；③ renderer 增加运行重试/重放入口。

实现形态（届时照做）：跨运行键改用内容派生（`planId` 从 runId 换成 `runtime:{workspaceId}:{date}:{canonical tasks 摘要}`），仍落 `create-workspace-service.ts:521-530` 既有查重，journal 回执带 taskIds。**不建议**在网关层做跨运行去重表——跨运行状态放网关会引入第二份持久化，违背「去重是 per-run 语义」的现规范（`tool-gateway.ts:223`）。


### Legacy 退役判据（v2 第四节；量化 spec P4 行的「对照期结束判据」）

**时钟条款（本节最重要的一条）**：退役判据的时钟**从生产默认引擎切 Pi 那一刻开始走**。切之前，L1–L6 一律显示「**不适用（无生产样本）**」，而不是「未达标」。这两种状态必须区分：没样本时任何阈值都永远不满足，「未达标」看起来像差一点、「不适用」才诚实说明根本没开始——混在一起，将来会有人说「你看跑了三个月都满足」而其实一次生产运行都没有。前置事实：生产聊天现在走 Legacy 直连（`index.ts:229-233` 明确「聊天路径本批不切换」，`ButlerService.stream` 仍是唯一生产执行路径），`assembleRuntime` 只装配 `legacy` 一个引擎——切 Pi 是产品翻转，主人批后时钟才走。

**判据（时钟走后全部满足 ⇒ 可退役 LegacyEngine 装配；时钟未走时全部「不适用」）。测量源 = RunJournal：**

- **L1 运行量**：Pi 生产运行 ≥ 100 次（journal `run.started.engineId='pi'` 计数）。
- **L2 零回退**：连续 30 天用户可见的「切回 Legacy」操作 = 0。
- **L3 失败率不劣化**：Pi 的 failed 终态占比 ≤ 基线 + 2 个百分点（journal 按 `run.finished.state` 统计）。基线 = 切换前最近 30 天 Legacy 生产 failed 率——**必须在切换时冻结基线快照**（切完 Legacy 没有生产运行，同期比较届时不可算）。
- **L4 三场景对拍绿**：验收 12 逐字段一致 + 场景二/三对拍在最新 master 全绿。
- **L5 打包门**：验收 11 三步在最近**两个**发布版的打包产物实跑通过。**前置核查**：评估 L5 时先核 P2 打包证据（验收 11 的 JSON 结果文件）是否已在库留档——现在有留档（`docs/pi-selftest-evidence/`）。
- **L6 零 Legacy-only 功能**：非目标清单无「仅 Legacy 可用」条目。当前唯一 Legacy-only 是「无审批直执行」——那是语义差异，恰是退役的理由而非障碍。

**不可退役条件（任一即冻结时钟）**：L4 对拍出现非测试缺陷；L3 连续两周不达标；出现只有 Legacy 能完成的用户场景。

**「退役」要拆两层**：**(a) LegacyEngine 从装配退役**（Pi 成为唯一生产引擎）——可判，即上表；**(b) `ButlerService.stream` 循环体与工具执行器删除**——触 `src/main/butler/`，**越出 Runtime 白名单**，属于另一个 spec。退役动作是单独一批：生产装配移除 legacy + 删 `legacy-engine.ts` + Legacy 专属测试迁移；**不删** `ButlerService.stream`（conversation 持久化仍被聊天历史使用）。该批会触 `butler-service.ts`——按验收 1 白名单口径越界，**需重新裁定白名单**（流程项，非技术项）。

**判据满足后执行退役是产品决策**：届时 Needs you。L1=100 次、L2=30 天是可调参数。


### 三个月后回看的三条架构断言（可执行检查）

三条断言全部已有代码承载，这里只写「届时跑什么命令」。复查机制：不加定时自动化（团队无 CI 定时先例），由 sc-lead 届期开 item 派 sc-review/qa 一次性实跑并留档。

**断言 1：移除 Pi，业务零改动**
- 承载：路径白名单（`tests/main/runtime/path-whitelist.test.ts`，env 门控显式基线）；Pi 零泄漏（`pi-leak.test.ts`，唯一允许前缀 `main/runtime/engine-pi/`）；关 Pi 后场景一逐字段一致（`scenario-plan-pi.test.ts`）。
- 检查：① `RUNTIME_PATH_WHITELIST_BASE=master npx vitest run tests/main/runtime/path-whitelist.test.ts` → 绿；② `grep -r "pi-agent-core" src/ --include=*.ts` → 仅命中 `src/main/runtime/engine-pi/`；③ `npx vitest run tests/main/runtime` 排除 `pi-engine.test.ts`/`pi-leak.test.ts`/`scenario-plan-pi.test.ts` 后全绿。

**断言 2：模型不能自授权限**
- 承载：行为级联合只有 `'query' | 'confirm'`，第三级「注册即违规」（`tool-gateway.ts:24`、`:26`）；标级表唯一权威 `BUTLER_TOOL_LEVELS`（`butler-bridge.ts:22-50`）+ 装配 fail-fast 双向断言（`assertButlerConfirmTools`，`butler-bridge.ts:107-126`）；审批绑定 invocation+参数、无缓存、参数变即新审批（`tool-gateway.ts:356-414`）；只读门（`:303-311`）与权限门（`:312-320`）都来自 `options.readOnly` / `context.permissions`，不来自模型参数。
- 检查：① `npx vitest run tests/main/runtime/gateway.test.ts tests/main/runtime/assembly.test.ts` → 绿；② 静态断言（**待补**，约 10 行）：全部注册工具的 `parameters.properties` 不含 `permissions`/`approved`/`skipApproval` 类键。

**断言 3：业务结果以服务回执为准**
- 承载：完成规则 = 有确认级提交且其后无回执 → `pending-verification`（`run-controller.ts:224-228`）；测试：无回执→待核实、有回执→完成、引擎抛错→失败、「失败不说成功」。
- 检查：① `npx vitest run tests/main/runtime/contracts.test.ts tests/main/runtime/scenario-plan.test.ts` → 绿；② journal 复核脚本（**待补**，约 10 行）：对任一真实 completed run 的 JSONL 断言最后一条确认级 `tool.committed` 的 seq < 某条 `service.receipt` 的 seq。


## 验收（编号可测；分批对应；「最终数据为准」贯穿全部场景）

**架构总验收**
1. 移除 PiEngine 注册（仅留 Fake/Legacy），P0–P4 全部验收用例照常通过；UI 代码、vault 数据、领域服务零改动。可执行形式：对合入 diff 跑 `git diff --name-only <base>...HEAD` 做**路径白名单断言**（允许清单：`src/main/runtime/` 新目录、装配点 `src/main/index.ts` 与 `src/main/ipc.ts`、`package.json` 与 `package-lock.json`（item 61 2026-11-27 裁定：精确锁版本的必然产物，随 package.json 入清单）、`tests/`、`docs/`；**item 61 2026-11-28 sc-lead 裁 A 扩面**（场景二并入 P4 批的机械后果）：`src/main/butler/tools.ts`（`resolve_commitment` 收敛 + `reschedule_commitment` 新增）、`src/main/butler/prompt.ts`（改期指引指向新工具）、`src/shared/butler-stream.ts`（`ButlerReference.kind` 增 `'commitment'`，周总结引用来源）；逐条对应裁定要求的真实触面，不整目录放开；断言进 CI）。

**P0**
2. 每条 RunEvent 序号在单次运行内严格递增且连续（FakeEngine 回放断言）。
3. `cancel` 后运行进入「取消」态，**不再执行任何后续工具**（FakeEngine 注入「工具+取消竞态」负例断言）。
4. 工具网关拒绝未注册工具与未声明行为级的工具：返回 `tool.failed`，模型收到错误回执而不是静默忽略。
5. 重复写入类调用**仅对已提交（`tool.committed`）的调用**去重：同一 `runId` 内同参同范围的调用在首次提交后再次出现即被网关拒绝；**`tool.failed` 后的同参重试放行**——重试被允许，只是不能双写（方案 A1 验收标准 2 原文「取消或重试不能把同一计划写两遍」）。测试拆两条：提交后同参 → 拒；失败后同参 → 放行。
6. `plan_workspace` 拆分后：预览工具**零写盘**（临时 vault 探针断言无文件变化），提交工具才有写入。

**P1（场景一，Fake/Legacy）**
7. 满日项目生成计划：只排 1 件、时长 ≤10 分钟，与直接调用 planner 结果一致（对照 `busy-day.ts:23` 行为）。
8. 用户输入「今天有 30 分钟」：计划按 30 分钟排，planner 收到 `availableMinutes=30`，模型不能在提示词里重算规则。
9. 工具报错时运行结束为「失败」，UI 不出现「已安排」；`run.finished` 事件与落盘数据一致。
10. 同一输入 Legacy 引擎跑两遍，最终计划逐字段一致（模型模拟层用 Fake 固定输出）。

**P2（PiEngine）**
11. 打包后的 Windows Electron 加载锁定版本 `pi-agent-core`：完成一次流式响应、一次工具调用、一次取消（打包产物实跑，非开发机 Node）。
12. 场景一切 Pi 引擎：业务结果与 Legacy 逐字段一致（同 Fake 模型、同临时 vault）。
13. 关闭 Pi 开关后 Legacy 仍可用（回滚路径可用）。
14. Pi 类型零泄漏：`grep -r "pi-agent-core\|from 'pi" src --include=*.ts` 仅命中 `src/main/runtime/engine-pi/`；renderer 与 vault 序列化代码零命中（CI 断言）。

**P3（场景二：改期）**
15. 改期成功后：承诺详情与通知中心读到的 `due` 是同一天（`records.ts:17` 的 `due` 字段，经 `coerceDue`（`records.ts:102`）净化后仍一致）。
16. 无效日期（过去日期、格式错、空串）：服务拒绝、**不写盘**、运行进「失败」；UI 不显示「已改期」。
17. 两条同名承诺：Runtime 先发 `approval.requested` 附两条候选让用户选；未选择前不写盘；候选选择不可经旧工具调用替代（旁路负例见验收 23）。
18. 审批绑定参数：批准 `A→周五` 后模型再提 `A→周六`，必须重新确认，不能用旧批准（网关断言）；把改期伪装成旧工具调用同样无效（见验收 23）。
19. 「准备修改」与「已经修改」事件可区分：`approval.requested` ≠ `tool.committed`；只有服务回执后才产生 committed。

**P4（场景三：周总结）**
20. 复盘输出每条结论附来源记录标识（记录 ID/文件路径）；无记录支撑的结论必须明示「推断」。
21. 请求本周总结时某项目无记录：输出明说「没有记录」，不编补。
22. 场景三运行全程只读：任何写入类工具调用被网关拒绝并记 `tool.failed`（测试注入模型尝试写入的负例）。

**旁路负例（P3）**
23. 旧入口旁路被堵死：模型经 `resolve_commitment` 携带 `newDue` 提改期 → 网关/schema 层拒绝（该工具 schema 已移除 `newDue` 参数，多余参数即拒），不写盘、不产生 `tool.committed`；改期只能走确认级 `reschedule_commitment`，且用户批准后该次调用才落盘（FakeEngine 负例断言）。


**运行期工程（v2 增量；24–29 为 2026-11-28 新增，编号续接、不改动 1–23）**
24. **journal 恢复幂等**（v2 第二节，规范见「RunJournal · 崩溃恢复语义」）：同一个未终态 run 文件连续两次 `recover()`——第一次返回该 runId 并追加 `run.interrupted`，**第二次返回空数组且文件末行 seq 不再增长**。第二个断言是关键：只断言「返回空」会漏掉「仍然重复追加」的实现。另加一条：以 `run.interrupted` 结尾的文件不被再次追加。**当前实现不满足**（`run-journal.ts:111` 只认 `run.finished`）——本条是待落地缺口，**需 P0 批次落地**，现阶段写到测试里就是红灯（先红后绿），不是已绿。
25. **改期复活已结案承诺**（2026-11-28 主人裁定 A，规范见「改期与「复活」语义」）：种一条 `status:'done'` 且带 `resolvedAt` 的承诺 → `resolve({ id, newDue: <明天> })` 后读盘断言 `status==='open'`、**`resolvedAt` 已不存在**（`not.toHaveProperty`，不是断言为空串）、`due` 为新日期。再补一条 dropped 起点的同样断言。落点：`tests/main/commitments.test.ts`（现有 `resolve newDue moves the promise without closing it` 只覆盖 open 起点，`:172-177`）。
26. **复活只由 `newDue` 触发**（同裁定的负向锁定）：一条 `done` 承诺 → `resolve({ id, outcome: 'dropped' })` 后 `due` **逐字符不变**，`status==='dropped'`、`resolvedAt` 是新的。目的：锁死「改期与结掉是两条语义」，防止日后把 `newDue` 顺手接进 outcome 分支。
27. **`commit_plan` 走领域查重**（v2 第三节）：同一 `runId` 的 `commit_plan` 调两次同参（第一次成功后模拟崩溃重试，绕过网关 per-run 去重）→ vault 里该计划项**只有一条任务**（按 `planId`+`planItemId` 命中返回已有任务，`create-workspace-service.ts:521-530`）。断言方式：直接调 `commit_plan` 的执行体两次（不经网关去重），数磁盘上的任务文件。**当前实现不满足**（`plan-tools.ts:174-187` 不传这两个字段）——同为待落地缺口，**需 P0 批次落地**，现阶段为红灯。
28. **数据边界：跨项目承诺不出机**（2026-11-28 主人裁定 A，规范见「ContextBuilder 数据边界」）：临时 vault 建项目 A/B，各写一条 open 承诺 + 一条无归属的全局承诺；运行 `workspaceIds=[A]`，捕获 `streamFn` 实参并序列化 → 断言**含 A 的承诺原文与全局承诺原文**、**不含 B 的承诺原文**。配套负例：出站载荷不含 vault 绝对路径、不含 `sk-` 形串。**注意**：本条只对 Runtime 路径成立；Legacy 不经 ContextBuilder，对拍测试按各自口径断言（见该节「连带项」）。
29. **设置页两句数据去向文案**（2026-11-28 主人裁定 A）：`settings.test.tsx` 类落点，四个渲染态断言——① `anthropic` provider 面板展开 → 见到第一句逐字文案；② `openai-compatible` → 见到；③ `ollama` → **见不到**（本机，别用「非 local-cli」近似）；④ `local-cli` + `nativeTools=true` → 见到第二句；⑤ `local-cli` + `nativeTools` 关闭 → 见不到第二句。文案逐字照「设置页数据去向文案」表。

## 测试点（落点建议）

| 批次 | 测试文件（新建为主） | 关键桩 |
|---|---|---|
| P0 | `tests/main/runtime/contracts.test.ts`、`tests/main/runtime/gateway.test.ts` | `FakeEngine`、临时 vault |
| P1 | `tests/main/runtime/legacy-engine.test.ts`、`tests/main/runtime/scenario-plan.test.ts` | Fake 模型固定输出、现有 `busy-day` 行为 |
| P2 | `tests/main/runtime/pi-engine.test.ts`（单测用 Fake；打包验证走手测清单） | 锁版本依赖 |
| P3 | `tests/main/commitments.test.ts`（验收 25/26 落这里；**不要新建 `tests/main/commitments/` 目录**——该目录不存在，承诺测试原本就在这个单文件）、`tests/main/runtime/scenario-reschedule.test.ts`、`tests/renderer/approval-card.test.tsx`（**待建**，渲染层现无审批 UI） | 临时 vault、假时钟 |
| P4 | `tests/main/runtime/scenario-weekly-review.test.ts` | 只读网关断言 |
| v2 增量 | `tests/main/runtime/contracts.test.ts`（验收 24 恢复幂等）、`tests/main/runtime/scenario-plan.test.ts` 或新建 `plan-idempotency.test.ts`（验收 27）、`tests/main/runtime/context-builder.test.ts`（验收 28，**新建**——`context-builder.ts` 尚不存在）、`tests/renderer/settings.test.tsx`（验收 29） | 脚本化 `streamFn` 捕获实参、临时 vault 双项目 |

## 依赖与冲突

- **实施状态（2026-11-28 更新）**：iter32 已全批收口，P0–P4 已由 sc-build 实施并合入 master（`eabb196` 为 P4 终批）。**本 spec 的 v2 折回是文档改动**，其中验收 24（journal 恢复幂等）、27（`commit_plan` 领域查重）、28（ContextBuilder 数据边界）、29（设置页文案）**尚未实现**——它们需要一批新的施工，不占本 spec 分支。
- **文件交集（按当前 master 重核）**：本轮新增改动落 `src/main/runtime/context-builder.ts`（**新建**）、`src/main/runtime/run-journal.ts`（recover 判据 + pruneOld）、`src/main/runtime/plan-tools.ts`（传 planId/planItemId）、`src/renderer/settings/SettingsPage.tsx`（两句文案）、`src/main/commitments/service.ts`（仅注释/测试，行为不变）、`tests/`。`tools.ts` 与本轮无交集（`reschedule_commitment` 已在 P4 落地）。
- **与 iter34 的交集**：iter34 P0/P1 正在 practice 侧与周统计侧施工，与本轮文件不重叠；但 `SettingsPage.tsx` 是设置页常客，派单时按当时的 `git log` 再核一次。
- 不推 origin（团队边界）；本 spec 分支独立评审，合入由 sc-build 按 sc-lead 派单执行。

## 给 builder 的默认决定（评审可推翻）

1. `pi-agent-core` 版本锁定策略：package.json 精确版本（非 `^`），锁文件入库存许可证与依赖清单（草稿 3：先查许可证/分发义务/依赖清单）。**已落地**：`package.json:34` 为 `1.6.1`。
2. RunJournal 先做单文件 JSON 追加（每 run 一文件、`data/runtime-runs/` 下），不上 state-store、不上 SQLite。**已落地**。
3. 场景一的「预览/提交」拆分用两个工具名（`plan_preview` / `commit_plan`），旧 `plan_workspace` 在网关层保留别名一个迭代后删除。**已落地**（`butler-bridge.ts:30` 注释记现状）。
4. 审批卡确认粒度：一次批准 = 一次工具调用 + 一组参数 + 一个项目范围；会话级「始终允许」不做（草稿 4）。
5. Legacy 的会话摘要（`maybeSummarize`，`butler-service.ts:576`）不迁入 Runtime v1——它是 Legacy 引擎内部实现，Runtime 契约不管对话压缩。
6. 打包验证门（验收 11）作为 P2 的**手测清单**记录在交付报告，不进 CI（CI 没有打包产物）。**已落地**（证据在 `docs/pi-selftest-evidence/`）。
7. **（v2 关闭）改期后端选 `resolve({ newDue })` 复用而非新增 `reschedule` 服务方法**：v2 第五节给了完整的一致性理由，**备选 a 不再评估**（见「已定 9」）。
8. **（v2 新增）跨项目承诺的处理只改 Runtime 路径**：Legacy 的 `gatherContext` 不动。若有人提议「顺手统一 Legacy」，先回答：对照期还需要 Legacy 作回滚底座吗？（需要，则两条路径的差异是有意的）。见「ContextBuilder 数据边界 · 连带项」。

## 风险

- `pi-agent-core` 在打包 Electron 里的兼容性：已实测通过（`docs/pi-selftest-evidence/`，验收 11 三步），但**每次升级 pi pin 都要按「打包产物里的 fetch 行为」复验**（见「引擎适配器 · 升级复验条件」），开发机 Node 跑通不算。
- **未达标在线上跑了多久**：验收 24（恢复幂等）与 27（`commit_plan` 查重）是已写进规范的缺口、实现未做。它们的危险不是「功能缺失」，而是**静默错误**——恢复幂等缺口让 journal 每次启动多一条 marker（日志失真），查重缺口让崩溃重试多建一条任务（用户数据失真）。派新一批时把它们当 P0 优先，别排在「有空再说」。
- 双引擎对照期维护两套调试入口的成本；对照期结束判据已量化为 L1–L6（见「Legacy 退役判据」）。**若判据时钟迟迟不走（生产一直不切 Pi），Legacy 会无限滞留**——这是本 spec 最大的结构性风险，退役判据的「不适用 vs 未达标」区分就是为暴露它而设。
- **v1 当前状态（交付判断的直接事实，不是顺带一提）**：runtime 只在测试与自测钩子中被装配，生产聊天仍走 Legacy 直执行；渲染层没有任何审批 UI。切流前必须完成审批 UI 与生产装配，**二者都不是本 spec 的批次产物**。没有审批 UI 就没有「模型不能自授权限」这条的兑现路径；没有切 RunController 就没有对外的 runtime。
- 云端模型的数据出机边界：v2 已补条款（「ContextBuilder 数据边界」），但**ContextBuilder 尚未实现**——现在 PiEngine 只收静态 systemPrompt。写 ContextBuilder 之前，Pi 路径的出站载荷实际上没有集中约束点。

## 已定（不再翻转的裁决）

1. 2026-11-27 主人批准立项，走 spec 流程；实施等 iter32 收口（item 61）。
2. v1 不 fork Pi、不引入完整 Pi Coding Agent（方案 v1 开头 + item 61）。
3. 首批三场景与顺序：先计划、再改期、最后复盘（方案 §一）。
4. 方案 v1 群发被 502 截断，spec 以「已发出部分 + 草稿回收」为准绳、未定处标「spec 填充，待方案 v2 确认」（sc-lead 2026-11-27 批准，回执 `msg_4d3ebd034038`；sc-lead 负责向主人如实报告截断一事）。
5. 团队边界：本分支不推 origin；合入由 sc-release 收口。
6. 2026-11-27 sc-review 评审：三条阻断已折叠——工具实数 19（原误写 14）、改期复用 `resolve({ newDue })` 并收敛旧入口（原「接缝空缺需新增方法」系误判）、去重仅限已提交调用；非阻断 4/5 一并折叠（验收 1 改路径白名单断言、P2b 合入后行号重核注记），非阻断 6 仅记录不改。评审同时声明：其无群历史读取通道，落盘原文的逐字一致性采信 sc-spec 的逐字回收 + sc-lead 批准回执（见「已定 4」）。
7. 2026-11-27 sc-lead 裁定：验收 1 白名单补 `package-lock.json`（锁定 pi-agent-core 精确版本依赖的必然产物）；实现 `db10277` 已按此落地，本 spec 文本随裁定补齐。2026-11-28 sc-lead 裁 A 扩面（场景二并入 P4 批的机械后果）：白名单另加 `src/main/butler/tools.ts`、`src/main/butler/prompt.ts`、`src/shared/butler-stream.ts`，逐条对应真实触面，不整目录放开。
8. **2026-11-28 主人裁定：三件产品决策全部选 A**（sc-lead 转达，本 spec 按方案 v2 终稿 v0.5 `a6e8039` 第九/十节折入）：
   - **决策 1 · 跨项目承诺不出机**：ContextBuilder 只发本项目承诺 + 用户未指明的全局承诺（见「ContextBuilder 数据边界 · 跨项目承诺」）。**连带：对照期 Legacy（不圈定）与 Pi（圈定）数据面不同，对拍测试按各自口径断言——有意设计，不是缺陷。**
   - **决策 2 · 设置页加两句数据去向说明**：远端 provider 一句 + `local-cli && nativeTools` 一句，措辞可微调但两句都要有（见「设置页数据去向文案」）。
   - **决策 3 · 改期已结案承诺保留复活并写明**：行为不变，写进契约 + 测试锁定，工具描述加「改期一条已完成的承诺会重新打开它」（见「改期与「复活」语义」）。
9. **2026-11-28（v2 第五节）：不再评估「显式 `reschedule` 服务方法」备选**。原「给 builder 决定 7 备选 a」关闭。理由：`resolve` 是改期唯一权威入口，拆开即造第二个改期入口，两处各自维护下界校验、迟早漂移；工具层的「结掉/改期」分离已由 P4 完成。本决定与「已定 8 决策 3」配套——复活语义留在 `resolve` 内，改动面最小。
10. **v2 「spec 填充」标记闭合对照（本版已完成；左侧行号是折回前 `50206b8` 版的标记位置，仅供追溯，不是当前行号）**：`:5` 口径说明改为 v2 已补 ｜ `:25` 批次拆分确认（维持 P0–P4，P3 已被装配批实现的事实已记）｜ `:37/:41` 非目标表述 | `:52` RunRequest 字段确认 = 现实现 ｜ `:68` RunJournal 形态 = 「RunJournal」节 ｜ `:158` 决定 7 备选 a 关闭 = 「已定 9」｜ `:163/:165` 两条风险按 v2 改写（见「风险」）。
11. **2026-11-28 本轮新增的「已知缺口」（不是 spec 填充，是实现欠账）**：验收 24（journal 恢复幂等）、27（`commit_plan` 领域查重）原定随 P4 落地，P4 已合入而未做；28（ContextBuilder）、29（设置页文案）是 v2 新增、尚未派工。四条在「风险」与「依赖与冲突」两处都写了，派单以它们为 P0。
