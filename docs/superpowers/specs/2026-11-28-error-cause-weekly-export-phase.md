# ASAKI iter34：错因一行与顽疾可见 / 周数据口径 / Anki 导出 / 考研三阶段

> 状态：待 sc-review 评审 ｜ 分支 `xiaolai/iter34-spec` ｜ 基线 master `4574847`（2026-11-28，1.3.0 已发）
> 依据：第七轮调研报告（本分支 `docs/superpowers/reports/2026-11-28-error-cause-data-integrity-export-phase-research.md`，cherry-pick 自 `xiaolai/iter34-research` @ `ae209b9`）。
> 范围裁定（主人 2026-11-28）：**P0、P1、P2、P3 全做**。

## 一句话

1.3.0 修好了「坚持」与「恢复」，iter34 修「错与信」：每条错题能回答「为什么错」且二次错可见可洗白（P0）、每周数字不再吓人也别骗人（P1）、数据随时能带走去 Anki 复习（P2）、给三个月长跑装三座里程碑（P3）。AI 归因、FSRS 旋钮、自动删除、云同步四条路进非目标。

## 为什么（证据摘引，全文见报告）

- **P0**：`PracticeMistake` 有 wrongCount/correctStreak/priority/stabilityDays/difficulty，**无错因字段**（`src/shared/practice.ts:188-215`，G1）；`priority` 错一次 +1、封顶 3（`src/main/practice/practice-service.ts:233`），答对 -1（`:253`）——**升到 3 了学习者看不见**（G2）；复习单只显示「错 N 次 · 优先级 N · 状态」（`src/shared/practice-sheet.ts:78`），错题本行同（`src/renderer/shell/PracticePanels.tsx:162`）。证据：一行错因方法论（r/GetStudying「just the ones where i misunderstood the concept. one line... takes 30 seconds」）、概念级自我解释 g=.55 且优于元认知归因（Bisra 2018）、中文错题本闭环「及时清空变薄＋二次错升级大考必看」（知乎 ③）、Anki leech 阈值→tag 与连对洗白状态机（LeechToolkit）。
- **P1**：同一文件里两个口径并存——周统计分母把**全部无日期积压**算进去（`src/shared/weekly-stats.ts:76-78`），而 `recent7DayCompletion` 明确排除无日期积压并注释「a standing backlog cannot drag the rate down forever」（`:117-149`，注释见 `:121-124`，G3）；周正确率 `correct/answered` 把重复作答全算（`:93-96`，G4），与 Anki True Retention「只有每日第一次算」相反。误读的代价是信任（第三轮「信任核验」）。
- **P2**：导出面只有卡组 PDF（`src/main/deck-browser.ts:14`、`:320`）与错题复习单 md（`practice-service.ts:856-894`，G5）——HN 原声点名「PDFs are inserted as bitmap images」式「能看不能用」。Anki 文本导入规格支持 `#separator` / `#columns` / `#tags column` / `#deck` / `#html` 头部（报告 1d 逐条原文），**零转换器**直进 Anki 桌面/手机。
- **P3**：`Workspace` 有 `targetDate` / `kind` 但无 `phase`（`src/shared/workspace.ts:56-80`，G6）；三阶段各有可执行验收动作，且恰好逐一落在已上线能力上：不翻书概括（自测）、限时真题记用时（iter33 整卷+用时）、对照错题检查（错题本）——积木齐了，缺串起来的仪式（报告 3a）。

## 批次（P0 → P1 → P3；P2 与 P0 同侧、可并行）

| 批次 | 内容 | 依赖 |
|---|---|---|
| **P0 错因一行 + 顽疾可见 + 变薄** | `PracticeMistake.cause?: string`（可选一行，≤40 字）；错题本与复习单渲染错因行；复习单顶部按科目聚合行（n≥2 才出现）；`wrongCount≥2 && correctStreak<2` 渲染「顽疾」标记、连对 2 次自动洗白（零新增状态：两字段都已在库，**priority 不参与判据**）；错题本加「清空已掌握」→ resolved 错题**可逆移动**到 `practice/mistakes-archive.md` | 无 |
| **P1 周数据口径修正** | 周统计分母与 `recent7DayCompletion` 同规则（无日期积压不计入 N）；周正确率按「每题每日只计首次」去重；练习样本 n<5 只显题数不显百分比 | 无 |
| **P2 Anki 兼容 TSV 导出** | vault `workspaces/<id>/practice/exports/<set>-YYYY-MM-DD.tsv`，带 `#separator:tab` / `#html:true` / `#columns` / `#tags column` / `#deck` 头部；**不导出调度字段** | 无（与 P0 同 practice 侧，见冲突节） |
| **P3 考研三阶段 + 一次性阶段验收问句** | `Workspace.phase?: '基础'|'强化'|'冲刺'`；切换后的第一次周复盘问一次该阶段验收问题，点过不再问；**不做自动进度判定** | 已上线三块能力（P0 错题本 / iter33 整卷+用时 / 自测） |

P3 与 P2 无共享文件，可并行；P0 与 P2 都落 `practice-service.ts` 与 `practice.ts` —— 必须先互探 merge-tree，或按 P0 → P2 串行。

## P0 细则

### ① 错因一行

- 字段：`PracticeMistake.cause?: string`（`src/shared/practice.ts:188`）。写入时 trim；空串视为未填、不落盘（沿 `checkpoints` / `referenceAnswer` 的宽容读写先例）。
- 长度：超过 40 字截断到 40 字（不省略号截断——错题本里是用户自己的话，宁可截断也不加符号）。
- 入口：错题本行的「补一句错因」内联输入（可跳过）；提交后写 mistakes.md。**不预置按钮/标签**——placeholder 给示例「哪个概念、为什么（例：导数链没拆完）」，不做「粗心/不会」这类预设（Bisra：元认知归因效果更差）。
- 渲染：错题本行与复习单 section 在错因存在时各加一行 `错因：{cause}`；缺省时渲染与 1.3.0 **逐字节一致**。

### ② 顽疾标记 + 自动洗白

- **判据只用 `wrongCount` 与 `correctStreak`，不用 `priority`**。原因（sc-review 2026-11-28 阻断 1，已实测）：`practice-service.ts:232-233` 答错写 `correctStreak: 0` 且 `priority: Math.min(3, priority+1)`，`:253-254` 答对写 `priority: Math.max(0, priority-1)` 且 `correctStreak: correctStreak+1`——两字段同步反向，**`priority===3` 时必然 `correctStreak===0`**，原设计（`priority===3 && correctStreak>=2` 洗白）恒不可达。
- 标记条件：`wrongCount >= 2 && correctStreak < 2`（「错第二次起升格」，对应知乎 ③「二次以上错题……将错题升级，并做上记号」）。文案 `顽疾`（中性：题的属性，不是人的评价）。
- 洗白：连对 2 次（`correctStreak >= 2`）即不再显示——**纯渲染条件，不改任何数据**（`wrongCount` 只增不减，`priority` 与 `correctStreak` 的升降逻辑一字不动）。因此零迁移、无新写入路径。
- 存活性（真实序列可构造）：错 → 错（`2/0`，标记出现）→ 对（`2/1`，仍在）→ 对（`2/2`，消失）；之后再错则 streak 归零、标记复现。见验收 4。
- 渲染位置：错题本行状态区（`PracticePanels.tsx:162` 同行）与复习单尾行（`practice-sheet.ts:78`）。

### ③ 按科目聚合行

- 复习单顶部（标题下、第一条错题前）加一行聚合：按 `PracticeMistake` 所属练习集 `subject` 计数，格式 `数学 8 · 英语 3 · 政治 2`；**科目数 n≥2 才显示**（单科目不画）。
- 计数对象 = 本次导出的 active 错题集合（与 sheet 内容同源，不另查）。
- 科目取法：`PracticeMistake` 无 subject 字段 → 经 `setId` 到练习集取（现有数据路径，需在导出时把 subject 连同达到 buildMistakeSheet）；无匹配集时该条归入 `未分类`（但 `未分类` 不单独构成第二个科目——若全部未分类则不显示聚合行）。

### ④ 清空已掌握（可逆归档）

- 动作：错题本页「清空已掌握」按钮（显式点击，**无自动删除**）。
- 行为：把 `status === 'resolved'` 的错题从 `practice/mistakes.md` **移出**，追加写入 `workspaces/<id>/practice/mistakes-archive.md`（保留全部字段 + 追加 `archivedAt` 本地日期）；mistakes.md 只剩 active。
- **类型**：`PracticeMistake` 增 `archivedAt?: string`（可选，与 `stabilityDays` 同法；`serializeMistakesFile` 直接展开对象，缺类型会 TS 报错）。两文件同 schema，注释写明「archive 记录多一个 `archivedAt`」。
- 可逆：提供「从归档恢复」列出 archive 记录并可移回（移回时 `status` 恢复为 `resolved`，不自动改回 active——不替用户判断）。
- 归档文件格式沿用 mistakes.md 的序列化（同一 `serializeMistakesFile` 结构），**明文可读**，进备份目录（`workspaces/` 整目录本就在备份范围）。
- 幂等/安全：archive 文件不存在则创建并写 frontmatter 头；重复点「清空」时 archive 已有同 id 记录则不重复追加（以 id 去重，保留首条 `archivedAt`）。

### ⑤ 备份与归档说明

`mistakes-archive.md` 与 `practice/exports/` 都是 `workspaces/<id>/` 下的明文文件，天然被既有备份覆盖（iter31 口径：备份整 workspace 目录）。spec 不新增备份代码；仅要求交付报告里一句话确认归档/导出文件落在备份覆盖范围内。

## P1 细则

### ① 周任务完成分母

- `weekly-stats.ts:76-78` 的 `weekTasks` 过滤从「`due === undefined` 或本周 due」改为**只取本周 due**（无日期积压不计入）。
- 为不丢信息，`WeeklyOverview` 增 `backlogCount: number`（=`due === undefined` 且 `status === 'pending' | 'in-progress'` 的条数）；周复盘 stats 行在其 >0 时追加一行 `- 另有积压 {n} 件（不计入完成率）`。
- 函数注释写明「与 `recent7DayCompletion` 同规则」。
- **只改展示口径，不动任务数据与调度**。

### ② 周正确率去重

- `weekAttempts` 去重键 `(questionId, 本地日期)`，保留当日**首次**作答；`answered` / `correct` / `accuracy` 全部基于去重后集合。
- 与 iter33 P1 的「流畅度统计每日只计第一次」同一条规则（Anki True Retention），但**互不复用实现**：iter33 口径作用于单题历史统计，本项作用于周聚合，各自独立可测。若将来有人合并这两处，先核对生效窗口与去重键是否等价（一个是单题历史、一个是周聚合，去重键相同但聚合面不同）。

### ③ 小样本不报百分比

**不改 `accuracy` 字段本身**（sc-review 2026-11-28 阻断 2）：`accuracy` 是共享字段，`WeeklyOverview.tsx:26`、`weeklyRecapLine`（`check-ins/prompt.ts:246`）都在读；把它改成 `answered<5 → null` 会让语义分叉（`hasWeeklyNumbers` 仍真、stats 段仍在、但百分比缺一块），且 `WeeklyOverview` 的 `null` 分支现在是「—」（`answered===0` 专用）。

- 新增显式展示标记：`WeeklyOverview` 增 `accuracyReliable: boolean`（`answered >= 5`），`accuracy` 保持原值不变（`answered===0 ? null : correct/answered`，`weekly-stats.ts:110` 一字不动）。
- `answered > 0 && !accuracyReliable` 时三处消费方：
  - `WeeklyOverview` 的「答题正确率」stat 值改为 **`${answered} 题（样本不足）`**（逐字，与提示行同一句，避免两处措辞漂移）；
  - `weeklyRecapLine`（`prompt.ts:237-248`）不拼「正确率 X%」段（一段都不拼，不是拼空）；
  - flags 行改 `- 练习：本周目前 N 题（样本不足暂不计正确率）`。
- `answered >= 5` 或 `answered === 0`：三处行为与 1.3.0 **逐字节一致**（负例必须覆盖 `answered===0`——那时 `accuracy` 已是 null、`accuracyReliable` 为 false，但文案必须仍走原分支）。
- `hasWeeklyNumbers` 不变（`answered > 0` 仍算有数据）；`WeeklyOverview` 一行不改的路径由验收 15 锁死。

### ④ 口径变更的一次性说明

- 周复盘在**第一次**输出新口径时附一句 `（从本周起，积压任务不计入完成率分母）`。
- **存储位置（sc-review 非阻断 1）**：文案由 main 进程 `check-ins/prompt.ts` 生成，而 iter32 P3 的先例 `asaki:exam-writing-asked:*` 在 **renderer localStorage**（`Workspace.tsx:194-198`）——main 读不到，照抄会撞墙。本项改存 `AppSettings` 的可选标记 `weeklyScopeNoted?: true`（`src/shared/types.ts:151` 的 AppSettings，沿 `strictMastery?: boolean` 先例：缺省不序列化、旧设置文件逐字节往返）。
- 写入时机：该句**真正随周复盘消息发出**时置 `true`；下一次及以后不带。口径不再变动后此标记永久保留（无清理逻辑）。
- 说明：这与 iter32「一次性提醒不进共享设置」的原则局部相左——理由是那条先例的文案在 renderer 拼、本条的文案在 main 拼；跨进程传 renderer 状态要新增 IPC，代价高于一个可选布尔。已记入「已定 7」。

## P2 细则（Anki 兼容 TSV 导出）

- 入口：练习集卡片与错题本页各一个「导出到 Anki（TSV）」动作；一键，无对话框（路径固定、文件名确定）。
- 落点：`workspaces/<id>/practice/exports/<setId>-YYYY-MM-DD.tsv`（练习集）；错题本 `mistakes-YYYY-MM-DD.tsv`。目录不存在则创建。同名当日重复导出**覆盖**（幂等，不堆版本）。
- 文件头（逐字，Anki 文本导入规格）：

```
#separator:tab
#html:true
#columns:正面	背面	解析	标签
#tags column:4
#deck:<科目>
```

- 行格式：每题一行，四列以 Tab 分隔——
  1. 正面：题目 prompt（单选题把 `A. ...` 选项按行列出）
  2. 背面：正确答案（choice 取 `optionLetter(answer)`；short 取 `referenceAnswer`）
  3. 解析：`explanation`；**错题导出时若有 `cause`，追加一行 `错因：…`**
  4. 标签：错题导出给 `错因` / `顽疾`（`wrongCount>=2 && correctStreak<2`）/ `科目:<subject>`；练习集导出给 `科目:<subject>`
- 编码与转义：**UTF-8 无 BOM**；单元格内换行 → `<br>`（`#html:true` 下 Anki 原生识别）；单元格内 Tab → 全角空格替换（避免列错位）；不引入引号包裹（TSV 无引号语义，Anki 按 Tab 切）。
- **不导出调度字段**：wrongCount / correctStreak / priority / intervalDays / stabilityDays / difficulty / due 一律不出现在文件里（照 Anki 分享剥离调度口径）。测试用 grep 断言。
- 文件首行必须是 `#` 头（Anki 要求 header 在文件顶部，之前不得有空行）。`#deck:` 后的科目名按单元格同一规则清洗（Tab → 全角空格、换行剔除），否则会破坏头部行。
- 导出不判定成功/失败——写完即返回路径；路径回显在 UI（「已导出 12 题到 workspaces/…/exports/x.tsv」）。
- 说明句（UI 一行，逐字）：`这是一次性文件，导入 Anki 后不会自动更新；数据仍以 vault 里的 markdown 为准。`

## P3 细则（考研三阶段 + 一次性阶段验收）

### ① `phase` 字段

- 位置：`Workspace` 增 `phase?: ExamPhase`，`type ExamPhase = '基础' | '强化' | '冲刺'`（`src/shared/workspace.ts`，`targetDate` 旁）；`records/workspace.ts` 的 parse（`:32`）/ serialize（`:58`，止于 `:86`）各补一处，坏值丢弃（不在三值内 → 当作未设置），非 exam 项目不接受（写入端限制 `kind === 'exam'`）。
- 设置入口：项目卡内联选择（三选一，可留空）；butler `update_workspace` 工具增 `phase` 参数（schema 增补，仅 exam 项目接受）。
- 展示：项目卡显示阶段标签（有则显示）。

### ② 一次性阶段验收问句

- 触发：`phase` 被设置为某个值**之后**的第一次周复盘（weekly 检查）——问句拼在复盘消息末尾，确定性文案（不交模型改写，同 `freshStartCheckInLine` 机制）。
- 文案（逐字，按阶段）：
  - 基础 → `基础阶段收尾时可以这样验收：不翻书，能用 2-3 句话概括每章的核心主题吗？要不要现在就试一章？`
  - 强化 → `强化阶段收尾时可以这样验收：用一套近年真题限时练一遍吗？我帮你记各题型的用时和正确率，结果都在本周复盘里。`
  - 冲刺 → `冲刺阶段收尾时可以这样验收：对照错题记录，检查所有错题对应的知识点都掌握了吗？要打开错题本一起过一遍吗？`
- 一次性：记 `phaseAskedAt`（`Workspace` 字段，ISO 本地日期；写入时机 = 问句真正发出时）。已有 `phaseAskedAt` 则不再问——**切换阶段重置**：`phase` 变更时清空 `phaseAskedAt`（新阶段问新问题）。
- **不做自动进度判定**（不判落后/超前，不出「你落后 1 周」；3a 的 ±1 周规则由阿咲在对话里依据已有完成率数据说，不进硬逻辑）。
- 无 `phase` 的 exam 项目与所有非 exam 项目：晨间/周复盘消息与 1.3.0 **逐字节一致**。

## 非目标

**报告拒收的 7 项（逐条）**

1. **AI 自动错因归类 / 自动判错因**：AI 贴的错误标签不可核验，且 Bisra（g=.55）实证概念级自我解释优于元认知归因，模型更容易产出「粗心了」式元认知标签；错因必须是学习者自己的话。阿咲可在对话里帮想措辞，不做自动归类。
2. **把回访阶梯改成保留率旋钮 / 接入 FSRS**：已上线阶梯是刻意设计（`src/shared/revisit.ts:1-6` 注释原文「no scoring, no tuning and no model」，阶梯 `:9`）；Cepeda 2008 的比例递减发现与现有 3→7→14→30 形状一致，无证据要求改造。留观不做。
3. **自动过期 / 自动删除任何 vault 数据**：归档只做显式触发的可逆移动；「怕丢」是囤积的根因（数字囤积 fsQCA 2026），自动删除直接激活它。
4. **全库笔记自动重组 / 批量搬家**：ASAKI 的维护面只到自己写的 tasks/practice/memory 文件，vault 里用户笔记一个不碰（备份轮「只动自动备份目录里名字匹配的文件夹」同一原则）。
5. **错题排行榜 / 分享卡 / 打卡道具**：第五轮反功能复核已拒，本轮无新证据。
6. **云同步 / 多设备实时同步**：产品不变量；移动端需求由 P2 的 Anki 兼容导出（非云路径）承接。
7. **预测「按当前节奏你将考 X 分」**：第五轮已拒；Anki Simulator 类曲线同样不做。

**本轮另明确**

- 不做自动阶段进度判定（见 P3 ②）。
- 不改已上线的回访阶梯、整卷模拟、用时统计口径（只新增 P1 的周聚合口径）。
- 不做错因的模型润色（用户写什么存什么）。
- 导出只做 Anki TSV；CSV / apkg / AnkiConnect 直连不接。
- 任务日文件的月度归档不做（报告 G6 提到但未列入主人裁定的四批，留后续）。

## 验收（逐条可测）

**P0**
1. 错题补一句错因后，mistakes.md 落 `cause` 字段；错题本行与复习单 section 各显示 `错因：…` 一行。
2. 无错因的错题：错题本与复习单渲染与 1.3.0 **逐字节一致**（负例：字段缺省、空串、纯空白三种输入都不产生错因行、字段不落盘）。
3. 输入 45 字错因 → 落盘截断为 40 字（按码点计），无省略号；输入 40 字整 → 原样。
4. 顽疾三态**用真实提交序列构造**（不捏造 fixture）：同一题 错→错 → `wrongCount=2, correctStreak=0`，标记出现；再 对 → `2/1`，仍出现；再 对 → `2/2`，消失；再 错 → 标记复现且 `wrongCount=3, correctStreak=0`。另：`wrongCount=1` 任何时候不出现（四态序列断言）。
5. 洗白不改数据：上述序列每一步的落盘值等于 `practice-service.ts:219`（wrongCount 累加）`:232-233`（答错）`:253-254`（答对）既有逻辑的产出（回归断言），仅渲染条件变化；priority 的升降与标记无因果关系（构造 `priority=3, wrongCount=1` 与 `priority=0, wrongCount=2` 两种状态，标记只由后两者决定）。
6. 复习单聚合行：错题来自 2 个科目 → 顶部出现 `数学 8 · 英语 3`；单一科目或 `未分类` 占全部 → 无聚合行（负例）。
7. 聚合计数 = 本次复习单导出的条目数（与 `buildMistakeSheet` 收到的 mistakes 数组长度相等；`dueOnly` 只属于既有 `exportMistakeSheet`（`practice-service.ts:863`），**新增的 Anki TSV 导出不做 dueOnly 过滤，导出全部 active 错题**——两项导出互不共用过滤参数）。
8. 「清空已掌握」：resolved 错题从 mistakes.md 移出、出现在 mistakes-archive.md（字段不丢 + `archivedAt` 有值）；mistakes.md 只剩 active。
9. 归档幂等：连点两次，archive 无重复 id；archive 文件不存在时创建并带 frontmatter 头。
10. 从归档恢复：记录回到 mistakes.md 且 `status` 仍为 `resolved`；archive 里对应条目移除。
11. 归档与导出文件均在 `workspaces/<id>/practice/` 下、明文可读（临时 vault 探针手读确认）。

**P1**
12. 一周有 3 件本周 due（2 done）+ 5 件无日期积压 → 任务行显示 `2/3`，并出现 `另有积压 5 件（不计入完成率）`；与 `recent7DayCompletion` 对同一 fixture 的 planned/done 一致（同规则断言）。
13. 无积压时：无「另有积压」行，其余与改动前逐字节一致。
14. 周正确率去重：同题同日答 3 次（错、错、对）→ 计 1 题、按首次（错）计；不同日各一次 → 各计一次。
15. 小样本三处一致（`accuracy` 字段保持原值不变，只看新标记 `accuracyReliable`）：`answered=3` → `WeeklyOverview` 的「答题正确率」值显示 `3 题（样本不足）`（逐字）、`weeklyRecapLine` 不含「正确率」段、flags 行为 `- 练习：本周目前 3 题（样本不足暂不计正确率）`。另两条负例：`answered=5` → 三处与 1.3.0 逐字节一致（显示百分比）；`answered=0` → 三处与 1.3.0 逐字节一致（`WeeklyOverview` 显示「—」、recap 无正确率段、flags 为 `本周还没有做题`）。
16. 口径变更说明只出现一次且跨重启有效：首次周复盘带「（从本周起，积压任务不计入完成率分母）」，第二次起不带；`weeklyScopeNoted` 落 AppSettings（state.json）而非 localStorage——重启后仍不再出现（断言 state.json 该键为 true、localStorage 无相关键）。未写时旧设置文件逐字节往返不变。
17. 口径改动不动数据：同一 fixture 改造前后 tasks/attempts 的落盘文件逐字节相同（只改展示）。

**P2**
18. 导出练习集 → 生成 `practice/exports/<setId>-YYYY-MM-DD.tsv`；首行为 `#separator:tab`，其后 `#html:true`、`#columns:…`、`#tags column:4`、`#deck:<科目>`（顺序断言）。
19. 文件为 UTF-8 **无 BOM**（读首字节断言 `23 20 73` 即 `# s`）；单元格内换行导出为 `<br>`；单元格内 Tab 被替换（构造含 Tab 的解析，断言列数恒为 4）。
20. 调度字段零泄漏：对导出文件 grep `wrongCount|correctStreak|priority|intervalDays|stabilityDays|difficulty|due` 零命中。
21. 错题导出带 `错因` / `顽疾` / `科目:` 标签；`cause` 存在时第 3 列含 `错因：…` 行；洗白态（`correctStreak>=2`）不带 `顽疾` 标签（用验收 4 的真实序列构造）。
22. 同日重复导出覆盖同一路径（文件 mtime 变、目录内仍只有一个文件）。
23. 未导出时一切照旧（逐字节回归：无导出操作不产生 exports 目录或文件）。

**P3**
24. `phase` 三值往返：设置 → workspace.md frontmatter 落值 → 重读一致；坏值（如「预习」）读取丢弃、当作未设置；非 exam 项目写入被拒（工具与内联两入口各一负例）。
25. 设置 phase 后第一次周复盘消息末尾出现对应阶段问句（三阶段各一例，逐字比对）；第二次周复盘不再出现（`phaseAskedAt` 已写）。
26. 切换阶段（基础→强化）后 `phaseAskedAt` 清空，下一次周复盘问强化阶段的问句。
27. 无 phase 的 exam 项目、所有非 exam 项目：晨间与周复盘消息与 1.3.0 逐字节一致（负例）。
28. `phase` 字段在设置页/项目卡之外不产生任何「进度落后」类判定文案（grep 断言：无自动判定代码路径）。

## 测试点（落点建议）

| 批次 | 文件 | 桩 |
|---|---|---|
| P0 | `tests/main/practice-service.test.ts`（错因/归档）、`tests/shared/practice-sheet.test.ts`（聚合行、顽疾、错因渲染）、`tests/renderer/practice-ui.test.tsx`（错题本行、清空按钮） | 临时 vault、假时钟 |
| P1 | `tests/shared/weekly-stats.test.ts`、`tests/main/check-in-prompt.test.ts`（stats 行与 recap 行） | 假时钟、fixture 任务/attempts |
| P2 | `tests/main/practice-export.test.ts`（新建）、`tests/renderer/practice-ui.test.tsx`（导出按钮回显） | 临时 vault、grep 断言 |
| P3 | `tests/shared/workspace.test.ts`（phase 往返）、`tests/main/check-in-prompt.test.ts`（阶段问句）、`tests/main/butler-tools.test.ts`（update_workspace phase 参数） | 假时钟 |

## 依赖与冲突

- **P2 与 P0 都改 `practice.ts` 与 `practice-service.ts`**：P0 加 `cause` 字段与归档动作，P2 加导出动作——两者在 `practice-service.ts` 末尾各新增方法、在 `practice.ts` 的 `PracticeMistake`/输入类型各加字段，冲突面小但**派单时必须声明先后或先互探 merge-tree**。
- P1 落 `weekly-stats.ts` 与 `check-ins/prompt.ts`；P3 落 `workspace.ts`/`records/workspace.ts`/`check-ins/prompt.ts`（与 P1 同文件 `prompt.ts`，但 P1 改 stats 行、P3 加尾部问句，顺序实施无冲突）——P1 与 P3 若并行需声明 `prompt.ts` 先后。
- 与 Agent Runtime 实施并行：Runtime 只触 `src/main/runtime/` 与 `ipc.ts`（本 spec 的 P2 导出若走 IPC 会碰 `ipc.ts`——**建议导出经现有 practice IPC 命名空间加一个通道**，派单时与 Runtime 错峰）。
- 行号基线 `4574847`（报告核于 `ebfd0fd`，`git diff ebfd0fd 4574847` 对全部锚点文件为零——本次实测确认，**含文件存在性检查**）。

## 给 builder 的默认决定（评审可推翻）

1. 错因超长截断到 40 码点、不加省略号（错题本是用户自己的话）。
2. 顽疾洗白只改渲染条件、不改数据（`wrongCount>=2 && correctStreak<2`），零迁移；priority 不参与标记判据。
3. 归档 `archivedAt` 用本地日期 `YYYY-MM-DD`（与 `due`/`reviewedAt` 一致的日期形态）。
4. 聚合行格式用 `·` 分隔、科目顺序按计数降序、同数按科目名排序（确定性）。
5. TSV 的 `<br>` 只替换 `\n` 与 `\r\n`，不替换裸 `\r`（后者极少见，直接剔除）。
6. 周正确率去重实现为 Map 以 `questionId + '|' + localDate` 为键、保留首次（不排序依赖输入顺序）。
7. `phaseAskedAt` 只在问句**真正发出**（消息已投递）时写，不在设置 phase 时写——避免设置了却没看到问句就永久跳过。
8. P3 阶段问句文案改动需评审逐字过目（涉及产品语气，且与 iter32 P0/iter33 P0 的不羞辱口径同源）。

## 风险

- **错因行成为自我批评入口**：placeholder 必须写概念级示例（「导数链没拆完」而非「太粗心」）；顽疾标记用中性名词（题的属性）。评审请把这两处措辞。
- **P1 口径变化让老用户发现数字变了**：一次性说明句（`weeklyScopeNoted`，state.json）只为周复盘出现；若用户从不打开周复盘则永不见——可接受（口径变好，无损失方）。
- **P0 与 P2 同文件冲突**：已列依赖节，派单必须声明。
- **导出文件被误当同步**：UI 说明句已逐字给定；导出不写任何「已备份/已同步」文案。
- **阶段成为新打卡压力**：只在切换后问一次、无自动判定；若评审认为问句仍有压力，改文案即可，不改机制。
- **归档路径与既有 mistakes.md 序列化耦合**：复用 `serializeMistakesFile` 结构意味着 archive 与 mistakes 同 schema；将来 schema 变更需两处兼容——记入 builder 默认决定 3 的注释要求。

## 已定（不再翻转的裁决）

1. 2026-11-28 主人裁定：P0、P1、P2、P3 全做（item 72 派单）。
2. AI 打分禁令继续有效——P0 错因是用户自填一行，非模型归类（报告拒收 1）。
3. vault 明文直读不破：`mistakes-archive.md` 与 `practice/exports/*.tsv` 都是 vault 里的明文文件，不是隐藏区、不是数据库。
4. 批次顺序 P0 → P1 → P3，P2 可与 P0 并行但须声明文件相交；P3 依赖已上线三块能力。
5. 报告引用链：`xiaolai/iter34-research` @ `ae209b9`，报告 cherry-pick 至本分支保持引用可解析。
6. 团队边界：本分支不推 origin；合入由 sc-release 收口。
7. 2026-11-28 sc-review 首轮评审折叠：①**阻断 1**——原「`priority===3 && correctStreak>=2` 洗白」恒不可达（两字段在 `practice-service.ts:231/:253` 同步反向），改判据为 `wrongCount>=2 && correctStreak<2`，验收 4 改真实提交序列；②**阻断 2**——不改共享 `accuracy` 字段，新增 `accuracyReliable` 展示标记，三处消费方文案锁死，含 `answered===0` 负例；③非阻断 1——一次性说明句改存 `AppSettings.weeklyScopeNoted`（main 进程读不到 renderer localStorage，iter32 先例不适用；与「提醒不进共享设置」原则局部相左，理由：文案在 main 拼）；④非阻断 2——Anki TSV 导出不做 dueOnly 过滤（与既有复习单导出是两条路径）；⑤非阻断 3——`PracticeMistake.archivedAt?: string` 进类型；⑥非阻断 4——`#deck:` 科目名清洗；强化阶段问句补「结果都在本周复盘里」。
