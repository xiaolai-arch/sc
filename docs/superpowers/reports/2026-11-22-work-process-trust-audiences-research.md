# 第三轮调研：工作过程透明、本地信任、未覆盖受众（2026-11-22）

日期：2026-11-22
方法：先读真实用户讨论（Reddit 帖与评论树、Hacker News、App Store 评论区），再对照 1979–2026 年关于"劳动错觉/操作透明"与服务信任的研究；每条主张都带可回链 URL，引语保留原文并给中文释义。§0 说明取数方式与站点可达性，§1 是三块主题的证据，§2 与 ASAKI 现状对照（文件:行），§3 是排过序的 ≤6 项待办，§4 是反功能复核。

第一轮（[2026-11-21](2026-11-21-user-needs-research.md)）覆盖"练与学"八项、第二轮（[2026-11-22](2026-11-22-butler-needs-research.md)）覆盖"问责"六项，均已上线（iter23–28，`master` `74cd40f`）。本轮不重复：两份旧报告已立的待办在这里不再出现；它们各自 §6 的反功能清单在本轮 §4 逐条复核。

## 0. 取数方式与可达性（诚实声明）

- **Hacker News**：官方 Algolia API（`hn.algolia.com/api/v1/items/<id>`）取 item 与评论树全文，评论正文逐字核对后引用；URL 均为 `news.ycombinator.com/item?id=…`。
- **Reddit**：`reddit.com` 的 HTML 与 `.json` 在本机被网络层拦截（直连返回 000/403）。因此通过 Reddit 公共归档 API（`arctic-shift.photon-reddit.com`）读帖子原文与评论树；本次该 API 对关键词搜索参数限流严重（多次返回 `Timeout. Maybe slow down a bit`），故改用「先由站点内搜索定位帖子，再按 `link_id` 拉评论树」的路径。下面引用的每条评论都用该 API 复核过作者、分数与 permalink；URL 是 reddit.com 的规范地址，并尽量指到该评论。
- **App Store**：公开评论 RSS 可直读（`itunes.apple.com/us|cn/rss/customerreviews/…/json`）。本轮主题的证据主要来自 Reddit/HN，中文评论只用作背景，不再展开。
- **论文**：本轮的核心研究是 Buell & Norton (2011)《The Labor Illusion》（Management Science 57(9)），通过 HBS 公开 PDF 与 INFORMS 页面核对题录；arXiv 继续可直读。
- **本报告只做事后聚类**，没有做量化抽样；每组的「证据」是"能引用的独立帖/评论条数"，不是人群比例。第三块受众（§1.3）的样本集中在 ADHD/Notion 社区，覆盖面偏窄，已在结论处标注。

---

## 1. 证据

### 1.1 「工作过程可见」：用户在等的时候怕什么

**（a）看见"它在干活"本身就有价值——劳动错觉。**
Buell & Norton (2011) 的五组实验（在线旅行/婚恋搜索场景）发现：当网站把"正在执行的搜索步骤"展示给用户时，用户**反而更喜欢那些故意慢一点、但把过程展示出来的网站**，哪怕结果完全相同；机制是"看到付出 → 互惠感 → 价值感上升"。这是操作透明最经典的效应，直接支持"工作过程区"这个方向（[Management Science 57(9):1564–1579](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.1110.1376)，[HBS 全文 PDF](https://www.hbs.edu/ris/Publication%20Files/Norton_Michael_The%20labor%20illusion%20How%20operational_f4269b70-3732-4fc4-8113-72d0c47533e0.pdf)）。

**（b）反过来，"看不见"会被直接解读成"它在装"。**
r/ChatGPT 一条关于"ChatGPT 卡住不动"的回复把话说得最直白：「I'll save you a few hours of time: if there's nothing actively indicating that it's generating any pages (e.g. a moving progress bar or 'thinking' time increasing), then it's 100% hallucinating the entire process and not doing anything.」（省你几小时：如果没有任何东西在动——比如会走的进度条、或在增加的"思考"时间——那它 100% 是在假装整个过程，什么都没做）— [r/ChatGPT 1om71ry 评论](https://www.reddit.com/r/ChatGPT/comments/1om71ry/chatgpt_changed_lately_and_not_working/nmosblt/)。同帖另一条从用户侧描述了等待的痛感：「I am currently waiting 1-2 hours for chatgpt to get back to me with 3-4 draft pages of a very simple document.」（一份很简单的文档，我正在等 1–2 小时）— [nmohsdr](https://www.reddit.com/r/ChatGPT/comments/1om71ry/chatgpt_changed_lately_and_not_working/nmohsdr/)。

**（c）但"可见"必须是真的——假进度条是已知反例。**
Gmail 假加载条的讨论（2021）里，用户对"装饰性进度"的记忆是负面的：「I remember Internet Explorer also doing this back in the day… Only much later I learned it meant nothing, it was just showing it wasn't dead.」（小时候我以为它在显示真实进度，很久之后才知道它什么意思都没有，只是表示"程序还活着"）— [HN 29184858](https://news.ycombinator.com/item?id=29184858)；也有人给出正面读法：进度条的价值是「a kind of binary indicator」（一个"活着/卡死"的二值指示器）— 同帖 jeffbee。对游戏式"拉到 99% 然后等几分钟"的吐槽也在这条线程里：「Loading bar zips to 99% and then you wait for a few minutes.」— 同帖 drawqrtz。

**（d）长时间运行的可信度是独立的维度。**
HN 上对长任务 agent 的信任是按"能托付多久"计量的：「It's the first one that I trust for long running (>1 hour) tasks.」（这是我第一个敢托付 1 小时以上长任务的模型）— [HN 49946567](https://news.ycombinator.com/item?id=49946567)（danbrooks）。同一帖里有用户对"跑了 9 小时"的第一反应是震惊（"9 hours?!"，同帖 chewchewchew）——说明长运行本身就需要解释，而不是默认用户不慌。

**小结**：① 透明方向是对的，且已有研究背书；② 透明的前提是"真"——假进度、装饰性动画会反向摧毁信任；③ 对"已运行 N 秒"这类等待，最稀缺的是**它此刻正在做哪一步**和**做完之后去哪里看结果**。

### 1.2 本地优先的信任：备份、迁移、误删、换机

两份旧报告都把"无账号、无服务器、无遥测"当强项（第二轮 §4/2.6），但没有回答它的另一面：**数据在本机，本机就是单点**。这一块在真实讨论里密度很高。

**（a）丢一次 vault，就是永久离开。**
r/ObsidianMD 高分帖（364 分，320 评论，2026-11）：「Not looking for help, just grieving. I've been worldbuilding a homebrew setting for over 2 years now and one day I simply lost it all. Spent an entire week trying to fix it to no avail… now I'm going to have multiple forms of backup and completely avoiding any form of syncing and automatic updating.」（不是求救，是哀悼。我做了两年多的设定集，某天就全没了，花了一整周也没救回来……现在我会有多种备份形式，并且**完全避开任何同步和自动更新**）— [r/ObsidianMD 1xipb51](https://www.reddit.com/r/ObsidianMD/comments/1xipb51/i_lost_my_entire_vault_that_i_have_been_working/)。最高赞评论（200 分）说的是同一件事的另一面：「One of the first things I did when I switched to Obsidian was to enable the git plug-in. Honestly that thing should be built-in.」（我换到 Obsidian 做的第一件事就是开 git 插件。说实话这东西应该内置）— [guhcampos 评论](https://www.reddit.com/r/ObsidianMD/comments/1xipb51/i_lost_my_entire_vault_that_i_have_been_working/)。同帖还有一条高赞追问（69 分）「How does one 'simply' lose an entire vault?」——说明**用户自己也说不清自己的数据是怎么没的**，这正是本地优先产品的信任盲区。

**（b）社区共识：压缩归档 + 异地，而这全套都是用户自己拼的。**
r/ObsidianMD 的 PSA 帖（122 分）给了标准做法：「1) Use an archiving tool to compress your vault into one file, set a password… 2) Backup outside of your main computer, in the cloud with free tier storage or an external harddisk (avoid USB key).」（用压缩工具把 vault 打成一个带密码的文件；备份到主机之外——云免费额度或外置硬盘，别用 U 盘）— [r/ObsidianMD 1r3m9w0](https://www.reddit.com/r/ObsidianMD/comments/1r3m9w0/psa_backup_your_vault/)。评论区全是用户自装的方案：local backup 插件（29 分，「zips the vault and can put it to a folder synched with gdrive for example」）、syncthing + 每日归档脚本、duplicati——**没有一个是产品内置的**。

**（c）云备份也有信任门槛：宁可不备，也不把数据放别人机器上。**
r/ObsidianMD 一条关于加密备份的帖子里：「I don't put my data on computers belonging to other people, not even encrypted.」（我不把数据放到属于别人的计算机上，加密了也不放）— [1pjg2b5 评论](https://www.reddit.com/r/ObsidianMD/comments/1pjg2b5/how_do_you_encrypt_your_obsidian_vault_in_order/)。这与第二轮报告 §2.6（隐私）同向：ASAKI 不该做云备份，但**本地自动备份 + 异地副本的指引**是这一群人真正在拼的东西。

**（d）"能不能导出"是信任的试金石，产品方答不上来就失去用户。**
HN 上 Lowercase（在线笔记产品）的讨论里：「Can I export or host the data myself? For work sensitive notes I can't/won't use an untrusted sync mechanism.」（能不能自己导出或自托管？工作敏感的笔记，我不会用我不信任的同步机制）— [HN 40248217](https://news.ycombinator.com/item?id=40248217)（yellow_postit）；「Yeah, I couldn't imagine hosting my Most Important Notes on a freebie service whose provenance I don't entirely know. Notes are self host for me.」（我没法想象把最重要的笔记放在一个来路不明、说不定哪天就不做了的免费服务上）— 同帖 detritus。创始人在同帖承认「there isn't a way to export (or self host) as of now.」——这条帖子里对这个产品的不信任就此定型。还有一类更深的担忧：免费托管服务的存续本身（「either they won't be able to afford to run it much longer… or they start charging more… once I become reliant on it」）— 同帖 aae42。

**（e）本地存储的失败模式与"迁移"缺口，HN 有一个 13 年的样本。**
「My application I used daily for 13 years stores the data in localStorage and I had several unpleasant data loss incidents - mostly me cleaning storage of the wrong browser tab. Thankfully, a simple JSON dump/import feature enables a good enough degree of reliability. Thanks to it, I didn't lose any data in 5 years, but now I have a questionable habit where I defensively export data before every major edit or deployment.」（我日用 13 年的应用把数据放在 localStorage，出过好几次不愉快的数据丢失——多半是我清错了标签页的存储。一个简单的 JSON 导出/导入让可靠性"够用"了，这五年没丢过；但我也落下一个毛病：每次大改动前都先防御性导出一份）— [HN 42527344](https://news.ycombinator.com/item?id=42527344)（Klaster_1）。同帖另一条点出代价：「that does mean that you can't migrate between browsers/machines」（那就意味着你没法在浏览器/机器之间迁移）— 同帖 yjftsjthsd-h。

**（f）"本地优先"本身已经是用户验收的标准，而不是卖点。**
Notesnook 的 HN 讨论里，差评的措辞直接把验收清单列出来：「the app is not local-first, it lacks offline mode which would be guaranteed to work on a plane, … no encrypted backups」（它不是本地优先的，没有能保证在飞机上用的离线模式……也没有加密备份）— [HN 38707156](https://news.ycombinator.com/item?id=38707156)（pshirshov）。对 ASAKI 的含义：宣称本地优先之后，**离线可用性和备份**就是用户默认会检查的两件事。

### 1.3 第三块受众：「想法很多，落不了地」

前两轮覆盖了"练与学"和"问责"。这一块的共同画像是**想法多、开局热情高、维护意愿低**的人——他们不是不知道该做什么，而是项目在"第二周"死掉。

**（a）项目墓地是常态，不是例外。**
r/ADHD 高赞帖（905 分）原话：「My house is a cemetery of creative tools and abandoned projects gathering dust.」（我家就是一座放着落灰的创意工具和弃坑项目的墓园）— [r/ADHD pjobq8 评论](https://www.reddit.com/r/ADHD/comments/pjobq8/im_done_with_adhd_creativity_bs/hbxtlxa/)（TreeUsual3641）。同帖另一条（146 分）把机制说清：「And half the time that creativity isn't seen to completion lol.」（而且一半时候那个创意根本看不到做完）— [StoicMegazord 评论](https://www.reddit.com/r/ADHD/comments/pjobq8/im_done_with_adhd_creativity_bs/hbxtcwv/)。

**（b）维护系统本身变成新的放弃点。**
r/ADHD 的 Notion 过度工程帖里，一组互相印证的评论：「then spent more time getting a system in place never to use it. Eventually I realised that the more detail I added to 'customise' and catch every edge case instead just meant adding the tasks was a task in itself.」（花了更多时间搭系统却从没用它；我最后发现，越是往"自定义"和"兜住每种边角情况"里加细节，就越等于"录入任务本身成了一项任务"）— [1plfihd 评论](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/ntsn5dk/)（CultistOfTheFluid，15 分）；「it got so complicated and overwhelming it lasted 2 weeks and I haven't opened it since.」（系统复杂到我撑了两周，之后再没打开过）— [同帖](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/ntu49dl/)（Potteryc）；「the tinkering feels productive but it's just procrastination with extra steps」（折腾系统感觉很有产出，其实就是绕了一圈的拖延）— [同帖](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/nts8w3n/)（Many_Departure_6613，24 分）；同一现象在 ADHD 书里有个名字：「They call it pseudo-efficiency in ADHD books.」（ADHD 的书里管这叫"伪效率"）— [同帖](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/ntszmyf/)（farshiiid）。

**（c）对这群人有效的是"10 分钟的许可"，不是更好的系统。**
同帖最高赞回复（24 分）给了机制解：「i just tell myself '10 minutes on this one thing, don't even have to finish it' and somehow that's enough to trick my brain into moving, once i'm in motion i usually keep going but the permission to stop after 10 minutes makes starting possible.」（我只对自己说"这件事做 10 分钟，做完做完不完都行"，这就够把脑子骗进动了；一旦动起来通常能继续——**"10 分钟后可以停"的许可是开始的前提**）— [同帖](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/nts8w3n/)。这与 iter25 已上线的「我卡住了」→ 一个 2 分钟动作同构，但对象不同：iter25 解决"这一刻动不了"，这群人缺的是**这个项目间隔 N 天之后，还有没有人替他记得它**。

**证据强度**：4 条独立评论 + 1 个高分帖，集中在 ADHD/Notion 社区；"长期跟进一个具体项目"的人群（论文写作、独立开发、世界设定/同人创作）在本轮证据里只有 1xipb51 的世界设定帖一个直接样本。结论应视为**方向性**，不是定论。

---

## 2. 与 ASAKI 现状对照（文件:行）

| 块 | 现状 | 依据 | 缺口 |
| --- | --- | --- | --- |
| 工作过程可见 | 「正在为你处理 · 已运行 N 秒」表头 + 工具行 running/done/failed + 手动展开后不再自动折叠：`src/renderer/shell/TraceFlow.tsx:269`、`:173`；结束后的结果入口从**真实工具结果**派生、每类最多一条：`src/renderer/shell/trace.ts:56-61`、`resultLinksFromTrace()` `:64` 起；检索结果送入模型上下文：`src/main/butler/butler-service.ts:188` | §1.1：透明方向正确且被研究背书（[2603.17887](https://arxiv.org/abs/2603.17887) 已在第二轮引用；本轮新增劳动错觉） | 没有任何本地证据回答"入口有没有人点"——产品自己不知道这项功能的使用情况 |
| 本地信任 | 手动导出/恢复在设置页：`src/renderer/settings/SettingsPage.tsx:1375-1394`；恢复前确认文案「恢复前会自动保存一份当前数据的快照」：`:607`；备份是 vault 纯文件拷贝（含 symlink 解引用）：`src/main/backup.ts:79-120`；恢复前快照到 `<userData>/restore-safety/<stamp>` 且失败可回滚：`src/main/backup.ts:293-328`；`state.json` 有意不恢复（含 vault 路径与 provider 设置）：`src/main/backup.ts:293-295` | §1.2：丢 vault = 离开；社区方案全是用户自装 | 无自动/定时备份；无「距上次备份 N 天」的可见状态；备份与设置/API Key 的关系只在恢复确认文案里说了一半，没有「换机步骤」说明 |
| 第三受众 | 今日页置顶 1–3 件 + 目标进度：`src/renderer/shell/TodayOverview.tsx:548`；「今日只做一件」：`TodayOverview.tsx:647`；「我卡住了」：`TodayOverview.tsx:434`；承诺回访：`src/main/check-ins/prompt.ts:68-80` | §1.3：想法多的人死于"第二周" | 系统记得"今天的任务"，但不记得「这个项目已经 N 天没有推进」——停摆不是一个被记录的对象（与第二轮 §4 的「承诺」缺口同构） |

---

## 3. 排序后的待办（≤6 项，按需求 × 契合 × 成本）

排序说明：每项给出「痛点 1 行 + 最小诚实做法 + 挂靠的现有界面 + 证据强度」。全部不需要账号、服务器或新的通知渠道；逐条过了两份旧报告与本轮的反功能清单（§4）。

1. **「距上次备份 N 天」一行事实（默认关，opt-in）**
   痛点：本地优先意味着磁盘即命运，丢一次 vault 用户就永久离开（364 分帖 + 200 分评论）。
   做法：设置「数据与备份」区加一个开关；打开后，周复盘末尾追加一行「上次导出备份是 N 天前（M 月 D 日）」，导出当天不追加；不新增任何通知渠道、不加弹窗。
   挂靠：周复盘文案 `src/main/check-ins/weekly-honest.ts:174`；导出时间可由 `src/main/backup.ts:170`（`handleExportBackup`）落一个本地标记；设置区 `src/renderer/settings/SettingsPage.tsx:1375-1394`。
   证据：强（[1xipb51](https://www.reddit.com/r/ObsidianMD/comments/1xipb51/i_lost_my_entire_vault_that_i_have_been_working/)、[1r3m9w0](https://www.reddit.com/r/ObsidianMD/comments/1r3m9w0/psa_backup_your_vault/)、[HN 42527344](https://news.ycombinator.com/item?id=42527344)）。

2. **可选的定时自动备份（默认关，备份到用户选定目录）**
   痛点：社区的最佳实践（压缩归档 + 异地）全靠用户自装插件和脚本。
   做法：设置里可选「每周自动导出备份到…」，复用现有 `createBackup`（`src/main/backup.ts:79`，vault 解引用、异目录检查都已做好），固定时机挂周复盘同一条链路；失败只在下一条检查里说一次，不重试轰炸。
   挂靠：`src/main/backup.ts:79` + 设置页备份区。
   证据：强（[1r3m9w0](https://www.reddit.com/r/ObsidianMD/comments/1r3m9w0/psa_backup_your_vault/)：TriggerTG 推荐 local backup 插件、Caligapiscis 自装 syncthing+脚本、KillyMXI 推荐 duplicati——全部是"产品没做，用户自己拼"）。

3. **把「备份里有什么 / 换机怎么带走」写成用户可见的一句话**
   痛点：「备份不包含设置与 API Key」「恢复会覆盖什么」目前只在恢复确认弹窗里出现一次（`SettingsPage.tsx:607`），导出完成后没有任何内容清单；换机步骤无处可看。
   做法：导出完成的提示里列出实际包含的目录（vault / conversations / settings / usage）与文件大小；备份区尾部加三行「换机步骤」说明（新机安装 → 从备份恢复 → 重新登录模型接口）。纯文档级改动。
   挂靠：`src/main/backup.ts:293-295`（注释已明确 state.json 不恢复）、`SettingsPage.tsx:1375-1394`。
   证据：中–强（[HN 42527344](https://news.ycombinator.com/item?id=42527344) yjftsjthsd-h「can't migrate between browsers/machines」、[HN 40248217](https://news.ycombinator.com/item?id=40248217) 导出即信任试金石）。

4. **「停摆项目」事实行（opt-in，只陈述、可关）**
   痛点：「想法多、落不了地」的人死于第二周；系统记得今天，不记得"这个项目 N 天没推进"。
   做法：项目页（或今日页目标进度区）加一行可选事实：「「X」已经 12 天没有推进（上次：11 月 10 日）」，措辞只陈述，不评价、不催促；设置里可整体关闭。
   挂靠：项目分区 `src/renderer/shell/ProjectSections.tsx`（现有任务/笔记分组处）；目标进度区 `src/renderer/shell/TodayOverview.tsx:548`。
   证据：中（[pjobq8](https://www.reddit.com/r/ADHD/comments/pjobq8/im_done_with_adhd_creativity_bs/hbxtlxa/) 905 分 + [1plfihd](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/ntsn5dk/) 三条评论；受众与第二轮问责人群重叠度高，边际价值待验证）。**风险**：措辞稍重就会命中第二轮 §6 的"让用户内疚"反功能——验收时看文案而不是看功能。

5. **给工作过程补一个本地使用统计（本地文件，不联网）**
   痛点：本轮所有关于「用户会不会点结果入口」的证据都是间接的；产品没有任何本地手段回答它。
   做法：把「工作过程区展开次数 / 结果入口点击次数」按天记到 `<userData>/usage/` 本地文件（现有 usage 已有先例）；在设置「数据与备份」区给一行「查看本地统计」入口。没有遥测，数据不出机器。
   挂靠：`src/renderer/shell/trace.ts:64`（`resultLinksFromTrace` 已是唯一入口）、设置页统计区（现有 token 用量卡）。
   证据：间接（[劳动错觉](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.1110.1376)证明透明有价值，但"入口点击率"只能实测）。

6. **长任务的一句话解释（挂靠现有等待表头，不加动画）**
   痛点：「已运行 N 秒」回答了"活着吗"，没回答"在干什么"；用户对不可见等待的第一解读是"它在装"。
   做法：等待表头在首个工具事件到达前显示一句真实状态（如「正在读取今日任务与长期计划…」，从既有的 context 组装顺序派生，不新造步骤）；绝不做百分比或预计剩余时间。
   挂靠：`src/renderer/shell/TraceFlow.tsx:269`；状态来源 `src/main/butler/butler-service.ts:169`（`loadReferences`）等既有步骤。
   证据：强（[1om71ry 评论](https://www.reddit.com/r/ChatGPT/comments/1om71ry/chatgpt_changed_lately_and_not_working/nmosblt/)、[HN 29184858](https://news.ycombinator.com/item?id=29184858) 假进度反例、[劳动错觉](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.1110.1376)）。

**明确排除的候选**：云同步/云备份（违反第二轮 §2.6 与 [1pjg2b5](https://www.reddit.com/r/ObsidianMD/comments/1pjg2b5/how_do_you_encrypt_your_obsidian_vault_in_order/)「不放别人机器上」的硬前提）；加密归档（ASAKI 的 vault 本来就是明文 markdown，加密会让 Obsidian 直读这一核心卖点失效；需要加密的用户用 duplicati/7zip 自装，报告只提供指引）；游戏化连续天数（反功能，见 §4）。

## 4. 反功能复核（两份旧报告 §6 + 本轮新增）

| 反功能 | 本轮结论 |
| --- | --- |
| 更多提醒/通知渠道（[2610.24411](https://arxiv.org/abs/2610.24411) 打断预算） | 待办 1/2 全部挂靠既有周复盘/检查链路，不加渠道；待办 4 是页面事实行，不是通知 |
| 连续打卡/断签/游戏化（Tiimo、Habitica 反例） | 待办 1/2/4 都只显示"距离上次"，不做连续天数、不做目标值；1plfihd 里 apithrow 自己用 "streak goals" 是个人做法，不吸收进产品 |
| 假进度/制造倒计时压力（[1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/)） | 待办 6 明确禁止百分比与预计剩余时间；[HN 29184858](https://news.ycombinator.com/item?id=29184858) 是负面清单 |
| 替用户承诺/替用户排满 | 待办全部 opt-in 或默认关；备份是"替用户做的事"但只写本机目录，不外发 |
| 监控式生活记录 | 待办 5 的统计只记点击/展开计数，留在本机 `userData`，不联网、不可上传；若实现，需在说明里写明数据范围 |
| 拟人化陪伴（[2609.14843](https://arxiv.org/abs/2609.14843)） | 本轮全部待办无拟人化；备份/迁移文案保持"工具"语气 |

## 5. 引用清单（按首次出现顺序）

**研究**
1. Buell & Norton, *The Labor Illusion: How Operational Transparency Increases Perceived Value*, Management Science 57(9):1564–1579 (2011) — [DOI](https://pubsonline.informs.org/doi/abs/10.1287/mnsc.1110.1376) · [HBS PDF](https://www.hbs.edu/ris/Publication%20Files/Norton_Michael_The%20labor%20illusion%20How%20operational_f4269b70-3732-4fc4-8113-72d0c47533e0.pdf)

**Hacker News**
2. [Gmail's fake loading indicator (2020)](https://news.ycombinator.com/item?id=29184858) — 2021-11（Ndymium / jeffbee / drawqrtz 评论）
3. [Lowercase – A simple way to take and share notes](https://news.ycombinator.com/item?id=40248217) — 2024-05（yellow_postit / detritus / aae42 / siegers 评论）
4. ["local storage is too fragile to be the system of record"](https://news.ycombinator.com/item?id=42527344) — 2024-12（Klaster_1 / yjftsjthsd-h 评论）
5. [Notesnook – open-source and zero knowledge private note taking app](https://news.ycombinator.com/item?id=38707156) — 2023-12（pshirshov 评论）
6. [Getting the most out of Opus 5.5 in Claude and Claude Code](https://news.ycombinator.com/item?id=49946567) — 2026-10（danbrooks / chewchewchew 评论）

**Reddit**
7. [r/ObsidianMD 1xipb51 — I lost my entire vault that I have been working on for 2 years now](https://www.reddit.com/r/ObsidianMD/comments/1xipb51/i_lost_my_entire_vault_that_i_have_been_working/) — 2026-11（364 分 / 320 评；guhcampos 评论 200 分）
8. [r/ObsidianMD 1r3m9w0 — PSA : Backup your vault](https://www.reddit.com/r/ObsidianMD/comments/1r3m9w0/psa_backup_your_vault/) — 2026（122 分；TriggerTG / Caligapiscis / KillyMXI 评论）
9. [r/ObsidianMD 1pjg2b5 — How do you encrypt your Obsidian vault…](https://www.reddit.com/r/ObsidianMD/comments/1pjg2b5/how_do_you_encrypt_your_obsidian_vault_in_order/) — 2026（johsny 评论）
10. [r/ChatGPT 1om71ry — ChatGPT changed lately and not working](https://www.reddit.com/r/ChatGPT/comments/1om71ry/chatgpt_changed_lately_and_not_working/) — 2026-11（changing_who_i_am / OzButcher78 评论）
11. [r/ADHD pjobq8 — I'm Done With ADHD Creativity BS](https://www.reddit.com/r/ADHD/comments/pjobq8/im_done_with_adhd_creativity_bs/) — 2021（TreeUsual3641 905 分 / StoicMegazord 146 分评论）
12. [r/ADHD 1plfihd — Ugh, I fell into the (well-known?) trap of over-engineering my life with Notion](https://www.reddit.com/r/ADHD/comments/1plfihd/ugh_i_fell_into_the_wellknown_trap_of/) — 2026（Many_Departure_6613 24 分 / CultistOfTheFluid 15 分 / farshiiid / Potteryc 评论）

## 6. 一句话结论

工作过程区方向正确（研究背书），要守住的是"真实"——宁可少而真，不要漂亮而假；本地优先最大的未爆风险不是隐私而是**备份与迁移的沉默**——用户丢一次数据就永久离开，而这套东西现在全靠用户自己拼；第三块受众（想法多、落不了地的人）需要的是「有人替我记得这个项目 N 天没动了」这样的一行事实，而不是又一套要维护的系统。
