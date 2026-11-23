# qa-busy-day-e2e — 满日覆盖 e2e 断言从 IPC 层升级到工具路径（item 42 收尾）

分支：`xiaolai/qa-busy-day-e2e`（基于 master `3142baf`，未推送、未合并；合并由 sc-lead 协调）

## 改动文件清单（产品代码零改动）

| 文件 | 改了什么 |
| --- | --- |
| `e2e/qa-busy-day-plan.spec.ts`（新增） | 用户可见断言：驱动真实 Electron + fake CLI，在对话里说「帮我排一下今天的计划」触发 `plan_workspace` 工具，断言对话里的「生成计划」工具行明细（`每天可用 N 分钟 · 来源`，来源标签订在 `AVAILABLE_MINUTES_SOURCE_LABELS` 上）与写入真实 vault 的今日任务 |
| `e2e/qa-busy-day-tool.spec.ts`（新增） | 工具层断言：在 Playwright 进程里组装真实服务栈（真实 `createWorkspaceService` 写盘、真实 `createAvailabilityService` 读盘上的 `week-availability.md`、真实 planner 无模型走模板），直接执行 `executeButlerTool(plan_workspace)`，并用计数包装器钉住 UI 观测不到的「可用性读取次数」 |
| `e2e/fixtures/fake-codex.mjs` | 新增 4 个分支：`TOOL RESULT (plan_workspace)` → 收尾文本（防工具循环）；planner 提示含「这天用户说特别满」→ 按满日指令回 1 件 10 分钟任务；「帮我排一下今天的计划」→ `plan_workspace` 空参数信封；「只给我排 45 分钟」→ `plan_workspace { availableMinutes: 45 }` 信封。原有分支与顺序未动 |

`src/` 未动；既有 IPC 层断言（`tests/main/integration-context.test.ts:121`）原样保留作回归护栏。

## 断言钉住的用户可见行为（验收三条）

**验收 1 — 满日经工具路径：恰好 1 件、时长 ≤10 分钟、source week**

- `qa-busy-day-plan.spec.ts:111`（真实 app + fake CLI）：播种当天为满日的 `week-availability.md`，对话建项目后说「帮我排一下今天的计划」→ 断言用户看见的工具行 **「生成计划：每天可用 10 分钟 · 来自你说的一周安排」**（该字符串只有 `availableMinutesSource === 'week'` 时才存在）；vault 里当天任务**恰好 1 件**且 `durationMin ≤ 10`；今日安排页能看到这件「满日小事：整理一张错题卡」。
- `qa-busy-day-tool.spec.ts:110`（真实盘上服务栈）：工具 JSON `availableMinutes === 10`、`availableMinutesSource === 'week'`、任务恰好 1 件 ≤10；**可用性恰被读取 1 次**（对目标日的单日查询）。

**验收 2 — 平常日经工具路径：default 行为，不注入 BUSY_DAY_MINUTES**

- `qa-busy-day-plan.spec.ts:144`：记录里只标明天为满日（今天不标）→ 工具行 **「生成计划：每天可用 120 分钟 · 默认值」**，任务保持 30 分钟不被压成 10 分钟——覆盖是按天、不是按文件。
- `qa-busy-day-tool.spec.ts:136`：source `'default'`、120 分钟、无 10 分钟钳制；该天**被查询恰 1 次**且查完未命中（防止「工具根本不查可用性」的回归）。

**验收 3 — 调用方钉死 availableMinutes: 45：不发生可用性查询，source input**

- `qa-busy-day-tool.spec.ts:158`：**在满日当天**传 `{ date: 满日, availableMinutes: 45 }` → `busyDatesBetween` 读取次数为 **0**（计数包装器只数 `busyDatesBetween`）、source `'input'`、45 分钟。比 brief 的场景更严：满日 + 钉死，也不查。
- `qa-busy-day-plan.spec.ts:169`（同路径用户可见面）：今天标满、对话里「只给我排 45 分钟」→ 工具行 **「生成计划：每天可用 45 分钟 · 本次指定」**。

参考的 sc-review 探针结论逐条对上：真实盘上记录、满日 → 10 分钟 / source week / 恰好一次查询；平常日 → default；钉死 45 → input 且读取为零；满日+省略 date（UI 路径不带 date）查的是今天。

## 变异验证（测试真的能抓回归）

临时把 `src/main/butler/tools.ts` 的 busy-day 接线改成恒 `undefined`（模拟 iter27 回归：工具路径绕过规则；**未提交，验证后 `git checkout` 还原，产品代码回到 `3142baf` 原样**）：满日 UI 断言、满日工具层断言、平常日「恰读一次」断言三条**失败**；钉死 45 的断言独立通过（符合预期，它不依赖该接线）。还原后重建、全量门禁重跑，全绿。

## 五道门禁（真实输出）

| 门禁 | 结果 |
| --- | --- |
| ① `npm run typecheck` | exit 0（无输出） |
| ② `npm run typecheck:e2e` | exit 0（无输出） |
| ③ `npx vitest run --maxWorkers=4` | **199 文件全 passed；1990 passed \| 2 skipped (1992)；79.0s** |
| ④ `npm run build` | exit 0，`✓ built in 234ms` |
| ⑤ `npx playwright test --config e2e/playwright.config.ts` | **24 passed (40.4s)**（原 18 条 + 新增 6 条，零失败零跳过） |

## 工作树状态 / 分支 HEAD

- `git status --porcelain`：无输出（干净，除分支提交外无未提交改动）。
- 分支：`xiaolai/qa-busy-day-e2e`，测试提交 `e0632a4`（基于 master `3142baf`），本报告为其上的纯 docs 提交。
- 未合并回 master、未推 origin、未开 PR。
