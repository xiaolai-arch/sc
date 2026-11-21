# 学习科学与教育研究综述 v2：ASAKI 的证据基础

日期：2026-11-21（v2，应主人要求扩深论文调研）
方法：按"学习机制 → 关键文献（效应量）→ 产品落点"整理，只引用可回链的研究；每节末尾给 ASAKI 的具体含义。§8 汇总"反直觉/避免做"的证据。§9–10 与现有代码对照并给出迭代顺序。

---

## 1. 检索练习（testing effect）——最硬的证据

- **Karpicke & Blunt (2011), Science 331:772–775**：检索练习优于"精细学习"（elaborative concept mapping），且在以概念图为最终测验时依然胜出（[PubMed](https://pubmed.ncbi.nlm.nih.gov/21252317/)）。
- **Rowland (2014), Psychol. Bull. 140(6)**：testing effect 元分析，159 项研究，检索练习 vs 重复学习 **g = 0.50**，81% 的比较偏向检索练习（[PubMed](https://pubmed.ncbi.nlm.nih.gov/25150680/)）。
- **2026 年 Educational Psychology Review 元分析**（真实课堂）：再认 g = 0.46、保持 g = 0.57 显著；理解/迁移/流利度不显著——检索练习的红利主要在"记住并能再认"，不是自动带来迁移（[Springer](https://link.springer.com/article/10.1007/s10648-026-10225-5)）。
- **Dunlosky et al. (2013), PSPI 14(1)**：10 种技巧里只有**练习测验**与**分散练习**获评高效用；重读/划线/总结低效用（[PDF](https://irp.cdn-website.com/7e7a7568/files/uploaded/improving_student_learning_dunlosky_2013.pdf)，[PubMed](https://pubmed.ncbi.nlm.nih.gov/26173288/)）。

**ASAKI 含义**：产品的核心循环必须是"做题 → 错题重练"，而不是提供更多阅读/笔记功能；但对"检索练习提升了迁移"不要过度承诺（UI 文案不说"学会举一反三"）。

## 2. 分散练习与最优间隔

- **Cepeda et al. (2006), Psychol. Bull. 132(3):354–380**：839 个评估、317 个实验；**最优的复习间隔随目标保持期变长而变长**（[PubMed](https://pubmed.ncbi.nlm.nih.gov/16719566/)，[PDF](https://wixtedlab.ucsd.edu/publications/wixted/Cepeda_et_al_%282006%29.pdf)）。
- **Cepeda et al. (2008), Psychol. Science 19(11)**：1350+ 人；最优间隔约为保持期的 20–40%（一周内）到 5–10%（一年）（[PDF](https://laplab.ucsd.edu/articles/Cepeda%20et%20al%202008_psychsci.pdf)）；Pashler et al. (2007) 给的经验法则是保持期的 10–20%。
- **间隔算法**：FSRS 基于 DSR 模型（难度/稳定度/可提取性），学术基础是 MaiMemo 的两篇论文——**Ye, Su & Cao (2022), KDD '22**（随机最短路优化复习调度，召回预测较 SOTA 提升 12.6%，[dblp](https://dblp.org/rec/conf/kdd/YeSC22.html)）与 **Su, Ye et al. (2023), IEEE TKDE 35(10)**（[算法页](https://spacedrepetition.info/algorithms/fsrs)）；Anki 23.10 起原生集成，[ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 是 MIT 参考实现。

**ASAKI 含义**：间隔不能固定 [1,3,7]；答对必须把 `due` 往后推（间隔随成功增长、失败重置），这正是 FSRS/SM-2 家族的核心行为。当前实现违反（见 §9）。

## 3. 成功再学习（successive relearning）——把 §1 和 §2 合起来

- **Rawson & Dunlosky (2022), Current Directions in Psych. Science**：练习到"成功回忆"，再在**多个间隔开的会话**里重复到再次成功；Rawson et al. (2018) 数据：三次分散会话各回忆一次，一周后保持 68%；同一会话里回忆三次只有 26%。三次以上再学习会话性价比下降（[Sage](https://journals.sagepub.com/doi/full/10.1177/09637214221100484)）。
- **Bjork 的"合意困难"（desirable difficulties, 1994）**：间隔、交错、变化练习条件、减少/间歇反馈、把测验当学习事件——降低当下流畅度、提升长期保持（[Bjork Lab](https://bjorklab.psych.ucla.edu/research/)，[章节 PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/RBjork_inpress.pdf)）。

**ASAKI 含义**：「已掌握」的判定必须要求"跨天、且间隔拉长后的再次成功"（≥3 天间隔后的正确），同日连对两次不算——这正是 P0 调度包要改的。

## 4. 交错练习（interleaving）——有条件地有效

- **Brunmair & Richter (2019), Psychol. Bull. 145(11)**：59 项研究元分析，总体 **g = 0.42**；美术/视觉材料 g = 0.67、数学 g = 0.34；**词语类材料 g = −0.39（分组反而更好）**；类别越相似、材料越复杂，交错越有利（[PubMed](https://pubmed.ncbi.nlm.nih.gov/31556629/)，[PDF](https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf)）。

**ASAKI 含义**：多练习集混合出题（交错）可以做，但按"相似类别 + 数学/图形类"优先；不要对所有材料一刀切。

## 5. 自我解释与自述

- **Bisra et al. (2018), Educational Psychology Review 30:703–725**：自我解释提示元分析，69 个效应量，**g = 0.55**（[DOI](https://doi.org/10.1007/s10648-018-9434-x)，[PDF](https://gwern.net/doc/psychology/spaced-repetition/2018-bisra.pdf)）。
- Chi et al. (1989/1994) 的原始工作：自我解释改进理解（v2 报告首版已引，此处合并）。
- OECD《Digital Education Outlook 2026》：对话式导师的苏格拉底路径与 5–10 秒延迟痛点（[PDF](https://www.oecd.org/content/dam/oecd/en/publications/reports/2026/01/oecd-digital-education-outlook-2026_940e0dd8/062a7394-en.pdf)）。

**ASAKI 含义**：短答/自述题（P1）与"讲完请复述"的导师行为（已合入 iter6-tutor）都有 g≈0.5 量级的证据，值得继续投入。

## 6. 反馈：多 ≠ 好

- **Hattie & Timperley (2007), Rev. Educ. Res. 77(1):81–112**：反馈回答三个问题（我去哪/现在如何/下一步），作用于任务、过程、自我调节、自我四个层面；反馈可正可负，**指向自我调节的反馈最有效，指向"人"的表扬最弱**（[PDF](https://assess.ucr.edu/sites/default/files/2019-02/hattietimperley_2007.pdf)）。
- 合意困难框架提示：过度/持续反馈会削弱学习效果（见 §3 与 [CLT 对比综述](https://pmc.ncbi.nlm.nih.gov/articles/PMC12432286/)）。

**ASAKI 含义**：错题解析按"错在哪一步 → 下一步练什么"组织，少说"你真棒"；练习流程里答案解析应在提交后一次性给出，而不是边做边给。

## 7. 元认知：错觉性掌握是常态

- **Kornell & Bjork (2009), JEP: General 138(4)**：12 个实验的"稳定偏差"——学习者系统性低估未来学习、高估当前记忆，导致过早放弃（[PDF](https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Kornell_Bjork_2009_JEP-G.pdf)）。
- **Koriat & Bjork (2005)**：错觉来自"学习时可见、测试时不可见"的线索；**Karpicke, Butler & Roediger (2009)**：学生自认掌握与实际检索表现脱节（[PDF](https://psychnet.wustl.edu/memory/wp-content/uploads/2018/04/Karpicke-et-al-2009_Mem.pdf)）。
- **Bjork, Dunlosky & Kornell (2013), Annual Review of Psychology**：自我调节学习的信念、技术与错觉综述（[Annual Reviews](https://www.annualreviews.org/content/journals/10.1146/annurev-psych-113011-143823)）。
- **Panadero, Jonsson & Botella (2017), Educ. Res. Rev. 22**：自我评估对 SRL 的效应 0.23–0.65、对自我效能 0.73（[ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300313)）。

**ASAKI 含义**：答题把握度（P2）不是花活——把"自认有把握但答错"的题自动排进重点复习，是对抗错觉性掌握的直接手段；复盘页展示校准差（把握 vs 正确率）。

## 8. 反直觉/避免做的证据

| 迷思 | 证据 |
| --- | --- |
| 学习风格（视觉型/听觉型因材施教） | **Pashler et al. (2008), PSPI 9(3)**：偏好存在，但"匹配教学风格提升成绩"的交叉交互证据几乎不存在——不要按"风格"做个性化（[PubMed](https://pubmed.ncbi.nlm.nih.gov/26162104/)，[PDF](https://people.bath.ac.uk/edspd/Weblinks/PGCES%20ULL%20articles/Learning%20Styles/Pashler%20et%20al%202008%20PSPI.pdf)） |
| 一万小时/刻意练习万能 | **Macnamara, Hambrick & Oswald (2014), Psych. Science**：刻意练习解释成绩变异——游戏 26%、音乐 21%、体育 18%、**教育仅 4%**、职业 <1%（[PubMed](https://pubmed.ncbi.nlm.nih.gov/24986855/)） |
| 成长型思维干预普遍有效 | **Sisk et al. (2018), Psych. Science**：两个元分析（k=273/N=36.6 万；k=43/N=5.7 万），总体效应小，集中在高危/低 SES 学生（[PubMed](https://pubmed.ncbi.nlm.nih.gov/29505339/)） |
| 习惯 21 天养成 | **Lally et al. (2010), EJSP 40(6)**：中位 66 天，个体范围 18–254 天；2024 元分析：中位 59–66 天、均值 106–154 天——习惯养成提示不该设固定天数（[PDF](https://storage.googleapis.com/mailerlite-uploads-prod/1500700/t8ntgevUqxD4dN75U5ZhvvpmnKsILFnMqTZX8LDM.pdf)，[2024 元分析](https://pmc.ncbi.nlm.nih.gov/articles/PMC11641623)，[Surrey 澄清](https://www.surrey.ac.uk/news/does-it-really-take-66-days-form-habit-we-asked-expert-dr-pippa-lally)） |
| 反馈/夸奖越多越好 | §6：指向自我的表扬最弱；过度反馈削弱学习 |
| 重读=复习 | §1：低效用 |

## 9. 与 ASAKI 现有实现的对照（更新）

| 机制 | 现状 | 证据 | 差距 |
| --- | --- | --- | --- |
| 间隔复习 | 固定 [1,3,7]，答对不改 `due`（`practice-service.ts:129-167`） | §2：间隔随成功增长、随失败重置 | **硬伤**：同日反复到期 = 集中重复 |
| 掌握判定 | 同日连对 2 次即 resolved | §3：成功再学习要求跨间隔的再次成功 | 同日双对不算 |
| 检索形态 | 仅选择题 | §1/§5：自由回忆/自述更好 | 无短答题 |
| 元认知 | 无把握度 | §7：错觉性掌握常态化 | 无校准数据 |
| 计划触发 | 只有截止时间 | Gollwitzer & Sheeran 2006（d≈.65，94 研究）+ 2024 年 642 测试元分析（[DOI](https://doi.org/10.1016/S0065-2601%2806%2938002-1)，[2024](https://www.tandfonline.com/doi/abs/10.1080/10463283.2024.2334563)）；**Milkman et al. (2021, Nature)** megastudy：计划提示+提醒是少数可靠有效的干预（[PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC8822539/)；疫苗提醒 [Nature 2024](https://www.nature.com/articles/s41586-024-07591-x)） | 无 if-then 线索 |
| 掌握学习 | 无"不达标不放行" | Bloom (1984) 2σ（一对一只教比传统班高 2 个标准差，掌握学习约 1σ，[Sage](https://journals.sagepub.com/doi/10.3102/0013189X013006004)）；Kulik et al. (1990) 元分析 g≈0.52、EEF 综合 ≈0.40（[PDF](https://projects.panickssery.com/docs/kulik-1990-mastery_learning_meta_analysis.pdf)，[EEF](https://www.llse.org.uk/kil/uploads/datahub/4567ceb%5E03in-03/2021-06-05-EEF%20-%202018%20-mastery-learning.pdf)） | 长期计划可按"掌握再进下一阶段"组织 |
| 自适应模型 | 无 | 知识追踪：BKT（Corbett & Anderson 1995）、DKT（Piech 2015）、IRT；Baker et al. (2023) 比较现代 KT 算法（[CMU PDF](https://www.cs.cmu.edu/~bmclaren/pubs/BakerEtAl-HowWellDoContemporaryKnowledgeTracingAlgorithmsPredictKnowledgeDLG-ETRD2023.pdf)，[2025 综述](https://doi.org/10.1007/s40593-025-00508-3)） | P0 的 stability/difficulty 是最小可行替代，不上深度模型 |
| AI 导师 | 阿咲已能出题+苏格拉底规则（iter6 已合入） | **Kestin et al. (2024/25) Harvard 物理 RCT**：精心设计的 AI 导师学习增益是课堂主动学习的 2 倍以上、投入翻倍（[PubMed](https://pubmed.ncbi.nlm.nih.gov/40537565/)，[Stanford SCALE](https://scale.stanford.edu/publications/ai-tutoring-outperforms-active-learning)）；**Wang et al. (2024) Tutor CoPilot RCT**：给辅导者实时 AI 建议使学生掌握率 +4pp，新手辅导者受益最大（[arXiv](https://arxiv.org/abs/2410.03017)） | "导师质量来自教学法设计"——阿咲的讲解规则值得持续打磨 |
| 工作示例 | 无 | 认知负荷理论：新手从" worked examples"学习更好，专家反而冗余（专家反转效应，[Sweller 章节](https://www.cambridge.org/core/books/abs/cognitive-load-theory/learning-from-workedout-examples-and-problem-solving/DBA85CE81E9A7B1B090547D12E2F2A04)） | 讲解模式可按掌握度切换"示例先行/直接练习" |

## 10. 开源项目对照（补充）

- [DeepTutor](https://github.com/HKUDS/DeepTutor)：终身个性化辅导，直接读写 Obsidian vault。
- [OpenTutor](https://github.com/zijinz456/OpenTutor)：本地优先自适应学习工作台，FSRS 4.5 + 知识图谱 + 认知负荷检测。
- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) / [fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki) / [srs-benchmark](https://spacedrepetition.info/algorithms/fsrs-vs-sm-2)。
- Obsidian 插件：[Spaced Repetition](https://community.obsidian.md/plugins/obsidian-spaced-repetition)（FSRS+SM-2）、[FSRS](https://community.obsidian.md/plugins/fsrs)、[Spaced Repetition AI](https://community.obsidian.md/plugins/spaced-repetition-ai)。
- 129 个 AI 教育 App 横评：88/129 有 AI 答疑，带本地复习引擎的极少（[stealwhatworks](https://stealwhatworks.com/blogs/news/ai-education-app-features)）。

## 11. 迭代顺序（更新，按证据强度 × 成本）

- **P0 复习调度**（改 `practice-service` + 新纯模块）：FSRS 思路最小调度器——答对间隔单调增长并前移 `due`，答错重置；"已掌握"要求跨 ≥3 天间隔的再次成功。spec 已就绪（`iter7-scheduling.md`）。
- **P1 短答/自述题**：`kind: 'choice' | 'short'`，模型按参考答案评分，离线降级为自评；错题本展示"你的原答 vs 参考答案"。证据：§1/§5。
- **P2 把握度校准**：答题前"有把握/不确定"，复盘页给校准差；"自信但错"自动加重排期。证据：§7。
- **P3 实施意图**：任务/提醒支持"触发条件"，检查消息以 if-then 句式出现。证据：§9 表 + megastudy。
- **P4 交错与工作示例**：相似类别的练习集混合出题；讲解按掌握度在"示例先行/直接练"间切换。证据：§4 + CLT。
- **P5 掌握门控的长期计划**：阶段推进要求该阶段知识点达标（跨间隔正确），而非时间到了就翻页。证据：§9 掌握学习行。

## 12. 完整引用清单

1. Dunlosky, Rawson, Marsh, Nathan & Willingham (2013). PSPI 14(1), 4–58.
2. Karpicke & Blunt (2011). Science 331(6018), 772–775.
3. Rowland (2014). Psychol. Bull. 140(6), 1432–1463.
4. Educational Psychology Review (2026). 课堂真实环境检索练习元分析.
5. Cepeda, Pashler, Vul, Wixted & Rohrer (2006). Psychol. Bull. 132(3), 354–380.
6. Cepeda, Vul, Ko, Rohrer & Pashler (2008). Psych. Science 19(11), 1095–1102.
7. Pashler, Rohrer, Cepeda & Carpenter (2007). Learning styles concepts...（见 #18；本条为"Enhancing retention"综述）.
8. Brunmair & Richter (2019). Psychol. Bull. 145(11), 1029–1052.
9. Rawson & Dunlosky (2022). Curr. Dir. Psych. Sci.（successive relearning）.
10. Bjork (1994). Desirable difficulties（章节）.
11. Bisra, Liu, Nesbit, Salimi & Winne (2018). Educ. Psych. Rev. 30, 703–725.
12. Chi et al. (1989/1994). 自我解释原始研究.
13. Hattie & Timperley (2007). Rev. Educ. Res. 77(1), 81–112.
14. Kornell & Bjork (2009). JEP: General 138(4), 449–468.
15. Koriat & Bjork (2005). 错觉性掌握机制.
16. Karpicke, Butler & Roediger (2009). 学生自评与检索脱节.
17. Bjork, Dunlosky & Kornell (2013). Annu. Rev. Psychol.（SRL 综述）.
18. Pashler, McDaniel, Rohrer & Bjork (2008). PSPI 9(3), 105–119（学习风格）.
19. Macnamara, Hambrick & Oswald (2014). Psych. Science（刻意练习元分析）.
20. Sisk, Burgoyne, Sun, Butler & Macnamara (2018). Psych. Science（成长型思维双元分析）.
21. Lally, van Jaarsveld, Potts & Wardle (2010). EJSP 40(6), 998–1009（习惯）.
22. 习惯形成 2024 元分析（Health Psych. Rev. 系）.
23. Gollwitzer & Sheeran (2006). Adv. Exp. Soc. Psych. 38（实施意图元分析）.
24. Gollwitzer et al. (2024). Eur. Rev. Soc. Psych.（642 测试元分析）.
25. Milkman et al. (2021). Nature（megastudy：计划+提醒+微激励）.
26. Milkman et al. (2024). Nature（疫苗提醒 megastudy）.
27. Locke & Latham (2002). 目标设定理论（经 Gollwitzer 2006 引述）.
28. Bloom (1984). Educ. Researcher 13(6), 4–16（2 sigma）.
29. Kulik, Kulik & Bangert-Drowns (1990). Rev. Educ. Res.（掌握学习 g≈0.52）；EEF Toolkit 综合 ≈0.40.
30. Zimmerman (2002). Theory Into Practice 41(2)（SRL 概览）；Panadero, Jonsson & Botella (2017). Educ. Res. Rev. 22（自我评估元分析）.
31. Ye, Su & Cao (2022). KDD '22（FSRS 前身，召回预测 +12.6%）；Su, Ye et al. (2023). IEEE TKDE 35(10).
32. Corbett & Anderson (1995). BKT；Piech et al. (2015). DKT；Baker et al. (2023). KT 算法比较.
33. Kestin et al. (2024/25). Harvard 物理 AI 导师 RCT（学习增益 >2×）.
34. Wang, Ribeiro, Robinson, Loeb & Demszky (2024). Tutor CoPilot RCT（+4pp 掌握率）.
35. OECD (2026). Digital Education Outlook 2026.
36. Sweller 等. Cognitive Load Theory / worked examples（专家反转效应）.