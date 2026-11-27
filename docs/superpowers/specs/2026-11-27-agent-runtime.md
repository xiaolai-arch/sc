# ASAKI iter（立项）：Agent Runtime 自研底座 v1 —— Pi 首版执行引擎

> 状态：待 sc-review 评审 ｜ 分支 `xiaolai/agent-runtime-spec` ｜ 基线 master `6dd3253`（2026-11-27）
> 方案来源：`docs/superpowers/reports/2026-11-27-agent-runtime-plan-v1.md`（群发原文 + 断点考据与草稿回收）。
> **该方案 v1 群发正文被 API 502 截断**（止于「## 三、我们真正要自研的四」），后半篇从未生成；本 spec 以已发出部分（方案 §一/§二）为准绳，以同群三轮草稿回收件补后半，**凡方案没定的写明「spec 填充，待方案 v2 确认」**（sc-lead 2026-11-27 批准此口径）。方案补全成 v2 后，增量按老流程折入本 spec。

## 一句话

在 Electron 主进程自研 `ASAKI Agent Runtime`：我们定义一次任务的生命周期、模型可见数据边界、工具写入条件和失败恢复；Pi（`pi-agent-core`，锁版本）只作第一版可替换执行引擎，负责驱动模型调用工具、回送结果、流式事件。**架构总验收：移除 Pi，界面、领域工具、用户数据、验收用例零改动，只换执行适配器**（方案 v1 开头原文）。

## 为什么

- 主人 2026-11-27 批准立项，指定走 spec 流程（item 61）；实施排在 iter32 收口之后，spec 与 iter32 并行。
- 现状：管家的模型-工具循环长在 `ButlerService.stream`（`src/main/butler/butler-service.ts:275`，循环体 `:380-450`）里，工具执行、权限、重试、中止与业务服务耦合在同一循环；换模型引擎或加第二个入口（晨检、Web）都要复制这套循环。方案要把它抽成可替换的底座。
- 方案点名要守住的两条设计（方案 §二）：**当前时间由一次运行统一提供**（防止工具与 planner 在午夜两侧各算两个「今天」——本仓库已有注入先例：`butler-service.ts` 的 `now` 注入、晨检 provider/now 注入）；**业务结果以服务回执为准**（模型提前说「改好了」不算成功）。

## 首批三场景（顺序固定，方案 §一原文）

| # | 场景 | 逼出的能力 | 用户可见结果（验收以最终数据为准，不以回复措辞为准） |
|---|---|---|---|
| 1 | **安排今天的计划** | 读对项目和日期、调用现有 planner，不让模型重写业务规则 | 满日只排 1 件、最多 10 分钟（`src/main/planning/busy-day.ts:23` 返回 `BUSY_DAY_MINUTES`）；用户明确给 30 分钟则按输入 |
| 2 | **把一条承诺改到周五** | 选中正确记录、校验日期、可靠写入、区分「准备修改」和「已经修改」 | 改期后详情与通知中心同日期；无效日期不写盘 |
| 3 | **总结这一周** | 只读跨项目取事实、区分用户记录与模型推断 | 复盘指出结论来自哪条记录；没有记录就说明没有，不编补 |

## 批次（P0–P4；「spec 填充」——方案未定批次，此拆分待 v2 确认）

| 批次 | 内容 | 依赖 |
|---|---|---|
| **P0 底座骨架** | 契约三件套（RunRequest / RunEvent / RunState 六态）+ `EnginePort` + `FakeEngine`（测试里稳定制造失败）+ `RunJournal` + `ToolGateway`（工具注册表、三级行为、去重）；现有 19 个管家工具经网关**全部**重新注册（`createButlerTools`，`tools.ts:203`，名单以该函数返回为准）；`plan_workspace`（`tools.ts:389`，现在生成+写入一体）拆成**预览（只读）与提交（写入）两个工具** | 无 |
| **P1 场景一 + Legacy 对照** | `LegacyEngine` 包装现有 `ButlerService.stream`（映射 `ButlerStreamEvent`（`src/shared/butler-stream.ts:30`）→ RunEvent）；场景一在 Fake/Legacy 上端到端走通：取消、确认、失败不说成功 | P0 |
| **P2 PiEngine 接入** | `engine-pi` 适配锁定的 `pi-agent-core`（上游 `main` 标 **1.6.1、MIT、Node ≥ 22.19.0**，方案草稿 3/4）；**硬门：打包后的 Windows Electron 里**完成一次流式、一次工具调用、一次取消（开发机 Node 跑通不算）；场景一切到 Pi 与 Legacy 对照；Pi 类型零泄漏 | P0、P1 |
| **P3 场景二：承诺改期** | 改期语义**已存在**，不新增服务方法：`CommitmentService.resolve({ newDue })`（`service.ts:196`；日期校验 `:204-206`；改期下界唯一权威 `:211-219`，注释自证所有入口都走 `resolve`；写 due+恢复 open+清 resolvedAt `:229-232`），旧 `resolve_commitment` 工具已带 newDue 入口（`tools.ts:938`，描述 `:940`）。v1 做法：新增 `reschedule_commitment` 工具（**确认级**）以后端 `resolve({ newDue })` 为唯一改期路径；旧 `resolve_commitment` 收敛为纯「结掉」语义——工具 schema 移除 `newDue`，网关校验拒绝携带 `newDue` 的旧工具调用（防确认级审批被旁路）；renderer 审批卡（approval.requested → approved/rejected）+ 同名承诺先让用户选。（备选「新增显式 `reschedule` 服务方法并收敛 newDue」——接口重构，触 reminders page/IPC/工具全部入口——记入给 builder 决定 7，留 v2 评估） | P0（网关审批）；不依赖 P2，Legacy/Pi 都能跑 |
| **P4 场景三：周总结** | 只读跨项目周复盘工具（来源引用 + 「没有记录就说明没有」）；对照期结束判据：Legacy 退役评估 | P0；建议在 P2 后 |

**实施排期**：iter32 的 P0–P3 全部收口后，才由 sc-build 派本 spec 的批次（item 61 已定，主人 2026-11-27）。文件交集见「依赖与冲突」。

## 非目标（方案 §一/§二原文；★ 为 spec 填充待 v2 确认）

- 不 fork Pi，不引入完整 Pi Coding Agent（方案 v1 开头）。
- 不做多 Agent 协作、插件市场、任意 shell、全库向量化、自动后台写入（方案 §一）。
- 云同步、多用户/多账号：**v1 不做**（item 61 派单要点；方案正文未展开，★待 v2 确认表述）。
- 六个 Orca bot 是研发分工，不复制进用户桌面产品（方案 §一）。
- Runtime 不定义业务规则：「满日排多久」「承诺能改到哪天」仍归领域服务（方案 §二）。
- Pi 的消息类型、错误类型、会话文件格式不进 UI 或 vault（方案 §二③）。
- 模型不能自授权限；不给模型通用文件写入绕过服务（方案 §二④）。
- 聊天记录不当第二份任务/承诺数据库；RunJournal 不记密钥与完整提示词（方案 §二⑤；草稿 4）。
- v1 不拆独立守护进程、不开本地 HTTP 端口，不做独立 CLI / Web 客户端（草稿 5）。
- 首版不注册：删除类、批量改动、对外发送工具（草稿 4 工具契约第三级）。

## 数据与契约

### RunRequest（草稿 3/4；字段为「spec 填充，待 v2 确认」）

`runId`、`sessionId`、发起来源（chat / 晨检 / 用户主动操作）、项目范围、用户输入、引擎选择、预算（模型调用次数上限）、取消信号、本次统一时钟 `now`。理由（草稿 3 原文）：用户在聊天里说「改到周五」和晨检读到同一句话，权限不能一样。

### RunEvent 与 RunState（草稿 4 运行契约）

- 事件至少含：`run.started`、`text.delta`、`approval.requested`、`tool.committed`、`tool.failed`、`run.finished`；每条带 `runId` 与**递增序号**。映射参照现有 `ButlerStreamEvent`（`src/shared/butler-stream.ts:30-51`）与 `ModelStreamEvent`（`src/main/agent/model-client.ts:88-105`）。
- 状态六态：**执行中 / 等待确认 / 完成 / 失败 / 取消 / 结果待核实**。**「模型停止输出」≠「任务完成」**（草稿 4 原文）——完成必须由服务回执驱动。
- 客户端只认识 `start` / `subscribe` / `approve` / `cancel` / `getRun`（草稿 4）；断线后按序号补读。

### 工具三级行为（草稿 4 原文，ToolGateway 执行依据）

1. **查询和预览**：可自动执行（读周可用性、生成计划预览）。若现有工具同时会写入，先拆成预览与提交，不能只改工具名把写入当只读。
2. **修改本地数据**：默认展示变更摘要并**确认**；批准绑定这一次操作、这个项目、这组参数；参数变了就重新确认。
3. **删除、批量改动、对外发送**：v1 不注册。

### RunJournal（草稿 4 `journal` 模块；持久化形态为「spec 填充」）

本地记录每次运行的状态、批准了什么、工具是否提交、如何恢复。**不成为第二份计划/承诺数据库**；默认不记密钥与完整提示词。崩溃恢复语义沿用现有先例：`ConversationRunStore` 把重启后仍活跃的运行显式标记中断（`src/main/butler/conversation-runs.ts:123`，`RUN_INTERRUPTED_MESSAGE` `:13`「应用已退出，本次生成中断。」）。建议实现为独立 JSONL 目录（每 run 一文件，追加写），不进 `JsonStateStore`（`src/main/state-store.ts:33` 的缓存-写队列模型面向设置类小对象，运行日志是追加型数据）。

### 引擎适配器

- `PiEngine`：接 `pi-agent-core`，锁定版本依赖，**不 fork、不复制上游源码改名**（草稿 3/5）。
- `LegacyEngine`：包装现有管家（`ButlerService.stream`）作对照与回滚（方案 §二③）。
- `FakeEngine`：测试里稳定制造失败/取消/重复调用（方案 §二③）。
- 只有适配层允许 `import` Pi 包；业务代码出现 `import pi` 即评审打回（草稿 5）。

## 与现有代码的接缝（基线 `6dd3253`，行号已复核）

**复用不动**：
- 领域服务全套：planner（`src/main/planning/workspace-planner.ts` + `busy-day.ts:23`）、`CommitmentService`（`src/main/commitments/service.ts:68`，改期复用其 `resolve({ newDue })`，见 P3 行）、practice/knowledge/memory/availability。
- vault：用户业务事实唯一来源（方案 §二⑤）。
- 模型接入：`ModelClient`（`src/main/agent/model-client.ts:84`）/ `StreamingModelClient`（`:107`）与 provider 配置（ai-sdk / local-cli 两族）——Runtime 的引擎层坐在其上，首版不迁移全部 provider（草稿 5：不同时迁移执行引擎和所有模型供应商，先打通一个已配置、支持工具调用的模型）。
- 上下文收集先例：`gatherContext`（`src/main/butler/context.ts:86`）——Runtime 的 ContextBuilder 按本次任务选材，不整库塞提示词。

**被替换（对照期保留为 LegacyEngine）**：
- 模型-工具循环：`ButlerService.stream`（`butler-service.ts:275`）+ 循环体（`:380-450`，含 `maxToolSteps`（`:98,122`）、`runTool`（`:734`）、中止处理（`:441-447`）、重试（`model-retry.ts`））。
- 工具表与执行器：`createButlerTools`（`tools.ts:203`）/ `toModelToolDefinitions`（`:1288`）/ `executeButlerTool`（`:1300`）——迁到 ToolGateway 注册表下，行为类标级。

**新增**：`src/main/runtime/`（contracts、RunController、EnginePort、ToolGateway、RunJournal）+ `src/main/runtime/engine-pi/`；`reschedule_commitment` 工具（后端复用 `resolve({ newDue })`，不新增服务方法——见 P3 行）+ `resolve_commitment` 工具 schema 收敛（移除 `newDue`）；renderer 审批卡组件（订阅运行事件，参照现有流订阅 IPC：`src/main/ipc.ts:195-197` 的 stream/cancel/event 三通道与 `:202-203` 的 runs list/cancel）。

**renderer 现状**：已有取消通道（`ipc.ts:196` cancel-stream）与运行列表（`:202-203`）；v1 补审批卡与按序号补读，重连不新开协议。

## 验收（编号可测；分批对应；「最终数据为准」贯穿全部场景）

**架构总验收**
1. 移除 PiEngine 注册（仅留 Fake/Legacy），P0–P4 全部验收用例照常通过；UI 代码、vault 数据、领域服务零改动。可执行形式：对合入 diff 跑 `git diff --name-only <base>...HEAD` 做**路径白名单断言**（允许清单：`src/main/runtime/` 新目录、装配点 `src/main/index.ts` 与 `src/main/ipc.ts`、`package.json`、`tests/`、`docs/`；断言进 CI）。

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

## 测试点（落点建议）

| 批次 | 测试文件（新建为主） | 关键桩 |
|---|---|---|
| P0 | `tests/main/runtime/contracts.test.ts`、`tests/main/runtime/gateway.test.ts` | `FakeEngine`、临时 vault |
| P1 | `tests/main/runtime/legacy-engine.test.ts`、`tests/main/runtime/scenario-plan.test.ts` | Fake 模型固定输出、现有 `busy-day` 行为 |
| P2 | `tests/main/runtime/pi-engine.test.ts`（单测用 Fake；打包验证走手测清单） | 锁版本依赖 |
| P3 | `tests/main/commitments/reschedule.test.ts`、`tests/main/runtime/scenario-reschedule.test.ts`、`tests/renderer/approval-card.test.tsx` | 临时 vault、假时钟 |
| P4 | `tests/main/runtime/scenario-weekly-review.test.ts` | 只读网关断言 |

## 依赖与冲突

- **iter32 优先**：实施等 iter32 全批收口（item 61，主人 2026-11-27）。本 spec 是文档工作，不占 worker。
- 文件交集：本 spec 主要落 `src/main/runtime/`（全新）与 `src/main/commitments/service.ts`（iter32 各批未触碰）、`src/main/ipc.ts`（新增通道，iter32 未触碰）；`tools.ts` 仅在 P0 注册表迁移时触碰——iter32 P2b（回访阶梯）改同文件 `:839` 的 `schedule_revisit` 内部，冲突面小但派单时需声明先后。**P2b 合入后 `tools.ts` 尾部净增约 +35 行，`:1288/:1300` 等尾部锚点届时偏移（`:203/:389` 不受影响）——派单与实施按合入后的新 master 重核行号。**
- 不推 origin（团队边界）；本 spec 分支随 iter32 之外独立评审。

## 给 builder 的默认决定（评审可推翻）

1. `pi-agent-core` 版本锁定策略：package.json 精确版本（非 `^`），锁文件入库存许可证与依赖清单（草稿 3：先查许可证/分发义务/依赖清单）。
2. RunJournal 先做单文件 JSON 追加（每 run 一文件、`data/runtime-runs/` 下），不上 state-store、不上 SQLite。
3. 场景一的「预览/提交」拆分用两个工具名（`plan_preview` / `commit_plan`），旧 `plan_workspace` 在网关层保留别名一个迭代后删除。
4. 审批卡确认粒度：一次批准 = 一次工具调用 + 一组参数 + 一个项目范围；会话级「始终允许」不做（草稿 4）。
5. Legacy 的会话摘要（`maybeSummarize`，`butler-service.ts:576`）不迁入 Runtime v1——它是 Legacy 引擎内部实现，Runtime 契约不管对话压缩。
6. 打包验证门（验收 11）作为 P2 的**手测清单**记录在交付报告，不进 CI（CI 没有打包产物）。
7. 改期后端选 `resolve({ newDue })` 复用而非新增 `reschedule` 服务方法（P3 行）：服务注释自证 `resolve` 是改期唯一权威入口（`service.ts:211-216`），新增方法会造成第二路径、破坏「一条写入路径」；备选 a（显式 `reschedule` 方法并收敛 newDue，接口重构、迁移全部入口）若 v2 认为「resolve 兼两职」语义不清再评估。

## 风险

- `pi-agent-core` 在打包 Electron 里的兼容性未知（上游标 Node ≥ 22.19.0，Electron 内置 Node 版本需核对；不兼容则先比兼容版本或隔离进程代价，**不为此升级整个产品**，草稿 3）。
- 方案 v2 未出：本 spec 的批次拆分、契约字段、RunJournal 形态均为「spec 填充」，v2 到达后可能折入改动（预期是字段级，不是结构级）。
- 双引擎对照期维护两套调试入口的成本；对照期结束判据放 P4，避免 Legacy 无限滞留。
- 云端模型的数据出机边界（只发当前任务需要的片段）在草稿里反复出现但方案正文未定条款——spec 填充为 ContextBuilder 验收点（验收 22 只读断言部分覆盖），待 v2 补隐私条款。

## 已定（不再翻转的裁决）

1. 2026-11-27 主人批准立项，走 spec 流程；实施等 iter32 收口（item 61）。
2. v1 不 fork Pi、不引入完整 Pi Coding Agent（方案 v1 开头 + item 61）。
3. 首批三场景与顺序：先计划、再改期、最后复盘（方案 §一）。
4. 方案 v1 群发被 502 截断，spec 以「已发出部分 + 草稿回收」为准绳、未定处标「spec 填充，待方案 v2 确认」（sc-lead 2026-11-27 批准，回执 `msg_4d3ebd034038`；sc-lead 负责向主人如实报告截断一事）。
5. 团队边界：本分支不推 origin；合入由 sc-release 收口。
6. 2026-11-27 sc-review 评审：三条阻断已折叠——工具实数 19（原误写 14）、改期复用 `resolve({ newDue })` 并收敛旧入口（原「接缝空缺需新增方法」系误判）、去重仅限已提交调用；非阻断 4/5 一并折叠（验收 1 改路径白名单断言、P2b 合入后行号重核注记），非阻断 6 仅记录不改。评审同时声明：其无群历史读取通道，落盘原文的逐字一致性采信 sc-spec 的逐字回收 + sc-lead 批准回执（见「已定 4」）。
