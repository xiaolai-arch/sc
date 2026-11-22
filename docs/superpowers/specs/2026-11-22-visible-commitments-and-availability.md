# ASAKI iter30：看得见、改得动——承诺、一周安排与提醒完成（2026-11-22）

**依据：** `docs/superpowers/reports/2026-11-22-butler-needs-research.md` §4–§6、`docs/superpowers/specs/2026-11-15-personal-assistant-core-redesign.md` §7、`docs/superpowers/reports/2026-11-21-second-iteration-plan.md` §1.4
**基线：** `master` @ `23080a3`（1.1.0 已切版；iter29-goalid `d8f14b8` 与 iter29-nav `23080a3` 已合入；P0 依赖已满足）
**状态：** 已定稿待排期；主人 2026-11-22 定「先留草稿，等 iter29 合入后再写进仓库」+「提醒完成次日恢复」

---

## 一句话

iter23–28 把「承诺」和「一周哪几天特别满」做成了**只能由阿咲写、用户看不见也改不了**的数据。iter29 的通知中心把未结案承诺**带进了视野**，但仍是只读的——改期、放下、完成还是只能回对话里说；一周安排则完全没有入口。本轮让这两类记录**能被纠正**，并补上静音恢复后缺失的一句事实、以及提醒「完成」次日该不该再响。已完成的一支：点一次完成就永久静默，对每天重复的提醒是 bug（主人 2026-11-22 定了：次日恢复）。

## 为什么（实测证据，不是推测）

| # | 问题 | 证据 |
| --- | --- | --- |
| 1 | 承诺有了「看见」，还没有「处置」 | iter29 通知中心已列出未结案承诺（`grep "Commitment" src/renderer` 命中 `NotificationCenter.tsx`、`useWorkspaceData.ts:246-251`、`Workspace.tsx:1264-1271`），但**只读**：点击行只是把「关于承诺…」填进输入框（`Workspace.tsx:1268-1271`），改期/放下/完成仍只能靠对话；提醒页没有承诺区；`IPC_CHANNELS` 只有 `listPendingCommitments` 一个读通道（`src/main/ipc.ts:97-183`） |
| 2 | 对话里看不到自己答应过什么 | `renderContext` 只渲染项目/任务/档案/记忆/知识（`src/main/butler/prompt.ts:127-233`），没有未结案承诺；工具只有写入型 `record_commitment`（`src/main/butler/tools.ts:873`）与 `resolve_commitment`（`:924`），**没有读取工具**。用户问「我答应过什么」只能靠模型记忆，模型看不到 |
| 3 | 一周安排同样不可见 | `grep -rn "weekAvailability\|一周安排" src/renderer` = **0**；无 IPC；写入只经 `set_week_availability`（`tools.ts:986`），读取只发生在规划时（`src/main/context.ts:1085-1095`）与长期计划生成时（`src/main/plans/long-plan-service.ts:270-279`） |
| 4 | 说错了没法改 | 承诺改期/放下只存在于对话（`service.resolve` 支持 `newDue`/`outcome`）；一周安排只能再走一轮对话覆盖（`service.set` 按周一整周替换） |
| 5 | 静音到期没有任何交代 | 恢复后第一条检查与平常逐字节一致；`grep "恢复的第一天" src/` = **0**。iter28 的研究原话是「恢复后的第一条检查里明说『你之前暂停到 X，今天是恢复的第一天』」 |
| 6 | 任务的两个时间字段用户碰不到 | 新建/编辑表单只有标题/科目/时长/验收/触发时机/重复（`src/renderer/shell/ProjectSections.tsx:440-502`），没有 `due`（截止日）和 `startAt`（固定开始时间）；`due` 仅由阿咲写入，`startAt` 只能靠今日安排页拖拽（`SchedulePage.tsx:114,120`） |
| 7 | 全局搜索搜不到这些记录 | `rebuild()` 只扫 `workspaces/` 与 `knowledge/topics/`（`src/main/search/search-service.ts:285-300`），vault 根部的 `commitments.md`、`week-availability.md`、`profile.md` 均不入索引 |

**结论：** 这一轮的痛点不是「再加一种提醒」，而是**把已经存在的记录接到用户手上**。研究 §5 的第 1、4、5、6 项都已实现主体，缺的是最后一公里：可见、可改、可确认。

## 目标（本轮）

- **P0 承诺**：在提醒页新增「承诺」区，列出未结案承诺，可改期、可放下、可完成（iter29 通知中心已有只读列表，这里补的是处置动作，不重复建列表）；对话的系统提示带上最多 3 条未结案承诺，没有承诺时提示逐字节不变。
- **P1 一周安排**：长期计划页显示「你说过这周特别满的日子」，可清除该周记录。
- **P2 静音恢复**：从静音恢复后的第一条主动检查末尾追加一句事实，只说一次。
- **P3 任务时间**：新建/编辑表单可设截止日期与固定开始时间（今日页已能显示这两项，见 `TodayOverview.tsx:406`、`:395`）。
- **P4 提醒完成次日恢复**（主人 2026-11-22 已定）：点一次「完成」只在当天生效，次日自动回到正常排程，不需要再去手动「重新启用」。当前是完成后永久静默（`src/main/scheduler/scheduler.ts:179-181`），对「喝水」「背单词」这类每天重复的提醒是 bug。

## 非目标（本轮）

- **不改「关闭提醒」开关的语义**：`enabled: false` 仍是用户主动关闭，P4 只让 `done` 在次日失效，两者不要混成一个状态。
- 不做 `goalId` 数据模型（iter29-goalid 在做）、不做导航重设计（iter29-nav 在做）。
- 不新增导航入口：承诺放「提醒」页，一周安排放「长期计划」页，遵循 §8.3「概念只出现一次」。
- 不把承诺/一周安排塞进全局搜索索引（属于下一轮「vault 根文件入索引」的独立决定）。
- 不做提醒完成历史、承诺统计、周承诺完成率。
- 不引入新依赖、不新增 vault 文件、不联网。

## 数据与契约

### 承诺（已有服务，只读投影 + 两个动作）

- 类型复用 iter29 已建立的 `CommitmentSummary`（`src/shared/notifications.ts`，iter29-nav 分支），字段 `id/text/due/status/createdAt?/resolvedAt?/workspaceId?`；**不要**另建第二套形状。
- 渲染层只读：`listCommitments(input?: { includeResolved?: boolean })` → `CommitmentSummary[]`，按 `due` 升序、`createdAt` 次序；`includeResolved` 为真时把 `done/dropped` 附在同一次结果里（默认 `false`）。
- 两个动作走既有服务语义，不新增状态机：
  - 改期 → `service.resolve({ id, newDue })`（`due` 变更、`status` 保持 `open`、清 `resolvedAt`）
  - 放下 → `service.resolve({ id, outcome: 'dropped' })`
  - 完成 → `service.resolve({ id, outcome: 'done' })`（本轮界面提供，语义与晨检回答「做了」一致）
- IPC：在 `IPC_CHANNELS` **末尾**追加 `listCommitments`、`resolveCommitmentEntry`（`src/main/ipc.ts:97-183` 的惯例：iter29 的 `listPendingCommitments` 就是这么追加的），`requireX` 校验在 `ipc.ts` 内完成，坏输入不落盘。
- 不写新的 vault 文件；`commitments.md` 的 frontmatter `items` 仍是唯一事实源，正文由 `serializeCommitmentsFile` 生成（`src/main/commitments/records.ts:127`）。

### 一周安排（已有服务，只读投影 + 一个动作）

- 渲染层只读：`listWeekAvailability()` → `{ weekStart, busyDates, note? }[]`，按 `weekStart` 倒序，只保留本周及之后（过去的周不展示，避免翻旧账）。
- 清除 → `clearWeekAvailability({ weekStart })`：只移除该周记录，其他周逐字节不变；没有该周时不报错（幂等）。
- 存储不变：`week-availability.md`（`src/main/workspace/paths.ts:127`）。

### 静音恢复

- `NotificationSettings` 增加可选 `resumedFrom?: string`（局部日期 `YYYY-MM-DD`，**仅非空时序列化**，旧 `settings.json` 逐字节不变）。
- 写入时机：用户点「恢复提醒」（今天/3 天/7 天静音后手动恢复）**或**静音到期后第一次检查被允许执行时，记录被清掉的那个最后静音日；检查消息生成后清空该字段。
- 只影响消息末尾一句话，不影响 `isMutedOn` 判定（`src/shared/date.ts:34-37`）与检查上限。

### 提醒完成（P4）

- **不加新字段，不加新状态**。`done` 仍是生命周期状态（`src/shared/workspace.ts:162`），但只在**标为完成的那一天**生效。
- 判定点唯一：`buildTriggers` 里现在是无条件 `continue`（`src/main/scheduler/scheduler.ts:179-181`）。改成「`state === 'done'` 且今天不是 `doneAt` 那天才跳过」。
- 需要记录完成日：`Reminder` 增加可选 `doneAt?: string`（`YYYY-MM-DD`，同 `firedAt` 的写法但只到日）。**只在 `updateReminder({state:'done'})` 时写入**，`applyReminderStatePatch` 增加 `doneAt` 支持（`src/shared/workspace.ts:216-229`，`null` 清空的既有约定）。
- 过期判定放在读取时，不靠定时任务改文件：`state: done` + `doneAt < 今天` → 视作 `pending`。因此**不需要后台任务**，也不会因为应用没开就漏掉。
- 判定收在一处：`src/shared/workspace.ts` 新增 `effectiveReminderState(reminder, today)`，内部即「`done` 且 `doneAt` 早于 `today` 时返回 `pending`，其余返回 `reminderState(reminder)`」。**调度器与界面都必须调它**，不要各自比日期。`reminderState()` 本身保持不变（它仍是「文件里写了什么」）。
- 旧文件无 `doneAt`：`done` 视为永久（现状），用户下次点「重新启用」后回到新语义。不做数据迁移。
- `ReminderStatePatch` 的 `doneAt` 允许 `null`（清空）：`state: 'pending'` 时清 `doneAt`；成功投递（`markFired`，`scheduler.ts:337-350`）也一并清 `doneAt`，让文件与「已触发」一致。
- 兼容：`fired` 状态不受影响；`enabled: false` 不受影响。

## 界面

### 提醒页 · 新增「承诺」区（在现有 `RemindersSection` 之后）

- 标题「承诺」，副标题一句事实：「你说过的、还开着的事。这里能改日期，也能放下。」
- 每行：`承诺文本` + 右侧 `原定 MM-DD`（过期加 `· 已过期 N 天`）+ 三个动作「改期」「放下」「完成」。
- 过期行排在前面；`checkIn: 'off'` 的项目所属承诺仍显示（它此刻不会进晨检），但加一个 `不会主动问你` 的灰色小标签，避免「为什么没问我」的误解。
- 空态：「还没有记下的承诺。你在对话里说「我明天做 X」，阿咲才会记一条。」——不要用「暂未记录」这类含糊话。
- 「显示已结束」开关默认关闭；打开后只读显示 `done/dropped` 与结束日期，不提供动作。
- 改期用原生 `input[type=date]`，不得早于今天，最大 365 天后；冲突时给中文错误，不做静默失败。

### 长期计划页 · 顶部一条「一周安排」

- 一行：「你说过这周特别满：周二、周四（来自周复盘）」，右侧「清除」。
- 没有记录时**整块不渲染**（与现有「无数据就整段消失」的惯例一致）。
- 清除后给一句确认事实：「已清除。之后排计划会恢复按项目设置的可用时间。」不弹对话框。

### 任务表单 · 两个时间字段

- 「截止日期」`type=date`（可空）；「固定开始时间」`type=datetime-local`（可空）。
- 字段说明：截止日只是「什么时候之前要做完」；固定开始时间会占住时间表，不会被自动排程挪走。两句话直接写在输入框下方，避免用户以为是同一件事。
- 清空输入即传 `null` 清除（对应 `UpdateWorkspaceTaskInput.due/startAt` 的既有约定，`src/shared/workspace.ts:290-303`）。

### 检查消息

- 有恢复记录时，当天第一条主动检查（晨间/晚间/周日/落后任一）末尾追加：`你之前暂停到 M 月 D 日，今天是恢复的第一天。`；模型路径与模板路径都必须有，且**只追加一次**（沿用 `promiseLine` 的「模型没提就补上，提了就不重复」做法，`proactive-check-in-service.ts:325-335`）。
- 没有恢复记录时，四个模板与提示词全部逐字节不变。

### 提醒页 · 「完成」的次日行为

- 徽标文案分两档：当天显示「已完成」，次日显示「待触发」；不改 `REMINDER_STATE_CHIPS` 的键，只在取值时按今天判定（`ProjectSections.tsx:147-170`）。
- 「重新启用」按钮只在**当天**出现在已完成行上；次日该行已自动恢复，不再需要它，也不要留一个点了没反应的按钮。
- 完成时给一句事实确认：「今天不再提醒。明天照常。」放在现有动作反馈位置，不弹窗。
- 对只设了某些天的提醒，文案改成「下次提醒：周一」而不是「明天」，避免说错。

## 验收标准（可测）

**P0 承诺**

1. 有 3 条 open 承诺（含 1 条过期）时，提醒页「承诺」区按到期升序渲染，过期那条带「已过期 N 天」；`aria-label` 走动作名，例如 `改期：背 20 个单词`。
2. 点「改期」选新日期并保存后：界面行日期更新；`commitments.md` 该条 `due` 变化、`status` 仍为 `open`、无 `resolvedAt`；其他条目与其正文行逐字节不变。
3. 点「放下」后：该行从默认列表消失；文件里 `status: dropped` 且有 `resolvedAt`；打开「显示已结束」能看到它。
4. 空 vault（无 `commitments.md`）时显示指定空态文案，不报错、不写文件。
5. 有未结案承诺时，系统提示包含一节「未结案承诺」最多 3 条，格式 `- 「X」（原定 MM-DD）`；超过 3 条时只取最近到期的 3 条并注明还有几条；**没有承诺时提示与 `1cf5994` 逐字节相同**。
6. 通知中心（iter29）的 `listPendingCommitments` 行为不变；承诺页不通过它写入。

**P1 一周安排**

7. 有本周记录时，长期计划页显示「你说过这周特别满：周二、周四」；无记录时该区块不存在（`queryByText` 为空）。
8. 点「清除」后：`week-availability.md` 中该周记录消失、其他周不变；页面上区块消失；之后 `planWorkspace` 对那几天不再给 `BUSY_DAY_MINUTES`（`src/shared/planning.ts:26`）。
9. 清除一个不存在的周不抛错、不写文件。

**P2 静音恢复**

10. 设 `snoozedUntil = 今天+2`，两天后第一次检查通过时，消息末尾是那句事实；第二条检查（同一天或次日）不再有它。
11. 用户手动「恢复提醒」后第一条检查同样有这句话；从未静音过的仓库，四个触发器消息与提示词逐字节不变。
12. `settings.json` 中 `resumedFrom` 为空时不出现该键；旧设置文件读取后写回逐字节不变。

**P3 任务时间**

13. 表单填截止日期 `2026-12-01` 保存后，今日页任务行出现 `截止 12-01`；清空输入保存后该后缀消失。
14. 表单填固定开始 `2026-11-23T23:30` 保存后：今日安排把它放在 23:30，后续自动排程的任务不与它重叠；`buildDailySchedule` 的 `entries` 中该条 `pinned: true`。
15. `startAt` 为空串或非法时给出中文错误，调用被拒绝，不产生半写文件。

**P4 提醒完成次日恢复**

16. 12:00 的每日提醒「喝水」今天点「完成」后：当天 12:00 之后所有 tick 都不再投递（`delivered` 不含它），页面显示「已完成」，且 `reminders.md` 该条有 `state: done` 与 `doneAt: <今天>`。
17. 次日 12:00 的 tick 投递一次「提醒：喝水」，且写回 `state: fired`、`doneAt` 消失；同一天更晚的 tick 不再重复。
18. 有 `days` 的提醒（如只在周一、三、五）周五点完成：周六、周日不响，下周一正常响。
19. 旧文件里只有 `state: done`、没有 `doneAt` 的提醒：行为与 `1cf5994` 逐字节一致（继续静默，不写文件）；点「重新启用」后写入 `state: pending` 且无 `doneAt`，再点「完成」才带上 `doneAt`。
20. 只点过「延后」或「关闭开关」的提醒不受影响：`enabled: false` 仍然完全不响，不因次日判定而复活。
21. 已完成但未到次日的提醒不出现在「接下来」三项里（`TodayOverview.tsx:181` 现有过滤保持），次日恢复后重新出现。
22. 点「完成」后页面给出一句确认：设了 `days` 的提醒说「下次提醒：周一」，每日提醒说「明天照常」；不超过两行，不弹窗。
23. `state: done` 且 `doneAt` 是今天的提醒行，徽标是「已完成」并带「重新启用」；跨过零点后同一行徽标变「待触发」，且没有「重新启用」按钮。

## 测试点

| 层 | 文件 | 要证明的行为 |
| --- | --- | --- |
| main | `tests/main/commitments.test.ts`（扩展） | 只读投影字段、`includeResolved` 排序、清除幂等 |
| main | `tests/main/ipc-preload.test.ts`（扩展） | 新通道在 `IPC_CHANNELS` 尾部、桥接参数透传、坏输入被拒 |
| main | `tests/main/ipc-handlers.test.ts`（扩展） | `registered.size === Object.keys(IPC_CHANNELS).length + 12` 随新通道成立 |
| main | `tests/main/butler-prompt.test.ts`（扩展） | 承诺节出现/缺席两种提示词；缺席时逐字节等于基线 |
| main | `tests/main/check-in-prompt.test.ts`（扩展） | 恢复那一句只在有记录时出现，模板与提示词各一条 |
| main | `tests/main/proactive-check-in.test.ts`（扩展） | 恢复记录被消费一次后清空；四个触发器的字节不变性 |
| main | `tests/main/settings-service.test.ts`（扩展） | `resumedFrom` 校验、空值不序列化、旧文件往返不变 |
| main | `tests/main/availability.test.ts`（扩展） | `clear` 只删一周；不存在时不写文件 |
| main | `tests/main/scheduler-reminders.test.ts`（改写） | **现有 `a done reminder stops firing until it is re-enabled`（:540）按 P4 改写**：今日静默、次日恢复、带 `days` 的下一个符合日恢复、无 `doneAt` 的旧数据保持静默 |
| main | `tests/main/reminders-records.test.ts`（新或扩展） | `doneAt` 仅接受 `YYYY-MM-DD`，坏值被丢弃而非报错；无 `doneAt` 的旧文件往返逐字节不变 |
| renderer | `tests/renderer/project-page.test.tsx`（改写） | 现有 `:417`/`:421` 断言 `state === 'done'` 与「重新启用」保留；新增「次日回来时徽标是待触发」 |
| renderer | `tests/renderer/reminders-commitments.test.tsx`（新） | 列表/过期标签/三个动作/空态/显示已结束 |
| renderer | `tests/renderer/week-availability-panel.test.tsx`（新） | 显示、无记录不渲染、清除后消失 |
| renderer | `tests/renderer/project-editing.test.tsx`（扩展） | due 与 startAt 的填写、回显与清空 |
| renderer | `tests/renderer/schedule-page.test.tsx`（扩展） | 23:30 固定开始不被挪动且阻挡自动排程 |
| e2e | `e2e/feature-smoke.spec.ts`（扩展） | 从对话说「我明天做 X」→ 提醒页出现承诺 → 改期 → 文件与界面一致（可注入模型替身） |

## 依赖与冲突

- **依赖 iter29-nav 先合入——已满足**（2026-11-22，master `23080a3`）：`src/shared/notifications.ts` 已在 master（含 `CommitmentSummary{id,text,due,status,createdAt?,resolvedAt?,workspaceId?}`）与 `listPendingCommitments({byDate})`，「工作区」已统一改「项目」。本轮在它之上做，避免重复建 `CommitmentSummary`；`listCommitments` 是它那个「只取某天到期」的放宽版，不是第二套形状。
- iter29-nav 已改的断言（`butler-prompt.test.ts` 的 `当前工作区：考研`、e2e 的 `全部工作区`）已随合并成为主分支现状；本轮以合并后的 master 为基线，不再动这些字符串。
- 本轮新增 prompt 段落只在该数据非空时出现，故与 iter29 造成的字符串变化互不影响。
- **与 iter29 无重叠已核对**（2026-11-22 复查合并结果）：`git grep "doneAt\|effectiveReminderState"` 在 master 上是 0 命中，P4 不与 goalId 或通知中心抢同一处；`listPendingCommitments` 只出现在 `ipc` 一处，P0 的 `listCommitments` 是新增通道，不修改它。
- sc-build 报告通知中心还有一个 e2e 回归在修（窄对话列），与本轮 spec 的文档落地无关，但不与其实现改动并行抢文件。

## 主要文件（预计）

```
src/shared/ipc.ts                        + listCommitments / resolveCommitmentEntry / listWeekAvailability / clearWeekAvailability
src/main/ipc.ts                          + 4 通道、参数校验、桥接
src/main/context.ts                      + 4 个 api 方法；检查消息读取 resumedFrom
src/main/check-ins/prompt.ts             + 恢复句（模板 + 提示词）
src/main/check-ins/proactive-check-in-service.ts  + 消费 resumedFrom
src/main/settings/settings-service.ts    + resumedFrom 校验
src/main/availability/service.ts         + clear
src/shared/workspace.ts                  + Reminder.doneAt、ReminderStatePatch.doneAt、次日判定
src/main/workspace/records/reminders.ts  + doneAt 读写（旧文件不含该键）
src/main/workspace/create-workspace-service.ts  + 标为完成写入 doneAt
src/main/scheduler/scheduler.ts          + done 只在当天生效
src/main/butler/prompt.ts                + 未结案承诺节
src/renderer/shell/ProjectSections.tsx   + 承诺区、任务表单两个字段
src/renderer/shell/LongPlanPage.tsx      + 一周安排一条
src/renderer/shell/Workspace.tsx         + 接线
tests/…                                  + 见测试点
```

## 给 builder 的默认决定

- 承诺区放提醒页，不新增导航入口；一周安排放长期计划页顶部，整块无数据即不渲染。
- 完成/放下/改期都走 `resolve`，不新建服务方法；界面动作与晨检回答共用同一套语义。
- 承诺进提示词上限 3 条、每条截断到 120 字，注明「还有 N 条未列出」；不新增读取工具。
- 「显示已结束」默认关闭，只读。
- 静音恢复用 settings 里的 `resumedFrom`，读后即清，只影响一句话。
- P4 不加后台任务：判定放在读取侧（`state === 'done' && doneAt < 今天` 即视为 `pending`），所以应用没开也不会漏；不在 tick 里改文件，避免每 30 秒重写 `reminders.md`。
- P4 不改 `enabled`：关闭开关仍是用户主动关，与「今天已完成」是两件事。
- 时间字段：`due` 保持日期型，不新增「截止时刻」；固定开始用既有 `startAt`，0 分钟仍按最小 15 分钟块渲染（`schedule.ts:66`）。
- 所有新增用户可见文案用中文事实句，不使用「智能」「一键」这类词，不做弹窗庆祝。
- 不新增依赖、不新增 vault 文件、不联网；文件名与 id 继续走 `assertSafeSegment`。

## 风险

- **提示词逐字节断言**：`butler-prompt.test.ts`、`butler-service.test.ts`、`check-in-prompt.test.ts` 多处断言精确字符串。只在数据非空时追加，并在新增用例里显式断言「无数据时等于基线」。
- **IPC 计数断言**：`ipc-handlers.test.ts:78` 用 `+ 12` 的固定偏移；新通道加在 `IPC_CHANNELS` 里会同时进入 `Object.keys`，断言自然成立，但不要另建 channel 常量集。
- **承诺与任务重复**：「我明天做 X」既可能是一条承诺，也可能被模型再 `create_task` 一次。本轮不改工具，但界面文案明确「这是你答应的事，不是任务」；后续若出现双写，需要单独一轮合并决定。
- **e2e 选择器**：`全部工作区` → `全部项目` 的改名由 iter29 负责；本轮不要在 e2e 里再写死旧名。
- **P4 会打破一条既有测试**：`scheduler-reminders.test.ts:540` 明确断言「done 的提醒不投递且不写文件」。这是**有意**改行为，测试要按新语义改写，而不是放松断言。同 `project-page.test.tsx:417` 的徽标断言。
- **P4 与「每日已完成」的显示冲突**：`TodayOverview.tsx:181` 过滤掉 `done` 是对的（今天做完了）；但次日徽标要显示「待触发」，两处必须都走 `effectiveReminderState(reminder, 今天)`，不能一处看原字段、一处自己比日期。

## 待主人决定

（已定：提醒「完成」次日自动恢复，见 P4；spec 先留在草稿，等 iter29 合入后再写进仓库。）
