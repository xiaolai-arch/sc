# 第七轮调研：错因升级 / 数据口径 / 导出兼容 / 考研阶段（iter34 候选）

- 日期：2026-11-28
- 作者：sc-research（Orca 调研 bot）
- 对应交接：sc-lead 第七轮调研（item 69），基线 1.3.0 已发布（master `ebfd0fd`）
- 分支：`xiaolai/iter34-research`（child worktree，基线 `ebfd0fd`，未推 origin）
- 与前六轮去重：理解/保持、提问/测验、启动成本、信任核验、进度可见、问责陪伴、隐私删号、创意工具坟场、本地优先信任、备份迁移、断签恢复、计划现实主义、考前窗口、回访节奏，及 1.3.0 已上线的整卷模拟、明日第一步桥、用时流畅度、量规自评、中断现场恢复。**本轮四个新角度：①错题错因（why-wrong）②数据口径诚实（stats 边界）③数据可带走（导出兼容，非云）④考研三阶段与阶段验收。**

---

## 0. 取数方式诚实声明

**管道**（本轮实际使用）：

- Anki 官方手册新版（docs.ankiweb.net，经 `/llms.txt` 索引直读 `/manual/*.md` 原文页）；GitHub 仓库经 `api.github.com` contents 接口。
- Reddit 经 `arctic-shift.photon-reddit.com` 归档 API：**7 条帖子按 id 逐条复核、1 条评论按 link_id 检索复核**，引语与原文一致（其中 1 条快照分与交接稿差 1 分：pd8vt1n 归档显示 0 分，按归档值引用）。
- HN 经 `hn.algolia.com/api/v1/items`：3 条评论逐字复核。
- 知乎：tardis 文章镜像直读 1 条（`/tardis/zm/art/604425272`）；另一条「错题本怎么做省时间？」回答镜像 500 不可达，社媒子代理仅以搜索摘要转述、**未计入正式条目**（其诚实声明保留在本报告 §2 末）。
- 论文 PDF 三篇直读抽取：**Cepeda 2008**（gwern 镜像 PDF）、**Bisra 2018**（gwern 镜像 PDF）、**Epstein 2015**（UW 课程镜像 PDF）；抽取文本存在字符间空格，已做折叠处理，语义未动。**PMC 全文页直读 2 条**（学习自错误 2025 特刊评论、数字囤积 fsQCA 2026）。其余论文仅 **Crossref 书目核验**（DOI/卷期页），原文未读，文中明确标注。
- 中文网站（新东方在线 2027 备考规划页）curl 直读全文抽取，引文逐字。
- SuperMemo 20 rules（supermemo.guru）、Andy Matuschak evergreen notes（notes.andymatuschak.org）直读。

**子代理实读范围与抽查**：开源侧 13 个仓库由子代理实读 README/源码；**协调方抽查了其中 6 项**（LeechToolkit README 原文、Simple Archiver README 原文、IELTS-practice/genanki/obsidian-archive/expiring-notes 的仓库元数据 API 返回值），抽查一致。社媒 12 条中 **8 条由协调方逐条复核**（其余 4 条为子代理实读，含 2 条 HN 评论与知乎 1 条）。

**拿不到的（如实列出）**：

1. Anki 手册新站无独立 Empty Cards 页（llms.txt 全索引无此节），其机制描述仅能引 editing.md 的交叉引用「Tools>Empty Cards」。
2. IELTS-practice 的错题雷达实现细节（统计字段）未读其数据契约文档，只读到 README 的功能句。
3. Rohrer & Taylor 2006、Butterfield & Metcalfe 2001、Cepeda 2006、Whittaker 2011、Kornell & Bjork 2007、Bjork 等 2013 六篇**原文未读**，只引用其经 Crossref 核验的书目与广为转述的核心结论，标注「书目核验」。
4. obsidian.md 首页「You own your data」一句为子代理直读，协调方未复核。
5. Super Productivity 已迁移至 `super-productivity/super-productivity`（API 301 重定向），星数/license 为迁移后仓库值。

---

## 1. 开源项目

### 1a. Anki 内置 leech：「计数→阈值→打标签→暂停」，最简可抄的错题升级机制（ankitects/anki，33,069★，2026-11-26 仍推送）

- 出处：docs.ankiweb.net/manual/leeches.md（本轮直读）。
- 原文：「Each time a review card "lapses" (is failed while it is in review mode), a counter increases. When this counter reaches 8, Anki tags the note as a leech and suspends the card. The threshold, and whether to suspend or not, can be adjusted in the deck options.」
- 重复提醒原文：「These warnings occur at **half the initial leech threshold**. For example, if you set the warning at 8 lapses, future warnings will happen every 4 lapses (at 12, 16, and so on).」
- 官方处置三分法：**Editing**（改卡片呈现，「Maybe your cards have too much information, or you're trying to memorize something without fully understanding it」）/ **Deleting** / **Waiting**（干扰对：「an English learner may have recently learned the words "disappoint" and "disappear"」，一次只学一个）。附 Soren Bjornstad《Dealing with Leeches》链接。
- **可借鉴**：错题的「二次错」要有**自动、可见、可逆**的升级：计数已达成的阈值触发标记（ASAKI 的 `priority` 已在内部升级到 0-3，`src/main/practice/practice-service.ts:233`，但学习者看不见任何升级状态）；官方三分法证明升级后的动作是「改呈现」不是「加惩罚」。
- **前提检查**：无 license/模型问题；纯规则。

### 1b. Leech Toolkit：错题生命周期的完整状态机（iamjustkoi/LeechToolkit，7★，MIT，2024-04 后不活跃）

- 出处：README（本轮协调方原文复核）。
- 原文：「**Almost-Leech Marker** — Show a marker on cards that are about to be leeched.」；「**Lapse Reverse** — Decrease or reset card lapses after a custom number of correct answers in a row.」；「**Revert/Un-Leech Cards** — Revert leeched cards when their lapse count gets below a custom threshold.」
- 到阈值动作可配：`Set Flag / Suspend / Add Tag(s) / Remove Tag(s) / Forget / Edit Field(s)`。
- **可借鉴**：三个状态语义——**预警**（Almost-Leech）、**升级**（leech）、**洗白**（连对 N 次自动撤销）——可直接映射到 ASAKI 错题：wrongCount 达阈值给「易错」可见标记；`correctStreak` 连对自动撤销标记（字段已在 `src/shared/practice.ts:202`）。小项目维护 inactive（7★）不是否定证据——语义本身在 Anki 官方文档有对应物。

### 1c. IELTS-practice：错题按题型自动聚合的「雷达」（sallowayma-git/IELTS-practice，2,395★，GPL-3.0，活跃）

- 出处：README.zh-CN.md（子代理实读，元数据经协调方复核）。
- 原文：「阅读错题雷达：根据最近阅读记录统计错题题型分布。」；英文版：「...practice records, score statistics, **mistake analysis**, data backup...」；「Use it as your daily entry point to decide what comes next — more practice, **mistake review**, or vocabulary.」
- 诚实注：数据存 localStorage（非明文文件），实现细节未读其数据契约文档。
- **可借鉴**：对低技术素养用户，「错因」不必是让用户手打标签——**按题型/科目自动聚合错题分布**是系统替用户完成归因统计的形态（「我在哪类题错得多」一眼可见）。ASAKI 复习单目前是**纯平铺列表**（`src/shared/practice-sheet.ts:55-82`），无任何聚合行。

### 1d. Anki 文本导入规格：ASAKI→Anki 零成本导出通道（ankitects/anki-manual `manual/importing/text-files.md`，本轮直读）

- 原文（File Headers 节）：「Anki 2.1.54+ supports certain headers that can be included in the text file... They consist of `#key:value` pairs and must be listed in separate lines at the top of the file.」
- 头部指令表（原文逐条）：`separator`（Comma/Semicolon/Tab/Space/Pipe/Colon）、`html`（true/false）、`tags`（「Adds the listed tags to every imported note」）、`columns`、`notetype`/`deck`、`notetype column`/`deck column`/**`tags column`**/**`guid column`**。
- GUID 往返原文：「If you export your notes with the GUID included... you'll be able to import the notes back in to update the existing notes.」
- UTF-8 要求原文：「The files must be in UTF-8 format」。
- **可借鉴**：ASAKI 的练习集/错题本导出为**带 #headers 的 TSV**，Anki 23.10+（桌面）与 AnkiMobile/AnkiDroid 原生识别，**不需要写任何转换器**；错因/标签放 `tags column`。这是「数据可带走」的最低成本形态，也是**移动端复习的非云路径**（导出文件进 Anki 手机版，绕开云同步拒收区）。

### 1e. Anki 官方导出：明文是一等格式＋分享时剥离调度（anki-manual `manual/exporting.md`，本轮直读）

- 明文往返原文：「If you choose **"Notes in Plain Text"**, Anki will write the contents of the notes into a text file. Each field is separated by a tab. If you edit the resulting file and don't modify the first field, you can later import that file back into Anki and Anki will update your notes based on your edits...」
- 打包格式原文：「A "packaged deck" consists of cards, notes, note types, and any sounds or images bundled up into a file ending with .apkg or .colpkg」；分享语义：「Anki will assume that you are sharing the deck with other people, and will **remove the entire scheduling information**, including marked and leech tags.」
- **可借鉴**：①「明文可编辑后导回」的往返承诺值得写进 ASAKI 的导出说明；②**导出分享时不带私有调度状态**（wrongCount/stabilityDays 不外泄）——隐私与误解双防。

### 1f. 数据所有权口径：Obsidian / Joplin / Logseq 高度一致（子代理实读）

- Obsidian 官网原文：「**Your thoughts are yours.** Obsidian stores notes privately on your device...」「Obsidian uses open file formats, so **you're never locked in. You own your data for the long term.**」（协调方未复核，见 §0 声明 4）
- Joplin README：「The notes are in Markdown format ... can be copied, tagged and modified either from the applications directly or from your own text editor.」导出清单：JEX（tar）/raw 目录/HTML/PDF。
- Logseq：「A privacy-first, open-source platform... privacy, longevity, and user control... Markdown and Org-mode」（AGPL-3.0）。
- 反向生态位：genanki（2,829★，MIT）「allows you to programatically generate decks in Python 3 for Anki」；obsidian-spaced-repetition（2,628★，MIT）：SR 调度状态完全活在明文 md（`Question::Answer` 行内格式）。
- **可借鉴**：「你的数据以开放格式存在、永不锁定」是本地优先产品的**标配承诺句**；ASAKI vault 已满足事实，缺的是把它**说出来**＋补上结构化导出（1d）。

### 1g. Anki 的库维护「体检」三件套（anki-manual `manual/files.md`、`manual/browsing.md`，子代理直读）

- Check Database 原文：「Checking the database ensures the file has not been corrupted, rebuilds some internal structures, and optimizes the file.」「If you want to clear old tags out from the list that are no longer in use, checking your database is one way to do it.」自动面：「Anki will automatically optimize your collection **once every 2 weeks**... but it does not check for errors or rebuild the tag list when automatically optimizing.」
- Clear Unused Tags（浏览 Notes 菜单）：「Remove all tags from the sidebar that are not used by any notes.」
- Empty Cards：新站无独立页，仅 editing.md 交叉引用「you will need to use Tools>Empty Cards afterwards」（§0 声明 1）。
- **可借鉴**：官方形态＝**手动触发的体检命令**（找无用物→列出→用户处置）＋**低调的自动维护**（不自动删内容）。这是 ASAKI「库的长期维护」该抄的形状。

### 1h. Obsidian 归档插件两枚：可逆移动是归档的正确语义（子代理实读，协调方抽查）

- **Simple Archiver**（mfarr/obsidian-archive，15★，GPL-3.0）原文：「moves files or an entire folder to an archive folder that you configure. The items are moved to the **same relative path** in the archive folder. Conversely, items that have been archived can be **moved out of the archive to their original location**.」Auto-archive：「Conditions can be based on **file age (days since last modified)** and/or a file name regex. Rules are evaluated on a schedule (default every 60 minutes).」
- **Expiring Notes**（joerncodes/obsidian-expiring-notes，19★，无 SPDX 声明，beta）原文：「automatically delete or archive notes that have "expired"... uses a predefined frontmatter key like so: `expires: 2021-01-01`」。
- **可借鉴**：①归档＝**保留相对路径的移动＋可逆**，不是删除；②「过期」声明可以写在 frontmatter；③**auto-delete 语义拒绝**（见 §6 拒收），只借「archive-as-move」。

### 1i. Super Productivity：日终回顾是流程第 4 步（super-productivity/super-productivity，24,137★，MIT，2026-11-27 推送）

- README 原文：「4. **Finish the day.** Review what you got done, then log it: export a timesheet or send worklogs to...」「Your data stays on your device unless you choose to sync it.」
- 诚实注：grep 命中的只有**日**级回顾；GTD 式 weekly review 的开源实现本次未找到（子代理声明 12）。
- **可借鉴**：「回顾→落盘」作为仪式步骤而非可选功能；「数据留在你的设备上」产品句。

### 1j. FSRS 的 desired retention↔workload：间隔-工作量的官方定量表述（docs.ankiweb.net deck-options，本轮直读）

- 原文：「The default value of 90%... As desired retention approaches 100%, **the workload increases drastically**. For this reason, we suggest you be conservative... recommend you keep it lower than 97%.」
- 「Help Me Decide」原文：「you can ask yourself **"How many reviews can I realistically do per day?"** ... and check the corresponding workload graph」；最新版支持 per-deck 保留率。
- **可借鉴**：这是「复习强度该和目标日期、可用时间挂钩」的成熟表述；但**不借**它的「参数旋钮进 UI」——见 §6 拒收 2（与已上线回访阶梯的「界面上不出现任何算法名词」口径冲突）。

---

## 2. 社交媒体（12 条，8 条经协调方逐字复核）

### 2a. 错题错因（3 条）

**① r/GetStudying：「写下了错因，但只是点头式重读，照错不误」**（1 分快照 / 2026-10-16 / u/Reasonable_Bag_118）
https://www.reddit.com/r/GetStudying/comments/1x7gpht/redid_the_exact_question_i_bombed_on_wednesday/
> 「On wednesday I got 3/8 on a stats question, wrote down everything I missed... Fixed two of the three things on my list. And the third one, checking the assumption before picking the test, I skipped again. **Literally the thing I wrote down, like I'd read my own correction on wednesday and just nodded at it like I'd learned it.**」

——记录错因本身不生效；生效的是他后来自己发明的**隔天合上笔记重做、全对才划掉**（原帖自述）。对应 ASAKI：错题本的重做验证闭环（现在错题复习就是重做，但没有「写下的错因是否被这次重做修复」的验证视图）。

**② r/GetStudying：一行错因日志「可能是我价值最高的习惯」**（0 分快照 / 2026-10-01 / u/Ghost5x，帖 "Do you bother keeping a 'mistake log'..."）
https://www.reddit.com/r/GetStudying/comments/1wv4v1n/do_you_bother_keeping_a_mistake_log_or_making/pd8vt1n/
> 「i keep a light version of one and it's probably the highest value habit i have. not every question though, **just the ones where i realize i misunderstood the concept. one line: what the concept was, and why i got it wrong. takes 30 seconds.** just reading the explanation and moving on feels productive but it doesn't stick, you'll miss the same type next week. **the log only works if you actually reread it before practice sessions**」

——错因日志的完整方法论：**只记概念级错误＋一行「是什么概念、为什么错」＋30 秒内完成＋练习前重读**。「只看解析就过」被点名为同错再犯的根源。

**③ 知乎：《学霸高效学习法之「错题本」》**（镜像页可核验 / 2023-04-17 / 作者宝丫妈咪；赞同 18·收藏 23 为镜像快照）
https://www.zhihu.com/tardis/zm/art/604425272
> 「改错时机，根据我多年来总结的经验教训，**天天清，周周清，月月清效果最好**。即: 当日记错改错，一周和一个月后两次**在不复习的情况下重做一遍**，检查效果最好。」
> 「三、及时标出已经会了的「错题」，**让错题本变薄** 错题本不是一个让学生永远做下去的习题集，而是根据掌握程度及时「清空」，最终错题本会越用越薄直到毫无用处。」
> 「四、二次以上错题的处理 如果改过的错题仍然出错的话，就需要**将错题升级，并做上记号，大考前这些题属于必看必做题目**。通常二次出错的题目已经基本可以排除注意力不集中，阅题方面的问题，学生必须把注意力放到相关的基础知识、公式使用上，真正找到知识漏洞。」

——中文语境错题方法论的完整闭环：**定期无提示重做＋已掌握的清空变薄＋二次错升级标记（且二次错基本排除粗心，指向知识漏洞）**。三条与 ①②、与论文侧 Bisra（§4a）互相独立又同向。

### 2b. 数据可带走 / 锁仓焦虑（3 条，全部 HN）

**④ HN：「终于到了该走的时候——或至少先备份」**（45 分快照 / 2023-07-07 / u/gitgud，Ask HN: How did you migrate off Evernote?）
https://news.ycombinator.com/item?id=36628284
> 「After hearing the news I think it's finally time to move on, or at least **backup my data**. There's a few export options and 3rd party tools. Any have any recommendations?」

——服务动荡直接触发迁出；导出选项是工具信任的显式议题。

**⑤ HN：「这些工具是信息黑洞，我直接删了」**（同帖评论 / u/lylejantzi3rd）
https://news.ycombinator.com/item?id=36628928
> 「After looking at the data, I realized that these tools are **black holes of information. Things go in and never come back out again.** Habitually storing information I'll never look at again is the **digital version of hoarding**. It was a compulsion and I needed to stop. So I deleted it.」

——「可取出性」的极端反面教材：取不出来的数据被用户自己定性为囤积并以删除收场。与 §2c 的囤积主题直接相连。

**⑥ HN：OneNote「你的笔记基本上被锁进去了」**（母帖 "Managing my personal knowledge base" 348 分快照 / 2020-01-10 / u/mkl）
https://news.ycombinator.com/item?id=22010925
> 「I wouldn't trust anything important to OneNote... **Your notes are basically locked in.** You can sort of print to PDF, but it uses different pagination... **PDFs are inserted as bitmap images** instead of vector format, and text is only sometimes searchable.」

——「locked in」逐字原声；导出格式劣化（位图化、不可检索）是锁仓焦虑的具体形态。ASAKI 现有的卡组 PDF 导出正属于这种「能看不能用」的形态——信任感需要更结构化的出口。

### 2c. 库的长期维护 / 数字囤积（3 条）

**⑦ r/ObsidianMD：「迁移了 6000+ 条笔记，现在淹死在里面」**（46 分快照 / 2025-07-22 / u/FlyingWombat77，36 评论）
https://www.reddit.com/r/ObsidianMD/comments/1m6gh00/migrated_6000_notes_to_obsidian_now_im_drowning/
> 「Everything is a huge, disorganized mess. [...] In a perfect world, I'd just sit down for a month and fix everything. **But that's not real life.** [...] Tips for shutting up the *"your vault isn't finished!!"* voice in my brain?」

——十年多工具迁移积压的真实痛苦：清理被体验成**永远做不完的债务**，还伴随内疚式自我声音。「一个月修完」在现实中不可行→增量的小仪式才是可行解。

**⑧ 同帖高赞区：「绝大多数是垃圾，偶尔有宝石」**（6 分快照 / u/karatetherapist）
https://www.reddit.com/r/ObsidianMD/comments/1m6gh00/migrated_6000_notes_to_obsidian_now_im_drowning/n4kod2j/
> 「I imported a billion notes from Onenote going back to before the writing of the Bible... **Most are junk, but sometimes, there's a gem.** It helped me realize that some of the stuff I take notes on ain't worth it.」

**⑨ r/ObsidianMD：「我的想法全是垃圾，所以我就这样住着」**（0 分快照 / 2026-06-15 / u/athoughtfornoone，帖 "How do you keep your vault from turning into a junk drawer?"，39 评论）
https://www.reddit.com/r/ObsidianMD/comments/1u6dwy1/how_do_you_keep_your_vault_from_turning_into_a/orrr7gn/
> 「Uhhh well all my thoughts are junk, so... **I just live with it**」

——清理失败的麻木态；提问帖本身（39 评论）证明「防抽屉化」是普遍焦虑。三连的教训：维护不能靠「一次性大扫除」，要靠**低成本、可坚持的小动作**（归档一条已掌握错题≈10 秒）。

### 2d. 跨周节奏 / 平台期 / 休息（3 条）

**⑩ r/GetStudying：「休整一周的负罪感」**（6 分快照 / 2026-01-24 / u/BlueCactus_819）
https://www.reddit.com/r/GetStudying/comments/1qlddqq/how_do_i_stop_feeling_guilty_when_i_take_a_break/
> 「For 2 weeks I pulled all-nighters to finish a whole module... I want to take a break for a week because I do think I badly need it **but I feel so guilty for it**. If I don't take a break and continue studying, I probably won't retain much and would suffer a burn out soon.」（最高赞回复：「It's protective to rest, not dangerous.」5 分）

**⑪ r/GetStudying：「学 3 小时毫无进展」**（63 分快照 / 2026-02-25 / u/Salt-Maximum-758，32 评论）
https://www.reddit.com/r/GetStudying/comments/1rej64r/i_study_for_3hrs_with_no_progress/
> 「it may seem like I study for 3hrs or longer hours, but **I am just stuck at one topic** and Idk how fast the time goes and then I'm exhausted!!」

**⑫ r/GetStudying：倦怠的长周期形态**（9 分快照 / 2026-09-23 / u/overconfidentalien）
https://www.reddit.com/r/GetStudying/comments/1wo9pi7/how_to_get_over_an_academic_burnout/
> 「After that incident I was unable to study as much as I used to. [...] And my mind's been so foggy and overwhelmed that I am **caring less day by day** and have an outrageous phone addiction?」

——平台期体感＝高时长×零进展×耗竭；倦怠以「月」为单位延续。共同含义：**长周期需要「阶段」和「验收」来制造进展感**——没有中间里程碑，3 小时和 3 周都感觉是原地踏步。

**社媒子代理诚实声明**（要点保留）：知乎回答镜像 500 不可达，仅文章镜像可用；「study plateau」检索多次超时，D 角度以 no-progress/burnout/rest-guilt 覆盖；A 角度 Reddit 样本全部来自 r/GetStudying（r/Anki、r/math、r/college 检索因服务超时未完成）；低分帖（①②）按「内容优先于热度」取舍；分数均为归档快照值。

---

## 3. 网站/博客

### 3a. 新东方在线：考研三阶段规划的工业化口径（kaoyan.koolearn.com，本轮全文直读）

- 出处：https://kaoyan.koolearn.com/20261125/1987089.html （2027 考研复习规划备考攻略）
- 三阶段原文：「考研政治备考通常分为三个阶段：基础阶段、强化阶段和冲刺阶段。**基础阶段(建议5-6月)的任务是熟悉教材内容、建立知识框架，不追求记忆细节;强化阶段(建议7-9月)的任务是通过练习和背诵巩固理解，逐步提高做题速度和正确率;冲刺阶段(建议10-12月)的任务是保持对高频考点的熟练度，适应考试节奏。**」
- 时间配比原文：「建议将总复习时间的比例分配为**3:4:3**。如果某一阶段的任务未按计划完成，可在下一阶段的前两周内集中补上，**但不宜超过两周**。」
- 阶段验收原文：「每个阶段结束后，需要有一个明确的验收方式」——基础阶段结束：「尝试**在不翻书的情况下，用2-3句话概括每章的核心主题**」；强化阶段结束：「可用**一套近年真题进行限时练习，记录各题型的用时和正确率**」；冲刺阶段结束：「可**对照错题记录检查是否已掌握所有错题对应的知识点**」。
- 进度检查原文：「建议**每两周安排一次进度检查**...如果进度落后超过1周...需要适当调整下一阶段的任务量或延长该阶段的时间；如果进度超前超过1周，**不要提前进入下一阶段**，可将多余时间用于回顾近期错题」。
- **可借鉴**：三阶段各自有**可执行的验收动作**，而且三个验收动作恰好逐一套在 ASAKI 已上线的三块能力上——不翻书概括（笔记/自测）、限时真题记用时（iter33 整卷模拟＋用时）、对照错题检查（错题本）。1.3.0 造好了积木，缺的是把它们按阶段串起来的仪式。

### 3b. SuperMemo 20 条知识表述规则（supermemo.guru，本轮直读）

- 出处：https://supermemo.guru/wiki/20_rules_of_knowledge_formulation （Anki leech 手册页官方引用的改卡方法）
- Summary 原文：「**don't learn things that you do not understand** learn before you memorize start from basics before going into complexities **keep questions simple**...」
- **可借鉴**：错题升级后的处置是「改表述」（1a 的 Editing 分支），不是加惩罚；「最小信息原则」给错题改卡提供口径。

### 3c. Andy Matuschak：Evergreen notes（notes.andymatuschak.org，本轮直读）

- 出处：https://notes.andymatuschak.org/Evergreen_notes
- 原文：「Evergreen notes are written and organized to **evolve, contribute, and accumulate over time, across projects**.」「It's hard to write notes that are worth developing over time.」原则：「Evergreen notes should be **atomic** ... concept-oriented ... densely linked」。
- **可借鉴**：库维护的正面标准不是「干净」而是「可积累」——归档/清空的目的是让留下的条目继续演化，不是追求空。给「变薄」类功能定调：变薄是手段，留下的还能长大才是目的。

### 3d. Anki leeches 手册页（docs.ankiweb.net，与 1a 同源）

- 三分法原文（Editing/Deleting/Waiting）与 interference 释义见 1a；本页被 Anki 官方作为「错题处置」的教学页引用，出处：https://docs.ankiweb.net/manual/leeches.md

---

## 4. 论文

### 4a. 错因/自我解释

**Bisra, Liu, Nesbit, Salimi & Winne 2018**——《Inducing Self-Explanation: a Meta-Analysis》（Educational Psychology Review 30:703-725，DOI 10.1007/s10648-018-9434-x；**本轮取回 PDF 原文抽取核验**）

- 原文逐字：「Our systematic search... identified **69 effect sizes (from 64 research reports)**... The overall weighted mean effect size using a random effects model was **g = .55**.」
- 调节变量发现（原文）：「the prompts eliciting **conceptual self-explanations** (z = 3.284, p = .001) were more effective than those inducing **meta-cognitive self-explanations**」。
- 对产品的含义：错因要写「**哪个概念没懂、为什么**」（概念级），而「我又粗心了」（元认知归因）是效果更差的写法——与社媒 ② 的方法论逐字吻合（「not every question though, just the ones where i realize i misunderstood the concept」），与知乎 ③「二次错基本排除粗心」一致。

**Butterfield & Metcalfe 2001**——《Errors committed with high confidence are hypercorrected.》（JEP:LMC 27(6):1491-1494，DOI 10.1037/0278-7393.27.6.1491；**书目核验**，原文未读）

- 核心结论（广泛转述，标注）：**高置信的错误在反馈后被纠正得最好（hypercorrection）**——「有把握却错」的题是最值得投入的错误。
- 与 ASAKI 的接点：`confidence` 字段已在（`src/shared/practice.ts:176`），`sure-wrong` 已进难度加权（`src/main/practice/schedule.ts:178-184` `SURE_WRONG_EXTRA_STEP`）与校准卡（`src/renderer/shell/calibration.ts:76-80`），但**没有反哺错题本的排序/标记**——最有价值的错误在错题单里和其他错误长得一样。

**Learning from errors 特刊评论 2025**（British Journal of Educational Psychology，PMC11803059，**PMC 全文页直读**）

- 原文（摘要）：「errors and failures are indispensable parts of the learning process, the current theoretical models and empirical research remain inadequate to provide a comprehensive perspective for learning from errors... this special issue collects 11 research papers...」

**Kornell & Bjork 2007**——《The promise and perils of self-regulated study》（Psychonomic Bulletin & Review 14:219-224，DOI 10.3758/BF03194055；**书目核验**）＋ **Bjork, Dunlosky & Kornell 2013**——《Self-Regulated Learning: Beliefs, Techniques, and Illusions》（Annual Review of Psychology，DOI 10.1146/annurev-psych-113011-143823；**书目核验**）：自我调节学习的「错觉」族——把「看过解析」「点头读懂」当成学会，正是社媒 ①「nodded at it like I'd learned it」的学术命名。

### 4b. 数据口径/自我追踪

**Epstein, Ping, Fogarty & Munson 2015**——《A Lived Informatics Model of Personal Informatics》（UbiComp '15，DOI 10.1145/2750858.2804250；**本轮取回 PDF 原文抽取核验**）

- Lapsing 定义（原文）：「The **lapsing stage occurs when someone stops actively using a self-tracking tool. Lapsing typically begins with barriers to collection, but can also be caused by barriers to integration or reflection.**」
- 四类 lapse 原文：「We later describe four categories of lapses: **forgetting, upkeep, skipping, and suspending**.」其中 **upkeep**（维护负担）直接对应「库的长期维护」：维护成本本身是弃用触发器。
- Resuming 原文：「After a longer lapse (e.g., stopping tracking for months), the self-tracker may not necessarily resume collecting more data. Instead, they may resume integrating or reflecting upon their previous data.」——长时间中断后回归者先看旧数据、不急着记新数据，恢复动线要照顾这个形态。

**数字囤积 fsQCA 2026**（Frontiers in Psychology，PMC13201440，**PMC 全文页直读**）

- 原文（摘要）：「Individuals' excessive preservation and accumulation of digital information may result in **digital hoarding behavior**... due to **concerns about losing potentially useful information**... identifying three configurations that drive a high level of digital hoarding behavior in the workplace.」
- **可借鉴**：囤积的驱动是「怕丢」——归档功能必须**先证明数据不会丢**（可逆移动、明文可见）才有人敢用；「删除」永远不做（§6 拒收）。

### 4c. 跨周间隔与阶段

**Cepeda, Vul, Rohrer, Wixted & Pashler 2008**——《Spacing Effects in Learning: A Temporal Ridgeline of Optimal Retention》（Psychological Science 19(11):1095-1102，DOI 10.1111/j.1467-9280.2008.02209.x；**本轮取回 PDF 原文抽取核验**）

- 原文逐字：「more than **1,350 individuals** were taught a set of facts and—after a gap of up to 3.5 months—given a review. A final test was administered at a further delay of up to 1 year.」
- 核心发现（原文）：「At any given test delay, an increase in the interstudy gap at first increased, and then gradually reduced, final test performance. **The optimal gap increased as test delay increased. However, when measured as a proportion of test delay, the optimal gap declined from about 20 to 40% of a 1-week test delay to about 5 to 10% of a 1-year test delay.** The interaction of gap and test delay implies that many educational practices are highly inefficient.」
- 对产品的含义：**复习间隔应随「距目标日」的远近伸缩**；ASAKI 回访阶梯 3→7→14→30 是按比例递增的固定阶梯，与该发现的形状一致（数值上 7/14≈前段 1 周目标的 20-40% 区间、30 天≈1 月目标的中段），**现有阶梯不需改**（§6 拒收 2 的依据）——但「阶段」概念（距考试数月的宏观节奏）在该文献里没有对应物，属于产品侧空白。

**Cepeda, Pashler, Vul, Wixted & Rohrer 2006**——《Distributed practice in verbal recall tasks》（Psychological Bulletin 132(3):354-380，DOI 10.1037/0033-2909.132.3.354；**书目核验**）：分布练习元分析，354 项研究；间隔效应的奠基引用。

**Rohrer & Taylor 2006**——《The effects of overlearning and distributed practise on the retention of mathematics skills》（Applied Cognitive Psychology 20:1209-1224，DOI 10.1002/acp.1266；**书目核验**）：数学技能上**过度学习（overlearning）对长期保持贡献很小，分布练习才是主效应**——支持「阶段切换去学新东西，而不是在同一题上继续堆」的节奏建议。

**Whittaker 2011**——《Personal information management: From information consumption to curation》（Annual Review of Information Science and Technology 45:1-62，DOI 10.1002/aris.2011.1440450108；**书目核验**）：PIM 的核心困难是**从「囤」到「管」的转化**——多数人只收集不整理；与社媒 ⑦⑧⑨、4b 囤积研究同向。

---

## 5. ASAKI 现状与落差（file:line 均核于 master `ebfd0fd` 的 child worktree）

| # | 落差 | 现状（证据） | 文献/生态参照 | 可落地性 |
|---|------|-------------|---------------|----------|
| G1 | **错题只有计数没有「为什么」** | `PracticeMistake` 有 wrongCount/correctStreak/priority/stabilityDays/difficulty（`src/shared/practice.ts:188-231`），**无 cause/错因字段**；confidence 有（`:176`、`:252`）且已进难度加权与校准卡，但没落到每条错题的「为什么错」上；复习单是平铺列表，只显示「错 N 次 · 优先级 N · 状态」（`src/shared/practice-sheet.ts:78`），无错因行、无按科目/题型聚合 | 一行错因方法论（2a ②③）；概念级>元认知归因（4a Bisra）；自动聚合的雷达（1c） | **极小**：错题记录时加一行可选文本；渲染随字段出现 |
| G2 | **错题升级对学习者不可见** | `priority` 0-3 已在错一次时 +1（`src/main/practice/practice-service.ts:233` `Math.min(3, priority+1)`），答对 -1（`:253`）——但 UI/复习单没有任何「升级/顽疾」状态显示 | Anki leech 阈值→tag（1a）；Almost-Leech/洗白状态机（1b）；知乎「二次错升级＋大考必看」（2a ③） | **极小**：priority===3（或 wrongCount≥3）渲染一个「顽疾」标记；连对 N 次自动撤销可用现有 correctStreak |
| G3 | **周数据的分母口径不一致，「任务完成 M/N」会失真** | 周复盘统计 `weekTasks` 把**全部无日期积压任务**计入分母（`src/shared/weekly-stats.ts:76-78` `task.due === undefined` 全进 `weekTasks`），而同文件里规划用的 `recent7DayCompletion` 明确排除无日期任务（`:126-136` 注释「undated backlog is never part of a day's plan... a standing backlog cannot drag the rate down forever」）——同一文件里两个口径并存 | 信任核验口径（第三轮）；Anki「数据不吓人」默认值（第五轮 1.1） | **极小**：分母改用同一规则，或拆成两行并注明积压另计 |
| G4 | **周正确率把重复作答全部计入，不按「每题每日只计一次」去重** | `accuracy = correct / answered`，`answered` 为本周全部 attempts（`src/shared/weekly-stats.ts:94-111`），同一题当天重答多次会稀释/推高比例 | Anki True Retention：「**Only one review per day - the first one - counts.**」（第六轮 1g/3d 引文，本轮未重取）；recent7DayCompletion 的 planned<5→null 先例（`:133-136`） | **小**：按 (questionId, 当日) 取首次，或加最小样本门槛（n<5 只显示题数不显示%） |
| G5 | **数据出不去：只有卡组 PDF 和复习单 md** | 导出面仅 deck→PDF（`src/main/deck-browser.ts:14`、`:320` `exportDeckPdf`）与错题复习单 md（`src/main/practice/practice-service.ts:856-894`）；全库 grep 无 TSV/CSV/apkg 字样 | Anki #headers 原生识别（1d）；明文一等导出＋分享剥调度（1e）；Obsidian/Joplin/Logseq 口径（1f）；HN「black holes / locked in」（2b ④⑤⑥） | **中**：导出为带 #headers 的 TSV，落 vault 内 `practice/exports/`（明文＋进备份） |
| G6 | **任务/错题只生不清，「库」没有变薄的机制** | 任务按天落 `tasks/YYYY-MM-DD.md` 永久累积（`src/main/workspace/paths.ts:8`、`:73-79`），done/skipped 无归档；错题 resolved 后仍留在 mistakes.md（复习单过滤 active，`practice-service.ts:865`，但文件不瘦身）；知识主题有合并去重（`src/shared/knowledge.ts:69-79` merge、KnowledgePage.tsx:165 有 UI）但**没有过期/停滞的提醒面**；记忆 profile 只按桶限 5 条 newest-first（`src/main/memory/profile.ts:11-22`） | 错题本变薄（2a ③）；6000 笔记溺水（2c ⑦）；lapsing 的 upkeep 类别（4b Epstein）；Anki 体检三件套（1g）；可逆归档语义（1h） | **中**：已掌握错题「归档变薄」（显式点击、可逆移动到 archive 文件）；任务日文件的月度归档可后置 |

---

## 6. iter34 候选排序（P0-P3 打包，每条带验收草案素材）

**排序原则**：证据强度 × 改动大小 × 三条铁前提（vault 明文直读、本地优先、低技术素养 × Windows）× 不翻案（已拒方向无新证据不复活；已上线设计不无据改动）。

### P0 「错题为什么错」一行＋顽疾升级可见＋变薄（G1＋G2＋G6 的错题面）

- 做什么：
  1. 错题记录时多一个**可选一行**「错因」（自由文本，≤40 字；placeholder 给示例「哪个概念、为什么」，不做按钮预设——Bisra 发现概念级归因优于元认知归因，预设按钮会诱导「粗心」这类元认知标签）；
  2. 错题本与复习单显示错因行，复习单顶部加一行**按科目聚合**（「数学 8·英语 3」，n≥2 才显示科目行）；
  3. `priority===3` 渲染「顽疾」标记（内部状态已存在，零新增状态）；`correctStreak≥2` 自动撤销顽疾标记（连对洗白）；
  4. 错题本加「清空已掌握」动作：resolved 错题**可逆移动**到 `practice/mistakes-archive.md`（保留字段、追加式、带归档日期），mistakes.md 变薄。
- 证据链：一行错因 30 秒（2a ②）→ 只记概念级（4a Bisra 概念>元认知）→ 升级可见＋大考必看（2a ③）→ 连对洗白（1b）→ 变薄（2a ③＋4b 囤积「怕丢」所以必须可逆）。
- **验收草案素材**：
  - 字段：`PracticeMistake.cause?: string`（trim 后空串不落盘，沿 checkpoints 的宽容读写先例 `src/shared/practice.ts:52-58`）；
  - 逐字节回归：无错因、无顽疾、无归档操作时，错题本/复习单渲染与 1.3.0 逐字节一致；
  - 聚合行：单科目或 n<2 时不出现聚合行（不画空图先例）；
  - 归档：移动前后字段不丢；archive 文件也明文可读；备份覆盖说明文案同步更新（iter31 口径）。

### P1 周数据口径修正（G3＋G4，「数据可信度」）

- 做什么：
  1. 周复盘「任务完成 M/N」分母与规划口径对齐：**无日期积压任务不计入 N**（或拆两行：本周计划内 M/N＋积压 K 件（不计入）），采用 `recent7DayCompletion` 已有的同一规则；
  2. 周正确率按**每题每日只计首次**去重（Anki True Retention 规则），并在 n<5 时只显示题数、不显示百分比（沿用 planned<5→null 先例）。
- 证据链：同文件双口径（G3 file:line）→ Anki「每日只计第一次」（4b 引文）→ 小样本不冒充事实（weekly-stats.ts:133-136 自家先例）→ 误读的代价是信任（第三轮「信任核验」）。
- **验收草案素材**：
  - `weeklyOverview` 的 tasksTotal 定义变更写在函数注释（「与 recent7DayCompletion 同规则」）；
  - 有无积压两种快照测试；n<5 时 practiceLine 渲染「本周还没有足够的练习数据」而非百分比；
  - 口径改动**只影响展示与提示文案，不动调度与任务数据**。

### P2 数据可带走：Anki 兼容 TSV 导出＋所有权一句话（G5）

- 做什么：
  1. 练习集/错题本新增「导出 TSV」：文件落 vault `workspaces/<id>/practice/exports/<set>-YYYY-MM-DD.tsv`，带 `#separator:tab`、`#html:true`、`#columns:正面/背面/解析/标签`、`#tags column:4`、`#deck:<科目>` 头部；**不导出调度字段**（wrongCount/stabilityDays 留在 ASAKI，照 1e 分享剥调度口径）；
  2. 设置页/导出卡片加一句话所有权说明（「数据以 Obsidian 可读的 markdown 存在你的电脑上，可随时导出」），句式参照 1f 三家口径。
- 证据链：#headers 原生识别零转换器（1d）→ 明文一等＋往返承诺（1e）→ 「black holes / locked in」的用户代价（2b ④⑤⑥）→ 「never locked in」的行业口径（1f）→ 这也是**移动端复习的非云解法**（TSV 进 AnkiMobile/AnkiDroid）。
- **验收草案素材**：
  - 导出文件 UTF-8 无 BOM；TSV 字段内换行转 `<br>`（1d「Use HTML new lines」）；
  - 验收动作：导出文件在 Anki 23.10 桌面版导入为可学习卡组（字段数正确、标签进 tags、中文不乱码）；
  - 分享语义：导出文件不含任何调度字段（grep 验证）；
  - 逐字节回归：无导出操作时一切照旧。

### P3 考研三阶段＋阶段验收（G6 的节奏面，动线不做）

- 做什么：
  1. exam 项目加可选 `phase`（基础/强化/冲刺，用户或阿咲在对话里设置，卡片显示）；
  2. 阶段设置/切换后的第一次周复盘，阿咲问一次该阶段的**验收问题**（照 3a 原话：基础→「不翻书能概括每章核心主题吗」；强化→「要不要用一套近年真题限时练，我帮你记用时和正确率」（接 iter33 已上线能力）；冲刺→「对照错题记录检查是否已掌握所有错题对应的知识点」（接错题本））；点过不再问（iter32 P3 考前写作的一次性先例）；
  3. 不做进度落后/超前的自动判定（3a 的 ±1 周规则交给阿咲在对话里依据已有完成率数据说，不进硬逻辑）。
- 证据链：三阶段工业化口径（3a）→ 各阶段验收恰好套在已上线三块能力上（3a 原文↔整卷模拟/用时/错题本）→ 平台期与倦怠的月尺度体感（2d ⑩⑪⑫）→ Cepeda 2008 支持现有回访阶梯形状、不支持改造它（4c）。
- **验收草案素材**：
  - `workspace.phase?: string`（限定三值，缺省不序列化，沿 `strictMastery` 先例）；
  - 一次性验收问句记 `phaseAskedAt`，同 iter32 P3 的「点过就不再问」；
  - 无 phase 的 exam 项目一切照旧（逐字节回归）；
  - 前提检查：明文（workspace.md frontmatter）、本地、低技术素养（一次对话，无新面板）。

### 拒收清单（进非目标）

1. **AI 自动错因归类/自动判错因**：属于「不做 AI 作文打分」同族——AI 给你的错误贴标签不可核验，且 Bisra 发现**元认知归因效果劣于概念级自我解释**（AI 更容易产出「粗心了」式标签）；错因必须是学习者自己的话（知乎 ③「学生必须把注意力放到相关的基础知识...真正找到知识漏洞」）。阿咲可以在**对话里**帮用户想措辞，不做自动归类。
2. **把回访阶梯改成保留率旋钮/接入 FSRS**：已上线阶梯是刻意设计（revisit.ts:1-5「no scoring, no tuning, no model... 界面上不出现任何算法名词」）；Cepeda 2008 的比例递减发现与现有 3→7→14→30 的形状一致，**没有证据表明需要改造**；FSRS 的 desired retention 旋钮（1j）是成熟方案但与本产品「不出现算法名词」的已上线口径冲突。留观不做。
3. **自动过期/自动删除任何 vault 数据**（Expiring Notes 的 auto-delete 语义）：归档只做**显式触发的可逆移动**；「怕丢」是囤积的根因（4b），自动删除直接激活它。
4. **全库笔记自动重组/批量搬家**：6000 笔记级的大扫除（2c ⑦）是 Obsidian 的领域；ASAKI 的维护面只到自己写的 tasks/practice/memory 文件，vault 里的用户笔记一个不碰（备份轮「只动自动备份目录里名字匹配的文件夹」同一原则）。
5. **错题排行榜/分享卡/打卡道具**：第五轮反功能复核已拒（本地优先无分享面；道具化把修复变商品），本轮无新证据。
6. **云同步/多设备实时同步**：产品不变量；移动端需求由 P2 的 Anki 兼容导出（非云路径）承接。
7. **预测「按当前节奏你将考 X 分」**：第五轮已拒（完成率回灌只给事实行）；Anki Simulator 类曲线展示（1j 旁证）同样不做。

---

## 7. 反功能复核（每项候选对照三条铁前提）

- **P0**：明文 ✓（cause 是 md 字段）；本地 ✓；低技术素养 ✓（可选一行，30 秒口径）。反向风险：错因行变成自我批评的入口——placeholder 明确写概念级示例（「导数链没拆完」而非「太粗心」）；顽疾标记措辞中性（是「题的属性」不是「人的评价」，Anki 的 leech 同样是给卡打标签）。
- **P1**：明文 ✓；本地 ✓；低技术素养 ✓（口径修正对用户不可见，只让数字更诚实）。反向风险：口径变化让老用户发现「数字变了」——在周复盘文案里说一次（「从本周起积压任务不计入完成率分母」）。
- **P2**：明文 ✓（TSV 落 vault、进备份）；本地 ✓；低技术素养 ✓（一键导出）。反向风险：用户误以为导出=同步——说明句明确「这是一次性文件，不会自动更新」。
- **P3**：明文 ✓；本地 ✓；低技术素养 ✓（无新面板，问答一次）。反向风险：阶段变成新的打卡压力——阶段验收只在切换时问一次；无「进度落后」的自动判定（拒收面）。

---

## 8. 引用清单

**开源项目**（标注※者为子代理实读、协调方未复核原文，其余协调方复核或直读）
1. Anki leeches 手册页（ankitects/anki-manual，docs.ankiweb.net/manual/leeches.md）— https://docs.ankiweb.net/manual/leeches.md
2. LeechToolkit（iamjustkoi/LeechToolkit，7★，MIT）README — https://github.com/iamjustkoi/LeechToolkit
3. IELTS-practice（sallowayma-git/IELTS-practice，2,395★，GPL-3.0）README.zh-CN — https://github.com/sallowayma-git/IELTS-practice ※
4. Anki 文本导入规格（anki-manual manual/importing/text-files.md）— https://docs.ankiweb.net/manual/importing/text-files.md
5. Anki 导出（anki-manual manual/exporting.md）— https://docs.ankiweb.net/manual/exporting.md
6. Obsidian 官网数据所有权口径 ※ — https://obsidian.md
7. Joplin（laurent22/joplin）README＋import_export ※ — https://github.com/laurent22/joplin
8. Logseq（logseq/logseq）README ※ — https://github.com/logseq/logseq
9. genanki（kerrickstaley/genanki）README ※ — https://github.com/kerrickstaley/genanki
10. obsidian-spaced-repetition（st3v3nmw/obsidian-spaced-repetition）README ※ — https://github.com/st3v3nmw/obsidian-spaced-repetition
11. Anki Check Database / Clear Unused Tags（manual/files.md、manual/browsing.md）※ — https://docs.ankiweb.net/manual/files.md
12. Simple Archiver（mfarr/obsidian-archive，15★，GPL-3.0）README — https://github.com/mfarr/obsidian-archive
13. Expiring Notes（joerncodes/obsidian-expiring-notes，19★）README ※ — https://github.com/joerncodes/obsidian-expiring-notes
14. Super Productivity（super-productivity/super-productivity，24,137★，MIT）README ※ — https://github.com/super-productivity/super-productivity
15. Anki deck-options（FSRS desired retention 节）— https://docs.ankiweb.net/manual/deck-options.md
16. FSRS4Anki（open-spaced-repetition/fsrs4anki）README ※ — https://github.com/open-spaced-repetition/fsrs4anki
17. Anki Simulator（giovannihenriksen/Anki-Simulator）README ※ — https://github.com/giovannihenriksen/Anki-Simulator

**社交媒体**（⑦⑩⑪⑫⑥等为协调方逐字复核；其余子代理实读）
18. r/GetStudying 1x7gpht（1 分）— https://www.reddit.com/r/GetStudying/comments/1x7gpht/redid_the_exact_question_i_bombed_on_wednesday/
19. r/GetStudying 评论 pd8vt1n（0 分）— https://www.reddit.com/r/GetStudying/comments/1wv4v1n/do_you_bother_keeping_a_mistake_log_or_making/pd8vt1n/
20. 知乎文章 604425272（镜像直读）— https://www.zhihu.com/tardis/zm/art/604425272
21. HN 36628284（45 分）— https://news.ycombinator.com/item?id=36628284
22. HN 评论 36628928 — https://news.ycombinator.com/item?id=36628928
23. HN 评论 22010925（母帖 348 分）— https://news.ycombinator.com/item?id=22010925
24. r/ObsidianMD 1m6gh00（46 分）— https://www.reddit.com/r/ObsidianMD/comments/1m6gh00/migrated_6000_notes_to_obsidian_now_im_drowning/
25. 同帖评论 n4kod2j（6 分）— https://www.reddit.com/r/ObsidianMD/comments/1m6gh00/migrated_6000_notes_to_obsidian_now_im_drowning/n4kod2j/
26. r/ObsidianMD 评论 orrr7gn（0 分）— https://www.reddit.com/r/ObsidianMD/comments/1u6dwy1/how_do_you_keep_your_vault_from_turning_into_a/orrr7gn/
27. r/GetStudying 1qlddqq（6 分）— https://www.reddit.com/r/GetStudying/comments/1qlddqq/how_do_i_stop_feeling_guilty_when_i_take_a_break/
28. r/GetStudying 1rej64r（63 分）— https://www.reddit.com/r/GetStudying/comments/1rej64r/i_study_for_3hrs_with_no_progress/
29. r/GetStudying 1wo9pi7（9 分）— https://www.reddit.com/r/GetStudying/comments/1wo9pi7/how_to_get_over_an_academic_burnout/

**网站/博客**
30. 新东方在线：2027 考研复习规划（本轮全文直读）— https://kaoyan.koolearn.com/20261125/1987089.html
31. SuperMemo：20 rules of knowledge formulation — https://supermemo.guru/wiki/20_rules_of_knowledge_formulation
32. Andy Matuschak：Evergreen notes — https://notes.andymatuschak.org/Evergreen_notes

**论文**（标注「书目核验」者为 Crossref 核验、原文未读）
33. Bisra, Liu, Nesbit, Salimi & Winne 2018. Inducing Self-Explanation: a Meta-Analysis. Educ Psychol Rev 30:703-725. DOI 10.1007/s10648-018-9434-x（PDF 已取回抽取）
34. Butterfield & Metcalfe 2001. Errors committed with high confidence are hypercorrected. JEP:LMC 27(6):1491-1494. DOI 10.1037/0278-7393.27.6.1491（书目核验）
35. 特刊评论 2025. Learning from errors and failure in educational contexts. Br J Educ Psychol — https://pmc.ncbi.nlm.nih.gov/articles/PMC11803059/（PMC 直读）
36. Kornell & Bjork 2007. The promise and perils of self-regulated study. Psychon Bull Rev 14:219-224. DOI 10.3758/BF03194055（书目核验）
37. Bjork, Dunlosky & Kornell 2013. Self-Regulated Learning: Beliefs, Techniques, and Illusions. Annu Rev Psychol. DOI 10.1146/annurev-psych-113011-143823（书目核验）
38. Epstein, Ping, Fogarty & Munson 2015. A Lived Informatics Model of Personal Informatics. UbiComp '15. DOI 10.1145/2750858.2804250（PDF 已取回抽取）
39. 数字囤积 fsQCA 2026. Front Psychol — https://pmc.ncbi.nlm.nih.gov/articles/PMC13201440/（PMC 直读）
40. Cepeda, Vul, Rohrer, Wixted & Pashler 2008. Spacing Effects in Learning. Psychol Sci 19(11):1095-1102. DOI 10.1111/j.1467-9280.2008.02209.x（PDF 已取回抽取）
41. Cepeda, Pashler, Vul, Wixted & Rohrer 2006. Distributed practice in verbal recall tasks. Psychol Bull 132(3):354-380. DOI 10.1037/0033-2909.132.3.354（书目核验）
42. Rohrer & Taylor 2006. The effects of overlearning and distributed practise on the retention of mathematics skills. Appl Cogn Psychol 20:1209-1224. DOI 10.1002/acp.1266（书目核验）
43. Whittaker 2011. Personal information management: From information consumption to curation. ARIST 45:1-62. DOI 10.1002/aris.2011.1440450108（书目核验）

**代码证据**（child worktree @ ebfd0fd）
44. `src/shared/practice.ts:176-231`（confidence 枚举、PracticeMistake 全字段、无 cause）
45. `src/main/practice/practice-service.ts:233、253`（priority 升降）；`:856-894`（exportMistakeSheet md）
46. `src/shared/practice-sheet.ts:55-100`（平铺复习单、无聚合）
47. `src/main/practice/schedule.ts:178-184`（SURE_WRONG_EXTRA_STEP 已用 confidence）
48. `src/renderer/shell/calibration.ts:13-80`（校准卡已有、未反哺错题本）
49. `src/shared/weekly-stats.ts:76-78、94-111、126-136`（分母双口径＋正确率不去重＋planned<5 先例）
50. `src/main/check-ins/prompt.ts:207-247`（weeklyStatsLines 正确率行）
51. `src/main/workspace/paths.ts:8、73-79`（任务日文件永久累积）
52. `src/shared/knowledge.ts:69-79`（topic merge 已有）；`src/renderer/shell/KnowledgePage.tsx:165-338`（merge UI 已有）
53. `src/main/memory/profile.ts:11-22`（profile 桶限 5 条 newest-first）
54. `src/main/deck-browser.ts:14、320`（唯一结构化导出是 PDF）
55. `src/shared/workspace.ts:120-136`（EXAM_WINDOW_DAYS=14，无 phase 概念）；`src/shared/revisit.ts:1-25`（固定阶梯）

---

## 9. 一句话结论

1.3.0 修好了「坚持」与「恢复」，iter34 该修的是「错与信」：**让每条错题回答「为什么错」并让二次错可见可洗白（P0）、让每周数字不再吓人也不再骗人（P1）、让数据随时能带走去 Anki 手机上复习（P2）、给三个月的长跑装上三座里程碑（P3）**；AI 归因、FSRS 旋钮、自动删除、云同步四条路进非目标。
