# 学习科学研究与项目调研：让 ASAKI 更符合真实学习机制

日期：2026-11-21
范围：学习科学/教育心理学论文 + 开源学习项目 + 当前实现对照
结论先行：ASAKI 的练习/错题/复习机制与学界证据有两处硬伤——(1) 复习间隔固定为 1/3/7 天、答对不推迟下次复习，等于"集中重复"而非"间隔复习"；(2) 只有选择题，缺少检索练习中最有效的"自由回忆/自述"形态。另有三个高价值但尚未落地的机制：答题把握度（元认知校准）、实施意图（if-then 计划）、掌握判定。

## 1. 论文证据

### 1.1 哪些学习法真的有效（Dunlosky et al., 2013）
*Improving Students' Learning With Effective Learning Techniques*, Psychological Science in the Public Interest, 14(1), 4–58（[PDF](https://irp.cdn-website.com/7e7a7568/files/uploaded/improving_student_learning_dunlosky_2013.pdf)，[PubMed](https://pubmed.ncbi.nlm.nih.gov/26173288/)）。
评了 10 种技巧：**高效用只有两种——练习测验（retrieval practice）与分散练习（spaced practice）**；中等效用包括自我解释（self-explanation）、精细追问、交错练习；低效用是重读、划线、总结等学生最常用的方法。
对 ASAKI 的含义：产品的核心价值必须压在这两条上——"多做检索、并把复习分散到日子里"，而不是提供更多"看"的功能。

### 1.2 间隔复习算法（FSRS / SM-2）
FSRS（Free Spaced Repetition Scheduler，[open-spaced-repetition](https://github.com/open-spaced-repetition/free-spaced-repetition-scheduler)）用 DSR 模型（Difficulty 难度 / Stability 稳定度 / Retrievability 可提取性）预测召回概率，是 Anki 自 2024 起的原生算法；官方基准 srs-benchmark 比较各算法预测召回与实际召回的拟合度（[FSRS vs SM-2](https://spacedrepetition.info/algorithms/fsrs-vs-sm-2)）。TS 实现 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs)（MIT）已被大量产品复用。
对 ASAKI 的含义：不必引入依赖，但需要把"间隔随复习成功增长、失败则重置"这一 DSR 核心行为实现对；固定 1/3/7 天不满足。

### 1.3 目标设定与实施意图
Gollwitzer & Sheeran (2006) 元分析（94 项研究）：**"如果 X，就 Y"的实施意图对目标达成有中到大效应（d ≈ .65）**（[DOI](https://doi.org/10.1016/S0065-2601%2806%2938002-1)，[PDF](https://www.decisionskills.com/uploads/5/1/6/0/5160560/2006_gollwitzersheeran_implementation_intentions.pdf)）；2024 年 642 项测试的新元分析显示 if-then 格式、具体线索、预演会放大效果（[链接](https://www.tandfonline.com/doi/abs/10.1080/10463283.2024.2334563)）。Locke & Latham 的目标设定理论：具体且有挑战的目标优于"尽力而为"。
对 ASAKI 的含义：任务与提醒应支持"何时何地触发"（cue），而不只是截止时间；"目标日期"只是目标设定的一半。

### 1.4 苏格拉底式提问与自述（AI 辅导）
OECD《Digital Education Outlook 2026》总结了对话式 AI 导师的苏格拉底路径（先提问、按水平给台阶），并指出随上下文增长的 5–10 秒延迟是体验痛点；RemNote 的辅导循环（讲 → 测 → 让用户复述 → 纠错）是用户口碑最高的形态（[Reddit](https://www.reddit.com/r/remNote/comments/1xq3seh/the_tutoring_session_update_is_genuinely_insane/)）。中文教育研究同样强调"只会回答的系统未必是好老师"（[aitutors.me](https://aitutors.me/zh/blog/lba/learn-by-asking-and-the-socratic-method)）。
对 ASAKI 的含义：与第六轮"阿咲当老师"方向一致——出题、复述检验、按缺口追问，比继续堆答疑更重要。

## 2. 开源项目对照

| 项目 | 可借鉴点 |
| --- | --- |
| [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) | 终身个性化辅导：直接读写 Obsidian vault、按页引用、多检索后端 |
| [zijinz456/OpenTutor](https://github.com/zijinz456/OpenTutor) | 本地优先、上传材料 → 笔记/闪卡/测验/自适应导师；明确以 FSRS 4.5 + 知识图谱 + 认知负荷为"科学性"卖点 |
| [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) / [fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) | DSR 调度的参考实现与参数优化 |
| Obsidian [Spaced Repetition](https://community.obsidian.md/plugins/obsidian-spaced-repetition)、[FSRS 插件](https://community.obsidian.md/plugins/fsrs) | vault 内复习的交互惯例：卡片到期队列、评分（Again/Hard/Good/Easy） |
| [stealwhatworks 129 个 AI 教育 App 横评](https://stealwhatworks.com/blogs/news/ai-education-app-features) | 88/129 有 AI 答疑，但带完整本地复习引擎的极少——ASAKI 的差异化在"引擎"而非"聊天" |

## 3. 与当前实现的对照

| 机制 | 现状 | 证据要求 | 差距 |
| --- | --- | --- | --- |
| 间隔复习 | `PRACTICE_INTERVALS = [1,3,7]`，答错才换间隔，**答对只加 correctStreak，`due` 不变**（`src/main/practice/practice-service.ts:129-167`） | 间隔随成功增长、失败重置（DSR/SM-2） | 固定间隔 + 答对不推迟 = 集中重复；`due` 不变会让同一错题当天反复到期 |
| 检索形态 | 仅选择题（`PracticeQuestion.options/answer`） | 自由回忆/自述效果最好（Dunlosky 高/中等效用） | 无短答/复述题；选择题可被再认（recognition）取巧 |
| 掌握判定 | 连续答对 2 次即 resolved | 应在间隔拉长后仍能回忆（spacing 后的检索） | 同日连对两次即可"掌握"，证据不足 |
| 元认知 | 无 | 把握度校准能揭示"错觉性掌握" | 无把握度、无过度自信统计 |
| 计划触发 | 截止日期 + 时间块 | if-then 实施意图 d≈.65 | 无"何时何地/在什么之后"的触发线索 |
| 复盘数据 | 本周完成/专注/正确率 | 分散与检索统计应成为主指标 | 无"本周检索次数/间隔复习完成率"视角 |

## 4. 建议的迭代顺序（按证据强度 × 改动成本）

**P0 — 复习调度改为证据驱动（改动集中在 practice-service + 共享类型）**
- 错题记录增加 `stabilityDays`（稳定度）与 `difficulty`（0–1 难度）两个可选字段；旧记录缺省按 `intervalDays` 迁移，不重写文件。
- 答错：`stability` 重置为 1 天，`due = 今天 + 1`，难度 +。
- 答对：`stability` 按难度增长（下一个间隔 ≈ stability × 易度系数，向上取整，封顶 365），**`due` 必须前移**；连续答对且最近一次间隔 ≥ 3 天时才算 resolved。
- 测试钉住：间隔单调增长、答错重置、答对前移 due、旧数据迁移、同日两次答对不算掌握。
- 明确不做参数训练（无大数据），文档中如实称"FSRS 思路的最小调度器"。

**P1 — 检索练习：短答题（自述）**
- `PracticeQuestion.kind?: 'choice' | 'short'`；短答题 `answer` 存参考答案，用户输入后由模型按参考答案评分（可离线降级为自评"答对了/没答对"），attempt 记录原始回答。
- 错题本对短答题展示用户原答与参考答案的差异——这是"自我解释"证据的落点。

**P2 — 元认知校准**
- 答题前一个轻量把握度（有把握/不确定），存进 attempt；复盘页给出"把握度 vs 正确率"的校准提示（过度自信时提示把不确定的题当重点复习）。

**P3 — 实施意图**
- 任务/提醒支持"触发条件"（例如下班回家后、早饭后），在今日页与检查消息里以 if-then 句式出现：`如果 19:00 到家，就先做「数学错题 20 分钟」`。

## 5. 引用清单
- Dunlosky, J., Rawson, K. A., Marsh, E. J., Nathan, M. J., & Willingham, D. T. (2013). *Improving Students' Learning With Effective Learning Techniques*. PSPI 14(1). PMID 26173288.
- Gollwitzer, P. M., & Sheeran, P. (2006). *Implementation Intentions and Goal Achievement: A Meta-analysis*. Advances in Experimental Social Psychology 38.
- Gollwitzer, P. M. et al. (2024). *The when and how of planning: Meta-analysis of 642 tests*. European Review of Social Psychology.
- OECD (2026). *Digital Education Outlook 2026*（对话式导师章节）。
- open-spaced-repetition: FSRS / fsrs4anki / ts-fsrs（MIT）。
- OpenTutor、DeepTutor 仓库与 README（2026）。