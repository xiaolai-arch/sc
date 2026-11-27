# ASAKI iter32：断了不断进度——断签恢复、计划现实主义与考前整卷（2026-11-27）

**依据：** `docs/superpowers/reports/2026-11-24-streak-plan-realism-exam-research.md`（第五轮，分支 `xiaolai/iter32-research` 提交 `3653b0b`，已随本 spec 落在本分支 `32efa07`）§1–§7
**基线：** `master` @ `5dde0e6`（报告基线 `9d0143c` 与它之间只有 docs/e2e 改动，`git diff --name-only 9d0143c 5dde0e6 -- src/` 为空，报告 §5 全部 file:line 在本基线复核仍然成立；本 spec 开工前又逐条抽验过）
**状态：** 范围已定（item 57，主人 2026-11-27 裁定）：**P0–P2b 全做，P3 接 P2a 后同轮；P4（if-then 落任务）本轮不做**。跟踪项 item 58。

---

## 一句话

断签是每条学习记录 100% 会遇到的事，而产品现在的全部回应是「连续复盘 0 天」六个字；把 Anki 那套「缺席不罚、恢复有路、单日有顶」的默认值搬进来，再把本地已有的完成率数据接回每日规划，最后给练习集一个整卷形态、给知识主题一个回访节奏——四件事全部长在现有字段和组件上，不需要账号、云、加密或新文件格式。

## 为什么（证据密度最高的四个角度，报告 §1–§4）

| 角度 | 关键证据 | 对设计的意义 |
| --- | --- | --- |
| 断签 | JCR（Silverman & Barasch 2023）：断签伤害行为；**给修复机会显著减弱断签效应**（H4）。Loop Habit：漏几天「will not completely destroy your progress」，SKIP 不扣分不断签。Lally/Singh：漏一天无碍、习惯时间个体差异 18–254 天。Wohl 2010：原谅自己拖延的人下次拖延更少。r/duolingo 一手帖：丢 2000+ 天 streak 的用户在**改系统时间**，丢 611 天的靠**客服 DM 特批**恢复 | 修复应该是产品的默认一句话，不是恩赐或商品；文案承认中断、点名最长连续、给「今天回来就行」的动作（fresh-start 框架，Dai 2014） |
| 计划现实主义 | Buehler 1994（planning fallacy：人按理想剧本估时，不看自己过去）。Anki 用「新卡 20/日」的默认上限回答同一问题（手册原话：上限救你 from a **heart attack**）。r/productivity「4.5 小时睡眠的周计划」与 r/GetStudying「10 个词的 FINALS PLAN」是两个极端用户面 | 把过去 7 天实际完成率作为**事实行**回灌规划 prompt；超载给具体压量数字（本地数据算出，不做预测模型）；重排保持显式确认（SuperMemo Plan 的教训：自动压缩被体验为「计划背叛了我」） |
| 整卷模拟 | 成都大学上岸学生访谈（一手，两人都提）：「**严格按照考试时间和题量**来查漏补缺」「以真题为主，严格按照考研初试时间进行模拟」。Ramirez & Beilock 2011（考前暴露于压力情境的价值） | 现有练习集只有逐题形态；整卷 = 设定总时长 → 按卷内顺序限时作答 → 结卷出正确率，复用计时与错题本 |
| 回访节奏 | obsidian-spaced-repetition：调度元数据写回明文笔记是成熟做法。Quantum Country 数据（六次复习 54 天保持）。Duolingo 排程实验的反面：改节奏要看回访留存。fsrs4anki：保持率滑杆两侧都有坑，「默认值替用户拿主意即可」 | `revisitDue` 加**确定性**阶梯（答对顺延 3→7→14→30，没接住回次日），元数据仍落明文，不暴露任何算法名词、不做滑杆 |

## ASAKI 现状与落差（报告 §5，file:line 已按 `5dde0e6` 复核）

| # | 落差 | 证据 | 对应批次 |
| --- | --- | --- | --- |
| G1 | 断签没有设计：streak 是纯计算值，断签日只剩「连续复盘 0 天」，无表述无恢复引导；复盘连续口径的「最长连续」无处展示（热力图摘要行的「最长连续」是**学习分钟**口径、12 周窗口，`StudyHeatmap.tsx:56` 渲染 `heatmap.ts:124` 的 summary——与本缺口不同口径） | `review-stats.ts:8-16`（while 循环遇缺口即止）；`ReviewPage.tsx:73-79, 211-218` | P0 |
| G2 | 每日规划不看完成史：`buildWorkspacePlanPrompt` 的提示词里没有任何历史完成数据；可用时间四来源（输入/周安排/项目/默认 120）都不是「实际能完成多少」 | `planning/prompt.ts:24-94`；`workspace-planner.ts:18, 58-70` | P1 |
| G3 | 重排入口默认值凭空：重排剩余时长输入框硬编码 `'10'`，与实际进度无关 | `LongPlanPage.tsx:504` | P1 |
| G4 | 无整卷/模拟考形态：练习集只有逐题作答；专注计时固定 25 分钟、绑定任务 | 全仓库「真题/模拟考」仅在 `plan-template.ts:136` 种子文案；`FocusTimer.tsx:30-81`、`focus-timer.ts:3-5` | P2a |
| G5 | 知识主题回访无节奏：`schedule_revisit` 默认明天、单字段覆写 `revisitDue`，无间隔阶梯 | `butler/prompt.ts:44`；`butler/tools.ts:839-881`（`:874` 覆写） | P2b |
| G6 | 考前最后阶段无差异化行为：倒计时进了 prompt 与今日页，但「最后两周」与平时完全同构 | `planning/prompt.ts:105-152`；`TodayOverview.tsx:233-246` | P3 |
| G7 | 断签日的提醒文案是催促制：早检查文案固定，与「昨天没来」无关 | `scheduler.ts:157-163`（固定文案）；`proactive-check-in-service.ts:384`（模板路径） | P0 |

已做对的不动：存活期「上午不清零」（`ReviewPage.tsx:74-78` 先显示截至昨日的存活 streak）、热力图与校准卡、落后提醒只在完成 <50% 时响（`behind-schedule.ts:19-58`）、检查去重与推迟、错题本 3 天间隔定级（`practice/schedule.ts`）、`dueRevisitTopics` 让过期回访不消失（`TodayOverview.tsx:125-131`）。

## 目标（本轮）

- **P0 断签恢复（G1+G7）**：复盘页常驻「最长连续复盘 M 天」；断签日显示一句恢复文案（承认中断、点名最长连续、给「今天记一笔」动作）；断签次日的早检查把「继续昨天」换成 fresh-start 框架事实行。**极小改动，证据密度最高。**
- **P1 计划现实主义（G2+G3）**：过去 7 天实际完成率（本地数据，纯函数）回灌每日规划 prompt；完成率 < 60% 时给一行具体压量建议（数字由代码算出）；重排默认值从硬编码 `'10'` 改为「计划自己的每周小时数 × 实际速度比」。
- **P2a 整卷模拟（G4）**：练习集加「整卷模拟」模式——设定总时长 → 按卷内顺序限时作答 → 结卷出全卷正确率；逐题落库逻辑与错题本完全复用。
- **P2b 回访阶梯（G5）**：`schedule_revisit` 加确定性阶梯（回答到位 → 3→7→14→30 天；没接住 → 次日），阶梯步数落在 vault 明文里的一个新可选字段；UI 不出现任何算法词汇。
- **P3 考前窗口（G6，依赖 P2a）**：exam 项目倒计时 ≤ 14 天时今日页加一行整卷轻提示；「开始今天复盘」在窗口内第一次追问一句 Ramirez 式考前写作（一次性）。

**P4（if-then 落任务）本轮不做**（主人 2026-11-27 裁定）：报告 §6-P4 留档，等 P1 落地后规划文案有余量再评估。

## 非目标（本轮）

调研的拒收清单（报告 §6），七条：

1. **AI 一键批量生成题库/闪卡**：Nielsen 原话「making Anki cards is an act of understanding in itself」——制卡即精加工编码；管家在对话里帮出题（已有）保留，「一键生成 N 张」不做。
2. **连续打卡道具化**（streak freeze 购买/游戏化道具）：道具=把修复变成商品；修复是默认给的一句话。
3. **罚款/金钱承诺**：第三轮已拒（与「别让我内疚」冲突），本轮无新证据推翻。
4. **SuperMemo 增量阅读**：复杂度被建造者自己承认是障碍；低技术素养前提不可破。
5. **口语/语音练习**：无音频基础设施，无证据采集条件。
6. **番茄钟改造**（自定义时长、5 分钟起步档）：已有 25 分钟专注计时；P2a 的整卷计时顺带覆盖「按考试时长计时」的真实需求，不另做通用自定义。
7. **全量日历同步**：Windows 日历权限与隐私面大；「周安排/今天特别满」机制已覆盖同一需求。

其余不做（含反功能，报告 §7）：

- **P4 不做**（范围裁定，见「目标」末）；`cue` 字段已有，不改。
- ❌ 不做打卡日历红色断点标记、不做「你断了」愧疚横幅：断签文案只陈述事实 + 给下一步。
- ❌ 不把「最长连续」做成排行榜或可分享卡片：本地优先，无分享面。
- ❌ 不做预测性「你大概考 XX 分」：完成率只回灌**过去的事实行**，不外推。
- ❌ 倒计时与考前提示不用红色焦虑配色，保持中性数字。
- ❌ 考前写作不做「情绪分析/AI 解读你的焦虑」：写完随复盘照常保存，仅此而已。
- ❌ 不向 UI 暴露「间隔重复/FSRS/遗忘曲线/目标保持率」词汇，不做保持率滑杆：默认值替用户拿主意（fsrs4anki 教训：两侧都有坑）。
- 不引入账号/云、不新增依赖、不联网；不改 `createBackup` 白名单与密钥边界。

## 数据与契约

### 新增字段只有一个：`KnowledgeTopic.revisitStep`（P2b）

```ts
// src/shared/knowledge.ts —— KnowledgeTopic 增补
/** 回访阶梯步数 1–4：已连续接住的次数。缺省 = 还没进过阶梯（首次讲完）。 */
revisitStep?: number;
```

- 挂在既有 `revisitDue`（`knowledge.ts:38`）旁，**缺省不序列化**（`records.ts:97,118` 的既有模式：只有在场才写键）；读取容错——非 1–4 的值丢弃，主题不因坏值消失（`records.ts:81-83` 对 `revisitDue` 的同款规则）。`UpdateKnowledgeTopicInput` 增加同名可选键 `revisitStep?: number | null`，与 `revisitDue` 完全同款：`null` 删除该键、1–4 写入、其他值校验报错（先例 `create-knowledge-service.ts:437-443`）；仅由 `schedule_revisit` 工具写入，不进任何表单。
- **零值口径（评审建议 2）**：落盘形态只有「键在、值 1–4」与「键不在」两种，**从不写 `revisitStep: 0`**。没接住时 `nextRevisit` 返回 `step 0`，工具据此传 `revisitStep: null` 清键——回到「缺省=没进过阶梯」的语义，读取端与写入端只有一个口径。
- 阶梯是纯函数（新文件 `src/shared/revisit.ts`），`vault` 文件格式语义不变（仍是 frontmatter 里的可选键）：

```ts
export const REVISIT_LADDER_DAYS = [3, 7, 14, 30] as const;
/** 接住 → 步数 +1（封顶 4），间隔取阶梯；没接住 → 次日、步数归零。 */
export function nextRevisit(step: number | undefined, recalled: boolean): { step: number; days: number };
//   recalled: step = min((step ?? 0) + 1, 4)；days = REVISIT_LADDER_DAYS[step - 1]
//   !recalled: step = 0；days = 1（明天）
```

- 首次讲完仍默认明天（`butler/prompt.ts:44` 的现有口径不动）；阶梯从**回访日自测**开始走。

### `schedule_revisit` 增加一个可选参数（P2b）

```ts
recalled?: boolean;  // 回访自测结果：接住=true / 没接住=false
```

- 提供 `recalled` 时：忽略 `days` 参数，间隔与步数来自 `nextRevisit(topic.revisitStep, recalled)`，`revisitDue` 与 `revisitStep` 一起落库；返回消息文案不变（`已安排：N 天后（date）抽 5 分钟自测「X」。`）。
- 省略 `recalled` 时：与 `5dde0e6` 逐字节一致（显式 `days` 1–30、缺省明天、不写 `revisitStep`）。

### 过去 7 天完成率（P1，纯函数，无新存储）

```ts
// src/shared/weekly-stats.ts 增补（与 weeklyOverview 同文件同口径）
export function recent7DayCompletion(
  tasks: readonly WorkspaceTask[],
  today: Date
): { planned: number; done: number; percent: number } | null;
```

- 窗口 `[today-6, today]`，按 `due` 归日（无 `due` 的积压不计入——与落后提醒同一条口径：无日期的常备积压不是「今天的计划」，`behind-schedule.ts:8-11`）；`done` = `status === 'done'`；`skipped` 两边都不计。
- **样本门槛：planned < 5 返回 null**，prompt 不加行（字节不变）；门槛防止两三天的样本把完成率说成事实。

### 重排默认值（P1，纯函数）

```ts
// src/shared/plans.ts 增补
export function suggestedRecalibrateHours(plan: LongPlan, today: string): number;
```

- `elapsed = clamp(dayNumber(today) - dayNumber(plan.startDate), 0, weeks×7)`；`elapsed < 7` 或 `planProgress(plan).total === 0` → 返回 `plan.weeklyHours`（先把「凭空的 10」修成「计划自己的数」）。
- 否则按实际速度比：`expected = elapsed / totalDays`、`actual = progress.percent / 100`，返回 `clamp(round(plan.weeklyHours × actual / expected), 1, 80)`（80 与重排输入框上限一致，`LongPlanPage.tsx:1318`）。仍是输入框默认值，用户随手可改。

### 一次性考前写作标记（P3，renderer 本地）

- localStorage 轻量偏好（与「今日只做一件」「quiz-offer 冷却」同一家轻量 store，`TodayOverview.tsx:27-45`）：键 `exam-writing-asked:<targetDate>`，值 = 发送日期。清浏览器数据会再问一次——已知边界，不做服务端去重。

## 界面

### 复盘页（P0，`ReviewPage.tsx:211-218` 那一块）

- 有复盘记录时常驻一行：`最长连续复盘 {M} 天`（与「连续复盘 N 天」并排同排；两行都是事实行，不用红色）。
- **断签态**（今天未复盘、昨天也未复盘、历史有记录）时，紧跟其后一句恢复文案：

  `中断了一次，但「最长连续复盘 {M} 天」还在——今天记一笔，就重新开始。`

- 存活态与从未复盘态：不出现恢复文案，其余与基线逐字节一致。

### 早检查（P0 G7，`proactive-check-in-service.ts` + `check-ins/prompt.ts`）

- 新增注入式 provider（与 `getDueCommitment`/`getResume` 同一模式）取复盘事实；**断签次日**（昨天无复盘、更早有记录）的早检查消息末尾追加确定性事实行：

  `昨天没有复盘，新的一天从一件小事开始就行。`

- 拼接走 `resumeCheckInLine` 同款机制（compose 之后追加，`proactive-check-in-service.ts:370-371`）：模型开与关两条路径逐字相同，模型既不能吞掉也不能复述两遍。
- 与承诺回访行同日同在时：fresh-start 行在前、承诺行在后，顺序固定。

### 每日规划 prompt（P1，`planning/prompt.ts`）

- 有样本（≥5）时加一行事实：`过去 7 天：安排 {N} 项，完成 {M} 项（{P}%）。`
- `P < 60` 时再加一行压量建议，数字由代码算出（`X = max(15, round(A × P / 100 ÷ 5) × 5)`，A = 今日可用分钟）：

  `完成率偏低：请把今天的任务总量压到约 {X} 分钟（按过去 7 天完成率 {P}% × 可用 {A} 分钟），宁可少排，不要排满。`

- `P ≥ 60` 只有一行事实、无压量行；无样本两行都无（prompt 字节不变）。
- 模板计划路径（无模型）完全不经过 prompt，不受影响。

### 重排对话框（P1，`LongPlanPage.tsx:504,1315-1330`）

- 「接下来的每周投入（小时）」默认值 = `suggestedRecalibrateHours(plan, today)`，不再是硬编码 `'10'`；旁边给一行来源说明（`按你过去 {elapsed} 天的实际进度建议`，数据不足时 `沿用计划的每周小时数`）。

### 整卷模拟（P2a，`LearningPane.tsx`）

- 每个练习集头部加「整卷模拟」按钮（与「交错混练」同一排的次要按钮）。点击先出配置：`总时长（分钟）`，默认 `clamp(题数 × 2, 5, 600)`，可改（5–600 整数），确认开始。
- 整卷中：按卷内顺序逐题作答；顶部常驻倒计时（墙钟结算，`tickFocus` 同款防节流）；**不逐题展示对错**（保持模拟真实感）；可「提前交卷」。
- 到时自动交卷，提示 `时间到，自动交卷。`；未作答题标「未作答」，不记 attempt、不进错题本。
- 结卷摘要卡：`整卷完成：正确 {X} / {N} 题{，未作答 {M} 题}，用时 {T}。错题已记入错题本。`（未作答为零时省略逗号段；「再练一次」回普通模式。）
- 会话只存内存：离开页面或重启 = 该次整卷作废；已逐题落库的作答与错题不丢。25 分钟专注计时器一行不动。

### 考前窗口（P3，`TodayOverview.tsx` + 复盘开场）

- exam 项目、倒计时 ≤ 14 且 ≥ 0、P2a 已合入：今日页倒计时行下追加一行中性提示：

  `距考试还有 {N} 天——适合来一次整卷模拟（学习 → 练习集）。`

- 同一窗口内第一次点「开始今天复盘」（`ReviewRecords.tsx:52,142`）时，发给管家的开场消息由 `我们开始今天复盘` 变为追加一句：`先花两分钟写下你现在最担心考试的一件事，写完我们继续复盘。`；发送即写标记，同一 `targetDate` 只发一次。

## 验收标准（可测）

**P0 断签恢复**

1. `longestReviewStreak` 纯函数：跨月/跨年连续、乱序输入、同日重复去重、空历史 → 0（与 `reviewStreak` 共用本地日期口径，进 `tests/shared/review-stats.test.ts`）。
2. 复盘页有记录时常驻显示 `最长连续复盘 {M} 天`，与「连续复盘 N 天」同排；无记录时该行不出现（与基线一致）。
3. 断签态（今天与昨天都未复盘、历史有记录）出现恢复文案一句，含最长连续数字；文案不含「清零」「失败」「断了」字样，不用红色。
4. 存活态（今天或昨天已复盘）不出现恢复文案；「连续复盘 N 天」「今天还没复盘」行为与 `5dde0e6` 逐字节一致（`tests/renderer/review-streak.test.tsx` 现有两条用例保持通过）。
5. 断签次日早检查追加 fresh-start 行，模型开与关两条路径逐字相同；昨天已复盘或无历史时早检查消息与基线逐字节相同。
6. fresh-start 行与承诺回访行同日同在：两行各出现一次、fresh-start 在前，顺序固定。
7. 补录昨天的复盘后，当天再触发的检查不再带 fresh-start 行（判定按数据实时算，无缓存）。

**P1 计划现实主义**

8. `recent7DayCompletion` 边界：窗口按 `due` 归日；undated 不计；`skipped` 不计 done 也不计 planned；percent 四舍五入；窗口边界（第 7 天前的一天不计）。
9. planned < 5：prompt 无完成率行，与基线逐字节一致。
10. planned ≥ 5：prompt 出现事实行 `过去 7 天：安排 N 项，完成 M 项（P%）。`，数字与纯函数输出一致。
11. P < 60：出现压量行，`X` 等于代码算出的数（含 15 分钟下限与 5 分钟取整各一个边界用例）；P ≥ 60 无压量行。
12. 模板计划路径（无模型）输出与基线逐字节一致。
13. 重排对话框默认值：elapsed < 7 天或无进度 → `plan.weeklyHours`；elapsed ≥ 7 天且有进度 → 速度比公式值（clamp 1–80 各一个边界用例）；永不为 `'10'`；手改后提交仍走既有 `normalizeWeeklyHours` 校验。

**P2a 整卷模拟**

14. 每个练习集有「整卷模拟」入口；默认时长 = clamp(题数×2, 5, 600)（题数 1、3、400 三个边界用例），可改、越界提交被钳回。
15. 整卷中逐题提交照走 `submitAnswer`/`submitShortAnswer`：attempts、错题本、校准卡与逐题模式无差别（`tests/main/practice-service.test.ts` 既有断言不回归）。
16. 整卷模式不逐题展示对错；结卷前不出任何单题正确/错误反馈。
17. 到时自动交卷：未作答题标「未作答」，不记 attempt、不进错题本；摘要为 `正确 X / 共 N 题，未作答 M 题，用时 T`。
18. 提前交卷可得同样摘要；全部答完自动结卷。
19. 计时基于墙钟：模拟系统睡眠/后台节流（注入时钟推进）后剩余时间正确；离开页面或重启后整卷会话不恢复，但已提交题目的落库数据完好。
20. 25 分钟专注计时器行为与 `5dde0e6` 一致（常量、绑定任务、结算逻辑零改动）。

**P2b 回访阶梯**

21. `nextRevisit` 边界：无 step 接住 → 3 天/step 1；step 1/2/3 接住 → 7/14/30 天；step 4 接住 → 仍 30 天（封顶）；任何 step 没接住 → 明天/step 0。
22. `schedule_revisit` 带 `recalled`：忽略 `days`，`revisitDue` 与 `revisitStep` 按阶梯落库，返回消息文案与现在同形；省略 `recalled`：与 `5dde0e6` 逐字节一致（显式 days、缺省明天、不写 `revisitStep`）。
23. `revisitStep` 落盘只有两种形态：值 1–4 时写键，归零时键被移除（**从不写 0**，验收用一个「先接住两次、再没接住」的序列断言键消失）；frontmatter 坏值（0、5、'x'）读取丢弃、主题不消失；旧文件无该键读取不变。
24. butler 指引更新后：回访日自测结束按结果传 `recalled`；指引与一切 UI 文案不出现「间隔重复/FSRS/遗忘曲线/保持率」词汇（`tests/main/butler-prompt.test.ts` 加负断言）。
25. 到期回访仍进今日页：`dueRevisitTopics` 与回访卡片（`今天是「X」的回访日：让阿咲抽 3 道？`）与基线一致（`tests/renderer/today-revisits.test.tsx` 保持通过）。

**P3 考前窗口（依赖 P2a）**

26. exam 项目、倒计时 ≤ 14 且 ≥ 0：今日页出现整卷提示行（中性配色，含「学习 → 练习集」指引）；kind 非 exam、倒计时 > 14 或 < 0 均不出现。
27. **P2a 未合入时提示行整体不出现**（交付门控；iter31 评审阻断 3 同款教训：不得承诺还不存在的行为）。
28. 窗口内第一次「开始今天复盘」：开场消息含考前写作那句；同一 `targetDate` 第二次起不再追加（标记按 targetDate 键）；非窗口项目开场与基线逐字节一致。
29. 写作内容随复盘正文照常 `save_review`，无单独字段、无情绪分析出口。
30. P3 全部行为不依赖任何新设置项；关闭/清空本地标记只影响是否再问一次，不产生其他副作用。

## 测试点

| 层 | 文件 | 要证明的行为 |
| --- | --- | --- |
| shared | `tests/shared/review-stats.test.ts`（扩展；现有两条保持通过） | `longestReviewStreak` 四条边界（跨年、乱序、重复、空） |
| renderer | `tests/renderer/review-streak.test.tsx`（扩展） | 最长连续常驻行、断签恢复文案出现/不出现、存活态逐字节 |
| main | `tests/main/check-in-prompt.test.ts`（扩展） | fresh-start 行的拼接位置、与承诺行同在的顺序、缺席时字节不变 |
| main | `tests/main/scheduler-check-in.test.ts`（扩展） | provider 注入断签事实；补录后当日起不再出现；模型/模板两路径一致 |
| shared | `tests/shared/weekly-stats.test.ts`（扩展） | `recent7DayCompletion` 窗口/undated/skipped/门槛/round |
| main | `tests/main/planning-workspace-planner.test.ts` + `tests/shared/planning.test.ts`（扩展） | 完成率行与压量行的出现/缺席、X 的取整与下限、模板路径字节不变 |
| shared | `tests/shared/plans.test.ts`（扩展） | `suggestedRecalibrateHours` 四分支与 clamp |
| renderer | `tests/renderer/long-plan-page.test.tsx`（扩展） | 打开重排对话框默认值来自公式、来源说明两态、手改可提交 |
| renderer | `tests/renderer/practice-ui.test.tsx`（扩展） | 整卷入口、默认时长公式、不逐题亮对错、到时自动交卷、未作答不计、提前交卷、摘要 |
| main | `tests/main/butler-tools.test.ts`（扩展；现有 revisit stub `:1189-1194` 保持通过） | `recalled` 阶梯落库、省略时逐字节旧行为 |
| main | `tests/main/knowledge-service.test.ts`（扩展） | `revisitStep` 缺省不序列化、坏值容错读 |
| main | `tests/main/butler-prompt.test.ts`（扩展） | 指引含 `recalled` 用法；负断言四个算法词汇不出现 |
| renderer | `tests/renderer/today-revisits.test.tsx`（扩展） | 考前提示三态门控 + P2a 门控；一次性写作行与标记 |
| e2e | `e2e/feature-smoke.spec.ts`（可选） | 整卷一轮到摘要；断签态复盘页恢复文案 |

## 依赖与冲突

- **批次顺序建议：P0 → P1 → P2a → P2b → P3**。P2a 与 P2b 互不依赖、文件不相交，可并行或换序；**P3 硬依赖 P2a**（整卷提示指向的入口在 P2a 里），必须最后。
- **文件不相交**：P0（ReviewPage / review-stats / check-ins 两文件）、P1（planning 两文件 + weekly-stats + plans + LongPlanPage）、P2a（LearningPane / practice-ui）、P2b（knowledge 三文件 + butler 两文件）、P3（TodayOverview / Workspace）五个批次没有共享源文件；只有 `tests/renderer/today-revisits.test.tsx` 同被 P2b（回归）与 P3（新增）触碰，先后合入即可。
- **本机内存约束**（沿用 iter31 排期提醒）：长期只剩 0.5–1.2GB，不要同时开两条实现线，一条一条来。
- ButlerContext 不含复盘数据（`butler/context.ts:19-41`）：G7 的断签事实按检查服务既有的 provider 注入模式接（`getDueCommitment`/`getResume` 同款，`proactive-check-in-service.ts:477-496`），不扩 ButlerContext。
- P1 的 planner 数据来自 `getWorkspaceSnapshot`（已含 `tasks`，`workspace.ts:254-260`），不需要新查询。

## 主要文件（预计）

```
src/shared/review-stats.ts                 + longestReviewStreak、断签判定            （P0）
src/renderer/shell/ReviewPage.tsx          + 最长连续常驻行、断签恢复文案              （P0）
src/main/check-ins/prompt.ts               + fresh-start 行（模板与 prompt 两路）      （P0）
src/main/check-ins/proactive-check-in-service.ts + 复盘事实 provider、compose 后拼接   （P0）
src/shared/weekly-stats.ts                 + recent7DayCompletion                     （P1）
src/main/planning/prompt.ts                + 完成率事实行、压量建议行                  （P1）
src/main/planning/workspace-planner.ts     + snapshot.tasks → 完成率注入              （P1）
src/shared/plans.ts                        + suggestedRecalibrateHours                （P1）
src/renderer/shell/LongPlanPage.tsx        + 重排默认值与来源说明                      （P1）
src/renderer/shell/LearningPane.tsx        + 整卷模式（配置、倒计时、结卷摘要）        （P2a）
src/renderer/shell/focus-timer.ts          + 墙钟结算纯函数复用（常量与任务绑定不动）  （P2a）
src/shared/knowledge.ts                    + revisitStep 字段                         （P2b）
src/shared/revisit.ts（新）                + REVISIT_LADDER_DAYS、nextRevisit         （P2b）
src/main/knowledge/records.ts              + revisitStep 序列化/容错读                 （P2b）
src/main/knowledge/create-knowledge-service.ts + update 校验                          （P2b）
src/main/butler/tools.ts                   + schedule_revisit 的 recalled 参数        （P2b）
src/main/butler/prompt.ts                  + 回访自测后按结果走阶梯的指引一行          （P2b）
src/renderer/shell/TodayOverview.tsx       + 考前整卷提示行（P2a 门控）               （P3）
src/renderer/shell/Workspace.tsx           + 复盘开场一次性写作行与本地标记            （P3）
tests/…                                    + 见测试点
```

## 给 builder 的默认决定

- 所有新 prompt 行与 UI 行都是**数据在场才出现**：无样本/存活态/非窗口 → 与 `5dde0e6` 逐字节一致。这是本 spec 的第一条纪律，验收里每一条「不出现」都在锁它。
- 完成率、压量分钟数、重排默认小时数、整卷默认时长全部由**代码算出**，模型只收到事实，不做预测、不自行估完成率。
- 断签文案与 fresh-start 行的措辞以本文「界面」节的句子为准（可微调标点，不可改成愧疚制）；不新增任何红色样式。
- 整卷模式是练习集的一种**作答方式**，不是新实体：不新建文件、不加字段、不加 IPC 通道；逐题落库零改动。
- 阶梯只由 `schedule_revisit` 的 `recalled` 参数驱动；`days` 与 `recalled` 同给时 `recalled` 赢（并在工具描述里写明）。
- P3 的两样东西（提示行、一次性写作）都以 P2a 合入为前提做门控；单独交付 P0–P2b 时 P3 验收不适用（验收 27）。
- 「已做对的」清单（存活期不清零、热力图、落后提醒、检查去重、错题本定级、`dueRevisitTopics`）一次都不动。
- 不新增依赖、不联网；所有新文案中文事实句。

## 风险

- **prompt 字节断言多**：`check-in-prompt` / `planning-countdown` / `butler-prompt` 现有 fixture 对精确字符串敏感；新行只在数据在场时出现，且顺序固定（完成率行在倒计时行之后、压量行紧随其后；fresh-start 行在承诺行之前），新增行位置写进测试。
- **完成率口径会被告状**：「安排 N 项」只数有到期日的任务，undated 积压不计——这是与落后提醒一致的口径，prompt 行措辞已写明「安排」；不数积压是故意的（常备积压会让完成率永远难看）。
- **整卷摘要与 attempt 历史的两个分母**：整卷分母 = 全卷题数（含未作答），attempt 历史分母 = 已答题；文案已区分（摘要说「共 N 题」，历史不说「正确率」以外的整体话），测试锁两处口径不混用。
- **`revisitStep` 手改**：主题 frontmatter 可被手编；坏值容错读 + 仅工具写入双保险，测试用 0/5/'x' 三个坏值锁。
- **P3 标记在 localStorage**：清数据会再问一次（已知边界，验收 28/30 写明）；不做服务端去重。
- **整卷跨天**：计时基于开始时间戳，跨零点结卷按实际用时展示；不产生跨天任务、不动调度器。

## 已定（不再重开）

1. 范围：P0–P2b 全做，P3 接 P2a 后同轮；P4（if-then 落任务）本轮不做（主人 2026-11-27，item 57）。
2. 拒收七项进非目标（AI 批量题库 / streak 道具 / 罚款 / 增量阅读 / 口语语音 / 番茄钟改造 / 日历同步）。
3. 重排保持**显式确认**，只把默认值改成数据驱动（报告 §1.4：SuperMemo 的自动压缩被用户体验为「计划背叛了我」）。
4. 完成率回灌只给事实行 + 压量建议，不做预测模型、不做外推（报告 §7 反功能）。
5. 回访阶梯完全确定性（3→7→14→30 / 次日），不暴露算法名词、不做保持率滑杆（报告 §6-P2b）。
