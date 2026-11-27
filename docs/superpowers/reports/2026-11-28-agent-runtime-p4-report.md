# Agent Runtime P4 终批 交付报告（item 61，批次 5/5）

- 分支 `xiaolai/agent-runtime-p4`，基线 master `ebfd0fd`（1.3.0），单分支 6 提交，**未推 origin**。
- 顶端提交：`3d535b0`（提交清单见文末）。本批全部 24 个文件、+2067/−57 行。
- 中途收到 sc-lead 架构审计裁定（msg_35bbdcee1ca1）：F3 双时钟绑定=硬前置（本批做）、F7 白名单 `src/main/butler/tools.ts`（本批做）、F6 P2 证据补档（本批做）、F1 生产切引擎（明确不做）、F4 `budget.maxModelCalls` 无消费方（只记 file:line）、F5 审批槽并发覆写（item 71）。

## 五门禁（提交后实跑，数字逐字）

在最终代码顶端提交上实跑（typecheck/typecheck:e2e/vitest/build/e2e 与白名单全部绿色；交付报告为 docs-only 提交，随后复跑五门禁数字不变）：

| 门禁 | 输出（逐字） | 退出码 |
|---|---|---|
| `npm run typecheck` | （无输出，tsc node + web 双项目零错误） | 0 |
| `npm run typecheck:e2e` | （无输出，零错误） | 0 |
| `npx vitest run --maxWorkers=4` | `Test Files  219 passed \| 1 skipped (220)`；`Tests  2413 passed \| 3 skipped (2416)`；`Duration  95.55s` | 0 |
| `npm run build` | `✓ built in 540ms`（renderer 段末行；main/preload/renderer 三段全绿） | 0 |
| `npm run test:e2e` | `26 passed (1.1m)` | 0 |

Runtime 显式基线（纪律 2，存档）：

- `RUNTIME_PATH_WHITELIST_BASE=ebfd0fd npx vitest run tests/main/runtime/path-whitelist.test.ts` → `Test Files  1 passed (1)` / `Tests  1 passed (1)`，退出码 0（`ebfd0fd` = 分支起点、任务申报基线）。合入 diff（24 文件）全部落在扩面后的白名单内。
- 全量 vitest（gate 3）未设该环境变量，path-whitelist 按设计 skip（`1 skipped` 文件、`3 skipped` 测试即它，item 67 裁定的 env 门控口径）。

**对 master merge-tree 探测（交付前）**：master 已前进到 `d8fc24f`（iter30 语义改写 + fix-promise-tag，均不触 runtime/butler 工具面）。`git merge-tree --write-tree master HEAD` → 输出树 `caff371`、退出码 0，**零冲突**。

## 正事

### ① 场景二：承诺改期（验收 15–19、23）

- 新工具 `reschedule_commitment`（确认级）：`src/main/butler/tools.ts:1042`；改期唯一路径 = `CommitmentService.resolve({ newDue })`（不新增服务方法，spec P3 行既定）；schema `required:['newDue']` + `additionalProperties:false`（`src/main/butler/tools.ts:1056-1063`）；同名歧义探测钩子 `approvalCandidates`（`:1065-1092`：id 已给或唯一匹配 → null；多处匹配 → 候选 `{id, label:原文, detail:到期}`，匹配口径与 `CommitmentService` 一致——精确优先、其次唯一子串）。
- 旧 `resolve_commitment` 收敛纯「结掉」：描述改写（`src/main/butler/tools.ts:991`）；schema 移除 `newDue`（required 只有 outcome）；执行体第一道拒绝改期意图（`:1017-1021`「改期请用 reschedule_commitment 工具」），随后才校验 outcome。
- 提示词指引指向新工具：`src/main/butler/prompt.ts:46`（任务书写的 `check-ins/prompt.ts:46` 实际是 `src/main/butler/prompt.ts`，以实际仓库为准）。
- 网关层（`src/main/runtime/tool-gateway.ts`）：
  - schema 层未声明参数拒绝 `unknown-arg`：`:141-152`（`undeclaredArguments`：仅当工具声明 `additionalProperties:false` 时生效；只校验顶层键）；调用链上的拒绝点 `:320-330`。验收 23 的旁路在此被堵死——不写盘、无 `tool.committed`。
  - 候选探测 + 强制选择：`:349-361`（probe >1 才附候选；probe 抛错按工具失败，不静默放行）；审批事件带候选 `:375-381`；`decide` 批准必须带合法 selection，否则仍待选返回 false `:257-263`；选中 id pin 进参数 `:392-406`。
  - **审批绑定参数（验收 18）**：无审批缓存——每次 invoke 各自等待自己的 Promise（`:362-382`）；A→周五 批准后 A→周六 是新审批；驳回记 `tool.failed(reason=rejected)`；已批准的第一次调用照常提交。
  - 事件可区分（验收 19）：`approval.requested` 与 `tool.committed` 是两个事件类型，committed 只在服务回执成功后发射（`:422`）。
  - 自查补的缺陷：**pin 后去重复查**（`:392-406`）——选择改变最终参数（id pin）→ 去重键改变，必须在执行前按最终参数再查一次，否则「选中同一候选」的重复调用会绕过早先的检查。已补网关测试断言（同选择第三次调用 → duplicate，执行体只跑一次）。
- 只读拒绝顺序：readOnly 检查在 normalize 之前（`:296-304`），与 permissions 门并存。
- renderer 审批卡：**未建，现状与挂接建议见下文专节**。

测试 `tests/main/runtime/scenario-reschedule.test.ts`（7 条，FakeEngine 端到端 + Legacy 对照）：
`验收 15：改期成功后承诺详情与通知中心读同一 due（Fake 路径，唯一入口 reschedule_commitment）`；`验收 16：无效日期（过去/格式错/空串）服务拒绝、不写盘、运行「失败」，UI 不出现「已改期」`；`验收 17：同名承诺 → approval.requested 附候选让用户选；未选择不落盘；选中后只有被选记录改期`；`验收 18：审批绑定参数——批准 A→周五后再提 A→周六，必须重新确认，不能沿用旧批准`；`验收 19：approval.requested ≠ tool.committed 可区分；只有服务回执后才产生 committed`；`验收 23（旁路负例）：resolve_commitment 携带 newDue → 网关 schema 层拒绝，不写盘、无 committed；reschedule 正路可用`；`Legacy 对照：resolve_commitment+newDue 在 Legacy 引擎上是工具失败，运行按失败收尾`。
另有单测：`tests/main/butler-tools.test.ts`（resolve newDue 拒绝 ×旧用例重写、reschedule 正/坏/缺参、候选探测歧义/唯一/id 三态）；`tests/main/butler-service.test.ts`（花名册 20）。

### ② 场景三：周总结（验收 20–22）

- 新工具 `weekly_review`（查询级，全程零写盘）：`src/main/runtime/weekly-review.ts:59`（`buildWeeklyReviewTool`）。跨项目读取运行允许范围内的各 workspace 的任务/笔记/记忆/承诺（周一起始 `mondayOf`，`weekStart?` 可指定）；每条事实带 `source: { recordId, kind, path? }`（`:45`、任务 `:127`、笔记 `:141`、记忆 `:158`、承诺 `:187`）；无归属承诺单列 `unassignedCommitments`；结果附 `references` 数组（网关缝④发射）。工具描述硬性要求（`:64`）：每条结论标 `source.recordId`、无记录支撑必须「推断」、`hasRecords=false` 的项目明说「没有记录」——「区分记录与推断」由模型在转述层执行，工具只负责给足事实与标注（`:19` 注释）。
- 空项目：`noRecordNotice`（「X本周没有记录。」），且该项目不产生 references。
- 测试 `tests/main/runtime/scenario-weekly-review.test.ts`（4 条）：
`验收 20：周复盘每条结论附来源记录标识（recordId / kind / path），references 事件与事实同源`；`验收 21：某项目本周无记录 → 明说「没有记录」，不编补任何事实`；`验收 22：场景三全程只读——注入模型尝试写入 → 网关拒绝、记 tool.failed（reason=permission）、任务与承诺零变化`；`周复盘：跨项目——无归属项目的承诺也出现在结果里（不丢事实）`。
- 注入负例形态：`RunRequest.readOnly:true` + scripted 模型被指使调 `create_task` 与 `reschedule_commitment` → 两者都被拒（`:296-304` 只读拒绝，`只读` 文案进 error），查询级 `weekly_review` 照常执行。

### ③ references 事件类型（缝④，两适配器补映射）

- 契约：`src/main/runtime/contracts.ts:138-142`（RunEvent 载荷 `references`，注释即实现）；EngineEvent Extract 加 `references`（`:154-165`）。
- Legacy：`src/main/runtime/legacy-engine.ts:96-98`（原样透传 `items`），映射表行 `:44` 更新；健壮性测试期望表加 `references`。
- Pi：**无原生 references 事件**——选型：references 发射放在 **ToolGateway 共享缝**（`tool-gateway.ts:423-428`：工具返回值携带合法 `references` 数组即发射，`referencesOf` `:155-171` 按 `BUTLER_REFERENCE_LABELS` 校验 id/kind/title，非法形状不发射）。这样 Legacy（若未来走网关执行工具）与 Pi 同一条缝，两引擎都不重复映射；Pi 适配器只在映射表注明（`pi-engine.ts:58`）。非法/缺 references 的返回值静默无数据（不报错——references 是增强信息，不是契约必需）。
- kind 扩展：`src/shared/butler-stream.ts:22`（`'commitment'`）+ `:76`（标签「承诺」）——场景三引用承诺来源必需；renderer `openReference` 对未知 kind 优雅降级（已核）。
- 测试：`tests/main/runtime/gateway.test.ts`（合法形状发射、非法形状不发射、committed 顺序在 references 之前）；`tests/main/runtime/legacy-engine.test.ts`（透传 + seq 连续）；`tests/main/runtime/pi-engine.test.ts`（经网关真实执行 references 工具 → 事件到流，自建 harness：`makeHarness` 自建网关，探针工具必须注册到控制器实际用的那张）。

### ④ 生产接线（硬边界守住）

- `src/main/index.ts:227-249`：`registerIpcHandlers` 之后 `RunJournal(userData/data/runtime-runs)` + `assembleRuntime({ journal, engines: { legacy } })` + `recover()`（沿用 ConversationRunStore 崩溃恢复先例，失败仅告警不挡启动）。
- **硬边界逐条**：生产服务引擎未切——聊天仍走 `ipc.ts:202` stream → `ButlerService.stream`（Legacy 直执行）；装配引擎集合 = 仅 Legacy（显式 `engineId`，无默认槽）；Fake 不进生产；`assembleRuntime` 内 `registerButlerTools` + `assertButlerConfirmTools` 启动 fail-fast（P3 批已有）保证漏注册/标级漂移拒绝启动。
- pi-selftest env 钩子保留：`src/main/index.ts:186-200` 注释重写（原「P3 正式装配时移除」的说法被两件事推翻——① P4 生产装配与钩子无依赖冲突；② F6 证据恰经它产出）；是否移除留 sc-review。

### ⑤ journal.append 扇出修复（e531 memo）

- 选型（最小正确实现，沿用既有 run-journal 形态）：`run-controller.ts:350-360`（delta 链）与 `:392-402`（finalize 链）——`journal.append` 包 try/catch：失败**不再中断扇出**（listeners 逐个调用，且逐 listener try/catch 防单点监听器炸链），错误写 `record.journalError` + `console.error`；快照暴露 `journalError?`（`:50`、getRun `:291`）。语义：日志是旁路观察，不能反过来杀死正主事件流；但失败必须可见（快照字段 + 进程日志），不静默吞。
- 测试 `tests/main/runtime/contracts.test.ts`：`e531：journal.append 失败仍扇出事件且 journalError 上快照`——注入第 2 次 append 抛「磁盘满（注入）」，断言 `text.delta` 仍到监听器、快照 `journalError` 精确等于注入文案、journal 文件 seq 出现缺口 `[1,3,4]`（失败那条未落盘，正主流未断）。

### ⑥ Legacy 退役评估（只评估，不动）

对照期结束判据（spec `:32-33`、`:164`「对照期结束判据放 P4，避免 Legacy 无限滞留」）的结论：

1. **判据现状**：Runtime 侧五场景（plan/reschedule/weekly/cancel/approval）在 Fake+Legacy 引擎上全部端到端绿；Pi 在打包 Electron 实跑三步 PASS（见 F6 补档）。但**生产聊天流尚未切到 RunController**——`ButlerService.stream` 仍是唯一生产执行路径。退役的先决条件不是「引擎能力齐了」，而是「切流 + 一段对照观察期」。**结论：本批后 Legacy 仍必须保留**（它同时是生产路径与回滚底座，`src/main/index.ts:229-235` 注释即此意）；建议切流迭代设定判据为：Pi 引擎在生产流上连续 N 天真实使用无 P0/P1 回归 + 五场景验收在 Pi 上复跑绿，届时删 LegacyEngine（删 `legacy-engine.ts` + `engine-selection` 的 legacy 字段 + 场景测试的 Legacy 对照分支，UI/vault/服务零改动——spec 验收 1 的反向操作）。
2. **无审批/无预算约束（P1 裁定）继续成立**：Legacy 直执行路径上 `BUTLER_TOOL_LEVELS` 的 confirm 只是分类元数据，无审批 UI（见下节）；`budget.maxModelCalls` 仍无消费方——F4 记录：`src/main/runtime/contracts.ts:39-47` doc 注释已点名两个应消费的位置（`engine-pi/pi-engine.ts` 的 `agent.prompt(...)` 入口、`legacy-engine.ts` 的 `butler.stream(...)` 包装处），按裁定本批不改（item 71 一并处理）。
3. **commit_plan 幂等键（一行）**：确认级去重键已覆盖 `commit_plan`（`tool-gateway.ts:130-133`：runId+工具名+canonical 参数+workspace 范围），网关内同 run 同参只执行一次；跨 run 幂等（同一天重复提交计划不重复建任务）属服务层语义，Runtime v1 不做，Legacy 退役时随切流迭代决定。

## 「生产工具面变化」（硬边界 2 专节）

本批对**生产但ler工具面**的两处变化（均为 approved spec 文字的执行，非行为反转）：

1. `resolve_commitment` 收敛为纯「结掉」：schema 移除 `newDue`，执行体显式拒绝改期意图（`tools.ts:1017-1021`）。该变化**立即在生产聊天路径生效**——Legacy 的 `executeButlerTool`（`tools.ts:1424`）与网关委托同一份 `createButlerTools()` 实现函数，因此无论走哪条路径，`resolve_commitment+newDue` 都得到同一句拒绝文案；模型被提示词（`prompt.ts:46`）引导改走新工具。
2. `reschedule_commitment` 新增进工具表：`createButlerTools()` 花名册 19→20，**生产聊天路径（Legacy 直执行）上已可被模型调用**。如实说明：在该路径上它只有 `permissions.write` 门（`tools.ts:1436-1443`），**没有**确认级审批 UI——confirm 标级在 Legacy 直执行路径只是分类元数据（这是全部既有确认级工具的既状，非本批新引入）；完整的「审批 → 选择候选 → 提交」强制在引擎切流批随 RunEvent 流一起到达（见下节挂接建议）。同参去重（验收 5）也是网关语义，Legacy 路径暂无。

## renderer 审批卡现状与挂接建议（任务纪律：无挂接点则不建死 UI）

现状核查：生产聊天路径是 `ipc.ts:202-204` 三通道（stream/cancel/event，`ButlerStreamEvent`）+ `:209-210` runs 两通道（快照/取消）；**renderer 全树零处引用 "approval"**；`RunEvent`（含 `approval.requested`/候选/`references`）今天只存在于 Runtime 测试与 pi-selftest 通道，不达 renderer。**结论：本批没有可挂接审批卡的活生产路径**——建了即死 UI，按纪律不建。

挂接建议（留给切流批）：聊天流切 RunController 后，(a) 把 runs 事件通道的载荷升级为 RunEvent（或并列新增 run-events 通道，沿用按 seq 补读的重连先例）；(b) renderer 增加审批卡组件订阅 `approval.requested`：无候选 → 批准/驳回两键（调 `approve(runId, decision)`）；带 `candidates` → 先渲染候选单选（label+detail），批准必须携带 selection（服务端已强制：无合法 selection 返回 false、审批保持待选）；(c) `references` 事件复用现有引用渲染（`BUTLER_REFERENCE_LABELS` 已含新 kind）。

## 白名单最终清单与依据

- 前缀（不变）：`src/main/runtime/`、`tests/`、`docs/`。
- 精确文件：`src/main/index.ts`（④生产装配）、`src/main/ipc.ts`（本批未触）、`package.json`/`package-lock.json`（本批未触）、`src/main/butler/tools.ts`（①工具表本体，F7/裁 A）、`src/main/butler/prompt.ts`（①指引，裁 A）、`src/shared/butler-stream.ts`（③kind 扩展，裁 A）——后三者逐条注明「item 61 2026-11-28 sc-lead 裁 A」，不整目录放开；越界照旧红。
- spec 验收 1 文字同步：`docs/superpowers/specs/2026-11-27-agent-runtime.md:98`。

## 偏差清单（spec/任务书 vs 实际）

1. **F6 补档牵出真实缺陷修复**：补档实跑发现 `pi-fake-model.ts` 对 ESM-only `@earendil-works/pi-ai` 的**值导入**被打包成 CJS require，打包自测通道按入库代码根本起不来（`No "exports" main defined`）。修复为唯一动态 `import()` + 模块级缓存（`pi-fake-model.ts:15-21,123`），与 `pi-engine.ts` 同法。P2 当时的「证据」与入库代码形态互斥，已在 `docs/pi-selftest-evidence/README.md` 如实记录，不粉饰。修复超出「纯补档」字面，但不修则补档不可能产出真实证据。
2. **`src/shared/butler-stream.ts` 触面**：任务书白名单未列，sc-lead 裁 A/F7 明确加入（references kind 扩展是场景三引用承诺的最小触面）。
3. **pi-selftest 钩子未移除**：原注释说 P3 移除；F6 需要它产出证据，移除与否留 sc-review（`index.ts:186-200` 注释已纠正）。
4. **任务书笔误**：`check-ins/prompt.ts:46` 实为 `src/main/butler/prompt.ts:46`。
5. **中期裁定落地位置**：F3 选择「一致性检查 fail-fast」而非「覆盖」——理由：覆盖会把接线错误（两时钟各读各的）静默抹平，测试永远绿、缺陷延迟到用户日界附近才爆；fail-fast 把接线缺陷提前到 start() 即抛（`run-controller.ts:103-114`，判定粒度=本地日相等而非毫秒）。已配同日异时通过/跨日抛错两断言。

## 没做什么（按裁定/纪律）

- F1：生产引擎切换——明确不做（本批硬边界 1）。
- F4：`budget.maxModelCalls` 无消费方——只记 file:line（`contracts.ts:39-47`），不改代码。
- F5：审批槽并发覆写（`tool-gateway.ts` 单 pending 槽，二次审批请求会顶掉前一个的等待 Promise）——按裁定留 item 71。
- renderer 审批卡：无挂接点，不建死 UI（纪律 5；见专节）。
- NSIS 安装产物级自测实跑：未做（现有证据=构建产物 `out/main` 在 Electron 运行时实跑，Electron 45.2.1 / Node 24.22.1，三步全 PASS；与安装产物执行路径相同但非同一壳，`docs/pi-selftest-evidence/README.md` 如实标注）。
- 对照期 Legacy 退役：只评估，未动（⑥）。

## 提交清单（ebfd0fd..HEAD）

1. `107f5af` feat(butler): reschedule_commitment (confirm-level) + resolve_commitment convergence（①工具面 + 15–19/23 场景测试）
2. `19ca62c` feat(runtime): gateway candidates/readOnly/unknown-arg/references + controller bindings（②核心：候选/只读/schema 拒绝/缝④/F3/e531/F4 注）
3. `bc6bfe6` feat(runtime): weekly_review read-only tool + commitment references（场景三 + 桥接）
4. `776f93f` feat(app): production runtime assembly seam + packaged pi-selftest fix（④装配 + F6 通道修复）
5. `3d535b0` docs(runtime): whitelist expansion (裁 A) + spec sync + P2 selftest evidence backfill
6. `68e893d` docs(runtime): butler-bridge roster comments 19 -> 20 tools

**分支顶端：`68e893d`（`xiaolai/agent-runtime-p4`），未推 origin。**

> 注：本报告为 docs-only 提交，其后五门禁复跑数字与上表一致（docs 不进任何门禁的计测面）。
