# ASAKI iter33：明日第一步桥 / 用时流畅度 / 量规自评 / 中断现场包

> 状态：待 sc-review 评审 ｜ 分支 `xiaolai/iter33-spec` ｜ 基线 master `4752928`（2026-11-27）
> 依据：第六轮调研报告（本分支 `docs/superpowers/reports/2026-11-27-interruption-feedback-import-fluency-research.md`，cherry-pick 自 `xiaolai/iter33-research` @ `21cd12c`）。
> 范围裁定（主人，item 65，2026-11-27）：**P0+P1+P2a+P2b**；照片类（原 P3 照片遮罩卡、P4 页码溯源）本轮**不做**，在「后续」节标注（见非目标与后续）。

## 一句话

把「恢复与质量」做实：昨晚写下的「明天第一步」今早递回去（P0，一行确定性文案）；让「对了但慢」变成可见信号（P1，attempt 加用时，Anki revlog 口径）；给主观题一面自查镜子（P2a，检查点自评，明确不做 AI 打分）；给中断现场留一座桥（P2b，专注会话落盘可恢复 + 任务 `nextStep` 一行锚）。

## 为什么（证据摘引，全文见报告）

- **P0**：数据已在库——晚间复盘收集 tomorrow（`src/main/check-ins/prompt.ts:382`），入库 `ReviewRecord.tomorrow`（`src/main/context.ts:894`），但晨间消息的组成部分没有它（G1）。机制证据四路同向：ready-to-resume plan（Leroy，UW News 四项研究）、Hemingway Bridge「回来第一眼看到」、Ovsiankina 拉力、Altmann & Trafton 2002 联想提取线索。社媒自发对应物：HN 高分讨论「提前写好『回到哪』的人恢复得快」（报告②）。
- **P1**：`PracticeAttempt` 只有 `correct` 布尔（`src/shared/practice.ts:62-74`，G4）——「快且对」与「对了但慢」被抹平。Anki revlog 口径：用时一等数据、60 秒封顶、计时器默认不显示、「每日只计第一次」（报告 1g/3d）；「慢=未自动化」有 fact-fluency 元分析 g=0.76 支撑（报告 4c）。与 iter32 P2a（卷级限时，已合 `6dd3253`）不重叠：那是卷级体验，这是条目级遥测。
- **P2a**：short 题判分只有 `selfCorrect` 布尔（定义 `src/shared/practice.ts:148-156`，attempt 侧 `:225`；判分链 `src/main/practice/practice-service.ts:585-586、690-691`，G5）。量规透传 g=0.45＋过程反馈 d=0.48＋句子合并 0.50（报告 4b）；AI 打分被用户侧证据否决（r/GRE 两个批改器打架、r/WriteStreakEN「每句都改改没信心」，报告④⑥）——**本轮明确不做 AI 打分**。
- **P2b**：`FocusSession` 纯内存（`src/renderer/shell/Workspace.tsx:325`；类型 `src/renderer/shell/focus-timer.ts:7`），重启即失（G2）；任务无「下一步」锚（`WorkspaceTask` 现字段见 `src/shared/workspace.ts:118-127`，md 记录读写 `src/main/workspace/records/tasks.ts`，G3）。中断恢复文献：平均 11 分钟被打断一次（Mark 2005）、27% 挂起超 2 小时且长延迟归因「丢上下文」（Iqbal & Horvitz 2007）、写恢复计划的人表现更好（报告 4a）。

## 批次（P0 → P1 → P2a → P2b，顺序即依赖）

### P0 明日第一步桥

晨间检查消息追加一行**确定性文案**（复用 `freshStartCheckInLine` 同款机制：`src/main/check-ins/prompt.ts:103-106`，确定性、拼在成稿之后、从不交给模型改写；数据经 provider 注入，同 iter32 G7 的 resumeCheckInLine 先例）：

- 取数：今天之前**最近一条**含非空 `tomorrow` 的复盘记录（不硬限自然日昨天——复盘缺勤时仍有效，措辞不撒谎）。
- 行 A（常规）：`你在复盘里写下明天第一步：{tomorrow}——今天第一件事就是它吗？`（`tomorrow` 超 60 码点时截断嵌入：前 57 码点 + 「…」，确定性规则，不聪明截断）。
- 行 B（ staleness 变体）：最近 **3 条**复盘（含最新一条）的 `tomorrow` 归一化后完全相同 → `这步写了好几天了——要不要把它切小一点，或者干脆换一步？`（阈值 3 为 spec 填充默认；措辞走 iter32 P0 的不羞辱口径：给台阶，不评价）。
- 无数据 → 空串，晨间消息与现状**逐字节一致**（`tomorrow` 缺失、坏值容错读照旧）。

### P1 练习用时记录 + 流畅度分级

- `PracticeAttempt` 增 `durationMs?: number`（`src/shared/practice.ts:62-74`；缺省不序列化，旧文件/旧调用方零迁移）。注意区分：LearningPane 里已有的 `durationMs`（`:92`）是 iter32 P2a 的**整卷预算**，与本字段无关——builder 不要混用。
- 采集：LearningPane 从题目呈现到提交计时，客户端 60 秒封顶（Anki `cap_answer_time_to_secs: 60` 口径）；服务端归一化兜底：>60000 → 60000，非正数/非整数/NaN → 字段省略。
- 去重口径：**流畅度统计**中每道题每天只计第一次作答（Anki True Retention「Only one review per day - the first one - counts.」）；原始 attempt 仍全量落盘，不丢数据。
- 分级：`correct && durationMs < 10000` → **自动召回**；`correct && durationMs ≥ 10000` → 「对了但慢」；阈值 `AUTO_RECALL_MS = 10000` 为 spec 填充默认（常量，可调，不进设置页）。
- 呈现：统计区加每套题「中位用时」趋势与自动召回占比（放在现有正确率趋势旁，`src/renderer/shell/AccuracyTrend.tsx` 同层）；**用趋势不用及格线**（报告反功能复核）。**不新增答题中计时器**——数据照记、压迫不给（Anki `show_timer: false` 口径；iter32 P2a 整卷模式的卷级计时是另一件事，不动）。

### P2a 主观题量规自评

- `PracticeQuestion` 增 `checkpoints?: string[]`（short 题专用，2–3 条，frontmatter 列表，明文；读取容错：空串丢弃，超 3 条保留前 3）。写入路径保证 2–3 条：少于 2 条时检查点视为不存在（整字段省略）。
- `PracticeAttempt` 增 `checkpointHits?: boolean[]`（仅 short 且题目有 checkpoints 时写；长度与题目 checkpoints 对齐才参与统计；不对齐时按索引截断对齐，缺失视为未勾）。
- 生成：**只走建模集路径**——butler `create_practice_set` 对 short 题从 `referenceAnswer` 拆 2–3 条句子级检查点（提示词增补：仅当 `kind === 'short'` 且有 `referenceAnswer` 时出现新指令，其余建集提示词逐字节不变）；建模集整套沿用现有 `source: 'model'` + `reviewedAt` 待核对机制（`src/shared/practice.ts:48-57`），检查点随集走，**不新增按题待核对标记**。手工建集：用户自填（可空）。
- 作答流（LearningPane short 题，**仅当该题带检查点时**出现自勾步骤；无检查点的 short 题作答流与基线完全一致，仍是两步）：写答案 → 逐条自勾「答到了吗」（此时**不展示** `referenceAnswer`）→ 对答案（`referenceAnswer` + `selfCorrect` 照旧，`practice-service.ts:585-586` 判分链路零改动）→ **高亮漏掉的检查点**，不给分。
- **明确不做 AI 打分**（拒收 1，主人已裁）：检查点是镜子不是判官。

### P2b 中断现场包

**① FocusSession 落盘可恢复**

- 持久化走 `JsonStateStore`（`src/main/state-store.ts:33`，state.json 明文、写队列），**不写 vault**：专注计时是机器瞬态，不是用户事实——与报告 G2 建议的「workspace 明文文件」不同处在此，理由：vault 面向用户可读事实，state.json 已是既有的机器状态明文层，且有队列与原子写。
- 快照：`{ workspaceId, session: FocusSession（`focus-timer.ts:7-16` 全字段）, savedAtLocalDate }`，key `focusSession`，单槽（一窗一活跃会话）。
- 写时机：start / pause / resume / 结算四个状态迁移点 + 退出前（`before-quit`）；**不逐秒写**（1s tick 不落盘）。
- 恢复规则（全部确定性）：本地日期与今天相同且 `remainingMs > 0` → 恢复提示「上次专注还剩 {X} 分钟，继续？」，**一律以暂停态恢复**（即使快照存的是 running）——用户点继续才走现有 `resumeFocusSession`（`focus-timer.ts:65`）；跨天 → 直接丢弃快照（报告反功能复核：换了任务时的打扰要避免）。工作区不匹配 → 丢弃。

**② 任务 `nextStep` 一行锚**

- 字段落两处：类型 `WorkspaceTask` 增 `nextStep?: string`（`src/shared/workspace.ts:118`）；任务 md 记录读写同步——`src/main/workspace/records/tasks.ts` 的 `TaskRecord`/`parseTaskFile`（`:81`）/`serializeTaskFile`（`:89`）/`toWorkspaceTask`（`:110`）映射补字段。**不要新建 `src/shared/tasks.ts`**（该文件不存在）。单行，≤80 字符，写入时 trim，空串视为未设置不序列化；旧任务零迁移。
- 三个显式写入口：任务卡内联编辑；butler `update_task` 工具增 `nextStep` 参数（schema 增补，其余不变）；专注停止/放弃流——会话绑定了任务时，提供一行「下一步」输入（可跳过）。
- 展示：任务卡与任务列表有则显示；**晨间行优先级规则（本批起生效）**：今天首个未完成任务带 `nextStep` → 晨间恢复行改用 `{taskTitle} 的下一步已经记好：{nextStep}——从它开始？`（「首个未完成」按今日任务列表既有排序取第一个）；否则回落 P0 的复盘 `tomorrow` 行（含 staleness 变体）；都无 → 空串。**晨间恢复行永远最多一行**，不叠加。
- 晚间复盘**不**自动写任务 nextStep（复盘的 `tomorrow` 由 P0 递回，两者职责分开：复盘级 vs 任务级）。

## 非目标（主人已裁 + 报告拒收 7 项）

- **照片遮罩卡（原 P3）与页码溯源（原 P4）：本轮不做**（主人 2026-11-27，item 65）→ 见「后续」。
- AI 自动作文评分（本地或云 AES）：开源侧无产品级实现（最高 207★ 研究代码），云 AES 破坏无账号前提，用户侧不买账（报告④⑥）——需求解给 P2a 量规自评。
- 整本教材本地 OCR→markdown（捆绑 marker/MinerU）：0.8–3GB 模型、常驻 server、许可门槛；留门「显式授权可选插件 + basic 档」。
- 划词批注式全文阅读器（Obsidian 官方明确不做的 PDF annotations）；批注入数据库（Zotero 模式，与明文直读冲突）。
- 桌面活动监控式「中断检测」（监听窗口切换/空闲推断分心）：与信任立场冲突。
- 强制倒计时答题：数据照记、压迫不给（Anki 口径）；「用时影响调度」不做（`The time taken does not influence scheduling.`）。
- quick capture 升级 GTD 收件箱（多桶）；「存为草稿笔记」最小改进列为后续候选，本轮不做。

## 后续（本轮不做，标注按主人裁定）

- **照片遮罩卡**（报告 P3/G6 部分）：剪贴板照片 → 遮罩编辑器（Hide All / Hide One 照抄 Anki）→ 每遮罩一卡，遮罩坐标存练习集 frontmatter 内联 JSON（明文）。前置：P1/P2 练习底盘稳定。
- **页码溯源**（报告 P4/G7）：练习集/题目加可选溯源深链（`[[file.pdf#page=N]]` 格式，Obsidian 惯例），答错时一键跳原文。**字段命名注意**：不能叫 `source`——`PracticeSet.source`（`'user'|'model'`，`practice.ts:55`）已存在，届时用 `sourceRef` 之类（预防性备注）。前置：导入/遮罩生态存在才有消费者。现状锚点：导入过滤仅视频（`src/main/index.ts:338` `VIDEO_EXTENSIONS`）、`PracticeSet` 无溯源字段（`practice.ts:48-61`）。

## 数据与契约小结

| 字段 | 位置 | 缺省行为 | 容错 |
|---|---|---|---|
| `PracticeAttempt.durationMs?: number` | attempt 明文 | 缺省不序列化 | 服务端归一：>60000→60000；非正/非整→省略 |
| `PracticeQuestion.checkpoints?: string[]` | 题目 frontmatter | 缺省不序列化 | 空串丢、超 3 截前 3、<2 视为无 |
| `PracticeAttempt.checkpointHits?: boolean[]` | attempt 明文 | 缺省不序列化 | 按索引截断对齐，缺失=未勾 |
| `Task.nextStep?: string` | `WorkspaceTask`（`workspace.ts:118`）+ 任务 md 记录（`records/tasks.ts`） | 缺省不序列化 | trim；空串=未设置；>80 截断 |
| state.json `focusSession` | JsonStateStore | 无键=无恢复 | 坏 JSON/跨天/换工作区=丢弃 |

## 验收（逐条可测）

**P0**
1. 昨天复盘含非空 tomorrow → 今晨消息恰含一行行 A 文案（`tomorrow` 原文嵌入，超 60 码点按截断规则嵌入：57 码点 + 「…」）；消息其余部分与不含该行时逐字节一致。
2. 最近一条含 tomorrow 的复盘是 3 天前 → 行 A 措辞不出现「昨天」（用「你在复盘里写下…」），不撒谎。
3. 最近 3 条复盘 tomorrow 归一化相同 → 出行 B（切小/换一步措辞），不出行 A；第 2 条相同第 3 条不同 → 出行 A。
4. 无任何含 tomorrow 的复盘（或 tomorrow 为空串/纯空白）→ 无恢复行，晨间消息与改动前基线**逐字节相同**（负例：空串、纯空白、坏类型各一）。
5. staleness 阈值只数「含非空 tomorrow」的复盘；中间夹的空 tomorrow 复盘不断开连续计数也不计入阈值（确定性规则，测试两例）。

**P1**
6. 正常作答 8 秒提交 → attempt 落盘 `durationMs=8000`；70 秒后提交 → 落盘 60000（客户端封顶）；服务端注入 90000 → 归一 60000；注入 0/-5/1.5/NaN → 字段省略、不报错。
7. 无 `durationMs` 的旧 attempt 读取与统计不报错（旧文件负例）。
8. 流畅度统计：同题同日两次作答（第一次 8s 对、第二次 4s 对）→ 统计只计第一次；原始两条 attempt 都在。
9. `correct && durationMs<10000` 计自动召回；`correct && durationMs≥10000` 计「对了但慢」；`!correct` 两档都不计。
10. 统计区出现每套中位用时趋势与自动召回占比；答题界面无新增计时显示（截图/DOM 断言）；iter32 P2a 整卷模式行为不变（回归）。
11. iter32 P2a 的卷级 `durationMs`（LearningPane `:92`）与本字段无耦合：整卷模式下每题 attempt 仍按本规范记 `durationMs`。

**P2a**
12. butler 建 short 题建模集 → 每题 2–3 条检查点生成、随集走 `source:'model'`+`reviewedAt` 待核对；choice 题与无 referenceAnswer 的 short 题**零检查点**且提示词其余部分逐字节不变。
13. 手工建集可自填 0–3 条；填 1 条 → 字段省略（<2 视为无）。
14. 作答流顺序可测（带检查点的 short 题）：先写答案 → 检查点自勾界面**不显示** `referenceAnswer` → 对答案后才显示并高亮漏勾项。**负例：无 checkpoints 的 short 题作答流与基线两步一致**（不出现自勾步骤，UI 步骤数与文案逐字节不变）。
15. `checkpointHits` 与 checkpoints 等长才入统计；不等长按索引截断、缺失记未勾（构造 3 条 checkpoints / 2 条 hits 负例）。
16. `selfCorrect` 判分与统计链路零改动（`practice-service.ts:585-586、690-691` 回归）；无 AI 打分调用（grep 断言：P2a 代码路径无新增模型调用）。
17. 明文可读：检查点与命中记录落盘后手读 md/frontmatter 可见（临时 vault 探针）。

**P2b**
18. 专注进行中退出应用 → 重启同工作区同日 → 提示「上次专注还剩 {X} 分钟，继续？」，快照值即退出前值；点继续 → 走现有 resume 路径照常结算。
19. 恢复态一律暂停：running 快照被强杀后恢复仍先暂停（不自动起跑）；跨天快照丢弃（构造 `savedAtLocalDate=昨天` 负例）；换工作区丢弃。
20. 写时机断言：1 秒 tick 不产生 state.json 写入（写队列计数/文件 mtime 探针）；start/pause/resume/结算/退出五个点各写一次。
21. `Task.nextStep`：三个入口（任务卡、`update_task` 工具、专注停止流）各写入一例；>80 字符截断；空串清除字段（键删除，不是存空串）。
22. 晨间行优先级：首个未完成任务带 nextStep → 任务行文案；无 nextStep 但复盘有 tomorrow → P0 行 A/B；两者都无 → 无行（逐字节基线）。永远最多一行。
23. 晚间复盘消息与写路径不含任务 nextStep 自动写（负例：复盘后任务字段不变）。

## 测试点（落点建议）

| 批次 | 文件 | 桩 |
|---|---|---|
| P0 | `tests/main/check-in-prompt.test.ts`、`tests/main/proactive-check-in.test.ts`（均扩展，已存在） | 假时钟、复盘 fixture |
| P1 | `tests/main/practice-service.test.ts`（扩展）、`tests/main/butler-tools.test.ts`、`tests/renderer/practice-ui.test.tsx`（扩展） | 临时 vault、假计时 |
| P2a | `tests/main/butler-tools.test.ts`（create_practice_set prompt 增补）、`tests/renderer/practice-ui.test.tsx`（扩展）、`tests/main/practice-service.test.ts`（checkpointHits 归一） | 临时 vault |
| P2b | `tests/renderer/focus-timer.test.ts`（扩展恢复规则）、`tests/main/state-store.test.ts`（扩展）、`tests/main/butler-tools.test.ts`（update_task nextStep）、`tests/main/check-in-prompt.test.ts`（优先级） | JsonStateStore 临时文件、假时钟 |

## 依赖与冲突

- 批次顺序即依赖：P2b 的晨间行优先级规则叠在 P0 的行之上（同文件 `check-ins/prompt.ts`，顺序实施无冲突）；P1/P2a 同在 LearningPane 但改动面不同（计时采集 vs 自评流），按序做。
- **与 Agent Runtime 实施并行**（`4752928` 已合 P0+P1 批次，3/5 起还在进行）：Runtime 批次触碰 `src/main/ipc.ts`（新通道）与 `src/main/runtime/`；本 spec 只有 P2b 触 `ipc.ts`（focus 快照存取两通道）——派单时与 Runtime 批次错峰或声明 rebase 顺序。`practice-service.ts`、`check-ins/`、`src/shared/workspace.ts`、`records/tasks.ts` Runtime 均未触碰。
- 行号基线 `4752928`；若 Runtime 后续批次合入改动同文件，派单前重核（check-ins/prompt.ts 本轮基线未受 Runtime 影响，实测 `git diff c5b08fe..4752928` 零变更）。

## 给 builder 的默认决定（评审可推翻）

1. staleness 阈值 = 3（最近 3 条含非空 tomorrow 的复盘同文）；AUTO_RECALL_MS = 10000。都是常量，不进设置页。
2. `tomorrow` 归一化 = trim + 全部空白折叠为单空格（全半角不转换——写什么比什么，不聪明）。
3. focus 快照单槽全局（带 workspaceId），不做每工作区多槽——一窗一会话。
4. 恢复提示只在专注所在的工作区视图出现一次，不弹全局 toast。
5. `nextStep` 的 butler 工具描述写明「单行、一句话、可执行的第一步」，引导模型写短句。
6. 中位用时趋势只对**有 ≥3 条有效记录**的套显示（样本不足不画）。
7. P2a 自勾界面标题用「对照检查点自查」；漏勾高亮用中性色（黄/灰），不用红（与 iter32 P0 不羞辱口径一致——漏勾是信息不是错误）。

## 风险

- 晨间恢复行的措辞边界：连续点名同一 tomorrow 可能被读成催促——已用行 B 的给台阶措辞 + 阈值 3 缓解，评审时请措辞把关。
- `durationMs` 与整卷 `durationMs` 同名不同义（builder 误用风险，已在 P1 注明）。
- state.json 并发：专注快照写入走既有写队列，与 appSettings 等键无冲突；但 Runtime 批次也在动 ipc.ts，P2b 派单需错峰（依赖节已写）。
- 报告锚点核于 `c5b08fe`，本 spec 全部按 `4752928` 复核：`context.ts:884→894`、`Workspace.tsx:296→325`（quick capture 路径现为 `promptButler` 定义 `:1319`）、`focus-timer.ts:7` 不变且新增 pause/resume（`:56/:65`）、`index.ts:315-320→:338`；`check-ins/prompt.ts`、`practice.ts`、`practice-service.ts`、`records/tasks.ts`、`memory/synthesize.ts` 实测未漂移（`git diff c5b08fe..4752928` 为零）。**勘误**：报告 G3 的 `src/shared/tasks.ts` 不存在（任务类型实为 `workspace.ts:118` `WorkspaceTask`，读写 `records/tasks.ts`）；首版 spec 曾把「diff 为空」当「未漂移」的证据，对不存在的文件该方法静默失效——已按实际文件重核。

## 已定（不再翻转的裁决）

1. 2026-11-27 主人定范围（item 65）：P0+P1+P2a+P2b；照片类（原 P3/P4）本轮不做、spec 标注后续。
2. P2a 明确不做 AI 打分（拒收 1，主人裁定口径沿用）。
3. 报告引用链：`xiaolai/iter33-research` @ `21cd12c`，报告文件 cherry-pick 至本分支保持引用可解析。
4. 团队边界：本分支不推 origin；合入由 sc-release 收口。
5. 2026-11-27 sc-review 首轮评审两条阻断已折叠：P2b 任务锚点改指实际文件（`workspace.ts:118` `WorkspaceTask` + `records/tasks.ts` 读写链，原 G3 的 `src/shared/tasks.ts` 不存在）；P2a 作答流补「仅带检查点的题出现自勾步骤」条件 + 验收 14 基线负例。非阻断 1–3 一并折叠（行 A 60 码点截断规则、「首个未完成」按既有排序、后续节 `sourceRef` 撞名预防注记）；`selfCorrect` 定义锚顺带修为 `practice.ts:148-156`。
