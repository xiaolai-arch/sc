# iter32 P1 计划现实主义（G2+G3）交付报告

**分支：** `xiaolai/iter32-p1-plan-realism`　**HEAD：** 分支顶端为本报告 docs 提交（实现内容 = `d795bbe` feat + `dc98ded` merge master，未推送 origin）
**任务：** spec `docs/superpowers/specs/2026-11-27-streak-plan-realism-exam.md` 仅 P1（验收 8–13）；P0 已合入 master 未动，P2a/P2b/P3、P4 一概未做。
**基线说明：** 开工时分支从 `22a9f7d` 切出；收到协调者基线更新（master 前进到 `c8bc0b5`，e2e date-rot 已修）后把 `master` 并入本分支（merge commit `dc98ded`，仅带入 `e2e/iter30-commitments.spec.ts` 的种数据修复，无冲突）。

## 五道门禁（实跑，均在分支顶端 HEAD，即本报告所在提交）

| # | 命令 | exit code | 摘要 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | node + web 两个 tsconfig 通过 |
| 2 | `npm run typecheck:e2e` | 0 | 通过 |
| 3 | `npx vitest run --maxWorkers=4` | 0 | 205 文件 / 2164 通过 / 2 skipped（既有 skip） |
| 4 | `npm run build` | 0 | electron-vite 构建通过 |
| 5 | `npm run test:e2e`（build + playwright） | 0 | **25/25 全绿**（44.3s），含 `iter30-commitments`（c8bc0b5 修复生效，按协调者新门禁口径报） |

五项先在 `dc98ded` 实跑一遍全绿，随后在分支顶端（含本报告 docs 提交）按上表再实跑一遍，结果相同。

## merge-tree

`git merge-tree --write-tree master xiaolai/iter32-p1-plan-realism` → **exit 0，无冲突**，实跑两次均干净（master = `c8bc0b5`）：在 `dc98ded`（并 master 后、docs 报告前）跑出干净树 `1fa7ff6df9c48716b771ea6d12f47dcf1b45b30d`；在分支顶端（含本报告）再跑一次同样 exit 0 无冲突（树哈希随本报告自身内容漂移，故不落哈希；协调者合并前可复探）。

## 实现要点

### `src/shared/weekly-stats.ts` 增补 `recent7DayCompletion`（纯函数，同文件同口径）
- 导出 `Recent7DayCompletion { planned; done; percent }`；窗口 `[today-6, today]`，用 `formatLocalDate` + `new Date(y, m, d - 6)` 生成本地窗口键，`YYYY-MM-DD` 字符串比较归日。
- 按 `due` 归日：`due === undefined`、越界、坏值（`null`/`''` 比较后自然落窗外）一概不计——与落后提醒「无日期的积压不是今天的计划」同一口径（`behind-schedule.ts` 的 `isTaskForDate`）；`skipped` 两边都不计；`done` = `status === 'done'`（`in-progress`/`pending` 计 planned 不计 done）；percent `Math.round`。
- **样本门槛：planned < 5 返回 null**，调用方（prompt）字节不变。

### `src/shared/planning.ts` 增补 `compressionTargetMinutes(availableMinutes, percent)`
- `X = max(15, round(A × P / 100 ÷ 5) × 5)`，与 spec 公式逐字一致；放 shared 层使 15 下限 / 5 取整的边界能直接单测（`tests/shared/planning.test.ts`）。

### 每日规划 prompt（`planning/prompt.ts` + `workspace-planner.ts`）
- `WorkspacePlanPromptInput` 增加可选 `recent7DayCompletion?: Recent7DayCompletion | null`；planner 在**模型路径**里用 `recent7DayCompletion(snapshot.tasks, parseLocalDate(date))` 算出后传入（snapshot 已含 `tasks`，无新查询；`date` 是 `resolveDate` 之后的合法本地日期）。
- 注入位置与顺序：**倒计时行之后、`最近记录` 之前**；完成率事实行在前、压量行紧随其后：
  1. `过去 7 天：安排 {N} 项，完成 {M} 项（{P}%）。`
  2. （仅 `P < 60`）`完成率偏低：请把今天的任务总量压到约 {X} 分钟（按过去 7 天完成率 {P}% × 可用 {A} 分钟），宁可少排，不要排满。`
- 无样本（null）两行都无——prompt 与基线逐字节一致；`P ≥ 60` 只有事实行；模板计划路径完全不经过 prompt（`buildTemplatePlan` 与 prompt 无交集，planner 模板分支零改动）。

### 重排对话框（`shared/plans.ts` + `LongPlanPage.tsx`）
- `suggestedRecalibrateHours(plan, today)`：`elapsed = clamp(本地天数差, 0, weeks×7)`（经由新导出的 `planElapsedDays`，内部用既有 `localDaysBetween`）；`elapsed < 7` 或 `planProgress(plan).total === 0` → `plan.weeklyHours`；否则 `expected = elapsed / (weeks×7)`、`actual = percent / 100`，`clamp(round(weeklyHours × actual / expected), 1, 80)`（80 与重排输入框上限一致）。
- 对话框默认值 = 该函数结果：`openRecalibrate` 由原来的 `String(plan.weeklyHours)` 改为 `String(suggestedRecalibrateHours(plan, today))`；`useState('10')` 的硬编码初始态改为 `''`（打开时必被赋值，UI 上永不见硬编码数）。
- 输入框下新增一行来源说明（12px 灰字，无红色）：数据足时 `按你过去 {elapsed} 天的实际进度建议`，不足时 `沿用计划的每周小时数`（判定与函数分支一致：`elapsed ≥ 7 且 total > 0`）。
- 手改后提交仍走既有客户端 1–80 校验 + 服务端 `normalizeWeeklyHours`；仍是显式确认，无自动重排。

## 测试清单（新增/扩展，全部通过）

- `tests/shared/weekly-stats.test.ts`（+5）：窗口边界成对用例（today-6 计入 / today-7 与未来不计）；undated 不计、skipped 双不计；in-progress 计 planned 不计 done、percent 四舍五入（66.67→67）；门槛 planned 4→null、5→结果。
- `tests/shared/planning.test.ts`（+3）：`compressionTargetMinutes` 5 分钟取整（含 52→50、53.1→55）、15 分钟下限（30×20%→15、120×1%→15）、整倍不漂移。
- `tests/shared/plans.test.ts`（+6）：`planElapsedDays` 双向 clamp；<7 窗口（含第 6/7 天边界、开工前 clamp 0）；速度比公式（第 7 天→15、第 14 天→8）；elapsed 封顶后 expected 停增；无 items → weeklyHours；clamp 1（0% 进度）与 80（16 周计划 2 周全清 →640→80）。
- `tests/main/planning-workspace-planner.test.ts`（+8，describe "past-7-day completion lines"）：40% 事实行+压量行数字精确匹配（120×40%→50）；15 下限行（30×20%）；5 取整行（100×52%→50）；80% 只事实行无压量；planned 4 与基线 prompt **逐字节相等**（两 planner 实跑对比）；行顺序（事实行=倒计时+2、压量行紧随、再往后是 `最近记录：暂无。`）；窗口锚定计划日期（plan date 2026-11-20 ≠ now，仍按 [11-14, 11-20] 归日，60% 无压量——压线断言）；模板路径两 planner 输出 `toEqual` 全等。
- `tests/renderer/long-plan-page.test.tsx`（+4）：默认值来自公式（12 小时 × 50% 速度比 → `6`）+ 来源说明 `按你过去 14 天的实际进度建议` + 手改 9 提交；数据不足回退计划自己的数（weeklyHours 12、elapsed 1 → `12`，证明非硬编码 10）+ `沿用计划的每周小时数`；无 items 计划同回退；既有 1–80 校验保持（清空提交出原错误文案、不调 onRecalibrate；改 80 后提交成功）。既有 4 条重排/编辑用例全部保持通过。

## 偏离 spec 之处（含理由）

1. **「硬编码 '10'」的起点与 spec 描述不同**：master `22a9f7d` 上 `openRecalibrate` 早在 0a77540 就把默认值设为 `String(plan.weeklyHours)`（spec G3 指向的 `useState('10')` 只是打开前不可见的初始态）。因此实际改动是「打开时默认值 = suggestedRecalibrateHours」+ 删掉初始态硬编码（改为 `''`），净效果与 spec 目标一致：数据足→速度比公式，不足→计划自己的数，任何 UI 可见值都不来自硬编码。
2. **7 天窗口锚定计划日期而非墙钟**：spec 给的签名是 `recent7DayCompletion(tasks, today)`；planner 传入 `parseLocalDate(date)`（计划自己的日期）。理由：prompt 全文以 `{date}` 为「今天」（`今天：${date}`），窗口与之一致才自洽；两个真实调用方（context.ts、butler tools）不传 date 时 `date` 就是当天，行为不变。已用「plan date 2026-11-20 ≠ now」测试锁死该口径。
3. **X 公式落在 `src/shared/planning.ts` 而非 prompt.ts 内联**：spec 未指定归属；放 shared 层使 15 下限 / 5 取整边界可被 `tests/shared/planning.test.ts` 直接单测（任务测试表指定的文件），prompt 只消费。
4. **「手改后仍走校验」的测试路径**：输入框带 `min=1 max=80`，浏览器（jsdom 与真实浏览器一致）会在提交前用原生约束校验直接拦下越界值（如 0、81），React 层校验对越界值不可达。故用例改走可达路径：清空字段提交 → 原有错误文案出现且不提交；手改合法值（9 / 80）→ 原样提交。手改提交语义（`normalizeWeeklyHours` 前的客户端校验 + 显式确认）无变化。
5. **新增导出 `planElapsedDays`**：spec 只要求 `suggestedRecalibrateHours`；来源说明需要 `{elapsed}` 天数，抽出这个 clamp 助手供 UI 复用（同时是公式的第一步），避免 UI 里再写一遍日期差逻辑。
