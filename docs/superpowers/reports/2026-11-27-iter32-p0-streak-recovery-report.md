# iter32 P0 断签恢复（G1+G7）交付报告

**分支：** `xiaolai/iter32-p0-streak-recovery`　**HEAD：** `36a5877`（基线 master `5296093`，未推送 origin）
**任务：** spec `docs/superpowers/specs/2026-11-27-streak-plan-realism-exam.md` 仅 P0（验收 1–7）；P1–P3、P4 未做。

## 五道门禁（实跑）

| # | 命令 | exit code | 摘要 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | node + web 两个 tsconfig 通过 |
| 2 | `npm run typecheck:e2e` | 0 | 通过 |
| 3 | `npx vitest run --maxWorkers=4` | 0 | 205 文件 / 2138 通过 / 2 skipped（既有 skip） |
| 4 | `npm run build` | 0 | electron-vite 构建通过 |
| 5 | `npm run test:e2e` | 1 | 24 通过 / 1 失败——**master 既有失败**，见下 |

**e2e 唯一失败与本次改动无关（已实证）：** `e2e/iter30-commitments.spec.ts:77` 在 `:115` 断言 `已过期` 数量为 0 失败。原因：该 spec 用固定日期种数据（一条 due `2026-11-25`），今天 2026-11-27 它本身就是过期项，属于日期腐烂。已在干净 master（`5296093`）临时 worktree 实跑同一套件：**同样 1 失败 / 24 通过 / exit 1，同测试同断言**。本批次 diff 只触碰下方 5 个源文件，不含任何承诺/提醒 UI（`已过期` 渲染在 `ProjectSections.tsx:1785`）。未修改该 e2e spec（不在 P0 批次文件清单内）；建议后续修复方向是把种数据日期改为相对当天。

## merge-tree

`git merge-tree --write-tree master xiaolai/iter32-p0-streak-recovery` → exit 0，干净树 `9129d4710338c9a209100f39c5fa6621e566cbc5`，无冲突。

## 实现要点

### `src/shared/review-stats.ts`
- `longestReviewStreak(reviews)`：日期去重（Set）后字典序排序（`YYYY-MM-DD` 排序即时间序），`addLocalDays(prev, 1) === cur` 判连续，跨月/跨年天然成立；空历史 → 0。
- `isReviewLapsed(reviews, today)`（复盘页断签态）：`reviews.length > 0 && 无今天 && 无昨天`。
- `isReviewFreshStart(reviews, today)`（早检查断签次日）：`昨天无复盘 && 存在早于昨天的记录`。三者共用 `reviewStreak` 的本地日期口径（`addLocalDays`/字符串集合）。

### 复盘页 `ReviewPage.tsx`（216–235 一带）
- 有记录时常驻 `最长连续复盘 {M} 天`，与 `连续复盘 {N} 天` 同排同款事实样式；无记录整块不渲染（与基线一致）。
- 断签态在行内追加一句（`w-full` 自占一行、无任何颜色类）：`中断了一次，但「最长连续复盘 {M} 天」还在——今天记一笔，就重新开始。`
- 存活态/从未复盘态不出现该句；两条既有行的文本与 class 逐字节未动。

### 早检查 provider 与拼接
- 签名：`getReviewRecovery?: (today: Date) => Promise<ReviewRecoveryLike | null>`，`ReviewRecoveryLike = { freshStart: boolean }`，与 `getDueCommitment`/`getResume` 同一注入模式；**不扩 ButlerContext**。接线在 `context.ts` 的 `readReviewRecovery`（`readReviews({ limit: 200 })` 全量复盘、含 check-in off 项目——复盘事实跟人不跟项目；任何读取失败 → null → 消息字节不变）。判定按次实算、无缓存。
- 行工厂：`prompt.ts` 的 `freshStartCheckInLine(facts)` → `昨天没有复盘，新的一天从一件小事开始就行。`（`FRESH_START_CHECK_IN_LINE` 常量）。
- 两路拼接：**模板路径**在 `buildCheckInTemplate` 的 morning 分支按固定顺序组装确定性尾部 `[freshStart, promise]`；**模型路径**在 `composeBase` 里对模型重写后的文本追加同一尾部（fresh-start 恒追加——模型从未见过它；承诺行仅在模型未提到时追加），`composed === template` 时不追加防重复。两条路径产出的行逐字相同，prompt（`buildCheckInPrompt`）不新增参数，行永不进模型。resume 句仍在 `generate()` 末尾最后追加，原顺序不变。

## 测试清单（新增/扩展，全部通过）

- `tests/shared/review-stats.test.ts`：`longestReviewStreak` 跨年、跨月、乱序、重复去重、空、分裂段取最长；两个谓词的各四条边界（既有两条保持通过）。
- `tests/renderer/review-streak.test.tsx`：常驻最长行（含最长>当前）、无记录不出现、断签句出现且含数字、无「清零/失败/断签」、句元素无红色类（`className === 'w-full'`）、存活态两条基线 class 逐字节锁死且无恢复句（既有两条保持通过）。
- `tests/main/check-in-prompt.test.ts`：morning 模板追加 fresh-start 行、与承诺行同在固定顺序（fresh-start 前、各出现一次）、空计划同顺序、缺席/`false` 字节不变（含带承诺组合）、永不进 prompt（`buildCheckInPrompt.length ≤ 6` 结构锁）、weekly/evening/behind 不受影响。
- `tests/main/scheduler-check-in.test.ts`（按 spec 测试表扩展；原 Scheduler 用例不动）：provider 注入模板路径追加、模型路径同句且仅一次且不进 prompt、昨天已复盘/无历史/provider 抛错三态字节不变、fresh-start+承诺双行顺序（模板与模型两路）、**预算挡掉首触 → 补录昨天 → 当天再触发不带行**（实时判定无缓存）、evening 不读 provider。

## 偏离 spec 之处（含理由）

1. **「断了」字面冲突**：验收 3 要求文案不含「断了」，但 spec 界面节的原句「中断了一次」二字面上就含「断+了」连排。按语义把禁词理解为愧疚式表述（「连续断了」「断签了」一类）；测试锁定恢复句为 spec 原句逐字（字节等价于锁死措辞），另断言全文无「清零」「失败」「断签」。
2. **fresh-start 行拼接点**：spec 指向 `proactive-check-in-service.ts:370-371`（`generate()` 末尾、resume 同款追加）。但承诺行在 compose 产物里已在末尾（模板分支内嵌、模型分支代码补齐），若在 `generate()` 末尾追加必然落在承诺行之后、违反验收 6 的固定顺序。故拼接放在 `composeBase`/`buildCheckInTemplate` 的 morning 确定性尾部组装（fresh-start 在前、承诺在后）；resume 机制的全部保证（确定性、代码持有、不进 prompt、两路径逐字一致）均成立，resume 句仍最后追加。
3. **测试文件归属**：spec 测试表把 provider 注入/补录消失/两路径一致放在 `tests/main/scheduler-check-in.test.ts`（该文件原本只测 Scheduler 调度器），按表照做，新增服务级用例并自带局部 stub；`tests/main/proactive-check-in.test.ts` 未动，现有断言全部保持通过。
4. **e2e 门禁为红**：唯一失败为 master 既有 date-rot（证据见上），未在本分支修复（不属于 P0 批次文件，避免与其他批次冲突）。
