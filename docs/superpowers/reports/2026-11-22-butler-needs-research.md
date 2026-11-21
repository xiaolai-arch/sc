# 用户需求调研（第二轮）：想要「一对一管家 / 教练」的人到底要什么

日期：2026-11-22
方法：先读真实用户讨论（Reddit 帖与评论、Hacker News、App Store 中英文评论），再对照 2023–2026 年关于 AI 辅导、问责与主动代理的研究；每条主张都带可回链 URL，引语保留原文并给中文释义。§1 说明取数方式与站点可达性，§2 是八组痛点，§3 分列「被报告为有效」与「被报告为无效」的机制，§4 与 ASAKI 现状对照，§5 是排过序的 ≤6 项待办，§6 是这一群受众专属的反功能。

第一轮（[2026-11-21](2026-11-21-user-needs-research.md)）覆盖的是"练与学"——记不住、不知道该问什么、想被考、内容不可信。这一轮覆盖同一批人的另一半：**问责、跟进、生活与精力的协调**。两份报告不重叠：第一轮已立、且已上线的八项（讲完→明天抽测、主动抽测提议、讲解前诊断、用自己的话说一遍、一周诚实回执、生成内容标待核对、单题入库、首次运行"不用配置"）在这里不再出现。

---

## 1. 取数方式与可达性（诚实声明）

- **Reddit**：`reddit.com` 的 HTML 与 `.json` 在本机被网络层拦截（HTTP 403 Blocked）。因此通过 Reddit 公共归档 API（`arctic-shift.photon-reddit.com`）读取帖子原文与评论树；下面引用的帖/评论 ID 全部用该 API 复核过存在性与分数，URL 为 reddit.com 的规范地址。
- **Hacker News**：通过官方 Algolia 搜索 API 取评论全文与 item ID，URL 为 `news.ycombinator.com/item?id=…`（引用的是评论 ID 时链接同样直达该评论）。
- **App Store**：用 Apple 的公开评论 RSS（`itunes.apple.com/us|cn/rss/customerreviews/page=N/id=…/sortby=mostrecent/json`）取最新评论，正文与日期来自该接口；URL 指向应用页。
- **读不到、因而不引用**：Product Hunt（403）、Trustpilot（403）、知乎（403）、Bilibili 搜索接口（412 反爬）；小红书在未登录状态下取不到可引用的帖子正文。所以中文样本全部来自 App Store 中国区评论（脸疼、搭着学、小计划、小日常），不是知乎/小红书/B站。
- **论文**：arXiv API 可直读；下面区分「有效果数据」与「设计/访谈研究」，并标出样本量——小样本研究不当成效应量用。
- **本报告只做事后聚类**，没有做量化抽样：每组的「证据」是"能引用的独立帖/评论条数"，不是人群比例。
- **两条样本偏差，先说在前面**：（1）r/ADHD 与 r/adhdwomen 的自我选择样本不等于全体用户；（2）App Store 评论有明显的评分极化——中文「脸疼」的 5 星长评里有大量互相雷同的措辞（同一句"自律神器"反复出现，且夹带"围观也能赚钱"），这类评论不能当独立证据，只当"可能存在刷评"的线索；下面对 5 星评论的使用只限于它明确解释了机制（为什么有效）的场合。

## 2. 痛点聚类（8 组）

### 2.1 "要么它先来找我，要么我又要记得打开它"——问责必须自己回头

这是这一侧最一致的一组：用户要的不是更漂亮的待办清单，而是**一个会主动回头问的人**。

- r/ADHD「有没有问责搭子 App？」的回复里，有人直接在做这件事：「If I have to remember to go back into the accountability app myself, it kind of defeats the whole point.」（如果要我自己记得回去打开问责 App，那整件事就没有意义了）— [1w8c0qw 评论](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p8gwbdu/)（2026-09-08，同帖作者在推自己的产品，此处只引他对需求的描述）
- 同一帖里对 Focusmate 最精确的一句：「I still use it multiple times a week but I want a single person/system keeping tabs on my journey, daily.」（我一周还在用好几次，但我想要的是**一个人或一个系统，每天盯着我这条线**）— [p89my0u](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p89my0u/)（2026-09-07）
- 找人帮忙失败的原因也很具体：「I did ask our groupchat and no one responded.」（我在群里问了，没人回）— [p89nsgf](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p89nsgf/)（2026-09-07）
- r/DecidingToBeBetter「一个人是不是很难坚持目标」的回答里，有一条把形式讲得最可操作：「a promise you only make to yourself is easy to quietly drop, but once you have told another person you will do it, breaking it costs you a little face. … the trick is keeping the check in small and regular, like one real update a week, not some big dramatic pledge.」（只对自己许的诺言很容易悄悄放弃；说给另一个人听之后，违约要丢一点面子。诀窍是**小而规律**地检查，比如每周一次真实更新，不是什么大的誓言）— [1xy1j5k 评论](https://www.reddit.com/r/DecidingToBeBetter/comments/1xy1j5k/does_anyone_else_struggle_to_follow_through_on/19ss06l3cjk3k/)（2026-11-17）
- 有人把这件事做成小群并跑满一年，旁观者总结出人数上限：「the weekly email plus a short call is the part most accountability pairs skip, and it's probably why yours lasted a year. staying at 2 or 3 people helps too, past that someone always goes quiet.」（每周一封邮件加一次短通话，正是大多数搭子漏掉的部分；人一多，总有人会沉默）— [1xysy5m 评论](https://www.reddit.com/r/ADHD/comments/1xysy5m/is_there_an_accountability_partner_in_this/19stpxie6pnvk/)（2026-11-18）

**现有产品错在哪**：所有"自律 App"都把发起权留在用户手里——用户不打开，就没有人记得他说过什么。

### 2.2 "没人在等我的时候我就停住"——在场有效，但人不可靠

- r/adhdwomen 一篇 38 分的求助，标题就是需求本身：「I need some form of accountability right now」，正文：「Even if that's just saying this out loud, knowing other people know I have to do these things feels like a big step.」（哪怕只是说出来、让别人知道我要做这些，也算迈出一大步）— [1xsdtvg](https://www.reddit.com/r/adhdwomen/comments/1xsdtvg/i_need_some_form_of_accountability_right_now/)（2026-11-10）
- r/ADHD 2024 年一篇讲"用 ChatGPT 做身体双重在场"的帖子，把方法写得很具体——「I have ADHD and I would like you to pretend to be a "insert job role" so we can body double!」（请假装成某个岗位的同事，我们一起陪工），并「I come back and let it know I've finished the task and it'll cheer me on」（做完回来告诉它，它就会给我打气）— [1gzfbr0](https://www.reddit.com/r/ADHD/comments/1gzfbr0/chatgpt_for_body_doubling_wfh/)（2024-11-25）。同帖回复里既有"试了，对我有用"（「I am trying this out now and it is working for me」），也有主要是环保理由的强烈反对；真正质疑"它不算问责"的声音出现在另一帖（见 2.8）。
- Focusmate 类的痛点不是没人用，而是**对面的人会放鸽子，且不管事**：「it's too easy to cancel and keep postponing. A good chunk of people are vague and barely ask questions.」（太容易取消和一直往后推；相当一部分人很含糊，几乎不问问题）— [p89my0u](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p89my0u/)；另有整帖在问「No one is showing up to focusmate meetings?」（约了没人来），多名用户复现 — [1vgky6d](https://www.reddit.com/r/productivity/comments/1vgky6d/no_one_is_showing_up_to_focusmate_meetings/)（2026-08-05）
- 价格也是真门槛：「Focusmate is solid but pricey for what it is.」（好用，但按它提供的东西来说太贵了）— [1vjmp98 评论](https://www.reddit.com/r/productivity/comments/1vjmp98/alternatives_to_the_plattform_focusmate/p2s2qfo/)（2026-08-10）
- 研究侧（小样本，12 人，VR 砖墙任务）：独处 / 真人陪工 / AI 陪工三种条件下，**两种陪工都比独处更快、自评专注更好**（[arXiv:2509.12153](https://arxiv.org/abs/2509.12153)，2025-09-15）。另一项 14 名 ADHD 开发者的访谈给出关键机制：真人陪工提供社交支持，但「forces developers to constantly manage professional reputation and sacrifice personal privacy」（要不断管理自己的职业形象、牺牲隐私）；而 AI 陪工能「maintain accountability and cognitive flow without the social anxiety, performance judgment, or surveillance associated with human observation」（保持问责与心流，却没有被人盯着看的那种社交焦虑与评判）（[arXiv:2609.21254](https://arxiv.org/abs/2609.21254)，2026-09-18）。

**错在哪**：把"在场"外包给陌生人会把可靠性、价格和社交压力一起买进来；而完全不做，就只剩用户自己的意志力。

### 2.3 "它得知道我这周在忙什么"——要一个人，不要一堆孤岛

- r/ADHD「你会为一个真正懂哪些 ADHD 技巧对我有效的 App 付费吗」：「would def pay if it actually learned my patterns instead of just throwing random tips at me」（如果它真的学到我的模式、而不是随手甩一堆通用建议，我肯定付钱）— [1r2c41i 评论](https://www.reddit.com/r/ADHD/comments/1r2c41i/would_you_pay_for_an_app_that_actually_knows/o4vtkc8/)（2026-02-11）；同帖自嘲式反证：「I'd pay for it and forget about it knowing me」（按我的德性，付了钱就忘了）— [o4vuggf](https://www.reddit.com/r/ADHD/comments/1r2c41i/would_you_pay_for_an_app_that_actually_knows/o4vuggf/)
- 同一需求的另一面是"提醒我知道**为什么**"：「if an app actually reminded me *why* i should use it with like real proof that it worked for me before, i'd probably stick with it.」（如果它能提醒我"为什么该用"，并拿出我以前真的有效的证据，我大概就能坚持）— [o4w8c68](https://www.reddit.com/r/ADHD/comments/1r2c41i/would_you_pay_for_an_app_that_actually_knows/o4w8c68/)（2026-02-12）
- r/ADHD「我的个人生活一直在原地打转」：「having something that actually learns my specific patterns instead of just generic ADHD advice is really appealing, especially if it could catch those weird connections」（能学到我的具体模式、还能抓住那些奇怪关联的东西，真的很有吸引力）— [1qko1zb 评论](https://www.reddit.com/r/ADHD/comments/1qko1zb/i_feel_my_personal_life_just_goes_in_circles_and/o17whsy/)（2026-01-23）
- 生活负载协调的实战样本（伴侣一方 ADHD，哪套系统在用）：共享日历 + 冰箱白板 + "每人固定拥有某些任务" + 「a generic household queue that anyone can pick up from... "we as a team need to accomplish these things"」（一个谁有空谁接的公共家务队列，语气是"我们这队要完成这些"，而不是"我叫你做这个"）— [1xpc2x9](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/)（2026-11-06）；同帖最扎心的一条：「I have ADHD and my husband doesn't. We don't have a system… Everything is pretty much on me to take care of. It's exhausting sometimes.」（我家没有系统，几乎所有事都压在我身上，有时很累）
- 研究侧：个人代理真正的瓶颈被明确指为**上下文表示**——"这条事实什么时候成立、凭哪条原始记录"，并主张本地优先、冲突交给人裁决而不是静默覆盖（[arXiv:2611.16492](https://arxiv.org/abs/2611.16492)，2026-11-12）。

**错在哪**：日历只记时间，待办只记条目，没有任何一个地方同时知道"我这周在赶什么、哪几天特别满、上周答应过谁"。

### 2.4 "一对一辅导太贵、排课太麻烦、而且课上的结构得我自己带"

- r/languagelearning 50 节课后的复盘中，最有信息量的一句是**课外的部分没人管**：「I should definitely set aside the equal amount of time for study/review as I do for actual classes… The only issue sometimes is that going through the homework can take up a bit too much time in the next lesson.」（我得拿出和上课等量的时间复习；有时作业讲解又吃掉了下一节课）— [1xxr4mh 评论](https://www.reddit.com/r/languagelearning/comments/1xxr4mh/my_preply_experience_after_50_lessons_should_i/19sq7cvcf8j4z/)（2026-11-16）；同帖另一位用户把这件事讲成比例：「studying even 10 min a day, everyday speeds up more than 2 lessons a week of 1 h each.」（每天 10 分钟，比一周两节 1 小时的课推进得更快）— [1xxr4mh 评论](https://www.reddit.com/r/languagelearning/comments/1xxr4mh/my_preply_experience_after_50_lessons_should_i/19ss5jn5dq2ub/)
- 同帖对新方案的定价直觉：「I find it quite expensive for a jump from A1 to A2.」（为了从 A1 到 A2，这个价太贵了）— [19sqo5wpqu7z8](https://www.reddit.com/r/languagelearning/comments/1xxr4mh/my_preply_experience_after_50_lessons_should_i/19sqo5wpqu7z8/)
- 对"课上该干什么"的共识非常清楚：「Tutor time should be 80% you writing or speaking and the tutor correcting your output. Otherwise you are paying a tutor to read out a book to you.」（家教时间应该有 80% 是你在写/说、老师纠错；否则你是在付钱让人念书给你听）— [19srhf4i569d0](https://www.reddit.com/r/languagelearning/comments/1xxr4mh/my_preply_experience_after_50_lessons_should_i/19srhf4i569d0/)（2026-11-17）
- 而**结构要学生自己带**，这被反复当成经验之谈：「it's maddening when they just sit there waiting for you to produce conversation out of thin air. Bringing a workbook you picked out yourself is the move… It flips the dynamic from "entertain me" to "help me work through this chapter"」（他们干坐着等你自己凭空造出对话，这很气人；自己挑一本练习册带去，把局面从"逗我开心"翻成"帮我过这一章"）— [1xymfg1 评论](https://www.reddit.com/r/languagelearning/comments/1xymfg1/structured_tutor_lessons/19ssz4zir6ao0/)（2026-11-18）
- 「executive function coach」这个品类的信任度很低：「Sounds like a scam, just like life coach. Are they professionally trained, like therapists?」（听起来像骗局，跟"人生教练"一样。他们受过专业训练吗？）— [1sxy009 评论](https://www.reddit.com/r/ADHD/comments/1sxy009/executive_function_coach/oiq7l0y/)（2026-04-28）；同帖最尖锐的一句点出了要害：「we (the ones with ADHD) are *very* aware of what we need to do. The issue is the actual *starting* the doing.」（我们很清楚该做什么，问题在"开始做"）— [oitl96m](https://www.reddit.com/r/ADHD/comments/1sxy009/executive_function_coach/oitl96m/)
- 治疗与教练的分工也被讲清楚：「therapy for family/relationship stuff and a coach for practical systems… half my sessions were just explaining what executive dysfunction even is」（治疗管情绪与关系，教练管实际系统；我一半的会谈时间都在解释"执行功能是什么"）— [1x489ct 评论](https://www.reddit.com/r/ADHD/comments/1x489ct/therapist_vs_adhd_coach_or_both_as_an_audhder_and/pgfv634/)（2026-10-13）
- 研究侧：职业目标设定的三臂 RCT（N=517）里，AI 教练组比无支持组目标推进显著更高（d=0.33, p=.016），但**与"结构化的书面反思问卷"相比没有显著差异**；真正的中介变量是"被问责感"（indirect effect 0.15, 95% CI [0.04, 0.31]）（[arXiv:2603.17887](https://arxiv.org/abs/2603.17887)，2026-03-18）。另一项预注册实验（N=543）指出让目标设定聊天机器人有效的**关键不是建议，而是反馈**（[arXiv:2602.08636](https://arxiv.org/abs/2602.08636)，2026-02-09）。

**错在哪**：真人家教贵在"人在场"，而用户真正需要的那部分——有人知道课程进度、记得上周的薄弱点、在课外盯着——恰恰是最容易被漏掉、也最该由机器补上的部分。

### 2.5 "别让我内疚"——检查越密，越接近截止就越瘫痪

这一组是整份报告里最需要小心的：**同一个人可以同时要"有人盯着"和"别让我有被盯着的感觉"**。

- r/ADHD 一篇讲"把问责外部化"的高赞帖下面，有人当场提出反例：「How do you avoid the anxiety panic paralysis from feeling monitored? … the closer it gets to the check in, the worse the paralysis gets.」（怎么避免"被监控"带来的焦虑性瘫痪？离检查越近，瘫痪越重）— [1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/)（2026-06-11）
- 他随后把要求推到极端：「I have to find the knife edge perfect combination of enough and genuine accountability… and yet make sure that situation then adds literally zero anxiety and doesn't make me feel "monitored"」（我得找到那个刀刃：问责够真、又完全不添焦虑、还不让我觉得自己被监控）— 同帖；回答很干脆：「that knife edge doesn't exist.」（那个刀刃不存在）
- 愧疚是这一群人的底色，也是最容易被产品放大的东西：「I just wish that I did not have to live with this guilt 24/7… guilt is the only feeling that persists.」（我只想不必 24 小时背着这份愧疚……愧疚是唯一一直留着的感觉）— [1y12u1e 评论](https://www.reddit.com/r/ADHD/comments/1y12u1e/i_do_well_until_i_dont_then_months_of_progress/19sx7k6ehxy1t/)（2026-11-20）
- 罚款/押金类机制的实际结局：stickK 有 12 年忠实用户（「I have been using StickK every week, without fail, for over a dozen years」），但 1 星评论集中在同一件事——系统故障或用户生病时照扣钱：「The entire server… was down for three days. There was no way to report completion of a task. Yet today I was charged for missing all of those days!」（服务器宕机三天无法汇报，照样按漏报扣钱）— [stickK](https://apps.apple.com/us/app/stickk-goals-accountability/id776128765)（2022-10-14）；另有多条「charged $30 every day even though I've been checking in」。
- 中文样本同样把"监督"做成了围观与审判：「刚开始用这个 app 就是单纯打卡，很久之后不用再使用后发现莫名其妙多个小法庭功能…动不动图文无关，动不动就输，动不动就扣钱，我是想找个 app 打卡的，不是钱多了烧的送钱的」（[脸疼](https://apps.apple.com/cn/app/id1488289635)，2025-12-30）；另一条 1 星：「被恶意举报了只给 3 小时申述时间，谁会上午打完卡下午还会点开看呢？」（2025-09-20）
- 而且"提醒太多"本身就被当成故障源：「You say too many notifications. Maybe, that's the issue here.… I realized of how 70% on the notifications I get are completely useless.」（也许是通知太多；我发现我收到的通知里 70% 完全没用）— [1s29944 评论](https://www.reddit.com/r/ADHD/comments/1s29944/i_kept_telling_myself_ill_remember_it_later_i/)（2026-03-24）
- 研究侧：给主动代理设"打断预算"后，把提问限制在 1–3 个可把用户注意力成本降低 36–73%，同时保留 86–94% 的任务收益（[arXiv:2610.24411](https://arxiv.org/abs/2610.24411)，2026-10-17）；主动代理若无节制会被感知为侵入（[arXiv:2404.12670](https://arxiv.org/abs/2404.12670)，2024-04-19）。

**错在哪**：把"问责"实现成"催"，就等于把用户最怕的那种压力自动化了；而完全不催，用户又说没人等他。

### 2.6 "我的生活不是产品"——隐私、删号、以及"被记录"的感觉

- HN 上 Indy（ADHD 支持 App）的 Launch 帖是最密集的证据来源。有人数了首屏的追踪脚本：「ublock origin blocks a total of 15 tracking scripts on your health-related website」（在你们的健康类网站上，uBlock 挡下了 15 个追踪脚本）— [HN 46648519](https://news.ycombinator.com/item?id=46648519)（2026-01-16）
- 有人要求删号被无视：「i have made multiple requests to your nonexistent support to delete it and it all goes into a dustbin… makes me not trust at all how you'd handle my data」（[HN 46648902](https://news.ycombinator.com/item?id=46648902)）
- 同一帖里，隐私敏感用户直接问"有没有本地优先的方案"，并说得很具体：「As a privacy concious ADHDer… Anyone has any experience of similar/alternative local-first FOSS alternatives」（[HN 46649200](https://news.ycombinator.com/item?id=46649200)）
- 语音类学习 App 的隐私翻车最直接：Speak 更新后不改协议就不能上课——「I can not continue my lessons without allowing my voice to be shared with AI from platforms like Google and Microsoft… For a paying customer I should have a choice to decline.」（不把声音分享给 Google、微软等 AI 平台，我就没法继续上课；付费用户应该有拒绝的权利）— [Speak](https://apps.apple.com/us/app/speak-language-learning/id1286609883)（2026-11-19）；2026-11-09 至 11-19 的 1–2 星评论里，同一抱怨出现十余次。
- 研究侧：共处研究里，真人陪工让人"牺牲隐私"，而 AI 陪工的价值之一正是不留下被人观看的记录（[arXiv:2609.21254](https://arxiv.org/abs/2609.21254)）。

**错在哪**：这一群人的生活记录本身就是敏感数据（工作压力、医疗、家庭矛盾），任何"云端 + 账号 + 遥测"的默认设定在这一侧都是硬伤，而不是可协商的条款。

### 2.7 "别再多一个要维护的系统"——三天就弃

- r/productivity 一个反复出现的经验：「hundreds of productivity apps didn't work for me, so i gradually found…」（上百个效率 App 对我都没用，我慢慢摸索出……）— [14p5gnh](https://www.reddit.com/r/productivity/comments/14p5gnh/hundreds_of_productivity_apps_didnt_work_for_me/)（2023-07-03）
- 对"又一个 App"的直觉反应：「honestly it might actually work since its not trying to be some crazy complex system that we'll abandon in 3 days」（如果它不是一个我们三天就放弃的复杂系统，那可能真有用）— [1r8optj 评论](https://www.reddit.com/r/ADHD/comments/1r8optj/oh_look_not_another_adhd_app/)（2026-02-19）
- 纸质 vs 应用的选择理由，几乎都指向同一个点：**手机是干扰源**。「I keep a pocket sized notebook… as I find my phone to have a thousand other distractions」（手机上有上千种别的分心）— [1xtr515 评论](https://www.reddit.com/r/ADHD/comments/1xtr515/what_do_you_use_to_organize_your_to_do_list_apps/19shn3avjuuw3/)（2026-11-11）；「I almost never look at something that I put in notes or apps on my phone. It's too overwhelming for me.」（我几乎从不看写进手机里的事，太压人了）— 同帖
- 列表本身也会变成负担：「I have things on my to-do lists for years, have it on there multiple times, on multiple apps/pen & paper… and STILL dont ever complete it. … the thought of it sounds so overwhelming」（同一件事在多个 App 和纸上躺了好几年，还是没做；光是想到就压垮）— [19si8kah11exs](https://www.reddit.com/r/ADHD/comments/1xtr515/what_do_you_use_to_organize_your_to_do_list_apps/19si8kah11exs/)（2026-11-12）
- 伴侣视角的总结最狠：「Apps don't work for us, and for a lot of ADHD people - we need something we can't ignore, and apps are too easy to silence/switch off/put away.」（App 对我们不管用——我们需要一样没法忽略的东西，而 App 太容易静音、关掉、收起来）— [1xpc2x9 评论](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/19s8e9d78dv0h/)（2026-11-06）

**错在哪**：「多加一个入口」在这一侧不是中性的，是负资产。任何新增能力都该长在用户本来就会打开的那个界面上。

### 2.8 "我要一点人味，但不是假人味"

- 用 AI 假装同事之所以有效，恰恰因为它**不评判**：「let it know I've finished the task and it'll cheer me on」（做完告诉它，它就夸我）— [1gzfbr0](https://www.reddit.com/r/ADHD/comments/1gzfbr0/chatgpt_for_body_doubling_wfh/)；但另一帖里有人嫌它假：「It seems no different from talking to an imaginary friend -- it won't help with accountability.」（跟想象中的朋友说话没区别——对问责没用）— [1jelnm2](https://www.reddit.com/r/ADHD/comments/1jelnm2/how_do_you_use_ai_to_help_manage_your_adhd/)（2025-03-19），同帖也有人反过来说「For me it actually worked and helped me tremendously reduce my ADHD symptoms.」（对我真的有用，大幅减轻了我的 ADHD 症状）。
- 反过来，做得太"卡通"会被成年用户直接列为缺点：「Then I deal with childish cheering when I do something」（我做完事还要应付幼稚的喝彩）— [Tiimo](https://apps.apple.com/us/app/tiimo-to-do-list-planner/id1480220328)（2026-11-09）；「这个软件…不会有某些软件里，花里胡哨换装搭建场景养宠物等让我额外耗时间的东西。这点吸引我」（没有换装养宠物那些额外耗时间的花哨东西，这点吸引我）— [小计划](https://apps.apple.com/cn/app/id1581369450)（2026-10-23）
- 但"非人化的奖励"确实能让人开工，且有人明确说**它不因缺席而惩罚我**：「It's not something I use every day but it doesn't make you feel guilty for that.」（我不是每天用，但它不会因此让你有负罪感）— [Focus Friend](https://apps.apple.com/us/app/focus-friend-by-hank-green/id6742278016)（2026-11-08）
- 研究侧的风险也很明确：青少年依赖陪伴型 AI 的质性分析（3,930 帖 / 17,053 条引用）发现，"知道它是假的"并不能阻止义务感、愧疚与失落，「Awareness that the AI was artificial did not prevent guilt, obligation, grief, or distress」（[arXiv:2609.14843](https://arxiv.org/abs/2609.14843)，2026-09-13）；另一项基于 318 条自述帖的研究用行为成瘾框架描述过度依赖（[arXiv:2507.15783](https://arxiv.org/abs/2507.15783)，2025-07-21）。

**错在哪**：温度本身有市场，但把"温度"当成产品目标会滑向拟人陪伴，而那正好是研究里风险最高、也最容易被用户识破为假的一类。

## 3. 用户说什么是有效的、什么无效

### 3.1 被报告为有效的机制

| 机制 | 原话 | 出处 |
| --- | --- | --- |
| **一个具体的人在等，检查小而规律** | 「a promise you only make to yourself is easy to quietly drop… one real update a week」（只对自己许的诺容易放弃；每周一次真实更新） | [1xy1j5k 评论](https://www.reddit.com/r/DecidingToBeBetter/comments/1xy1j5k/does_anyone_else_struggle_to_follow_through_on/19ss06l3cjk3k/) |
| **每周一封邮件 + 一次短通话，人少（2–3 人）** | 「the weekly email plus a short call is the part most accountability pairs skip, and it's probably why yours lasted a year. staying at 2 or 3 people helps too」 | [19stpxie6pnvk](https://www.reddit.com/r/ADHD/comments/1xysy5m/is_there_an_accountability_partner_in_this/19stpxie6pnvk/) |
| **主动回头问（"它来找我"，不是"我去找它"）** | 「If I have to remember to go back into the accountability app myself, it kind of defeats the whole point.」 | [p8gwbdu](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p8gwbdu/) |
| **真人教练的稳定感** | 「The coach is a consistent person who helps frame a positive attitude with agency and skills」（教练是那个稳定的人，帮你把态度摆到"我有能动性"这一边） | [HN 48929790](https://news.ycombinator.com/item?id=48929790) |
| **每天互相报进度（最原始也最持久）** | 「we both used to tell each other what we'll achieve for that day. And then check up on each other at the end of the day.」 | [HN 809846](https://news.ycombinator.com/item?id=809846) |
| **在场即有效（陪工/身体双重）** | 12 人 VR 实验：陪工组（人/AI）都比独处更快、注意力更持久 | [arXiv:2509.12153](https://arxiv.org/abs/2509.12153) |
| **AI 陪工免去社交评判** | 「without the social anxiety, performance judgment, or surveillance associated with human observation」 | [arXiv:2609.21254](https://arxiv.org/abs/2609.21254) |
| **把问责外部化不是失败** | 「using other people as part of your structure is not bad and is not a failure. It's just working with what you got.」 | [1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/) |
| **反馈比建议更重要** | N=543 预注册实验：让目标设定机器人有效的关键是加"反馈"，而不是加"建议" | [arXiv:2602.08636](https://arxiv.org/abs/2602.08636) |
| **"被问责感"是 AI 教练的主要作用路径** | N=517 RCT：AI 组 vs 问卷组，进度无显著差异，但"被问责感"上升并中介了效果 | [arXiv:2603.17887](https://arxiv.org/abs/2603.17887) |
| **物理可见的提示 > 应用内提醒** | 「a visual cue (a physical tablet you put on kitchen) which us adhd'ers can benefit from」 | [19s90e1z21ow1](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/19s90e1z21ow1/) |
| **把第一步缩到"蠢小"** | 「Not "clean the kitchen" but "put the cups in the sink." Not "start working" but "open the document."」 | [1v1y7qu 评论](https://www.reddit.com/r/ADHD/comments/1v1y7qu/finally_realized_that_you_dont_need_the_perfect/oyrv90k/) |
| **结构由学生带来，老师负责纠错** | 「Tutor time should be 80% you writing or speaking and the tutor correcting your output.」 | [19srhf4i569d0](https://www.reddit.com/r/languagelearning/comments/1xxr4mh/my_preply_experience_after_50_lessons_should_i/19srhf4i569d0/) |
| **赌注（真金白银）对一部分人有效** | 「I have been using StickK every week, without fail, for over a dozen years.」 | [stickK 5 星](https://apps.apple.com/us/app/stickk-goals-accountability/id776128765)（2024-03-11） |

### 3.2 被报告为无效、甚至有害的机制

| 机制 | 原话 | 出处 |
| --- | --- | --- |
| **连续打卡 / 断签** | 「found myself not adding anything new, then "losing my streak" over time, then ultimately deleting it」 | [Tiimo](https://apps.apple.com/us/app/tiimo-to-do-list-planner/id1480220328)（2026-11-09） |
| **游戏化惩罚（掉级/扣血/押金）** | 「I crashed out from the penalties when having a tough time and ended up uninstalling it for almost 3 years」 | [Habitica](https://apps.apple.com/us/app/habitica-gamified-taskmanager/id994882113)（2026-07-15） |
| **罚款在系统故障时照扣** | 「The entire server… was down for three days… Yet today I was charged」 | [stickK](https://apps.apple.com/us/app/stickk-goals-accountability/id776128765)（2022-10-14） |
| **把打卡变成围观与审判** | 「动不动就输，动不动就扣钱，我是想找个 app 打卡的」 | [脸疼](https://apps.apple.com/cn/app/id1488289635)（2025-12-30） |
| **越催越瘫痪** | 「the closer it gets to the check in, the worse the paralysis gets」 | [1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/) |
| **通知过载** | 「70% on the notifications I get are completely useless」 | [1s29944 评论](https://www.reddit.com/r/ADHD/comments/1s29944/i_kept_telling_myself_ill_remember_it_later_i/) |
| **幼稚的喝彩** | 「Then I deal with childish cheering when I do something」 | [Tiimo](https://apps.apple.com/us/app/tiimo-to-do-list-planner/id1480220328)（2026-11-09） |
| **仪表盘代替判断** | 「It will create a task list and it will prioritize, but that's the same thing any other AI LLM will do」（它只会排任务，随便哪个模型都能做） | [Motion](https://apps.apple.com/us/app/motion-tasks-ai-scheduling/id1580440623)（2026-04-03） |
| **复杂系统本身** | 「update made the… service take a while to load… all of my list was duplicated」（一次更新让整个列表重复） | [Goblin Tools](https://apps.apple.com/us/app/goblin-tools/id6449003064)（2026-09-25） |
| **强制共享数据作为使用前提** | 「you can no longer use the App unless you agree to allow them to send all of your data including voice」 | [Speak](https://apps.apple.com/us/app/speak-language-learning/id1286609883)（2026-11-11） |

**一条来自产品方的诚实补充**：Indy 的创始人自己总结过，这一群的共同点不是"不知道怎么做"，而是**做不到持续**——「"knowing what to do" is rarely the problem for people with ADHD. The harder problem is actually doing it consistently over time」（[HN 46648144](https://news.ycombinator.com/item?id=46648144)）。这句和上面所有用户原话是一致的，也从反面解释了为什么"再加一个计划工具"注定失败。

## 4. 与 ASAKI 现状对照

（依据为 `CHANGELOG.md` 的 Unreleased 段与 `src/main/check-ins/`、`src/main/scheduler/`、`src/renderer/shell/TodayOverview.tsx`、`src/renderer/settings/SettingsPage.tsx` 的实际实现。）

| 聚类 | 现状 | 依据 | 缺口 |
| --- | --- | --- | --- |
| 2.1 它得先来找我 | **半处理** | 四类主动检查（晨/晚/周日/落后），默认 20:30 落后提醒，`proactiveSessionsPerDay` 上限、`snoozedUntil`、`dndStart/dndEnd`（`src/main/settings/defaults.ts`、`src/main/check-ins/proactive-check-in-service.ts`） | 检查问的是「**今天**还剩什么」，从不问「**昨天你说要做的**那件做了没有」。系统里有"今天的任务"，没有"我答应过什么"——承诺不是一个被记录的对象 |
| 2.2 没人在等就停住 | **半处理** | 已有「专注计时」（`src/renderer/shell/FocusTimer.tsx`）：挂在具体任务上、可暂停/继续/重置，专注分钟进周复盘 | 只有计时，没有"在场"。**但也不该照抄**：拟人陪工是 §6 的反功能；缺的那一格顶多是"计时结束时一句话把成果交还给你"，不是虚拟同事 |
| 2.3 知道我的生活上下文 | **已处理（强项）** | 纯 markdown 知识库、跨项目「我的资料」（分"你提供/模型推测"，推测待确认）、「本次参考」、「我的资料」可标过期（CHANGELOG） | 档案是**静态事实**（关于我/偏好/能力/近期变化），没有"这周在赶什么、哪几天特别满"的时间轴视图 |
| 2.4 辅导贵、排课烦、结构要自己带 | **半处理** | 「阿咲当老师」「掌握感知讲解」「长期计划」（阶段按验收门控、可设目标日期并倒计时） | 用户仍须自己开口"我们开始吧"；没有固定节奏（周复盘是"回顾"，不是"上课"）；长期计划不知道用户下周哪天没空 |
| 2.5 别让我内疚 | **已处理（应守）** | 免打扰时段、每日主动会话上限、`snoozedUntil`、落后提醒只在完成**不到一半**时发一条、无 gamification、周复盘"只说事实和下一步" | 无。这是目前最贴合这一侧的设计，任何新功能都不能突破这条线 |
| 2.6 我的生活不是产品 | **已处理（强项）** | 无账号、无服务器、无遥测；纯 markdown；密钥只进 `safeStorage`；备份恢复有回滚 | 无 |
| 2.7 别多一个系统 | **半处理** | 计划/今日页/提醒/复盘/知识库都在同一个本地 vault；没有插件市场；今日页置顶 1–3 件事 | 「安静时段」只能"今天不打扰"（按日期），不能"出差这三天都别打扰"；也没有从系统外一句话塞进来的轻入口 |
| 2.8 人味 vs 假人味 | **半处理** | 阿咲有名字与四个角色（老师/规划/记录/督促），提示语要求"温和、具体、不啰嗦"；有明确的不编造约束 | 温度之外没有实质差别；这是**有意为之**——见 §6 |

**结论**：这一侧最大的空白不是"再来一种提醒"，而是**承诺**这个对象：用户说"我明天做 X"，系统记不住，第二天也就无从问起。2.5/2.6 已经是强项，不该再投入；2.2 是陷阱，避开比做得像更重要。

## 5. 排序后的待办（≤6 项，按需求 × 契合 × 成本）

排序说明：每项给出「痛点 1 行 + 最小诚实做法 + 挂靠的现有界面 + 证据强度」。**排序时不考虑任何需要新增账号、服务端或拟人化的方案**；每一项都已用第一轮的反功能清单和本报告 §6 复核过一遍。

1. **承诺回访：昨天答应的事，今天只问这一件**
   痛点：用户要的是"有个人记得我答应了什么"，而现有检查只问今天的清单。
   做法：阿咲在对话中识别到用户明确说出承诺（"我明天做 X""这周内写完 Y"）时，落一条带日期的承诺记录到本地；次日晨检只在有承诺时追加一行——「昨天你说要做「X」，做了吗？没做的话，挪到今天还是先放一放？」用户不承诺，这条永不出现；答"做了"就结案，答"没做"给一个改期或缩小的选项，不做道德评价。
   挂靠：晨间检查（`buildCheckInPrompt`）+ 提醒生命周期 + 长期记忆；复用现有每日上限与免打扰。
   证据：4 条直接（[p8gwbdu](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p8gwbdu/)、[p89my0u](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/p89my0u/)、[19ss06l3cjk3k](https://www.reddit.com/r/DecidingToBeBetter/comments/1xy1j5k/does_anyone_else_struggle_to_follow_through_on/19ss06l3cjk3k/)、[1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/)）+ 研究（[2603.17887](https://arxiv.org/abs/2603.17887) 问责感中介、[2602.08636](https://arxiv.org/abs/2602.08636) 反馈是有效成分）。**风险**：若做成"追债语气"就命中 §6，验收时看措辞而不是看功能。

2. **今日页「只承诺一件」开关**
   痛点：列表本身就是压力源；用户反复说"我只承诺一件，反而做到了"。
   做法：今日页加一个开关。打开后只显示用户选中的那 1 项，其余收进一行「还有 N 件（展开）」；不排序、不催促，做完后自动问"要不要再选一件"。
   挂靠：今日页（`src/renderer/shell/TodayOverview.tsx`）。
   证据：3 条，来自同一帖的两条评论与一帖：
   - 「instead of listing *everything* that you want/need to do, you only list like 3-5 things total--things that would make you feel like you had a productive day even if they're the only things that you did.」（不要把所有事都列上，只列 3–5 件——哪怕只做完这些，你今天也算没白过）— [1xr1sd4 评论](https://www.reddit.com/r/adhdwomen/comments/1xr1sd4/sunday_reset_today_whats_yours/)
   - 「So now, I say I'm going to do ONE thing a day! I could have more on the list but I only commit to one. Much happier now.」（所以现在我只说"今天做一件事"；可以有更多，但我只承诺一件。人开心多了）— 同帖
   - 「Not "clean the kitchen" but "put the cups in the sink." Not "start working" but "open the document."」（不是"收拾厨房"，是"把杯子放进水槽"）— [oyrv90k](https://www.reddit.com/r/ADHD/comments/1v1y7qu/finally_realized_that_you_dont_need_the_perfect/oyrv90k/)
   说明：前两条评论的独立 permalink 在归档 API 中未返回，故链接指向帖本体；两条正文均已用归档 API 复核。

3. **「我卡住了」→ 只给第一个 2 分钟动作**
   痛点：用户清楚该做什么，卡在"开始"；此时给整条计划只会加重负担。
   做法：任务行与今日页各加一个"卡住了"按钮。阿咲只回**一个**动作（"先把文档打开""先把杯子放水槽"），不解释、不列清单、不追问原因；用户再点一次就再缩一格。全程不产生新任务，除非用户自己点"加为任务"。
   挂靠：任务行 + 今日页 + `update_task`。
   证据：4 条（[oyrv90k](https://www.reddit.com/r/ADHD/comments/1v1y7qu/finally_realized_that_you_dont_need_the_perfect/oyrv90k/)、[1url7nz](https://www.reddit.com/r/productivity/comments/1url7nz/the_reason_most_productivity_advice_doesnt_work/)（"reducing the size of the first action until it's almost embarrassingly small"）、[oitl96m](https://www.reddit.com/r/ADHD/comments/1sxy009/executive_function_coach/oitl96m/)（"the issue is the actual starting the doing"）、[19si8kah11exs](https://www.reddit.com/r/ADHD/comments/1xtr515/what_do_you_use_to_organize_your_to_do_list_apps/19si8kah11exs/)（一长串清单"光是想到就压垮"，说明此时不该再给清单））+ 研究（[2610.24411](https://arxiv.org/abs/2610.24411) 一次只问一件事）。

4. **问责对象：本地一个名字，只作为提醒的落点**
   痛点：用户明确说"知道另一个人知道我要做这件事"就是有效压力，但找人不可靠、也不该把数据发给别人。
   做法：设置里可填一个名字（朋友/同事/家人，纯本地，不上传不发送）。填了之后，承诺回访与周复盘的消息里只在末尾陈述事实：「这件事你原本说这周五做完，告诉 **A** 的是这个时间」。没有催促、没有"去汇报"按钮；一键可清空。
   挂靠：设置页 + 承诺回访 + 周复盘。
   证据：4 条（[19stpxie6pnvk](https://www.reddit.com/r/ADHD/comments/1xysy5m/is_there_an_accountability_partner_in_this/19stpxie6pnvk/)、[1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/)（"using other people as part of your structure is not bad"）、[1xy1j5k](https://www.reddit.com/r/DecidingToBeBetter/comments/1xy1j5k/does_anyone_else_struggle_to_follow_through_on/)、[1xpc2x9](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/)）+ 研究（[2603.17887](https://arxiv.org/abs/2603.17887)、[2609.21254](https://arxiv.org/abs/2609.21254) AI 共处不带社交评判）。

5. **下周可用时间：让长期计划知道哪几天没空**
   痛点：生活负载不协调时，再好的计划也会在"那天根本不在家"上崩掉。
   做法：周复盘里加一问——「下周哪几天会特别满、哪几天空一些？」回答作为**下一周**的可用时长写进项目设置（现有"每天可用时长"的来源标注已经能区分"本次指定/项目设置/默认值"）；不回答就完全沿用旧行为，逐字节不变。
   挂靠：周复盘 + 长期计划（掌握门控与 `plan_workspace`）。
   证据：3 条（[1xpc2x9](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/)（共享日历与"哪几天特别忙"的实际做法）、[1y12u1e](https://www.reddit.com/r/ADHD/comments/1y12u1e/i_do_well_until_i_dont_then_months_of_progress/)（booms and bust，"提前为崩的那段做准备"）、[1wv1055](https://www.reddit.com/r/Parenting/comments/1wv1055/rough_go_with_a_13_year_old_girl/)（「between services and tutors for her and extra curricular stuff for the other kids, it gets hectic on weekdays」——一周里有哪几天根本排不进事））。

6. **暂停到某一天（而不是只暂停今天）**
   痛点：出差、住院、期末周这类连续几天不能用的情况，现有 `snoozedUntil` 只能按"今天"静音。
   做法：把免打扰的"暂停"从"今天"扩展成"到某天为止"；到期自动恢复，并在恢复后的第一条检查里明说「你之前暂停到 X，今天是恢复的第一天」，不补发、不结算欠账。
   挂靠：提醒生命周期 + 设置页（`snoozedUntil`）。
   证据：2 条（[1s29944 评论](https://www.reddit.com/r/ADHD/comments/1s29944/i_kept_telling_myself_ill_remember_it_later_i/)（通知过载）、[1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/)（"被监控"的焦虑））+ 研究（[2610.24411](https://arxiv.org/abs/2610.24411)）。成本最低，故排末位但保留。

**一项被明确排除的候选**：拟人化的"陪你一起"（虚拟同事/虚拟搭子）。证据上它有效（§3.1），但落地形态与 §6 第一条正面冲突，且 [arXiv:2609.14843](https://arxiv.org/abs/2609.14843) 显示"知道它是假的"并不能阻止依赖与愧疚——不列入待办。

## 6. 反功能（这一群受众专属）

| 反功能 | 用户的原话 | 为什么不做 |
| --- | --- | --- |
| **模拟人的温度而没有实质**（虚拟人格、假生活、假在等你） | 「Then I deal with childish cheering when I do something」（[Tiimo](https://apps.apple.com/us/app/tiimo-to-do-list-planner/id1480220328)）；「It's not something I use every day but it doesn't make you feel guilty for that」（[Focus Friend](https://apps.apple.com/us/app/focus-friend-by-hank-green/id6742278016) 说明**有效的那部分是"不惩罚缺席"**，不是"有人格"） | 温度可以被更便宜、更诚实的方式替代（陈述事实 + 不追责）；而人格化会把用户推向"义务感—愧疚"这条链（[2609.14843](https://arxiv.org/abs/2609.14843)），这与 2.5 的整个痛点是相反的 |
| **假紧急 / 制造倒计时压力** | 「the closer it gets to the check in, the worse the paralysis gets」（[1u32cb0](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/)） | 对这一群，"临近截止"不是燃料而是抑制剂；ASAKI 已有"目标日期倒计时"是**陈述事实**，绝不能加"再不…就…" |
| **罚款 / 押金 / 赌注 / 扣积分** | 「server… down for three days… Yet today I was charged」（[stickK](https://apps.apple.com/us/app/stickk-goals-accountability/id776128765)）；「动不动就扣钱」（[脸疼](https://apps.apple.com/cn/app/id1488289635)） | 惩罚的落点永远是用户最没有还手之力的时候（生病、系统故障、网络问题）；且 ASAKI 无支付、无服务端，做这个等于自毁本地优先的前提 |
| **连续打卡 / 断签惩罚 / 排行榜** | 「losing my streak over time, then ultimately deleting it」（[Tiimo](https://apps.apple.com/us/app/tiimo-to-do-list-planner/id1480220328)）；「I crashed out from the penalties」（[Habitica](https://apps.apple.com/us/app/habitica-gamified-taskmanager/id994882113)） | 与第一轮结论一致，此处再确认：这一群要的是"有人等我"，不是"有个分数记我"。一次断签 → 弃用是常见链条 |
| **围观 / 公开打卡 / 社交比较** | 「被恶意举报了只给 3 小时申述时间」（[脸疼](https://apps.apple.com/cn/app/id1488289635)）；「莫名其妙的多个小法庭功能」 | 把私人生活变成表演，且必然长出举报、审判与申诉这类与帮助无关的结构 |
| **监控式生活记录**（自动截屏、持续录屏、行为上报） | 应用被整个下架的案例：「it ends up being very well suited for that role」（[HN 8469092](https://news.ycombinator.com/item?id=8469092)）；「option to remove the icon in the status bar」「Accountability partners are notified if you ever disable the app」 | 这类"监督"在社区里一律被识别为 spyware，而不是问责；[2609.21254](https://arxiv.org/abs/2609.21254) 也指出真人观察的代价正是"被看" |
| **替用户承诺、替用户排满** | 「it's better to ask what I had planned for the day… rather than someone telling me what to do with my time」（[19s8855fuya81](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/19s8855fuya81/)） | 这一群对"被安排"的反弹（anti-authority response）有明确记录；计划可以提议，承诺必须由用户说出口 |
| **用"更多提醒"解决"没做到"** | 「70% on the notifications I get are completely useless」（[1s29944 评论](https://www.reddit.com/r/ADHD/comments/1s29944/i_kept_telling_myself_ill_remember_it_later_i/)） | 提醒的边际收益为负；[2610.24411](https://arxiv.org/abs/2610.24411) 给出量化的"打断预算"，应把它当成上限而不是参考值 |

## 7. 引用清单（按首次出现顺序）

**Reddit（帖子；引用具体评论时链接已指到该评论的 permalink）**
1. [r/ADHD 1w8c0qw — Is there an accountability buddy app?](https://www.reddit.com/r/ADHD/comments/1w8c0qw/is_there_an_accountability_buddy_app/) — 2026-09-05
2. [r/DecidingToBeBetter 1xy1j5k — Does anyone else struggle to follow through on goals alone?](https://www.reddit.com/r/DecidingToBeBetter/comments/1xy1j5k/does_anyone_else_struggle_to_follow_through_on/) — 2026-11-16
3. [r/ADHD 1xysy5m — Is there an accountability partner in this subreddit](https://www.reddit.com/r/ADHD/comments/1xysy5m/is_there_an_accountability_partner_in_this/) — 2026-11-17
4. [r/adhdwomen 1xsdtvg — I need some form of accountability right now](https://www.reddit.com/r/adhdwomen/comments/1xsdtvg/i_need_some_form_of_accountability_right_now/) — 2026-11-10（38 分，18 评）
5. [r/ADHD 1gzfbr0 — ChatGPT for body doubling WFH](https://www.reddit.com/r/ADHD/comments/1gzfbr0/chatgpt_for_body_doubling_wfh/) — 2024-11-25
6. [r/productivity 1vgky6d — No one is showing up to focusmate meetings?](https://www.reddit.com/r/productivity/comments/1vgky6d/no_one_is_showing_up_to_focusmate_meetings/) — 2026-08-05
7. [r/productivity 1vjmp98 — Alternatives to the platform Focusmate](https://www.reddit.com/r/productivity/comments/1vjmp98/alternatives_to_the_plattform_focusmate/) — 2026-08-09
8. [r/productivity 1v4svmt — Anyone interested in a body doubling or focusmate partner](https://www.reddit.com/r/productivity/comments/1v4svmt/anyone_interested_in_a_body_doubling_or_focusmate/) — 2026-07-23
9. [r/ADHD 1r2c41i — Would you pay for an app that actually knows which adhd hacks work for you](https://www.reddit.com/r/ADHD/comments/1r2c41i/would_you_pay_for_an_app_that_actually_knows/) — 2026-02-11
10. [r/ADHD 1qko1zb — I feel my personal life just goes in circles](https://www.reddit.com/r/ADHD/comments/1qko1zb/i_feel_my_personal_life_just_goes_in_circles_and/) — 2026-01-23
11. [r/ADHD 1xpc2x9 — Couples where one partner has ADHD: what app or system do you use?](https://www.reddit.com/r/ADHD/comments/1xpc2x9/couples_where_one_partner_has_adhd_what_app_or/) — 2026-11-06
12. [r/languagelearning 1xxr4mh — My preply experience after 50 lessons](https://www.reddit.com/r/languagelearning/comments/1xxr4mh/my_preply_experience_after_50_lessons_should_i/) — 2026-11-16
13. [r/languagelearning 1xymfg1 — Structured Tutor Lessons](https://www.reddit.com/r/languagelearning/comments/1xymfg1/structured_tutor_lessons/) — 2026-11-17
14. [r/languagelearning 1r3zyr2 — Anyone picked a language to learn based on tutor cost?](https://www.reddit.com/r/languagelearning/comments/1r3zyr2/anyone_picked_a_language_to_learn_based_on_tutor/) — 2026-02-13
15. [r/ADHD 1sxy009 — Executive Function Coach?](https://www.reddit.com/r/ADHD/comments/1sxy009/executive_function_coach/) — 2026-04-28
16. [r/ADHD 1x489ct — Therapist vs. ADHD coach (or both?)](https://www.reddit.com/r/ADHD/comments/1x489ct/therapist_vs_adhd_coach_or_both_as_an_audhder_and/) — 2026-10-12
17. [r/ADHD 1u32cb0 — I stopped trying to fix myself and started building around myself](https://www.reddit.com/r/ADHD/comments/1u32cb0/i_stopped_trying_to_fix_myself_and_started/) — 2026-06-11
18. [r/ADHD 1y12u1e — I do well, until I don't](https://www.reddit.com/r/ADHD/comments/1y12u1e/i_do_well_until_i_dont_then_months_of_progress/) — 2026-11-20
19. [r/ADHD 1s29944 — I kept telling myself "I'll remember it later."](https://www.reddit.com/r/ADHD/comments/1s29944/i_kept_telling_myself_ill_remember_it_later_i/) — 2026-03-24
20. [r/productivity 14p5gnh — hundreds of productivity apps didn't work for me](https://www.reddit.com/r/productivity/comments/14p5gnh/hundreds_of_productivity_apps_didnt_work_for_me/) — 2023-07-03
21. [r/ADHD 1r8optj — Oh look NOT another adhd app](https://www.reddit.com/r/ADHD/comments/1r8optj/oh_look_not_another_adhd_app/) — 2026-02-19
22. [r/ADHD 1xtr515 — What do you use to organize your 'to do' list?](https://www.reddit.com/r/ADHD/comments/1xtr515/what_do_you_use_to_organize_your_to_do_list_apps/) — 2026-11-11
23. [r/ADHD 1v1y7qu — Finally realized that you don't need the perfect system](https://www.reddit.com/r/ADHD/comments/1v1y7qu/finally_realized_that_you_dont_need_the_perfect/) — 2026-07-20
24. [r/productivity 1url7nz — The reason most productivity advice doesn't work for ADHD brains](https://www.reddit.com/r/productivity/comments/1url7nz/the_reason_most_productivity_advice_doesnt_work/) — 2026-07-09
25. [r/adhdwomen 1y1eufi — I feel like I'm being slowly buried alive](https://www.reddit.com/r/adhdwomen/comments/1y1eufi/i_feel_like_im_being_slowly_buried_alive/) — 2026-11-20
26. [r/adhdwomen 1xr1sd4 — Sunday Reset today — what's yours?](https://www.reddit.com/r/adhdwomen/comments/1xr1sd4/sunday_reset_today_whats_yours/) — 2026-11-08（266 分，149 评）
27. [r/adhdwomen 1xqpkxs — Anyone want to be my accountability buddy?](https://www.reddit.com/r/adhdwomen/comments/1xqpkxs/anyone_want_to_be_my_accountability_buddy/) — 2026-11-08
28. [r/ADHD 1tcfmvt — r/ADHD support groups/coaches](https://www.reddit.com/r/ADHD/comments/1tcfmvt/radhd_support_groupscoaches/) — 2026-05-13
29. [r/ADHD 1ucd9tc — Any insights on high touch executive function support service?](https://www.reddit.com/r/ADHD/comments/1ucd9tc/any_insights_on_high_touch_executive_function/) — 2026-06-22
30. [r/GetMotivated 1vreuo6 — How I motivate myself to stay responsible](https://www.reddit.com/r/GetMotivated/comments/1vreuo6/story_how_i_motivate_myself_to_stay_responsible/) — 2026-08-18
31. [r/productivity 1y0i1or — I use Focusmate to push through 10–12 Pomodoros daily](https://www.reddit.com/r/productivity/comments/1y0i1or/i_use_focusmate_to_push_through_1012_pomodoros/) — 2026-11-19

**Hacker News**
32. [Launch HN: Indy (YC S21) — A support app designed for ADHD brains](https://news.ycombinator.com/item?id=46648144) — 2026-01-16（及其 `46648465`、`46648519`、`46648902`、`46649033`、`46649200`、`46649486`、`46653137` 等评论）
33. [HN 48929790 — ADHD 教练的价值在"稳定的那个人"](https://news.ycombinator.com/item?id=48929790) — 2026-07-16
34. [HN 809846 — 问责搭子的原始形态：每天互相报进度](https://news.ycombinator.com/item?id=809846) — 2009-09-07
35. [HN 8469092 — 被下架的"问责"应用实为监控](https://news.ycombinator.com/item?id=8469092) — 2014-10-17

**App Store（正文经 Apple 评论 RSS 读取，日期为评论日期；链接指向应用页）**
36. [stickK](https://apps.apple.com/us/app/stickk-goals-accountability/id776128765) — 2022-10-14 / 2024-03-11 / 2025-12-14 / 2026-11-09
37. [Beeminder](https://apps.apple.com/us/app/beeminder/id551869729) — 2016–2024 多条登录/同步失败
38. [Motion](https://apps.apple.com/us/app/motion-tasks-ai-scheduling/id1580440623) — 2026-04-03 / 2026-07-06
39. [Habitica](https://apps.apple.com/us/app/habitica-gamified-taskmanager/id994882113) — 2026-06-02 / 2026-07-15
40. [Finch](https://apps.apple.com/us/app/finch-self-care-pet/id1528595748) — 2026-11-19
41. [Tiimo](https://apps.apple.com/us/app/tiimo-to-do-list-planner/id1480220328) — 2026-11-09
42. [Goblin Tools](https://apps.apple.com/us/app/goblin-tools/id6449003064) — 2026-08-09 / 2026-09-25
43. [Focus Friend, by Hank Green](https://apps.apple.com/us/app/focus-friend-by-hank-green/id6742278016) — 2026-11-08 / 2026-11-17
44. [Speak: Language Learning](https://apps.apple.com/us/app/speak-language-learning/id1286609883) — 2026-11-09 ~ 2026-11-19
45. [Praktika — AI Language Tutor](https://apps.apple.com/us/app/praktika-ai-language-tutor/id1624701477) — 2026-10-05 ~ 2026-11-10（等级误判、纠错错误、不记得上次的要求）
46. [脸疼（中文，目标监督打卡）](https://apps.apple.com/cn/app/id1488289635) — 2025-09-20 / 2025-12-30 / 2026-08-11
47. [搭着学（中文，找搭子自习）](https://apps.apple.com/cn/app/id1630080978) — 2025-08-07 ~ 2026-11-04
48. [小计划（中文，组队打卡）](https://apps.apple.com/cn/app/id1581369450) — 2025-12-07 ~ 2026-10-23
49. [小日常（中文，习惯打卡）](https://apps.apple.com/cn/app/id1263789061) — 2026-11-17

**论文**
50. AI-Assisted Goal Setting Improves Goal Progress Through Social Accountability（N=517 三臂预注册 RCT，d=0.33）— [arXiv:2603.17887](https://arxiv.org/abs/2603.17887)（2026-03-18）
51. Supporting Effective Goal Setting with LLM-Based Chatbots（N=543 预注册实验，反馈 > 建议）— [arXiv:2602.08636](https://arxiv.org/abs/2602.08636)（2026-02-09）
52. You Are Not Alone: Designing Body Doubling for ADHD in Virtual Reality（12 人，陪工 > 独处）— [arXiv:2509.12153](https://arxiv.org/abs/2509.12153)（2025-09-15）
53. Two's a Crowd: Human and AI-Based Copresence for Developers with ADHD（14 人访谈，AI 共处免于社交评判）— [arXiv:2609.21254](https://arxiv.org/abs/2609.21254)（2026-09-18）
54. Ask Less, Ask Better: Allocating User Attention in Proactive LLM Agents with Interruption Budgets（1–3 问可降注意力成本 36–73%）— [arXiv:2610.24411](https://arxiv.org/abs/2610.24411)（2026-10-17）
55. Proactive Service Agents: A Unified Decision Framework（"沉默/询问/协助/行动"四选一，含越界与隐私成本）— [arXiv:2609.03727](https://arxiv.org/abs/2609.03727)（2026-09-03）
56. Towards Human-centered Proactive Conversational Agents（无设计的主动系统会被感知为侵入）— [arXiv:2404.12670](https://arxiv.org/abs/2404.12670)（2024-04-19）
57. Time and Space: A Dual-Axis, Evidence-Grounded Context Substrate for Personal Agents（本地优先、来源可回溯、冲突交人裁决）— [arXiv:2611.16492](https://arxiv.org/abs/2611.16492)（2026-11-12）
58. A Responsive Present, a Shared Past, a Social Other: Teens' Overreliance on Companion AI Chatbots（3,930 帖 / 17,053 条引用）— [arXiv:2609.14843](https://arxiv.org/abs/2609.14843)（2026-09-13）
59. Understanding Teen Overreliance on AI Companion Chatbots Through Self-Reported Reddit Narratives（318 帖）— [arXiv:2507.15783](https://arxiv.org/abs/2507.15783)（2025-07-21）

## 8. 一句话结论

这一侧要的不是"更会说话的陪伴"，而是**一个记得我答应过什么、到了第二天会回来问一次、问完就走的人**——它必须长在 ASAKI 已有的检查、计划、档案上（不新增系统），必须守住现有的免打扰与每日上限（不新增压力），最该补的是「承诺」这个对象和「问一次就够」的分寸；拟人陪伴、"监督"式的围观、以及任何形式的罚款，都在证据里以失败收场。
