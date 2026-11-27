# Agent Runtime 跨批验收测试：双引擎对拍 + 验收 3/5/7/8/9

- 分支：`xiaolai/qa-runtime-acceptance`（自 master `ebfd0fd` 切出，产品代码零改动）
- 日期：2026-11-28
- 执行：sc-qa（QA，只动 `tests/`；发现的问题写成报告，改码归 sc-build）
- 任务来源：sc-lead handoff「Agent Runtime 跨批验收测试」

---

## 1. 交付了什么（三个测试文件，全部走真实装配入口 `assembleRuntime`）

| 文件 | 覆盖（spec 验收） | 一句话 |
| --- | --- | --- |
| `tests/main/runtime/acceptance-parity.test.ts` | 任务书第 1 条 + 验收 7 | 双引擎对拍：场景一（排计划·满日）、场景二（承诺改期，现入口 `resolve_commitment`+newDue）各在 Legacy/Pi 上跑，断言**最终 vault 归一化内容逐字段一致**；场景三 skip 占位（P4 未合入，见 §5） |
| `tests/main/runtime/acceptance-plan.test.ts` | 验收 7/8/9 | 三条用户可见断言（满日 1 件 ≤10min；「今天有 30 分钟」→ planner 收到 `availableMinutes=30` 且满日读数被压制；工具报错 → 终态 failed、无「已安排」、零写入），Legacy+Pi 两条真引擎各验一遍 |
| `tests/main/runtime/acceptance-cancel-dedup.test.ts` | 任务书第 3 条 + 验收 3/5 | 取消（Pi 等审批中取消 / Legacy 工具执行中取消）+ 去重（同参重复 duplicate 拒不产生第二次审批；失败后同参重试放行但需要**新的一次审批**） |

定向跑（打字修正后复跑）：

```
 Test Files  3 passed (3)
      Tests  9 passed | 1 skipped (10)
   Duration  2.96s
```

## 2. 怎么测的（关键做法）

- **装配收口**：所有用例经 `assembleRuntime({ journal, engines })` 真实装配入口
  （工具注册、确认级一致性断言、默认引擎禁令守卫全部生效），不手工 new RunController。
- **对拍是 vault 级**：两个引擎各用**独立临时 vault** 各跑一次；整个 vault 读成
  「相对路径 → 正文」，只归一化「每次必不同、与业务无关」的东西（ISO 时间戳、
  随机 `t-/ws-/cm-` 8 位 hex id），日期保留，然后 `toEqual` 逐字节比对。差异即红，
  失败时 vitest 原样打印两边正文——没有绕过去的口子。
- **假时钟 + 相对日期**：`NOW = 2026-11-28 08:00 local` 固定注入（不吃 date-rot）；
  种数据日期相对该时钟（`TODAY/TOMORROW/MONDAY` 常量）。
- **Pi 的脚本层**：`scriptedPiModel` 脚本轮读 planner 真实输出组装 `commit_plan`
  参数（不是硬编码一份假计划再假装一致）；`plan_preview {}` 无参——满日读数走
  ButlerToolContext 的 weekAvailability（验收 8 的压制断言因此有意义）。
  `PiEngine` 的 `tools:` 选项只喂 `definitions()`（与 scenario-plan-pi.test.ts
  同一「双网关」装配形态），真正 invoke 走控制器网关。
- **失败注入按引擎写真实路径**：Pi 走 `commit_plan` 对假日期 `2026-02-30` 的
  参数校验拒绝（`tool.failed` error 含 YYYY-MM-DD）；Legacy 走注入 planner 抛错
  （`plan_workspace` 经 `executeButlerTool` 转 `tool-result !ok`）。
- **Legacy 的模型模拟**：`ScriptedStreamingClient`（与 legacy-engine.test.ts 同形）。

## 3. 五门禁实跑输出（分支 HEAD 见 §6；未推 origin）

```
=== 门禁1 typecheck ===
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（无输出，退出码 0）

=== 门禁2 typecheck:e2e ===
> tsc --noEmit -p e2e/tsconfig.json
（无输出，退出码 0）

=== 门禁3 vitest run --maxWorkers=2 ===
 Test Files  220 passed | 1 skipped (221)
      Tests  2401 passed | 4 skipped (2405)
 Duration  153.92s

=== 门禁4 build ===
✓ built in 232ms

=== 门禁5 test:e2e（build + 全量 playwright）===
  26 passed (44.5s)
```

门禁③里那 1 个 skipped file 就是本交付的场景三 P4 占位（`test.skip`，不装绿）。

## 4. 实证结果摘要

- **对拍两场景全绿**：排计划（满日）与承诺改期，Legacy 与 Pi 的最终 vault
  归一化内容逐字段一致（含 tasks 目录文件清单一致、种子承诺 id/createdAt 全等）。
- **验收 7**：两引擎各只排 1 件、时长 ≤ `BUSY_DAY_MINUTES`(10)、due=今天，
  完成由 `service.receipt` 驱动（缝①在场）。
- **验收 8**：Legacy planner 收到 1 次入参、Pi 收到 2 次（preview + 脚本轮）且
  两次相同；都 `availableMinutes=30` 且**无** `weekAvailabilityMinutes` 键——
  显式输入确实压过了满日读数；任务总时长 ≤30、全部 due=今天。
- **验收 9**：两引擎终态 failed（`getRun` 与事件与落盘三处一致），`tool.failed`
  在场、无写入提交、无回执、拼接文本不含「已安排/安排好了」、vault 零任务。
- **验收 3**：Pi 在审批等待点取消 → cancelled、其后 approve 无效、零写入、
  `plan_preview`（查询级）不受牵连；Legacy 在工具执行中取消 → 第二轮模型调用
  从未发生、任务B 从未创建、终态与 journal 一致。
- **验收 5a**：同参重复在网关被拒（reason=duplicate），只产生 1 次审批、1 次
  提交、1 条落盘。**验收 5b**：失败（注入的 createTask 首次抛错）没进去重键，
  同参重试放行，但必须来**新的一次审批**（新 invocationId、参数与第一次全等），
  最终恰好 1 条落盘。

## 5. 发现（报给 sc-build/sc-lead 拍板，产品代码未动）

### 5.1 Legacy 不经 ToolGateway：审批与去重语义对 Legacy 不成立（已知取舍，请确认收口方式）

`legacy-engine.ts:20-26` 自己写明「确认（审批）语义 — 产品取舍点，见交付报告」：
Legacy 循环内确认级工具**直执行**，唯一闸门是 `permissions`；不经网关 → 无审批、
无去重。本次实证：同一场景 vault 最终一致（§4），但**治理语义**不同——Pi 的
`commit_plan` 必须用户点确认才落盘，Legacy 的等价写入直接落盘。验收 5 的去重、
验收 3 的审批点取消只对 Fake/Pi 路径成立。这不是测试能修的：改它需要动
`ButlerService.stream` 本体（工具表不可注入，越出「包装不是重写」约束）。
**请 sc-build/sc-lead 拍板**：a) 接受为 Legacy 的既定边界并写进用户文档；
b) 排期把 Legacy 也接上网关。

### 5.2 Legacy 取消后，在途写入仍落盘（用户可见；spec 验收 3 未定义这种情况）

实证（`acceptance-cancel-dedup.test.ts` Legacy 变体，按真实时序断言）：
`cancel()` 返回 true、终态 cancelled、journal 末尾 cancelled、无 `tool.committed`、
无回执——但卡在闸门上的 `createTask` 在**取消之后**完成落盘，vault 里多出「任务A」
（在途写入完成，`createCalls=1`）。

用户视角：点了取消，任务还是出现了，且事件层没有任何提交记录（落盘与事件不一致——
Pi 路径取消是严格零写入）。spec 验收 3 只说「取消后不再执行任何工具」，对
**取消时已在途**的工具没有定义。**请 sc-build 定语义**：a) 在途写入允许落盘但补
一条事件（落盘与事件一致）；b) 真回滚；c) 接受现状并写文档。测试当前按「在途
写入落盘、事件零提交」的现状断言（不装绿也不装红），语义定下后按裁决改断言。

### 5.3 双网关形态是装配现状，不是测试绕过

`PiEngine` 的 `tools:` 选项（仅 `definitions()`）与控制器网关是两个实例——与
`scenario-plan-pi.test.ts` 同形态。若这不是有意的，值得 sc-build 确认一下
（本次对拍显示行为正确，仅指出形态本身）。

## 6. 待补清单与分支状态

**待 P3 合入后补**（`acceptance-parity.test.ts` 文件尾有待补注释）：
`reschedule_commitment` 三条旁路负例——同名取第一条 / 审批绑参 / 旧入口带 newDue
拒绝（spec 验收 17/18/23）。现入口 `resolve_commitment`+newDue 的对拍已绿（§4）。

**待 P4 合入后补**：场景三周总结对拍（spec 验收 20–22），现为 `test.skip` 占位。

```
<new> (HEAD) test(qa): agent runtime 跨批验收（双引擎对拍 + 验收 3/5/7/8/9）
ebfd0fd (master) chore(release): cut 1.3.0
```

`git diff master..HEAD --stat`：3 个新测试文件 + 1 份报告，共 4 个文件。产品代码
零改动。未推 origin。合并归 sc-lead。
