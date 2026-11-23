# fix-busy-day — 满日覆盖收进一个共享函数，`plan_workspace` 不再绕过 iter27

分支：`xiaolai/fix-busy-day`（基于 master `723b063`，未推送；iter39 的修复分支是独立的，没有从它分叉）

## 背景

iter27 的「用户说哪几天特别满，那几天只排一件 10 分钟小事」只活在 `api.planWorkspace` 一处：但勒工具 `plan_workspace` 直接调 `context.planner.plan(...)`，完全绕过这条规则。于是用户在标满的那天说「帮我排计划」会得到一份全尺寸计划——这恰恰是用户真正走到的那条路（晨间调度 / 托盘走 api 路径，本来就有覆盖）。

## 提交

| commit | 内容 |
| --- | --- |
| `bb50eb9` | **抽取** — 满日判定收进 `src/main/planning/busy-day.ts` 的 `busyDayMinutes`；`api.planWorkspace` 改为调它（行为不变）；共享函数单测 |
| `5d064a8` | **接线** — `plan_workspace` 在未钉死分钟数时走同一个 `busyDayMinutes`，把 `weekAvailabilityMinutes` 传进 planner；工具路径 5 条测试钉死 |
| （随后的 docs 提交） | 本报告本身，不含代码 |

## 共享函数契约

**位置：`src/main/planning/busy-day.ts:15` `busyDayMinutes`（经 `src/main/planning/index.ts:22` 导出）。**

```
busyDayMinutes(availability: Pick<AvailabilityService, 'busyDatesBetween'>, date: string)
  → Promise<number | undefined>
```

- 回答且只回答一个问题：`date` 是不是用户一周安排里标满的那几天之一；是 → 返回 `BUSY_DAY_MINUTES`（即 10），不是 → 返回 `undefined`。
- **try/catch 在共享函数体内**（`busy-day.ts:24-27`）：读记录抛错（文件损坏、日期非法等）→ 返回 `undefined`，规划继续。两个调用方因此天然都是 best-effort，不再各自包 try/catch。
- **「调用方有没有自己钉死分钟数」不进这个函数**：`input.availableMinutes === undefined` 的判断留在每个入口（api 在 `context.ts:1185`，工具在 `tools.ts:416`）。函数不负责这个语义。
- 接收 `Pick<AvailabilityService, 'busyDatesBetween'>` 而不是完整服务或读取结果：只要一次「查这一天」的能力，调用方无须先自己读再传数组（那样 try/catch 就得复制两份）。对 `date` 只查 `busyDatesBetween(date, date)`，从不查整周。

## 改动点（file:line）

- **新增** `src/main/planning/busy-day.ts` — 共享函数全文（31 行，含契约注释）。
- `src/main/planning/index.ts:22` — 导出 `busyDayMinutes`。
- `src/main/context.ts:44` — import 从 `BUSY_DAY_MINUTES` 换成 `busyDayMinutes`（`BUSY_DAY_MINUTES` 本身没动，仍在 `src/shared/planning.ts:26`）。
- `src/main/context.ts:1178-1192` `api.planWorkspace` — 原内联 try/catch 块换成 `input.availableMinutes === undefined ? await busyDayMinutes(services.weekAvailability, input.date ?? today()) : undefined`。可观察行为不变（api 层既有测试原样全绿，见下）。
- `src/main/butler/tools.ts:23` — import `busyDayMinutes`。
- `src/main/butler/tools.ts:409-428` `plan_workspace.execute` — 在 `availableMinutes === undefined && context.weekAvailability` 时调 `busyDayMinutes(context.weekAvailability, date ?? formatLocalDate(context.now()))`，结果作为 `weekAvailabilityMinutes` 传入 `context.planner.plan`（`tools.ts:426`）。日期省略时用 `context.now()` 解析成本地当天，与 planner 的 `resolveDate` 默认一致。服务没接线（`context.weekAvailability` 为 undefined/null）→ 不产生 override，工具其余行为不变。planner 未改（`workspace-planner.ts:63` 的 `'week'` 源优先级原样）；`useWorkspaceData.ts` 的死代码未碰；UI 文案、`package.json`、`CHANGELOG.md` 未碰。

「一次实现、两个调用方」可 grep 证明：

```
$ grep -rn "busyDayMinutes" src/ | grep -v "^src/main/planning/busy-day.ts"
src/main/butler/tools.ts:23:import { busyDayMinutes } from '../planning';
src/main/butler/tools.ts:417:            ? await busyDayMinutes(
src/main/context.ts:44:import { busyDayMinutes, createWorkspacePlanner } from './planning';
src/main/context.ts:1186:          ? await busyDayMinutes(services.weekAvailability, input.date ?? today())
src/main/planning/index.ts:22:export { busyDayMinutes } from './busy-day';
```

（其余命中只有两处注释提到函数名。）

## 验收对应的测试

**验收 1（同一共享函数、两个入口）**：上面的 grep 输出 + api 路径回归测试原样通过：

- `tests/main/integration-context.test.ts:121`「plans a stored busy day as one small task without overriding an explicit budget」— **未改动**，覆盖 busy / 非busy / 显式分钟数胜出 / 清除该周后恢复四段断言。

**验收 2（工具路径，全部新钉）** `tests/main/butler-week-availability.test.ts`：

- `:315`「plan_workspace budgets a stored busy day through the shared override」— 记满的日期 + 不传 `availableMinutes` → 用捕获输入的 stub planner 断言 `planner.plan` 收到 `weekAvailabilityMinutes: BUSY_DAY_MINUTES` 且 `availableMinutes` 未传；并断言工具返回的 `availableMinutes` / `availableMinutesSource` 等于 planner 产出的 `10` / `'week'`。
- `:347`「plan_workspace leaves the budget untouched on a normal day」— 非满日 → planner 输入 `toEqual({ workspaceId, date })`，完全没有 `weekAvailabilityMinutes` 字段，返回 `'default'` / 120。
- `:368`「plan_workspace does not ask availability when the caller pins availableMinutes」— 调用方钉死 45 分钟 → `busyDatesBetween`（`vi.fn()`）**一次都没被调**，planner 输入只带 `availableMinutes: 45`，源是 `'input'`。
- `:389`「plan_workspace still plans when the availability record is unreadable」— 可用性读取抛错 → 规划照常进行，无 override，返回 `'default'`（best-effort 保持）。
- `:412`「plan_workspace checks today when the date is omitted」— 日期省略 → 共享读被问到 `context.now()` 的当天（`('2026-11-23','2026-11-23')`），当天满则注入 override。

**验收 3（app-scheduler 回归）**：`src/main/scheduler/app-scheduler.ts:26` `planFirstEmptyWorkspace` 零改动（走 `context.api.planWorkspace`，天然吃到共享函数）。`scheduler-triggers` / `scheduler-check-in` / `scheduler-failures` 全绿；全量 vitest 199 个文件无一失败。

共享函数自身的直测（不止经调用方）`tests/main/planning-busy-day.test.ts`：

- `:19`「busyDayMinutes returns BUSY_DAY_MINUTES when the date is marked busy」（含断言查询恰为 `(date, date)`）
- `:31`「busyDayMinutes returns undefined when the date is not busy」
- `:37`「busyDayMinutes returns undefined for an empty availability record」
- `:43`「busyDayMinutes stays best-effort when the availability read throws」

## 给 sc-qa 的备注（验收 4，非本任务改动）

现在**工具路径与 api 路径共享同一条满日覆盖**。QA 的 e2e 断言应从 IPC 层（直接调 `api.planWorkspace`）挪到用户可见的断言上，可对准的接口是：

- **共享函数**：`busyDayMinutes`（`src/main/planning/busy-day.ts`，满日 → `BUSY_DAY_MINUTES`，否则 `undefined`，读坏不抛）。
- **planner 输入字段**：`weekAvailabilityMinutes`（`src/shared/planning.ts:71`；planner 由此把 `availableMinutesSource` 标为 `'week'`）。
- **用户可见断言（推荐）**：在 vault 写入含目标日期的 `week-availability.md` 后，以「帮我排计划」触发 `plan_workspace`（不传 `availableMinutes`），断言工具 JSON 结果里 `availableMinutes === 10`、`availableMinutesSource === 'week'`，且写入项目的任务恰好 1 个、`durationMin <= 10`。api 路径（晨间调度）已由 `integration-context.test.ts:121` 覆盖，e2e 无须再经 IPC 重复。

## 与 iter39 的合并探针（交付前必查）

```
$ git merge-tree --write-tree --name-only master HEAD
b0a64e198ac41a2e7605a4b07db85a6588345942
exit=0            ← 无冲突文件

$ git merge-tree --write-tree --name-only xiaolai/iter39-m1m2 HEAD
de90134bf361ecfc86666da7a5e074805727bb08
exit=0            ← 无冲突文件
```

两个探针都干净（两个分支都动了 `context.ts` 但在不同区域，与预期一致）。按 brief，非脏即继续，不需要 sc-build 介入。

## 门禁（真实输出）

```
$ npm run typecheck
> study-coach@1.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
（无输出，通过）

$ npm run typecheck:e2e
> study-coach@1.1.0 typecheck:e2e
> tsc --noEmit -p e2e/tsconfig.json
（无输出，通过）

$ npx vitest run --maxWorkers=4
 RUN  v5.0.5 C:/Users/34191/orca/workspaces/sc/fix-busy-day

 Test Files  199 passed (199)
      Tests  1966 passed | 2 skipped (1968)
   Start at  15:50:45
   Duration  59.29s

$ npm run build
rendering chunks...
out/renderer/index.html                             1.11 kB
out/renderer/assets/index-CT_BvWtL.css             75.09 kB
  …（中略：其余 chunk 正常产出）…
out/renderer/assets/react-dom-BOxPwYkh.js         530.47 kB
✓ built in 213ms

$ npm run test:e2e
Running 18 tests using 1 worker
  ok  1 e2e\desktop.spec.ts:13:7 › … (9.5s)
  …（18 条全部 ok，含 iter30-commitments 的 week availability 两条）…
  18 passed (37.1s)
```

## 最终 HEAD

代码评审对象：`5d064a8`（`bb50eb9` 抽取 + `5d064a8` 工具接线，两个提交各自可独立编译）。本报告随后作为纯 docs 提交落在其上；交付消息里报的是报告提交后的真实最终 HEAD。
