# 第五轮调研：断签恢复 / 计划现实主义 / 考前窗口（iter32 候选）

**日期：** 2026-11-24　**作者：** sc-research　**基线：** master `9d0143c`
**范围：** 四类来源（开源项目 / 社交媒体 / 网站·博客 / 学术论文）各取证据；缺口带链接与可落地性标注；给出 iter32 候选排序（P0-P4）与拒收项。只加本文档，不碰 `package.json` / lock / CHANGELOG / `src`。
**与前三轮去重：** 理解/保持、提问/测验、启动成本、信任核验、进度可见、问责陪伴、隐私删号、创意工具坟场、本地优先信任、备份迁移均已覆盖。本轮四个新角度：**①断签与恢复**（连续记录断了以后怎么设计）、**②计划现实主义**（把实际完成率接回规划）、**③考前窗口**（最后几周的产品行为）、**④回访节奏**（知识主题的间隔复习阶梯）。

## 0. 取数方式与可达性（诚实声明）

- **Anki 官方手册**：`docs.ankiweb.net` 直接抓取（deck-options / studying 页全文），引文为原文。
- **Anki 源码**：`ankitects/anki` GitHub API 读 `rslib/src/deckconfig/schema11.rs`，默认值以代码为准（新卡 20/日、复习 200/日、leech 阈值 8 次忘记、默认只打标签不暂停）；learn ahead 20 分钟出自代理读的 `rslib/src/config/mod.rs`。
- **Loop Habit Tracker / obsidian-spaced-repetition 源码**：子代理经 GitHub 读 `uhabits-core`（Entry/ScoreList/EntryList/Preferences/strings.xml）与 OSR（README/settings/notes-data-store/question），行内引文为源码注释与字符串原文。
- **SuperMemo**：`help.supermemo.org` 被 Cloudflare 拦，改读官方 Help 16 存档（super-memory.org/archive/help16/plan.htm）与作者站 supermemo.guru（Wozniak 本人维护），版本旧于当前 Help wiki，如实标注。
- **JCR 论文全文**：Silverman & Barasch 2023 读作者本人托管的 PDF（jackiesilverman.com），逐段核对。
- **Wiley/Elsevier 正文被 Cloudflare 拦截**（Lally 2010、BJHP 2021）：中位数与方差引 2024 年 Singh 等系统综述（PMC 可直读）复核，Lally 的「漏一天无碍」结论标注为「广泛转述、原文未直读」。
- **Reddit**：直连被拦，走 `arctic-shift.photon-reddit.com` 归档 API（同第四轮口径）；每条引语复核过作者/分数/permalink。
- **知乎/贴吧**：仅搜索摘要可读，中文证据标注「中」，只作佐证。
- **高校新闻/心理中心页面**：curl 直读（山东大学心理中心、成都大学新闻网），引文保留原文。
- **博客**（Nielsen、quidproquo.cc 等）：curl 直读全文后逐段摘引。
- 每条引语保留原文，不给 URL 的不引用。

## 1. 开源项目：成熟实现的机制与取舍

### 1.1 Anki——「积压不滚雪球」的一整套默认值

Anki 对「断了怎么办」的全部答案都写在**默认值**里，没有一句话是靠说教：

| 机制 | 默认值 | 出处 | 设计意图（原文） |
|---|---|---|---|
| 新卡/日 | **20** | `rslib/src/deckconfig/schema11.rs:261`（`per_day: 20`） | 手册：「If you are consistently learning 20 new cards a day, you can expect your daily reviews to be roughly about 200 cards/day.」 |
| 复习/日上限 | **200** | 同上 `:246`（`per_day: 200`） | 手册（Maximum Reviews/Day）：「can save you from a **heart attack** when returning to Anki after taking a week off.」——上限的存在就是为了断一周回来那天不吓死人 |
| 漏一天不复利 | — | 手册 Daily Limits：「If you study fewer than the limit, **or miss a day**, the next day the counts will be back to their original setting: you won't be given more cards than your limit allows.」 | 积压不因缺席而变大——缺席的代价被默认值吸收 |
| 积压时停止加新 | — | 手册：「If you have a backlog of overdue review cards, it is recommended that you **stop introducing new cards** until you catch up with that backlog.」 | 官方建议的恢复路径：先清旧，不加新；社区用 filtered deck 把「近 7 天到期」与「更早积压」拆成两个临时牌组分开消化（手册 filtered-decks 页） |
| 提前学习上限 | **20 分钟** | `rslib/src/config/mod.rs:233-236`（`learn_ahead_secs` 缺省 `unwrap_or(1200)`）；手册警告「the 'review ahead' custom study setting is not appropriate for repeated use」 | 就算今天做完，也不鼓励一口气往后赶——防把明天变成新积压 |
| 目标保持率（FSRS） | **0.90** | 手册 FSRS：「The default is 90%... **Above 90% the workload increases very quickly, and above 97% the workload can be overwhelming.**」 | 记得更牢与复习量之间给出官方默认折中 |
| 忘 8 次的卡（leech） | 只打标签；暂停（suspend）是可选项 | `schema11.rs:272`（`leech_fails: 8`）、`:218-222`（`LeechAction` 默认 `TagOnly`） | 卡住的不是人，是卡——先把烂卡标记出来，而不是逼人硬啃 |

这组默认值共同构成 Anki 的断签哲学：**缺席不罚（不复利）、恢复有路（先清积压再加新、按时间盒消化）、单日量有顶（防 heart attack）、烂账有标记（leech）**。一个口径冲突如实标注：源码里 leech 默认是 `TagOnly`（只打标签，`schema11.rs:218-222`），而手册 leeches 页写「When this counter reaches 8, Anki **tags** the note as a leech **and suspends** the card」——手册描述的是把 leech action 设为 Suspend 时的行为，自动搁置是可选项而非默认。对照产品：ASAKI 的任务没有每日上限概念，落后提醒（`behind-schedule.ts`）只在「完成 <50%」时响一次，缺口见 §5。

### 1.2 Loop Habit Tracker——「跳过」不是「失败」，分数衰减而非归零

Loop 的每日状态是五值枚举而非布尔（`uhabits-core/.../models/Entry.kt`）：`SKIP = 3` 的注释原文「Value indicating that the habit is **not applicable** for this timestamp」，与 `NO = 0`（「the user **did not perform** the habit, even though they were expected to perform it」）在模型层就分开：

- **分数不动**：计分明确跳过 SKIP（`ScoreList.kt`：`if (value != Entry.SKIP) { ... }`）——「今天不适用」不扣分。
- **连胜不断**：连胜判定把 SKIP 当完成（`EntryList.kt`：`val completed = entry.value != Entry.NO && entry.value != Entry.UNKNOWN`）；数值型习惯的跳过天直接从周期目标里扣（`target = max(0.0, baseTarget - dailyTarget * skippedDays)`）。
- **UI 原话**（`strings.xml`）：「Toggle twice to add a skip instead of a checkmark. **Skips keep your score unchanged and don't break your streak.**」
- **设计哲学**（README）：「Every repetition makes your habit stronger and every missed day makes it weaker. **A few missed days after a long streak, however, will not completely destroy your progress**, unlike many other don't-break-the-chain apps.」
- Skip **默认关闭**（`Preferences.kt`：`storage.getBoolean("pref_skip_enabled", false)`）——不加重首次使用的认知负担。

对 ASAKI 的直接启示：断签的计量单位不必是「归零的整数」，可以是**衰减的强度**；缺一天不该抹掉 60 天的积累。Loop 给的第三个状态（skip=不适用）在「学习」场景同样存在（生病、考试周、出差），但三态控件对低技术素养用户要配一句人话，且状态必须落在明文里（ASAKI 的复盘记录本来就是每日一行，天然兼容）。

### 1.3 obsidian-spaced-repetition——复习长在笔记里，vault 仍是明文

在普通 markdown 笔记里写 `#flashcards` 标签 + `Question::Answer` 行，笔记即牌组（README）；调度状态**写回笔记本身**，是题目行尾的一行 HTML 注释：`Q2::A2 <!--SR:!2023-10-16,34,290-->`（源码 `question.ts` 注释即此格式）；默认且当前唯一实现的存储是 `dataStore: StorageType.NOTES`（`settings.ts`；`FOLDER`/`PLUGIN_DATA` 在枚举里被注释掉），读写走 `/<!--SR:(.+?)-->/m` 正则（`notes-data-store.ts`）。

**机制取舍：**
- ✅ 零导入写作：用户在写笔记的地方顺手成卡；元数据一行跟着笔记走，备份/迁移天然包含；vault 仍是 `.md`，Obsidian 直读不破坏（阅读视图不渲染注释）。
- ❌ `<!--SR:!2023-10-16,34,290-->` 对人是乱码，源码视图变脏；手动编辑题目行容易破坏或重复元数据；`::`/`:::`/`?`/`??`/标签层级是一套要学的语法；「复习」不是正文里原地翻卡，而是命令打开牌组视图——「内嵌」只发生在数据层，不在交互层。

对 ASAKI（P2b 回访阶梯）的启示：**调度元数据放明文里是成熟做法**（ASAKI 的 `revisitDue` 本就是知识主题记录的既有字段，同一哲学），但不要引入「用户手写语法」——录入走表单，元数据由程序生成；也不必承诺「正文原地翻卡」，在今日页集中处理到期主题即可。

### 1.4 SuperMemo 的 Plan 组件与增量阅读的复杂度教训

- **Plan 的机制**（官方 Help 16 存档，`help.supermemo.org` 被 Cloudflare 拦，存档可读）：一天是一串带时长的时间槽；到点点 Begin，实际开始时间回写后「**The whole schedule is automatically rebuilt and optimized**」；超时会挤压后续：「If you keep overrunning your allocated time slots, **the remaining activities of the day will progressively get squeezed**」；插入活动则前后「optimally be stretched or compressed」。重排模式默认 `Unfix`（「let your schedule flow as if nothing happened」），另有 Leave unchanged / Shift all equally / Shift in proportion to time left 三档（supermemo.guru，Wozniak 作者站）。
- **作者自己写的反面**：要求「If you do not religiously stick to the schedule, schedule optimization will not work!」（Help 16）；用户评价「**Many users consider it redundant. Few have ever tried to use it. Those who have tried have often failed.**」（supermemo.guru）。
- **增量阅读为什么没流行**（作者站自答）：「learning curve: you need to learn the toolset」；「If Anki takes 3 hours to learn, it is already too much. If incremental reading requires months of practice… you can expect **a tiny fraction of most dedicated survivors** to continue.」；「**Very often users hate SuperMemo for the burden it imposes in their life.**」

取舍结论：Plan 的「按实际用时压缩剩余安排」是 P1（计划现实主义）的半个镜像——但 SuperMemo 把压缩做成了**自动且默认**（Unfix），低技术用户会体验为「计划背叛了我」。ASAKI 应该把重排做成**显式的、给出建议数字、由用户确认**的动作（现有重排入口已经是显式的，缺的是建议数字来自真实数据，见 G2/G3）；分钟级 Delay 分析与 IR 工具链不引入。

## 2. 社交媒体：新角度的用户原声（11 条，全部经 arctic-shift 归档 API 核验）

### 2.1 断签的痛苦与「社区教作弊」

- **r/duolingo，48 分 / 23 评（2026-11-10）**：丢 2000+ 天 streak 的自白——晚班回家已过午夜、以为有 streak freeze：「Finished out the lesson. Duo congratulated me on a **1 day streak** and thanked me for coming back. **But I never left.** Gutted to lose it that way.」；帖主追评（12 分）：「To make this even more painful a few weeks ago I got a one year Super subscription…」；最高赞评论（25 分）竟是**教人改手机系统时间**找回 streak：「Change the time and date on your phone and do a lesson」。— [1xs8gwz](https://www.reddit.com/r/duolingo/comments/1xs8gwz/lost_my_2000_streak_and_i_am_needing_some_love/)
- **r/duolingo（2026-11-20）**：丢 611 天 streak——「I recently lost my 611 day streak as I was **ill to the point we had to call an ambulance**.」（病到叫救护车仍先想到打卡）；问「Any tips on getting it back or is it just lost to time and I have to start over?」；官方人员 DM 恢复后帖主回帖（9 分）「All fixed now!」——**修复是靠人肉 DM 特批的，不是产品功能**。— [1y18pt9](https://www.reddit.com/r/duolingo/comments/1y18pt9/lost_my_611_day_streak/)

断签后的行为两极：要么社区集体教作弊（改系统时间），要么靠客服特批。对应 JCR 的 H4（给修复机会会减弱断签效应）：**修复应该是产品的一等公民，而不是特例恩赐。**

### 2.2 计划排太满（planning fallacy 的用户面）

- **r/productivity（2022-10-14，归档 4 分）**：用 Habitica 排出周计划表，最高赞（23 分）一针见血：「**Self imposed 4.5 hours of sleep per night isn't sustainable** or a good idea IMO」；另一条（13 分）「4.5 hours of sleep will literally destroy you」；最佳总结（1 分）：「**If you have to ask, then it's unrealistic** :-)」。— [y3eo0k](https://www.reddit.com/r/productivity/comments/y3eo0k/is_my_schedule_unrealistic/)
- **r/GetStudying（2026-11-16）**：标题即全部——「opened my thanksgiving break study plan from last year. it was last edited the night before i left and **has 10 words in it**」：计划只写了「mon: ch 1-4. tue: ch 5-8. wed: rest. thu: turkey.」「guys, that was my plan for 9 days」；「came back to campus with finals 2 weeks away and **zero hours done**」。而今年的修正方案正是极简主义：「so this year it's dumber. **3 sessions, that's all.**」— [1xxp4x7](https://www.reddit.com/r/GetStudying/comments/1xxp4x7/opened_my_thanksgiving_break_study_plan_from_last/)
- **r/Anki，29 分 / 31 评（2026-11-12）**：回归者的积压——三年不断签反而养出不可持续的日负荷：「~2 hours for 250 cards and growing」；大搬家后断 7 个月，10k 卡待补。高赞策略（kazlime）：「**Decide by time, not by card count. 15 minutes a day, timer on, stop when it rings** even if the counter still says 9,000. **The backlog number looks like a to-do list but it isn't one.**」；心理成本（ingrideto）：「If you already knew 1000 words and now you're faced with 3 months of work to know 1000 words, **that's pretty demoralising**.」— [1xuh2vc](https://www.reddit.com/r/Anki/comments/1xuh2vc/how_do_i_catch_up_on_a_huge_backlog_10k_without/)
- **r/college（2015，34 分）**：螺旋自白——「I need to get out of this **endless circle** that I am in. I need better time management, but I have zero idea wtf to really do」。— [3pc83o](https://www.reddit.com/r/college/comments/3pc83o/extremely_disappointed_in_myself_i_promised/)

### 2.3 考砸与考前心态

- **r/college，973 分 / 101 评（2023-11-06）**：「I went from getting a perfect SAT math score and 5s on all my math AP exams to **getting my ass kicked**.」；同帖 5 个月后帖主归来（2024-03-22）：「I ended up finishing this class with a solid B after failing the first two midterms」——**方法修正后的完整恢复叙事**。— [17orcr9](https://www.reddit.com/r/college/comments/17orcr9/i_spent_a_week_straight_studying_for_my_first/)
- **r/college，311 分 / 77 评（2023-10-17）**：「Everyone around me just passed. I failed. I feel awful.」「Please can anyone just lend some support. **I feel hopeless.**」；高赞回复（8 分）：「I got a C in economics and I took it in my 4th year. **Pretty dang irrelevant at this point.**」— [179ymp6](https://www.reddit.com/r/college/comments/179ymp6/i_just_failed_my_first_college_exam_that_everyone/)

### 2.4 启动不了（拖延的死循环）

- **r/GetStudying，49 分（2026-09-04）**：「when I actually sit down, I end up checking my phone… **I usually feel guilty about wasting time, which just makes it harder to start**」——负罪感 → 更难启动，与 Wohl 2010（自责加重拖延）同一闭环的用户自述版。— [1w77fip](https://www.reddit.com/r/GetStudying/comments/1w77fip/how_do_you_actually_start_studying_when_you_know/)
- **r/GetStudying（2026-06-05）**：「some days when I'm stressed about studying I could avoid it by **reading for 8-12h nonstop**」（用别的「学习」逃避该学的）；「**Pomodoro won't work at all**」——通用技巧对一部分人无效，别把宝押在单一机制。— [1ty14ov](https://www.reddit.com/r/GetStudying/comments/1ty14ov/i_cant_bring_myself_to_start_studying/)
- **r/GetStudying（2026-06-16）**：全文两句：「How do i escape this」「And how to stop searching for **perfect tool, perfect setup or perfect method**」——找完美工具本身就是拖延形态；对产品是警示：**别给「折腾配置」留更多入口**。— [1u7f4vz](https://www.reddit.com/r/GetStudying/comments/1u7f4vz/procrastinated_for_a_year_been_in_a_rut_now_cant/)

**诚实声明：** 11 条全部来自 Arctic Shift Reddit 归档 API（原始 JSON 存档于本机 chat-scratch，可逐条复核）；分数是归档快照值、非实时；r/college 近两年考砸帖正文多被 [removed]，只能引 2015-2023 归档；「计划排太满」角度样本最弱（模板营销帖污染严重，已排除）；知乎/贴吧正文未取到，中文证据只用了 §3.3 的大学页面。

## 3. 网站·博客：三个直接可用的来源

### 3.1 Michael Nielsen《Augmenting Long-term Memory》（2018，全文直读）

- **量级感**：「I've used Anki to create a little over 10,000 cards over about 2 and a half years… When I'm keeping up with my card review, it takes about **15 to 20 minutes per day**. If it routinely rises to much more than 20 minutes it usually means I'm adding cards too rapidly, and need to slow down.」——记忆系统是**长期低烈度**的，日负荷是首要设计变量。
- **卡片自己做**：「making Anki cards is an act of understanding in itself… To use someone else's cards is to forgo much of that understanding.」＋「The act of constructing an Anki card is itself nearly always a form of elaborative encoding.」——这直接支持 ASAKI 现有「自建练习集」的路线，也构成对「AI 一键批量生成题库」的质疑（见 §6 拒收项）。

### 3.2 quidproquo.cc《Building Spaced Review into Teaching Articles》（2026-10-14，全文直读，作者 xiaoxu）

对「嵌入式复习」这一产品形态最完整的盘点（8,867 词，附逐项证据强度标注）：

- **Quantum Country 数据**（作者自述后端数据，非同行评审）：首篇嵌 112 题；「Quantum Country readers who reached their 6th review had about **54 days of 'demonstrated retention'** per question on average, after about **95 minutes of total review**; the essay itself takes about 4 hours」——且作者自己点名这是幸存者偏差（只有坚持到第 6 次复习的人被统计）。
- **无复习对照**：延迟两周复习的一组，「accuracy on 8 questions went from 91% to 87%; in the group reviewing as usual it went from 89% to 96%」——n=25/16、无显著性检验，博客如实标注「informal experiment」。
- **嵌入式 vs 题库**：「The authors argue that embedding the questions in the narrative is what lets this form handle conceptual knowledge; **no published data compares the two approaches**.」
- **Duolingo 排程实验的反面教训**：两次随机实验（约 100 万 / 330 万人）**只测了次日回访**，「With the new algorithm against the old rule, **next-day return to practice dropped 7.3%**, and it still went to all users」——换排程算法要看留存，不能只看学习指标。
- **Execute Program 的每日限量**：「opens only **5 lessons on the first day**, then each day **starts with reviews before new lessons**; new users occasionally email to complain, and long-term users email to praise it」——限量 + 复习先行，用户初期抱怨、长期感激；创始人自述、无效果数据（博客标注）。
- **为什么没流行**（建造者自述的障碍）：「readers have to build a habit of coming back, **good questions are hard to write**, readers feel it is like homework; it also needs **accounts and a scheduling system**」——后两条 ASAKI 天然满足不了也要诚实面对：无账号无邮件，回访全靠桌面端启动。

### 3.3 中文语境：考前冲刺的两个一手页面（强度：中，只作佐证）

- **山东大学学生心理健康教育与咨询中心**《进入考研冲刺期，考研人心态崩了怎么办？》：「有人说，**最后一个月备的是心态，考的也是心态**：大家都在焦虑，谁能停止无止境的内耗，谁就是这场拉锯战的胜者！」；结尾「**不要过多苛责自己**……不必把自己活成苦行僧」。— [xljk.sdu.edu.cn](https://www.xljk.sdu.edu.cn/info/1008/10431.htm)
- **成都大学新闻网**《研考倒计时1个月 上岸"橙子"分享冲刺"秘诀"》（2024-11-21，上岸学生访谈）：
  - 模拟考节奏：「我采取……**每周一次的专业课模拟考和两周一次的公共课模拟考**，针对近几年的真题进行模拟考试，**严格按照考试时间和题量**来查漏补缺」；
  - 另一位：「复习重心放在了政治和专业课上，**以真题为主，严格按照考研初试时间进行模拟**」；
  - 断签后的自愈：「到十二月时状态较差，**经常因做题过程中错误太多陷入情绪低谷**，学习不在状态」；
  - 微小仪式：「我每天在便利贴上记录必做清单，完成后再把它**'划掉'**」。
  — [news.cdu.edu.cn](https://news.cdu.edu.cn/info/1002/45837.htm)

## 4. 论文：九篇核心证据 + 一组备选

| # | 论文 | 关键数字 / 结论 | 对应候选 |
|---|---|---|---|
| 1 | Lally et al. 2010, *Eur. J. Soc. Psych.* 40:998-1009（[DOI](https://doi.org/10.1002/ejsp.674)，2008 次引用） | 习惯自动化到平台的**中位数 66 天**，个体差异 **18-254 天**；「漏掉一天无实质影响」（结论为广泛转述，原文未直读，见 §0） | ①断签 |
| 2 | Singh et al. 2024, *Healthcare*（[PMC11641623](https://pmc.ncbi.nlm.nih.gov/articles/pmc11641623/)，全文直读） | 复核 habit formation 时间：**中位数 59-66 天，均值 106-154 天，个体差异 4-335 天**；干预对习惯分数 SMD=0.69 (95% CI 0.49-0.88) | ①断签 |
| 3 | **Silverman & Barasch 2023, *JCR* 49(6):1095-1117**（[DOI](https://doi.org/10.1093/jcr/ucac029)；作者 PDF 全文直读） | 七项研究：「consumers are more likely to engage in a behavior when it contributes to an **intact streak**… relative to when it follows a **broken streak**」；**自己归因的断签伤害更大**（H3）；**给修复机会会显著减弱断签效应**（H4：「allowing certain actions to fill in the break… reactivate the streak goal」） | ①断签 |
| 4 | Dai, Milkman & Riis 2014, *Mgmt. Sci.* 60(10):2563-2582（[DOI](https://doi.org/10.1287/mnsc.2014.1901)） | **Fresh start effect**：时间地标（新年/月初/周一/生日）后目标行为显著上升；机制是「新心理账户把过去的不完美划归上一个时期的自己」 | ①断签恢复文案 |
| 5 | Wohl, Pychyl & Bennett 2010, *Pers. Individ. Differ.* 48(7):803-808（[DOI](https://doi.org/10.1016/j.paid.2010.01.029)） | N=119：**原谅自己拖延的学生，下次考试前拖延更少**——自责加重回避循环 | ①断签文案、③考前 |
| 6 | Gollwitzer & Sheeran 2006, *Adv. Exp. Soc. Psych.* 38:69-119（[DOI](https://doi.org/10.1016/S0065-2601(06)38002-1)） | 实现**意图**（if-then 计划）元分析：k=94、N=8,461，**d=.65**；要具体到「何时何地做什么」 | ②计划 |
| 7 | Buehler, Griffin & Ross 1994, *JPSP* 67(3):366-381（[PDF](https://web.mit.edu/curhan/www/docs/Articles/biases/67_J_Personality_and_Social_Psychology_366%2C_1994.pdf)） | **Planning fallacy**：人按「理想剧本」（inside view）估时，不看自己过去同类任务的实际用时 | ②计划 |
| 8 | Ramirez & Beilock 2011, *Science* 331(6014):211-213（[DOI](https://doi.org/10.1126/science.1199427)） | 大考前 **10 分钟表达性写作**（写下对考试的担忧）显著提分，对高焦虑学生收益最大；机制是清空工作记忆中的担忧 | ③考前 |
| 9 | van Eerde & Klingsieck 2018, *Educ. Res. Rev.* 25:73-85（[DOI](https://doi.org/10.1016/j.edurev.2018.09.002)） | 拖延干预元分析（24 项研究，N=1,173）：总体大效应且随访稳定；**CBT 类最强** | ②计划（自我调节部分） |
| 10 | AWE 元分析组：Fleckenstein et al. 2023（[Frontiers in AI](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2023.1162454/full)，g=0.55，20 研究/N=2,828）；Ngo, Chen & Lai 2024（EFL/ESL，g=0.59）；*System* 2026（[ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0346251X26000497)，d=0.271，N=11,875，最大效应在情绪投入） | **自动写作反馈对写作质量是中到小效应**，且新版 AI 反馈的大型元分析效果更保守——够撑一个「参考反馈」功能，撑不起「AI 批改=好成绩」的承诺 | （备选，见 §6-P3 之后评估） |

## 5. ASAKI 现状与落差（只读，file:line 已核）

### 5.1 已经做对的（本轮四个角度）

| 已有能力 | 证据 |
|---|---|
| 连续复盘天数展示；今日未复盘仍显示昨日存活 streak | `src/shared/review-stats.ts:8-16`；`src/renderer/shell/ReviewPage.tsx:74-78, 212` |
| 热力图带「最长连续 M 天」（12 周窗口） | `src/renderer/shell/heatmap.ts:89-125` |
| 每日计划生成带倒计时与冲刺阶段指引（基础→强化→冲刺） | `src/main/planning/prompt.ts:62-69, 105-152` |
| 今日安排页显示「距离目标还有 N 天」；目标日已过有提示 | `src/shared/workspace.ts:87-95`；`src/renderer/shell/TodayOverview.tsx:84, 233` |
| 长期计划重排带逐周完成率摘要（整体完成 N 项 N%） | `src/main/plans/long-plan-service.ts:157-189` |
| 落后提醒：完成 <50% 才响、点名第一项、提供「一起调整」 | `src/main/scheduler/behind-schedule.ts:19-58` |
| 早/晚/周检查到点提醒，去重与推迟已做 | `src/main/scheduler/scheduler.ts:157-202` |
| 管家可给知识主题安排回访（默认明天），到期回访进今日页 | `src/main/butler/prompt.ts:44`；`src/main/butler/tools.ts:839-881`；`TodayOverview.tsx:125-131` |
| 「今日只做一件」偏好（一天一件任务的模式） | `src/renderer/shell/TodayOverview.tsx:30-40` |
| 25 分钟专注计时绑定任务 | `src/renderer/shell/FocusTimer.tsx:30-81` |

### 5.2 落差表

| # | 落差 | 证据（file:line） | 对应外部证据 | spec 方向 | 可落地性 |
|---|---|---|---|---|---|
| G1 | **断签没有设计**：streak 是纯计算值；「今天还没复盘」的提示与「上午不清零」已有（ReviewPage 先显示截至昨日的存活 streak），但断签一旦发生，数字落回「连续复盘 0 天」且无任何表述与恢复引导；「最长连续」只在热力图无障碍文本里，复盘页看不到 | `review-stats.ts:8-16`（while 循环到首个缺口即止）；`ReviewPage.tsx:73-79, 210-218`（存活期显示 + 蓝色「今天还没复盘」提示 + 「连续复盘 N 天」行） | JCR（断签伤害 + 修复减弱效应）；Loop Habit（漏几天「will not completely destroy your progress」、分数衰减不归零）；Lally/Singh（漏一天无碍、时间个体差异大）；Wohl（自责加重拖延） | 复盘页断签日给一句恢复文案 + 常驻显示「最长连续」；文案原则见 §6-P0 | **小**：一个组件文案 + 一个已有字段 |
| G2 | **每日规划不看完成史**：每日任务生成的提示词里没有任何历史完成数据；可用时间四来源（用户输入/周安排/项目设定/默认 120 分钟）都不是「实际能完成多少」 | `planning/prompt.ts:24-94`（提示词构成）；`workspace-planner.ts:18, 58-70` | Buehler 1994（planning fallacy=不看自己过去）；Anki 新卡 20/日的「默认上限」哲学 | 「本周概览」已算出完成率（`TodayOverview`），把「过去 7 天平均完成 N%」作为一行加进每日规划 prompt 与重排建议；超载时建议压量而不是照排 | **小-中**：prompt 加一行 + planner 读聚合数据 |
| G3 | **重排入口的默认值凭空**：重排剩余时长输入框默认 '10'（小时），与实际进度无关 | `LongPlanPage.tsx:504`（`useState('10')`） | 同 G2 | 默认值改为「按过去两周实际完成速度推算」，并允许改 | **小**：一个默认值计算 |
| G4 | **无整卷/模拟考形态**：练习集只有逐题作答；全仓库「真题/模拟考」只出现在种子任务文案里；专注计时固定 25 分钟，不能按考试时长整卷跑 | grep 全仓库「真题\|模拟考」仅 `src/shared/plan-template.ts:136`（文案）；`FocusTimer.tsx`（25 分钟固定） | 成都大学上岸学生（每周模拟考、严格按考试时间与题量）；Ramirez & Beilock（考前暴露于压力情境的价值） | 练习集加「整卷模式」：设定总时长→按卷内顺序计时作答→交卷出正确率（复用计时器与错题本，不加云能力） | **中**：一个新模式 + 计时器参数化 |
| G5 | **知识主题回访无节奏**：`schedule_revisit` 由模型临场决定、默认明天，`revisitDue` 只有一个日期，无间隔阶梯（答对顺延/答错回退） | `butler/prompt.ts:44`（默认明天）；`butler/tools.ts:874`（单字段覆写） | QC 数据（六次复习后 54 天保持）；Duolingo 排程实验教训（改节奏要看回访留存）；obsidian-spaced-repetition（调度元数据写回明文笔记是成熟做法，`<!--SR:...-->` 一行跟着文件走） | 给 `revisitDue` 一个确定性阶梯：回答到位→3→7→14→30 天顺延；没接住→次日/后天；**不改 vault 文件格式语义**（revisitDue 已是既有字段），录入走表单不引入手写语法 | **小-中**：一个纯函数 + 工具改一行默认 |
| G6 | **考前最后阶段无差异化行为**：倒计时进了 prompt 与今日页，但「最后 2 周」与平时完全同构——没有整卷建议、没有「不再加新内容」的信号、没有一次性的考前写作出口 | `planning/prompt.ts:105-152`（staging 只在生成时用一次） | SDU（最后一个月备的是心态）；CDU（模拟考节奏）；Ramirez & Beilock | 若 G4 做了，倒计时 <14 天时今日页加一行「可以来一次整卷模拟」的轻提示 + 复盘问题里出现一次「写下你现在最担心的事」（Ramirez 式，一次性） | **小**（依赖 G4） |
| G7 | **断签日的提醒文案是催促制**：早/晚/周检查文案固定，与「昨天没来」无关 | `scheduler.ts:157-176`（固定文案） | Dai 2014（时间地标=新开始）；Wohl 2010（自责→更拖延） | 检查到 service 已有上下文（落后提醒同型），断签次日的早检查把「继续昨天」换成「新的一天」框架，一句话 | **小** |

### 5.3 与既有前提的相容性

四个候选全部不需要账号、云、加密、新文件格式；vault 仍为纯 markdown 直读；`revisitDue` / streak / 计划重排 / 练习集全部复用既有字段与组件。低技术素养 × Windows：所有候选没有新概念需要用户理解（无「FSRS」「间隔重复」「遗忘曲线」字样入 UI）。

## 6. iter32 候选排序（P0-P4）

| 优先级 | 候选 | 为什么 | 规模 |
|---|---|---|---|
| **P0** | **断签恢复设计（G1+G7）**：复盘页在 streak 断掉的第一天显示恢复文案（承认中断、点名「最长连续 M 天」、给「今天回来就行」的动作，Loop 哲学：漏几天不清零长期进度）；检查文案在断签次日切换为 fresh-start 框架（Dai 2014）。证据密度最高（JCR+Lally+Singh+Dai+Wohl+Loop+两条 Reddit 一手帖），改动最小，且与第三轮「别让我内疚」红线同向 | 断签是 100% 会发生的事，而现在产品的全部回应是「0 天」两个字；r/duolingo 用户为找回 streak 在改系统时间、求客服 DM 特批——修复该是默认给的一句话，不是恩赐 | 极小 |
| **P1** | **计划现实主义（G2+G3）**：把过去 7 天实际完成率（本周概览已在算）接进每日规划 prompt 与重排默认值；超载周给出「建议按 60% 排」之类的具体数字建议（数字来自本地数据，不做预测模型；重排保持显式确认——SuperMemo Plan 的教训是自动压缩会被体验为「计划背叛了我」） | planning fallacy 是有 30 年证据的稳定效应（Buehler 1994）；Anki 用「默认 20/日」回答了同一问题；Reddit 用户自述「4.5 小时睡眠的周计划」和「10 个词的 FINALS PLAN」就是它的两个极端；ASAKI 数据都在本地现成 | 小-中 |
| **P2a** | **整卷模拟模式（G4）**：练习集整卷限时作答（复用 FocusTimer 参数化 + 错题本），考研 workspace 价值直接（真题模拟是上岸学生的标准动作） | 现有自建练习集只有逐题形态；CDU 一手访谈里两个考生都提到「严格按照考试时间和题量」 | 中 |
| **P2b** | **回访节奏阶梯（G5）**：`revisitDue` 加确定性阶梯（3→7→14→30 / 失败回 1-2 天），让主题回访从「讲过的、默认明天」变成「有节奏的」；不在 UI 提任何算法名词；元数据沿用明文字段（OSR 的 `<!--SR:...-->` 证明调度状态放明文里可行且可迁移）；不暴露「目标保持率」类滑杆（fsrs4anki 教程原话：higher values will greatly increase your workload, lower values can be demoralizing——两侧都有坑，默认值替用户拿主意即可） | QC 与 OSR 证明嵌入式复习可行且 vault 明文可容纳；Duolingo 教训提醒：改节奏后要看回访留存指标 | 小-中 |
| **P3** | **考前窗口（G6，依赖 P2a）**：最后两周的整卷轻提示 + 一次性考前写作（Ramirez 式）进复盘问题 | Science 级证据但使用频次极低（一年一两次），适合做成轻提示而非功能 | 小 |
| **P4** | **实现意图落到任务（G2 延伸）**：今日任务的 acceptance 已有完成标准，可再加「何时何地开始」一行（Gollwitzer d=.65） | 证据极强但 UI 已有 startAt 时间表，增益有限；仅当 P1 落地后规划文案有余量时做 | 小 |

### 拒收项（连同理由）

| 拒收 | 理由 |
|---|---|
| **AI 一键批量生成题库/闪卡** | Nielsen 原文：「making Anki cards is an act of understanding in itself… To use someone else's cards is to forgo much of that understanding.」制卡即精加工编码；现有「自建练习集」是对的。管家可以在对话里帮出题（已有），不做「一键生成 N 张」 |
| **连续打卡道具化**（streak freeze 购买/游戏化道具） | Duolingo 的 streak freeze 是内购货币换的（JCR 论文原话），道具=把修复变成商品；修复应是产品默认给的一句文案，不是商店货架 |
| **罚款/金钱承诺** | 第三轮已拒（Beeminder/StickK 模式与「别让我内疚」冲突）；本轮无新证据推翻 |
| **SuperMemo 增量阅读**（见 §1.4） | 复杂度是被建造者自己承认的障碍（「good questions are hard to write」的另一面是流程复杂）；低技术素养前提不可破 |
| **口语/语音练习** | 无音频基础设施（ffmpeg 仅视频管线）；无证据采集条件 |
| **番茄钟改造**（自定义时长、五分钟起步档） | 已有 25 分钟专注计时；「5 分钟起步」无独立证据支撑其优于现有形态；留作 P2a 的整卷计时顺带覆盖 |
| **全量日历同步**（读取系统日历排任务） | Windows 日历权限与隐私面大；本地 .ics 解析对低技术素养用户是配置成本；现有「周安排/今天特别满」机制已覆盖同一需求 |

## 7. 反功能复核（沿用第三、四轮格式）

- ❌ 不做打卡日历的红色断点标记/愧疚式「你断了」横幅——断签文案只陈述事实 + 给下一步（round-2 §2.5「别让我内疚」同源）。
- ❌ 不把「最长连续」做成排行榜或可分享卡片：本地优先，无分享面。
- ❌ 不做预测性「你大概考 XX 分」：完成率回灌只给「过去 N 天平均完成 M%」的**事实行**，不做外推。
- ❌ 不用游戏化道具（货币/勋章/复活卡）承载任何恢复机制。
- ❌ 倒计时不用倒计时焦虑配色（红色警告），保持中性数字（第三轮「进度可见 ≠ 愧疚仪表」同源）。
- ❌ 考前写作不做「情绪分析/AI 解读你的焦虑」：写完即存，仅此而已。

## 8. 引用清单（按首次出现）

1. Anki 手册，Deck options（Daily Limits / Maximum Reviews/Day / FSRS） — https://docs.ankiweb.net/deck-options.html
2. Anki 手册，Studying（Leeches / Falling Behind） — https://docs.ankiweb.net/studying.html
3. Anki 源码 `rslib/src/deckconfig/schema11.rs`（新卡 20 / 复习 200 / leech 8 次 / TagOnly） — https://github.com/ankitects/anki/blob/main/rslib/src/deckconfig/schema11.rs
4. Michael Nielsen, Augmenting Long-term Memory（2018） — https://augmentingcognition.com/ltm.html
5. xiaoxu, Building Spaced Review into Teaching Articles（2026-10-14） — https://quidproquo.cc/posts/learning/2026-10-14-spaced-review-in-teaching-articles-en/
6. 山东大学学生心理健康教育与咨询中心，进入考研冲刺期，考研人心态崩了怎么办？ — https://www.xljk.sdu.edu.cn/info/1008/10431.htm
7. 成都大学新闻网，研考倒计时1个月 上岸"橙子"分享冲刺"秘诀"（2024-11-21） — https://news.cdu.edu.cn/info/1002/45837.htm
8. Lally, van Jaarsveld, Potts & Wardle (2010), Eur. J. Soc. Psych. 40:998-1009 — https://doi.org/10.1002/ejsp.674
9. Singh et al. (2024), Time to Form a Habit（系统综述与元分析）, Healthcare — https://pmc.ncbi.nlm.nih.gov/articles/pmc11641623/
10. Silverman & Barasch (2023), On or Off Track: How (Broken) Streaks Affect Consumer Decisions, JCR 49(6) — https://doi.org/10.1093/jcr/ucac029 （作者 PDF：https://www.jackiesilverman.com/_files/ugd/0399b5_58713e2052ca4148891dbb00b30a8597.pdf ）
11. Dai, Milkman & Riis (2014), The Fresh Start Effect, Mgmt. Sci. 60(10) — https://doi.org/10.1287/mnsc.2014.1901
12. Wohl, Pychyl & Bennett (2010), I forgive myself, now I can study, Pers. Individ. Differ. 48(7) — https://doi.org/10.1016/j.paid.2010.01.029
13. Gollwitzer & Sheeran (2006), Implementation Intentions and Goal Achievement, Adv. Exp. Soc. Psych. 38 — https://doi.org/10.1016/S0065-2601(06)38002-1
14. Buehler, Griffin & Ross (1994), Exploring the "Planning Fallacy", JPSP 67(3) — https://web.mit.edu/curhan/www/docs/Articles/biases/67_J_Personality_and_Social_Psychology_366%2C_1994.pdf
15. Ramirez & Beilock (2011), Writing about testing worries boosts exam performance, Science 331(6014) — https://doi.org/10.1126/science.1199427
16. van Eerde & Klingsieck (2018), Overcoming procrastination? A meta-analysis, Educ. Res. Rev. 25 — https://doi.org/10.1016/j.edurev.2018.09.002
17. Fleckenstein, Liebenow & Meyer (2023), Automated feedback and writing（多层元分析）, Frontiers in AI — https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2023.1162454/full
18. Ngo, Chen & Lai (2024), AWE in EFL/ESL writing（三层元分析）, Interactive Learning Environments — https://eric.ed.gov/?id=EJ1419671
19. AI-assisted feedback in L2 writing（三层元分析, N=11,875）, System (2026) — https://www.sciencedirect.com/science/article/pii/S0346251X26000497
20. ASAKI 代码：`src/shared/review-stats.ts`、`src/renderer/shell/ReviewPage.tsx`、`src/renderer/shell/heatmap.ts`、`src/main/planning/prompt.ts`、`src/main/planning/workspace-planner.ts`、`src/main/plans/long-plan-service.ts`、`src/renderer/shell/LongPlanPage.tsx`、`src/main/scheduler/behind-schedule.ts`、`src/main/scheduler/scheduler.ts`、`src/main/butler/prompt.ts`、`src/main/butler/tools.ts`、`src/renderer/shell/TodayOverview.tsx`、`src/renderer/shell/FocusTimer.tsx`、`src/shared/workspace.ts`（行号见 §5）
21. Anki 手册，Leeches（8 次 lapse；suspend 可调） — https://docs.ankiweb.net/leeches.html
22. Anki 手册，Filtered Decks（积压分流的社区做法） — https://docs.ankiweb.net/filtered-decks.html
23. Anki 源码 `rslib/src/config/mod.rs`（`learn_ahead_secs` 缺省 1200 秒） — https://github.com/ankitects/anki/blob/main/rslib/src/config/mod.rs
24. Loop Habit Tracker（uhabits）源码与 README：`uhabits-core/.../models/Entry.kt`（SKIP 语义）、`ScoreList.kt`（分数跳过 SKIP）、`EntryList.kt`（连胜判定与数值目标扣减）、`Preferences.kt`（skip 默认关）、`uhabits-android/res/values/strings.xml`（「Skips keep your score unchanged and don't break your streak」） — https://github.com/iSoron/uhabits
25. obsidian-spaced-repetition 源码：`README.md`、`src/data/settings.ts`（`StorageType.NOTES` 默认且唯一实现）、`src/data/data-store/notes-data-store/notes-data-store.ts`（`<!--SR:...-->` 读写）、`.../question.ts`（注释示例） — https://github.com/st3v3nmw/obsidian-spaced-repetition
26. fsrs4anki 教程（desired retention 范围与保守调整建议） — https://github.com/open-spaced-repetition/fsrs4anki/blob/main/docs/tutorial.md
27. SuperMemo Help 16 存档，Plan（自动重建/挤压/Unfix） — https://super-memory.org/archive/help16/plan.htm （`help.supermemo.org` 当前版被 Cloudflare 拦，未直读）
28. supermemo.guru（Wozniak），Planning a perfect productive day without stress — https://supermemo.guru/wiki/Planning_a_perfect_productive_day_without_stress
29. supermemo.guru（Wozniak），Why is incremental reading not popular? — https://supermemo.guru/wiki/Why_is_incremental_reading_not_popular%3F
30. r/duolingo 1xs8gwz（丢 2000+ 天 streak，社区教改时间，48 分） — https://www.reddit.com/r/duolingo/comments/1xs8gwz/
31. r/duolingo 1y18pt9（病到叫救护车丢 611 天，官方 DM 特批恢复） — https://www.reddit.com/r/duolingo/comments/1y18pt9/
32. r/productivity y3eo0k（Habitica 4.5 小时睡眠周计划） — https://www.reddit.com/r/productivity/comments/y3eo0k/
33. r/GetStudying 1xxp4x7（10 个词的 FINALS PLAN 与「3 sessions, that's all」） — https://www.reddit.com/r/GetStudying/comments/1xxp4x7/
34. r/Anki 1xuh2vc（10k 积压回归，「Decide by time, not by card count」） — https://www.reddit.com/r/Anki/comments/1xuh2vc/
35. r/college 3pc83o（「endless circle」自白，2015） — https://www.reddit.com/r/college/comments/3pc83o/
36. r/college 17orcr9（连挂两次期中考后以 B 收尾的恢复叙事，973 分） — https://www.reddit.com/r/college/comments/17orcr9/
37. r/college 179ymp6（全班唯一挂科求安慰，311 分） — https://www.reddit.com/r/college/comments/179ymp6/
38. r/GetStudying 1w77fip（负罪感→更难启动，49 分） — https://www.reddit.com/r/GetStudying/comments/1w77fip/
39. r/GetStudying 1ty14ov（「Pomodoro won't work at all」） — https://www.reddit.com/r/GetStudying/comments/1ty14ov/
40. r/GetStudying 1u7f4vz（「找完美工具」即拖延） — https://www.reddit.com/r/GetStudying/comments/1u7f4vz/

## 9. 一句话结论

断签是每条学习记录 100% 会遇到的事，而产品的全部回应现在是「0 天」两个字；把 Anki 那套「缺席不罚、恢复有路、单日有顶」的默认值搬过来，再把本地已有的完成率数据接回每日规划，两件小事都长在现有字段和组件上——这就是 iter32 最值得先做的那一刀。
