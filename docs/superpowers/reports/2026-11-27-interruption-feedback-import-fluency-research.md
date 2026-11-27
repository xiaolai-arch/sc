# 第六轮调研：中断恢复 / 主观题批改 / 材料导入 / 答题流畅度（iter33 候选）

- 日期：2026-11-27
- 作者：sc-research（Orca 调研 bot）
- 对应交接：sc-lead 第六轮调研（item 62），与 iter32 实现并行开跑
- 分支：`xiaolai/iter33-research`（child worktree，基于 master `c5b08fe`，未推 origin）
- 与前五轮去重的 14 个已做主题：理解/保持、提问/测验、启动成本、信任核验、进度可见、问责陪伴、隐私删号、创意工具坟场、本地优先信任、备份迁移、断签恢复、计划现实主义、考前窗口、回访节奏。本轮四个角度全部避开这些主题，也避开 iter32 spec 已排期的 P0–P3（断签恢复、计划现实主义、整卷限时模拟、回访阶梯、考前窗口）。

---

## 0. 取数方式诚实声明

**可用管道**（本轮实际使用的）：

- GitHub 仓库与文档：`api.github.com` contents 接口（`raw.githubusercontent.com` 直连被重置）。仓库 README / 指定文件均实读，星数与 license 来自 API。
- Reddit：经归档镜像 `arctic-shift.photon-reddit.com`（reddit.com 直连不通），取回的是归档 JSON 原文。
- Hacker News：`hn.algolia.com` API。
- 论文 PDF：ACM 两篇（Mark 2005、Iqbal & Horvitz 2007）取回原文并用本地脚本抽取文本（见 `/tmp/sc-r6`），引文是抽取文本的逐字摘录（ACM PDF 抽取存在字符间空格，已做折叠处理，语义未动）。PMC 全文页直连可读（fact-fluency 元分析）。
- 引用详情：Crossref API（Altmann & Trafton 2002 的卷期页码）。

**本轮拿不到的（如实列出）**：

1. **Leroy & Glomb 2018 原文（Organization Science，付费墙）未读**。替代：UW News 官方通稿（采访 Leroy 本人，四项研究的样本量与结论）＋ 助手概念页。其「ready-to-resume plan」的效应量级无法独立核验，本报告只引用其**方向性结论**（写恢复计划的人在打断任务上表现更好）。
2. **Writing Next（Graham & Perin 2007）报告原文本轮未能直取**：all4ed.org 403、ERIC fulltext 重定向。效应量数字（策略教学 0.82、句子合并 0.50、范文 0.25）沿用第五轮核查记录，本轮另取到一篇开放获取综述（PMC13374430）的二次印证：「resonate with the meta-analysis of Graham and Perin, which identified strategy instruction as one of the most effective approaches for struggling writers」。
3. **Social Semantic Scholar API 本轮限流**（429），未用它取摘要。
4. **MinerU / marker 转换质量未实测**——只读了 README、license 与硬件表；两项目的基准数字均为厂商自述（OmniParseBench 是 marker 母公司自有基准）。
5. **AES（自动作文评分）开源仓库只读 README**，未跑代码；最高星 207，无产品级实现（详见 §1.2a）。
6. **Super Productivity** 只读 README，未读其 pause/resume 源码；故「开源侧无成熟中断恢复范式」的判断只到 README 粒度。

---

## 1. 开源项目

### 1a. 材料转 markdown：marker（datalab-to/marker，41,088★，Apache-2.0 代码 + OpenRAIL-M 权重）

- 机制：PDF/图片/PPTX/DOCX/XLSX/HTML/EPUB → markdown+JSON+HTML。核心是**分层路由**：数字版 PDF 走内嵌文本层（`pdftext`）＋轻量 ONNX 版面模型，只有公式、复杂表格、CJK/非拉丁文字、扫描页才升级 VLM OCR（Surya 2.5）。
- README 关键数字（https://github.com/datalab-to/marker ，2026-11-26 仍活跃）：`fast` 档「runs 100% in-process on CPU/MPS (~18 MB Indra ONNX weights)」，23.6 页/秒；GPU `balanced` 档 16.9 页/秒；CJK 与扫描件依赖 VLM。
- License 原文：代码 Apache-2.0；模型权重「modified AI Pubs Open Rail-M license (free for research, personal use, and **startups under $5M funding/revenue**)」。
- **可借鉴**：「数字版不跑 OCR、扫描件才 OCR」的分层成本结构，是教材导入的正确省钱姿势；markdown 输出（公式 `$$LaTeX$$`、图片落盘）与 vault 兼容。
- **破坏前提**：GPU 档要 Docker＋NVIDIA Container Toolkit / vllm 级部署，Electron 桌面捆绑过重；权重许可对商业化有门槛；模型需下载。

### 1b. MinerU（opendatalab/MinerU，84,408★，Apache-2.0）

- 机制：本地文档解析（PDF/图片/Office/EPUB/OFD/HTML→Markdown 等 9 种目标），**四档质量分级＋硬件自动探测＋本地后台 server＋远端解析显式授权**。
- README 硬件表（https://github.com/opendatalab/MinerU ）：`basic` 档 ONNX「~0.8 GB」、最低 2GB RAM、CPU 可跑；`standard/advanced`「~2 GB」、8GB RAM；PyTorch+VLM「~3 GB」、16GB RAM。另支持 Intel/AMD/NVIDIA iGPU 的 ONNX 加速「approximately 2–3× CPU speed」。
- LICENSE.md 原文：「Apache License 2.0 ... if ... **MAU exceed 100 million; or total monthly revenue exceeds USD 20 million**, you must obtain a separate commercial license」——桌面本地小产品无影响。
- 隐私原则原文：「**Documents are not automatically uploaded to the official service; remote parsing requires explicit configuration**」——与 ASAKI 无云立场同构。
- **可借鉴**：①质量/速度/硬件三轴分档并明说 trade-off（「flash ... never default final reading quality」）是给低技术素养用户做导入的产品化范式；②硬件探测后推荐档位；③「上远端必须显式授权」。`basic` 档 CPU＋2GB RAM＋0.8GB 模型是普通家用机的可行锚点。
- **破坏前提**：模型下载 0.8–3GB；需常驻 `mineru server start` 后台进程——对低技术素养 × Windows 用户是运维负担。

### 1c. Obsidian 的 PDF 处理：只嵌入、深链、明确不做批注（obsidianmd/obsidian-help）

- 出处：`en/Linking notes and files/PDFs.md`、`Embed files.md`（https://github.com/obsidianmd/obsidian-help ）
- 嵌入与深链原文：`![[Document.pdf#page=3]]`、`![[Document.pdf#page=3&height=400]]`；「**Copy link to selection** copies a link to that passage」，粘贴后形如 `[[Gemmy.pdf#page=1&selection=32,0,32,14|Gemmy, page 1]]`。
- **关键负面发现**（原文）：「> [!info]+ **Annotations are not supported** — Obsidian doesn't support adding annotations or highlights to a PDF. To mark up a PDF, use another app and then open the updated file in your vault.」
- **可借鉴**：「PDF 留在 vault 不转格式＋页码/选区深链」正是明文直读该选的形态；`#page&selection` 坐标格式可直接抄给练习卡的溯源链接。
- **注意**：不要把「Obsidian 支持 PDF 批注」当事实——它明确不支持；ASAKI 若做「在教材上划重点生成卡片」须自己实现，且要决定批注存哪（对照 1e Zotero）。

### 1d. Anki Image Occlusion：一图多遮罩、每遮罩一卡（ankitects/anki-manual `src/editing.md`）

- 原文：「cloze deletion based on images instead of text」；「Anki will add a card **for each shape or group of shapes**」。
- 两模式：「**Hide All, Guess One**: All areas are hidden and only one area at a time is revealed」；「**Hide One, Guess One**: Only one area at a time is hidden」。
- 录入：「click on **Paste image from clipboard**」——板书/课件照片剪贴板直贴。
- 维护坑原文：「deleting a shape won't delete its associated card automatically; you will need to use Tools>Empty Cards afterwards」。
- **可借鉴**：「拍照→遮罩编辑器→点 Add 批量出卡」是低技术素养用户友好的完整流程，值得照抄。
- **破坏前提**：遮罩坐标存在 Anki 专用 note type 字段（非明文）。ASAKI 坚持明文直读，需要自行设计遮罩数据存放（如 frontmatter 内联 JSON 或旁挂可读 md）——是设计题，不是障碍。

### 1e. Zotero 的 annotation→note 工作流：批注入库不进文件，但「永不锁死」（zotero/zotero-docs）

- 出处：`content/pdf_reader.md`、`content/kb/annotations_in_database.md`、`content/note_templates.md`（https://github.com/zotero/zotero-docs ）
- 存放原文：「**Zotero stores annotations in the Zotero database, not in the PDF file**... Zotero annotations can be exported to PDFs with embedded annotations at any time and **will never be locked in Zotero**」；理由是同步免冲突、可全局 tag/过滤。
- 工作流原文：批注一键成笔记，「Annotations added to notes will automatically include **links back to the PDF page** as well as citations」；笔记内点「Show on Page」跳回原页。
- 模板原文：高亮默认模板 `<p>{{highlight}} {{citation}} {{comment}}</p>`，Config Editor 搜 `annotations.noteTemplates` 可定制，支持 `{{if}}` 条件分支。
- **可借鉴**：「划重点→结构化卡片（摘录＋页码回链＋模板变量）」是成熟形态。
- **破坏前提**：批注入数据库与明文直读相反。ASAKI 若做批注，要么写回 PDF 本体、要么旁挂可读文件——Zotero 证明了「旁路存储＋可导出」可行，但明文性要自己保证。

### 1f. AES 自动作文评分：开源侧无成熟产品（repo search 实读）

- 搜索（API，sort=stars，2026-11-27）：`nusnlp/nea` 207★ GPL-3.0；`mankadronit/Automated-Essay--Scoring` 150★ 无 license；`lingochamp/Multi-Scale-BERT-AES` 63★；`Turanga1/Automated-Essay-Scoring` 58★；`benhamner/ASAP-AES` 43★ BSD-2。
- 实读结论：训练数据全是 **ASAP**（Kaggle Hewlett 基金会数据）；验收指标是 **QWK**（「The accuracy is calculated by Quadratic Weighted Kappa(QWK), which measures the agreement between two raters」）；技术栈陈旧（nea：Keras+Theano，2016 EMNLP 代码；mankadronit：TensorFlow 1.9）；nea 需按 prompt 单独训练（`-p 1 # Prompt ID`）且 GPL-3 商业另授权。
- **诚实结论**：开源侧没有可产品化的本地 AES。直接做需要大模型或自训模型，按题目训练、质量无保证——与「本地、无账号、考研分数相关」的前提冲突。本轮不推荐（见 §6 拒收），只留两条可借鉴：QWK 可作未来批改功能的离线验收指标；ASAP 可作测试集。

### 1g. Anki 的答题用时是一等数据：revlog、60 秒封顶、计时器默认关（anki-manual ＋ anki 源码）

- 手册 `src/stats.md`：revlog 表列 `time`＝「The amount of time (in milliseconds) you spent on the question and answer sides of the card before selecting an ease button」；Review Time 图据此绘制；True Retention 表：「A card is defined as 'mature' if its interval is ≥21 days. **Only one review per day - the first one - counts.**」
- 源码 `rslib/src/scheduler/answering/mod.rs`：`CardAnswer { milliseconds_taken: u32, ... }`，`fn cap_answer_secs(&mut self, max_secs: u32) { self.milliseconds_taken = self.milliseconds_taken.min(max_secs * 1000); }`
- 默认值 `rslib/src/deckconfig/mod.rs` `DEFAULT_DECK_CONFIG_INNER`：`cap_answer_time_to_secs: 60`、`show_timer: false`、`stop_timer_on_answer: false`。
- **可借鉴**：①用时是日志一等列，ASAKI 的练习日志（明文 md）每条应含用时；②**60 秒封顶**防挂机污染统计；③计时器**默认不显示**（数据照记，不制造压迫感）；④「每日只计第一次」的去重规则值得照抄进流畅度统计。纯数据设计，无任何前提破坏。

### 1h. 中断恢复的开源侧证据：弱（如实说）

- Obsidian Workspaces（core plugin，`en/Plugins/Workspaces.md`）：「A workspace contains information about **open files and tabs, and the width and visibility of each sidebar**.」——手动命名快照，不是自动「回到中断现场」。
- Obsidian Tabs：唯一相关项是「**Recently closed tab** `Ctrl`+`Shift`+`T`」。
- Super Productivity（johannesjo/super-productivity，Electron）README：「Pick a task and start a **Pomodoro, Flowtime or countdown** session... a **break reminder** tells you when to step away.」——只确认会话类型与休息提醒，pause/resume 细节未读源码（见 §0 声明 6）。
- **给协调方的判断**：「学习中被打断→跨天/跨会话恢复现场」在开源产品侧没有公认成熟机制，证据主力转引文献（§4），开源证据只作「快照＋恢复关闭标签」两个小特性的旁证。

---

## 2. 社交媒体

取数：Reddit 走归档镜像 `arctic-shift.photon-reddit.com`（reddit.com 直连不通），逐帖按 id 取回原文核验；HN 走 `hn.algolia.com`。分数为归档快照值，可能略低于实时分；HN 楼内评论分数不可见。引语均出自取回的 JSON 原文（保留原拼写）；本节 7 条 Reddit 帖与 2 条 HN 评论由协调方逐条抽查，与原文一致。

### 2a. 中断与恢复

**① r/ADHD：一遇摩擦就摸手机，回来思路已断**（202 分 / 2026-07-16 / u/Lower_Living3183）
https://www.reddit.com/r/ADHD/comments/1uy9qwb/noticed_this_my_phone_isnt_the_distraction_its/
> 「The minute I get a hurdle on the task, I reach my phone. Not because I need to check something on my instagram. Then I come back to the doc a few minutes later, **still stuck, AND now I've also lost my train of thought**.」

——打断的真实代价不是那几分钟，是「train of thought」本身的重建成本（对应 4a Iqbal 的 resumption lag）。

**② HN 282 分讨论：《The cost of interrupted work》**（https://news.ycombinator.com/item?id=44999373 ，2025-08-23）
> u/Waterluvian：「Some days an interruption will throw me off my train of thought, and I spend **the remaining six hours** collecting discarded bottles and railway ties for hopeful use somewhere, somehow, sometime.」
> u/baxtr：「For me, the difference is whether I had **pre-planned my tasks** or not. Knowing what I wanted to focus on and achieve from 10-11 am makes it **much easier to get back on track**.」

——baxtr 这条是 ready-to-resume plan（3b/4a）在真实工作者那里的自发对应物：**提前写好「回到哪」的人恢复得快**。

**③ r/GetStudying：能理解，难在「进入并留在」状态里**（205 分 / 2026-04-01 / u/Redline13k）
https://www.reddit.com/r/GetStudying/comments/1s98zm4/tipsadvices_needed/
> 「my biggest problem with studying isn't understanding the content… it's actually doing it consistently.」
> 「**It's just that gap between 'I should start' and actually starting and staying focused that messes everything up.**」

### 2b. 主观题/写作练习与批改

**④ r/GRE：两个 AI 批改器给 5 分和 3.5 分，用户不知道信谁**（6 分 / 2025-03-21 / u/ac76342）
https://www.reddit.com/r/GRE/comments/1jg8bjo/doubt_with_awa_score/
> 「ScoreITNow score: 5   Gregmant Essay evaluaor score: 3.5 ... I know Gregmat states that feedback can be inaccurate as it is an AI mode, but still I can't still believe I got a 5. Can someone help me to tell whether it is 5 as it might be a fluke?」

——两个 AI 评分相差 1.5 分（满分 6），考生只能发帖求真人仲裁。**这就是拒收 AI 打分的用户侧证据**（§6 拒收 1）。

**⑤ r/EnglishLearning：老师给了最高分也不敢信**（4 分 / 2024-04-03 / u/Wmeowmm）
https://www.reddit.com/r/EnglishLearning/comments/1buisx9/could_you_check_my_essay_and_letter_please/
> 标题即求助：「could you check my essay and letter please?」正文：「my school teacher checked it and gave me the maximum results **but i don't trust her lol**」

**⑥ r/WriteStreakEN：AI 每句都改，「把我仅剩的信心改没了」**（3 分 / 2026-09-27 / u/Schwanengesang_）
https://www.reddit.com/r/WriteStreakEN/comments/1wru23s/streak_1/
> 「The bad thing about using AI is that it **corrects every time even though there are no mistakes** in the sentence. And this has started to **kill my confidence**, which is already low, and I'm trying to improve it.」

——全量纠错式反馈的副作用与 4b 的结论一致：反馈要落在「任务层」而不是逐句红笔；这也支持 P2a 的「检查点自评」形态（自查「答到了吗」，而不是被 AI 逐句判错）。

**⑦ 知乎：考研英语作文批改平台提问**（592 赞 / 2508 收藏，回答者林月半）
https://www.zhihu.com/tardis/zm/ans/1737930267
> 摘录：「分享几个好用、且free的英语作文批改工具，建议先收藏」；要点转述：作文要手写练、但「没人帮忙批改」，故推荐有道写作/批改网/微软爱写作等。

——需求侧强信号（2508 收藏）：考研人群确实在找作文批改方案。诚实注：此条经 tardis 镜像的网页摘要转述，未取到原始 JSON；且要注意它推荐的全是云服务（与 ASAKI 前提冲突），需求真实、方案不可照搬。

### 2c. 学习材料导入（PDF/板书/扫描件 → 可练内容）

**⑧ r/Anki：手动做卡「浪费宝贵学习时间」，作者干脆自己写了 PDF→卡脚本**（50 分 / 2025-09-26 / u/Legitimate_Town781）
https://www.reddit.com/r/Anki/comments/1nqw18d/to_save_time_studying_i_made_a_script_that_turns/
> 「I found myself spending way too much time manually creating cards from my PDF lecture slides. It was tedious and felt like **a waste of valuable study time**.」
> 「If you have low-quality, image-based lecture notes that don't have selectable text, the application has a built-in OCR engine.」

**⑨ r/Anki：1500 页 PDF 教材 → 5000+ 张卡，「我不会编程」**（5 分 / 2022-08-10 / u/drwatson_99）
https://www.reddit.com/r/Anki/comments/wlakek/how_to_quickly_turn_a_whole_pdf_textbook_into/
> 「We are looking at 5000+ cards as the PDF I has over 1500 pages. Which is a lot of work. So I am looking for a way to perhaps automatically do this.」「**I don't really know how to code** or anything but wondering if anyone would know an easy solution to this」

**⑩ r/Anki：手写笔记拍照转卡，为不会编程的妻子找工具**（2 分 / 2026-03-04 / u/miguelfs_elfs）
https://www.reddit.com/r/Anki/comments/1rkrksd/vlmllm_card_creation_toolpluginapp/
> 「she spends too much time adding one by one manually from her note book, like **half an hour** in a process that takes time and stamina while she could have been study instead.」「I also keep suspicious about OCR solutions because **they don't work well with handwritten text**…」

——⑧⑨⑩共同给出需求画像：**制作摩擦是真实的痛点**（有人为它写脚本、有人求工具），且提问者往往明确说自己不会编程。⑩还点名 OCR 对手写体不可靠——这正是 P3 选「照片遮罩」（不需要识别内容，人眼+遮罩）而不是「拍照 OCR 转文字」的理由。同时注意：⑨这种「整本 5000 张」的期望正是 §6 拒收 2 要拦的（制卡即编码，全量转换既违反 Anki 社区共识也违反第五轮「AI 一键批量生成题库」的拒收逻辑）。

### 2d. 会但太慢/熟练度与限时

**⑪ r/Mcat：一科都做不完，求具体计时方案**（6 分 / 2026-08-09 / u/Old_Chemical802）
https://www.reddit.com/r/Mcat/comments/1vjyy1d/how_did_you_actually_fix_mcat_timing_im_not/
> 「Timing is by far my biggest MCAT problem right now. I'm literally not finishing any section without rushing through the last passage or randomly clicking answers at the end.」「I spend too long reading passages, get stuck between two choices... Then I look at the clock, **panic**, and barely get through the final questions.」
> 热评（ThomasDaTrain98，5 分）：「You need to get good at realizing when it's an expert question and just **flagging it and moving on**.」

**⑫ r/Mcat：正式考试紧张导致大面积超时（二战考生）**（7 分 / 2026-09-03 / u/Gracecg618）
https://www.reddit.com/r/Mcat/comments/1w6h5oc/timing_issues_and_testing_anxiety/
> 「I tremendously ran out of time and had multiple passages that I could barely answer in chem and cars.」「I was just so anxious, which made me not be able to focus and ultimately run out of time.」

——诚实注：r/college 的「run out of time」全文搜索命中的全是挂科帖，角度四证据全部来自 r/Mcat（备考计时场景，与考研限时同构但不完全等同）；且这两条更多支撑 iter32 已排期的 P2a（整卷限时），对 iter33 的 P1（条目级用时遥测）只是氛围佐证——「慢」的可见性是前置于「快起来」的第一步。

---
---

## 3. 网站/博客

### 3a. Hemingway Bridge（concepts.dsebastien.net）

- 出处：https://concepts.dsebastien.net/concept/hemingway-bridge/
- 定义原文：「Ending a work session at a point where you know exactly what comes next, so that resuming the work later is easy.」；「The Hemingway Bridge is the practice of stopping work before you are completely done, at a point where you know what the next step is, and **leaving yourself a note about it**.」
- 机制原文：「**Ovsiankina Effect**: An intentionally unfinished task keeps a pull to resume it. Stopping mid-task uses that pull instead of fighting it.」；「**Shorter resumption lag**: The note preserves the mental context that would otherwise decay, so you get back to full speed faster.」
- 实操原文：「Keep the bridge note **inside the project note** so it is the first thing you see when you come back.」
- 关联：Tiago Forte《Building a Second Brain》推广了该词。

### 3b. UW News：ready-to-resume plan 的四项研究（华盛顿大学官方通稿）

- 出处：https://www.washington.edu/news/2018/01/16/task-interrupted-a-plan-for-returning-helps-you-move-on/
- 原文（四项研究）：「four studies in which subjects were set to work on a task with a time constraint and then interrupted for a different project」——研究一为 202 名职场人士田野调查；研究二（实验室，词联想法）证明被打断后无恢复计划时人仍在想任务 A、「their performance on Task B suffered as a result」；研究三/四（66、44 名学生）检验 ready-to-resume plan 的收益。
- Leroy 原话：「people who have done the ready-to-resume plan **make better decisions, and recall more information** from those résumés that they just read... It's an improvement in performance, both in quality of information retained and in the ability to make decisions with complex information.」
- 诚实注：研究三四测的是**打断任务（Task B）上的表现**，原文明说「The studies did not explore whether the plan improved performance on the interrupted Task A when participants returned to it」——即恢复计划的直接受益者是「打断后的那段新时间」，不是任务 A 本身；对 ASAKI 而言这仍然成立：中断后先做的常是别的事，回来时的状态由恢复计划决定。

### 3c. The Writing Revolution：句子级训练（thewritingrevolution.org/method）

- 出处：https://www.thewritingrevolution.org/method/
- 原文：「The methodology rests on **explicit, carefully sequenced instruction, building from sentences to compositions**.」；六原则之一：「**Sentences are the building blocks of all writing.** When embedded in the content of the curriculum, writing instruction is a powerful teaching tool.」
- 对应论文侧证据（§4b Graham & Perin 句子合并 0.50）：练习产品侧的可行形态是「句子级、嵌在学科内容里」，不是孤立的作文课。

### 3d. Anki 官方手册：计时的默认哲学（docs.ankiweb.net/deck-options.html）

- 出处：https://docs.ankiweb.net/deck-options.html 「Timers」节。
- 原文一：「Anki monitors how long it takes you to answer each card, so that it can show you how long was spent studying each day. **The time taken does not influence scheduling.**」
- 原文二（60 秒封顶的理由）：「Maximum answer seconds: **The default limit is 60 seconds**. If you take longer than that, Anki assumes you have walked away from your computer or have been distracted, and caps the recorded time at 60 seconds, so that you don't end up with inaccurate statistics.」
- 原文三（屏上计时器默认）：「Show on-screen timer: On the Study screen, show a timer that counts the time you're taking to study each card...」——默认关闭（1g 源码 `show_timer: false`），即**数据记、压迫不给**。

### 3e. Obsidian 帮助：PDF 批注不支持的官方口径（help.obsidian.md/pdf）

- 出处：https://help.obsidian.md/pdf （SPA 页面，本轮经 obsidian-help 仓库镜像核验，文本见 1c）。
- 原文：「**Annotations are not supported** — Obsidian doesn't support adding annotations or highlights to a PDF.」
- 用途：材料导入 §5 落差的产品参照——「不转格式＋深链」是 vault 生态的既成惯例，ASAKI 跟随即可，别造阅读器。

---

## 4. 论文

### 4a. 中断与恢复

**Mark, Gonzalez & Harris 2005**——《No task left behind? Examining the nature of fragmented work》

- 出处：CHI 2005，ACM，DOI 10.1145/1054972.1055017（经 Crossref 核验；本轮取回 PDF 原文抽取核验数字）。
- 关键数字（原文逐字，已折叠抽取空格）：「The average length of time that the informants spent in central and peripheral working spheres was **11 min. 4 sec.**, (sd=18 min. 9 sec.) before switching to another working sphere or being interrupted」；「**57% of WS interrupted**」；「Avg. of **11.7** different working spheres」。
- 释义：知识工作天然碎片化，平均 11 分钟被打断一次——「 uninterrupted 25 分钟」是例外不是常态；工具要么接受中断、要么帮人恢复。

**Iqbal & Horvitz 2007**——《Disruption and recovery of computing tasks: field study, analysis, and directions》（CHI 2007）

- 出处：CHI 2007，ACM，DOI 10.1145/1240624.1240730（经 Crossref 核验；本轮取回 PDF 原文抽取核验数字）。
- 关键数字（原文逐字）：「**27% of task suspensions resulted in more than two hours of time until resumption**」；「For delayed responses, the resumption phase spanned on average **12 minutes and 2 seconds** (S.D. = 14m, 58s)」；数据规模「**2,267 hours** of activity data over a period of 2 weeks, resulting in 974 sessions」。
- 机制归因（原文）：「In interviews, **users attributed long delays to the loss of context** associated with the task switch.」——丢的是「上下文」，这正好是笔记能补的。
- 设计启示（原文）：早期任务管理研究「stressing the need to allow for efficient task switching and resumption, and to provide methods for **assisting with refreshing a task context**」。

**Altmann & Trafton 2002**——《Memory for goals: an activation-based model》（Cognitive Science 26(1):39-83，DOI 10.1207/s15516709cog2601_2；卷期页码经 Crossref 核验，原文未直读）

- 机制：目标不是被「记住」而是被「激活」——挂起后激活随时间衰减，恢复需要把目标重新拉到阈值以上，**联想提取线索（associative retrieval cues）**是最可靠的再激活路径。
- 对产品的含义：给任务挂一条「下一步」文字，就是给自己造一条提取线索；与 3a 的 Hemingway Bridge、4a 的 ready-to-resume 同一机制。

**Leroy & Glomb 2018**——《Tasks interrupted: How anticipating time pressure on resumption of an interrupted task causes attention residue》（Organization Science 29(3)；页码本轮未核验故不标注，原文未直读，见 §0 声明 1）

- 经 UW News 核验的结论：写 ready-to-resume plan 的人在打断任务上决策与信息保持更好（3b 已引）。方向性证据足够支撑「恢复计划」小功能；效应量级不引用。

**Ovsiankina 效应（1928）**：经 3a 概念页转引——被刻意留下的未完成任务会持续产生「想回去」的拉力。停在半句，把拉力变助力，而不是硬扛。

### 4b. 写作/主观题反馈

**Graham & Perin 2007**——《Writing Next: Effective strategies to improve writing of adolescents in middle and high schools》（Alliance for Excellent Education / Carnegie）

- 效应量（沿用第五轮核查记录；本轮报告原文不可达，见 §0 声明 2）：**策略教学 0.82**、**句子合并 0.50**、**范文学习 0.25**、传统语法教学负效应；SRSD 类（策略＋自我调节）在后续元分析中更高（Graham & Sandmel 2011 报 1.14）。
- 二次印证（本轮实读）：PMC13374430（开放获取综述）：「These findings from the included studies resonate with the meta-analysis of Graham and Perin, which identified **strategy instruction as one of the most effective approaches for struggling writers**.」

**Wisniewski, Zierer & Hattie 2020**——《The Power of Feedback Revisited: A Meta-Analysis of Educational Feedback Research》（Frontiers in Psychology，DOI 10.3389/fpsyg.2019.03087，经 Crossref 核验；效应量沿用第五轮核查记录）

- 结论：反馈总体 d=0.48，但**反馈内容维度比「给不给」更重要**——不是有反馈就好，是对「任务层、过程层」的具体反馈才有效。

**Panadero & Broadbent 等 2023**（rubrics 元分析，g=0.45；沿用第五轮核查记录）

- 结论：量规（rubric）透传评价标准本身有中等效应——**把「好答案长什么样」变成可见清单**，比事后给个分数有用。

**练习侧推论**：考研主观题（政治大题、数学证明、英语作文）的批改瓶颈不必靠 AI 打分解开——「参考答案对照＋量规自评」有独立证据基础（§6 P2a）。

### 4c. 流畅度/自动化

**National Mathematics Advisory Panel (NMAP) 2008**——《Foundations for Success》（US Department of Education）

- 结论（权威综述）：算术事实的**流畅回忆（automaticity）是代数准备度的显著预测因子**——「缓存的认知资源」论：基本运算自动化后，工作记忆腾出来给更高层推理。考研数学里就是「导数表、积分表不过脑子」。
- 出处：https://ies.ed.gov/ncee/pdf/20084084.pdf （本轮未重取；第五轮核查记录引用）

**Fact-fluency 元分析 2026**（Journal of Learning Disabilities 59(3)；本轮经 PMC 全文页实读：https://pmc.ncbi.nlm.nih.gov/articles/PMC13069136/ ）

- 原文逐字：「We synthesized findings from **35 group-design studies, reporting 178 effect sizes (ESs), conducted between 1975 and June 2024**... an educationally meaningful average ES (**g = 0.76**), providing evidence of the overall efficacy of fact fluency interventions. However, the **prediction interval (−0.60 to 2.12) indicated substantial heterogeneity**」。
- 调节变量（原文）：「publication era emerged as a significant moderator」——越早（更多机械练习时代）效应越大；「Interventions delivered in **large-group formats yielded larger effects** than those delivered in one-on-one and small-group formats」。
- 机制描述（原文）：「Students often struggle to retrieve mathematical facts from long-term memory, resulting in **slower response times and an overreliance on inefficient strategies, such as finger counting**」——「慢」本身就是未自动化的信号，所以**用时数据值得记**。

### 4d. 多媒体原则（材料导入旁证）

**Mayer 多媒体学习原则**（多轮元分析，g≈0.37-0.39——真实但中等，远小于宣传口径；沿用第五轮核查记录）

- 对导入功能的含义：把教材变成「图＋文＋题」有真实收益，但不是魔法；**导入的价值主要在降低制作摩擦（编码前置成本），不在转换本身**。

---

## 5. ASAKI 现状与落差（file:line 均核于 master `c5b08fe` 的 child worktree）

| # | 落差 | 现状（证据） | 文献/生态参照 | 可落地性 |
|---|------|-------------|---------------|----------|
| G1 | **昨晚写的「明天第一步」，今早没人提** | 晚间复盘收集 `tomorrow`（`src/main/check-ins/prompt.ts:382`「以及明天第一步」），入库为 `ReviewRecord.tomorrow`（`src/main/context.ts:884`），经记忆合成间接进入 butler 上下文（`src/main/memory/synthesize.ts:30-46`）；但**晨间 prompt 的组成部分只有 taskLines/memoryLines/promiseLine/freshStart**（`src/main/check-ins/prompt.ts:340-390`），无 yesterday.tomorrow 行 | ready-to-resume plan（3b/4a）；Hemingway Bridge「first thing you see when you come back」（3a） | **极小**：晨间 prompt 加一行（数据已在库）；明文、无云、无新表 |
| G2 | **专注计时器不落盘，重启即失** | `const [focus, setFocus] = useState<FocusSession | null>(null)`（`src/renderer/shell/Workspace.tsx:296`）；`FocusSession` 纯内存（`src/renderer/shell/focus-timer.ts:7`） | 中断后恢复需要外部化的上下文（4a Iqbal「loss of context」） | **小**：会话写入 workspace 明文文件，重启读回，提示「上次专注还剩 X 分钟，继续？」 |
| G3 | **任务没有「下一步」锚，闪念进聊天不入库** | 任务字段 title/subject/durationMin/acceptance/cue（`src/shared/tasks.ts`）；quick capture 提交后只 `promptButler(text)` 进聊天（`src/renderer/shell/Workspace.tsx:2200-2202`），不落任务/笔记 | 联想提取线索=恢复的关键（4a Altmann & Trafton）；bridge note「inside the project note」（3a） | **小**：任务加可选 `nextStep` 字段＋复盘/中断时写一行；quick capture 至少可存为vault 笔记草稿 |
| G4 | **答题没有用时数据，「对了但慢」不可见** | `PracticeAttempt { choice, response?, confidence?, correct, answeredAt }`（`src/shared/practice.ts:62-74`）——无 duration 字段，无封顶，无每日去重 | Anki：revlog time 列＋60s 封顶＋show_timer false＋「每日只计第一次」（1g/3d）；「慢=未自动化」（4c PMC 原文） | **小**：attempt 加 `durationMs`（60s 封顶），统计页给每套题中位用时趋势；纯数据，明文兼容 |
| G5 | **主观题只有「对/错」自判，无量规自评** | `PracticeQuestionKind = 'choice' | 'short'`（`src/shared/practice.ts:23-24`）；short 交 `referenceAnswer`，判分是 `selfCorrect` 布尔（`src/main/practice/practice-service.ts:585-586、690-691`） | 量规透传 g=0.45（4b Panadero）；反馈要具体到任务/过程层（4b Wisniewski d=0.48）；句子级起步 0.50（3c/4b） | **中**：short 题建集时生成 2-3 条检查点（从 referenceAnswer 拆），作答后逐条自勾，不自动打分 |
| G6 | **材料导入只有视频；PDF/照片进来不了** | `dialog` 过滤只有 `VIDEO_EXTENSIONS`＋所有文件（`src/main/index.ts:315-320`）；唯一导入管线 `src/main/video-notes/`（`src/main/index.ts:20`）；无任何 PDF/图片入口 | Obsidian：PDF 留 vault＋`#page&selection` 深链（1c）；Anki IO：照片→遮罩→批量出卡（1d）；MinerU `basic` 档 CPU 2GB RAM（1b） | **分档**：溯源深链极小；照片遮罩卡中等；整本 OCR 转换应拒（§6） |
| G7 | **练习卡无溯源字段** | `PracticeSet`/`PracticeQuestion` 无 source/page 字段（`src/shared/practice.ts:27-42`） | Obsidian 深链格式（1c）；Zotero「links back to the PDF page」（1e） | **极小**：set/question 加可选 `source` 行，值形如 `[[(教材.pdf)#page=12]]`，复习时一键跳原文 |

---

## 6. iter33 候选排序

**排序原则**：证据强度 × 改动大小 × 是否贴合三条铁前提（vault 明文直读、本地优先、低技术素养 × Windows）× 与 iter32 已排期项不重叠。

### P0 「明日第一步」桥（G1）

- 做什么：晨间检查 prompt 注入昨晚 `tomorrow`：「昨天你写下明天第一步：X——今天第一件事就是它吗？」；若连续多日同一 tomorrow 未动，措辞换成「这步写了好几天了，是它太大了还是不想做？」。
- 为什么 P0：**数据全在库里，只差一行 prompt**；机制证据最厚（ready-to-resume plan＋Hemingway Bridge＋Ovsiankina＋goal reactivation 四路同向）；社媒侧有自发对应物——HN 高分讨论里 u/baxtr：「Knowing what I wanted to focus on and achieve from 10-11 am makes it **much easier to get back on track**」（②），与 r/GetStudying 的「should start 与实际开始之间的鸿沟」（③）；且与 iter32 P1（计划现实主义）天然互补——P1 管排多少，这个管「从哪开始」。
- 前提检查：明文（读复盘 md）、本地（无新依赖）、低技术素养（无新 UI）。全过。

### P1 练习用时记录＋流畅度分级（G4）

- 做什么：`PracticeAttempt` 加 `durationMs`（renderer 记时，**60 秒封顶**照抄 Anki）；统计页加每套题「中位用时」趋势；`correct && durationMs < 阈值` 标记为「自动召回」，与「对了但慢」分开；沿用「每日只计第一次」去重。**不给压迫感**：计时器默认不显示（Anki `show_timer: false` 口径），只事后呈现。
- 为什么 P1：纯数据设计，零前提风险；考研数学「会但慢」与「快且对」是两种掌握状态，现有 `correct` 布尔抹平了这个差异；NMAP＋g=0.76 证据支撑「流畅度是单独维度」；r/Mcat 的计时崩溃原声（⑪⑫）说明「慢」的焦虑真实存在——但注意那两条更多支撑 iter32 P2a（卷级限时），P1 提供的是它前置的「条目级」可见性。
- 与 iter32 P2a（整卷限时）不重叠：P2a 是卷级计时体验，本项是条目级遥测。

### P2a 主观题量规自评（G5）

- 做什么：short 题建集时从 `referenceAnswer` 拆出 2-3 条检查点（由 butler 生成、建集者可改）；作答后先写答案，再逐条自勾「答到了吗」，记录每条命中与否；对答案时高亮「漏掉的检查点」而非给分。
- 为什么 P2：证据独立成立（量规 g=0.45＋过程反馈 d=0.48＋句子合并 0.50——句子级检查点正是「从句子到成篇」的台阶）；**明确不做 AI 打分**（见拒收 1），自评对照有主动检索收益且不依赖模型质量。
- 大小：中等——涉及建集流程与练习 UI，但数据仍是明文 frontmatter 列表。

### P2b 中断现场包（G2＋G3）

- 做什么：①`FocusSession` 落盘（workspace 明文文件），重启恢复并提示「上次专注剩 X 分钟，继续？」；②任务加可选 `nextStep` 一行字，晚间复盘与 quick capture 都能写；离开任务时若任务有 nextStep，晨间/任务页直接显示。
- 为什么 P2 而不是 P0：P0 只动 prompt 一行，本项要动状态持久化＋任务 schema；但 Hemingway 场景（写到一半去吃饭）只有它覆盖；r/ADHD 的「回来时 still stuck, AND now I've also lost my train of thought」（①）正是没有 nextStep 锚时的体验——回来那一下没有线索可抓。
- 前提检查：全部明文落 vault；无新依赖。

### P3 照片遮罩卡（G6 部分）

- 做什么：练习集支持「拍照建卡」：剪贴板/相册照片进遮罩编辑器，画矩形遮罩（**Hide All / Hide One** 两模式照抄 Anki），每遮罩一卡；遮罩坐标存练习集 md 的 frontmatter 内联 JSON（明文可读，解决 Anki 非明文的坑）。
- 为什么 P3：OSS 先例完整（1d）；社媒需求画像清晰——r/Anki 有人为「手写笔记逐条录入要半小时」找工具（⑩），提问者明确说自己不会编程（⑨）；⑩还点名「OCR 对手写体不可靠」，这正是选「照片遮罩」（人眼定位＋遮住即出题，不需要识别内容）而不是「拍照 OCR 转文字」的理由。UI 工程量在本轮候选里最大，且需要先有 P1/P2 的练习底盘稳定。
- 前提检查：照片落 vault attachments（Obsidian 惯例）；遮罩数据明文；无云。

### P4 卡片页码溯源（G7）

- 做什么：练习集/题目加可选 `source` 深链，格式照 Obsidian `[[file.pdf#page=N]]`；复习答错时展示「跳回教材第 N 页」。
- 为什么只是 P4：单点极小，但**消费者依赖导入语境**——用户得先把 PDF 放进 vault 并建立「这题出自哪」的习惯；没有 P3/导入生态时收益有限。建议随 P3 或导入功能一起上。

### 拒收项（7）

1. **AI 自动作文评分（本地或云 AES）**：开源侧无产品级实现（207★ 研究代码、按 prompt 训练、十年前技术栈，1f）；本地大模型质量与考研分数相关的高利害场景不匹配；云 AES 破坏无账号前提。**用户侧也不买账**：r/GRE 两个批改器给 5 分和 3.5 分、考生只能发帖求真人仲裁（④）；r/WriteStreakEN 用户抱怨 AI「每句都改、把仅剩的信心改没了」（⑥）——逐句红笔式反馈的副作用与 4b「反馈要落在任务/过程层」的结论互相印证。需求本身真实（知乎作文批改帖 2508 收藏，⑦），但需求应解给 P2a 的量规自评，不是解给 AI 打分。
2. **整本教材本地 OCR→markdown 转换（捆绑 marker/MinerU）**：模型下载 0.8-3GB、常驻后台 server、GPU 档要 Docker/vllm（1a/1b）——低技术素养 × Windows 的运维负担；权重许可（OpenRAIL-M 门槛）对后续商业化埋雷；转换质量未实测（§0 声明 4）。**需求侧如实记**：r/Anki 有人为这个问题自己写脚本（⑧）、有人求「1500 页 PDF→5000 卡」的自动化（⑨）——摩擦是真实的，但「整本转卡」同时撞上第五轮「制卡即编码」的拒收逻辑；ASAKI 的答案是降低单卡制作摩擦（P3 遮罩），不是全量转换。**留门**：若未来做，只做「显式授权的可选插件」路线（MinerU「remote parsing requires explicit configuration」的口径），且 basic 档起步。
3. **「划词生成卡」式全文批注器（对标 Obsidian 明确不做的 PDF annotations）**：阅读器＋批注系统是另一个产品（1c 官方口径）；ASAKI 该做的是**深链**（P4）与**遮罩**（P3），不是通用批注。
4. **批注入数据库（Zotero 模式）**：「stores annotations in the Zotero database」与 vault 明文直读直接冲突（1e）；ASAKI 若做批注类数据一律旁挂 md/frontmatter。
5. **桌面活动监控式「中断检测」**（监听窗口切换/空闲计时来推断「分心了」）：Mark/Iqbal 描述的是现象，不是产品方案；监控 UX 与信任立场冲突（第三轮「问责陪伴」的教训同源），且 Windows 后台驻留成本高。
6. **强制倒计时答题**（每题倒计时压迫）：Anki 的默认哲学相反——数据照记、计时器默认关（1g/3d）；「The time taken does not influence scheduling」。压迫感伤害低技术素养用户的坚持（与 iter32 P0 断签恢复的「不羞辱」口径一致）。
7. **把 quick capture 升级成「收件箱系统」**（GTD 式多桶）：现状 quick capture 进聊天是**近因偏差下的可用性**选择；本轮证据不支撑跳到多桶收件箱（那是任务管理产品的路线）。只建议最小改动：闪念至少可「存为草稿笔记」（G3 附带）。

---

## 7. 反功能复核（每项候选对照三条铁前提）

- **P0**：明文直读 ✓（读现有复盘 md）；本地 ✓；低技术素养 ✓（无新界面，消息里多一句）。反向风险：连续多日同一 tomorrow 反复点名可能变成羞辱——措辞必须走 iter32 P0 的「不羞辱、给台阶」口径。
- **P1**：明文 ✓（attempt md 加一个数字字段）；本地 ✓；低技术素养 ✓（默认不显示计时器）。反向风险：用时数据被用户误读为「逼自己更快」——统计呈现用「趋势」不用「及格线」。
- **P2a**：明文 ✓（检查点是 frontmatter 列表）；本地 ✓（检查点可由 butler 本地模型生成，生成的归「待核对」，与现有 `reviewedAt` 机制同构）；低技术素养 ✓（勾选交互）。反向风险：检查点太细变成新的负担——上限 3 条。
- **P2b**：明文 ✓；本地 ✓；低技术素养 ✓。反向风险：落盘的 focus 恢复提示在用户已经换任务时变成打扰——恢复提示只在当天内有效，跨天作废。
- **P3**：明文 ✓（遮罩坐标 frontmatter JSON，Obsidian 可读）；本地 ✓；低技术素养 ✓（拍照→点 Add）。反向风险：遮罩卡「看图猜」如果遮太大块会变成背图而非理解——默认推荐 Hide All, Guess One。
- **P4**：明文 ✓；本地 ✓；低技术素养 ✓。

## 8. 引用清单

**开源项目**
1. marker（datalab-to/marker）README — https://github.com/datalab-to/marker
2. MinerU（opendatalab/MinerU）README/LICENSE.md — https://github.com/opendatalab/MinerU
3. Obsidian help：Embed files / PDFs（obsidianmd/obsidian-help，`en/Linking notes and files/PDFs.md`）— https://github.com/obsidianmd/obsidian-help
4. Anki manual：Image occlusion / editing（ankitects/anki-manual `src/editing.md`）— https://github.com/ankitects/anki-manual
5. Zotero docs：pdf_reader / annotations_in_database / note_templates（zotero/zotero-docs）— https://github.com/zotero/zotero-docs
6. nusnlp/nea、mankadronit/Automated-Essay--Scoring、benhamner/ASAP-AES 等（AES repo search）— https://github.com/nusnlp/nea
7. Anki manual `src/stats.md`＋源码 rslib（deckconfig/answering/revlog）— https://github.com/ankitects/anki
8. Obsidian Workspaces / Tabs（obsidian-help）＋ Super Productivity README — https://github.com/johannesjo/super-productivity

**社交媒体**（全部经 arctic-shift / hn.algolia 取回原文核验；⑦为网页摘要转述）

9. r/ADHD（1uy9qwb，202 分）— https://www.reddit.com/r/ADHD/comments/1uy9qwb/noticed_this_my_phone_isnt_the_distraction_its/
10. HN 44999373（282 分）The cost of interrupted work — https://news.ycombinator.com/item?id=44999373
11. r/GetStudying（1s98zm4，205 分）— https://www.reddit.com/r/GetStudying/comments/1s98zm4/tipsadvices_needed/
12. r/GRE（1jg8bjo）AI 批改器给分打架 — https://www.reddit.com/r/GRE/comments/1jg8bjo/doubt_with_awa_score/
13. r/EnglishLearning（1buisx9）— https://www.reddit.com/r/EnglishLearning/comments/1buisx9/could_you_check_my_essay_and_letter_please/
14. r/WriteStreakEN（1wru23s）AI 全量纠错伤信心 — https://www.reddit.com/r/WriteStreakEN/comments/1wru23s/streak_1/
15. 知乎：考研英语作文批改平台（592 赞/2508 收藏，tardis 镜像摘要转述）— https://www.zhihu.com/tardis/zm/ans/1737930267
16. r/Anki（1nqw18d，50 分）PDF 讲义手动做卡太慢 — https://www.reddit.com/r/Anki/comments/1nqw18d/to_save_time_studying_i_made_a_script_that_turns/
17. r/Anki（wlakek）1500 页 PDF→5000 卡求助 — https://www.reddit.com/r/Anki/comments/wlakek/how_to_quickly_turn_a_whole_pdf_textbook_into/
18. r/Anki（1rkrksd）手写笔记拍照转卡 — https://www.reddit.com/r/Anki/comments/1rkrksd/vlmllm_card_creation_toolpluginapp/
19. r/Mcat（1vjyy1d）计时崩溃与 flag-and-move-on — https://www.reddit.com/r/Mcat/comments/1vjyy1d/how_did_you_actually_fix_mcat_timing_im_not/
20. r/Mcat（1w6h5oc）正式考试紧张超时 — https://www.reddit.com/r/Mcat/comments/1w6h5oc/timing_issues_and_testing_anxiety/

**网站/博客**
21. Hemingway Bridge — https://concepts.dsebastien.net/concept/hemingway-bridge/
22. UW News：Task interrupted — https://www.washington.edu/news/2018/01/16/task-interrupted-a-plan-for-returning-helps-you-move-on/
23. The Writing Revolution：Our Method — https://www.thewritingrevolution.org/method/
24. Anki docs：Deck Options（Timers 节）— https://docs.ankiweb.net/deck-options.html
25. Obsidian help：PDF — https://help.obsidian.md/pdf

**论文**
26. Mark, Gonzalez & Harris 2005. No task left behind? Examining the nature of fragmented work. CHI 2005. DOI 10.1145/1054972.1055017（Crossref 核验＋PDF 已取回抽取）
27. Iqbal & Horvitz 2007. Disruption and recovery of computing tasks. CHI 2007. DOI 10.1145/1240624.1240730（Crossref 核验＋PDF 已取回抽取）
28. Altmann & Trafton 2002. Memory for goals: an activation-based model. Cognitive Science 26(1):39-83. DOI 10.1207/s15516709cog2601_2（Crossref 核验；原文未直读）
29. Leroy & Glomb 2018. Tasks interrupted... Organization Science 29(3)（付费墙；经 UW News 通稿核验，效应量不引用）
30. Graham & Perin 2007. Writing Next. Alliance for Excellent Education（本轮原文不可达；数字沿用第五轮核查＋PMC13374430 二次印证）
31. Wisniewski, Zierer & Hattie 2020. The Power of Feedback Revisited. Frontiers in Psychology. DOI 10.3389/fpsyg.2019.03087（Crossref 核验；效应量 0.48 沿用第五轮核查记录）
32. Panadero 等 2023. rubrics 元分析（g=0.45；第五轮核查记录）
33. NMAP 2008. Foundations for Success — https://ies.ed.gov/ncee/pdf/20084084.pdf
34. Fact-fluency 元分析 2026. Journal of Learning Disabilities 59(3) — https://pmc.ncbi.nlm.nih.gov/articles/PMC13069136/（PMC 全文本轮实读）
35. PMC13374430（开放获取综述，Graham & Perin 二次印证）— https://pmc.ncbi.nlm.nih.gov/articles/PMC13374430/
36. Mayer 多媒体原则元分析（g≈0.37-0.39；第五轮核查记录）

**代码证据**（child worktree @ c5b08fe）
37. `src/main/check-ins/prompt.ts:340-390`（晨间 prompt 组成）、`:382`（晚间收集明天第一步）
38. `src/main/context.ts:884`（ReviewRecord.tomorrow 入库）
39. `src/main/memory/synthesize.ts:30-46`（tomorrow 的间接路径）
40. `src/renderer/shell/Workspace.tsx:296`（focus 内存态）、`:2200-2202`（quick capture→聊天）
41. `src/renderer/shell/focus-timer.ts:7`（FocusSession 类型）
42. `src/shared/practice.ts:23-24、27-42、62-74`（题型、无溯源、无用时）
43. `src/main/practice/practice-service.ts:585-586、690-691`（selfCorrect 自判）
44. `src/main/index.ts:20、315-320`（video-only 导入过滤）

## 9. 一句话结论

iter32 修的是「坚持」（断签、计划、考前），iter33 该修的是「恢复与质量」：**先把昨晚写下的第一步在今早递回（P0，一行 prompt），再把「对了但慢」变成可见信号（P1，纯数据），然后给主观题一面自查镜子（P2a）和给中断现场留一座桥（P2b）**；照片遮罩卡（P3）与页码溯源（P4）作为导入线的第一二步，而 AI 批分、整本 OCR、桌面监控、强制计时四条路本轮明确拒收。
