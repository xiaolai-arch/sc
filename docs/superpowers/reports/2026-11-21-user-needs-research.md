# 用户需求调研：人们到底想从 AI 学习伙伴那里得到什么

日期：2026-11-21
方法：先读真实用户讨论（Reddit 帖与评论、Hacker News、Obsidian / Anki 官方论坛、App Store 中英文评论、Bilibili 视频与评论区），再对照 2023–2026 年研究；每条主张都带可回链 URL，引语保留原文并给中文释义。§1 说明取数方式与站点可达性，§2 是八组痛点，§3 是「用户明说、主流 AI 工具没做」的清单，§4 与 ASAKI 现状对照，§5 是排过序的 ≤8 项待办，§6 是明确不该做的。

---

## 1. 取数方式与可达性（诚实声明）

- **Reddit**：`reddit.com` 的 HTML 与 `.json` 在本机被网络层拦截（`curl` 超时、WebFetch 拒绝），因此通过 Reddit 公共归档 API（`arctic-shift.photon-reddit.com`）读取帖子原文与评论树；下面引用的帖/评论 ID 全部用该 API 复核过存在性与分数，URL 为 reddit.com 的规范地址。
- **知乎、小红书**：`zhihu.com` 搜索接口 403、单条回答 403，小红书返回 302 跳登录——**无法取到可引用的具体帖子**，故不引用，改用 Bilibili（可读视频与评论区）和中文 App Store 评论作为中文样本。
- **Hacker News**：站点本身超时，改用官方 Algolia 搜索 API 拿到评论全文与 item ID，URL 为 `news.ycombinator.com/item?id=…`。
- **App Store**：用 Apple 的公开评论 RSS（`itunes.apple.com/us|cn/rss/customerreviews/...`）取最新评论，正文与日期来自该接口；URL 指向应用页。
- **论坛**：Obsidian（Discourse JSON）与 Anki（Discourse JSON）可直读。
- 本报告只做事后聚类；**没有做量化抽样**，所以每组的「来源数」是"能引用的独立帖/评论条数"，不是人群比例。

## 2. 痛点聚类（8 组）

### 2.1 "它讲得我懂了，但我记不住"——理解与保持是两件事

这是出现频率最高、跨社区最一致的一组。

- r/GetStudying：「I can understand a topic when someone explains it to me, but when I sit down to study it myself, I struggle to remember the points and write answers in my own words.」（我能听懂别人讲，但自己坐下来就记不住要点、写不出自己的话）— [1xcpfll](https://www.reddit.com/r/GetStudying/comments/1xcpfll/how_do_you_study_theory_subjects_effectively_need/)（2026-10-23）
- r/GetStudying 标题即痛点：「long time to understand things but forget them after a few days」，正文「I prefer understanding things properly rather than memorising them.」— [1xu4qtw](https://www.reddit.com/r/GetStudying/comments/1xu4qtw/long_time_to_understand_things_but_forget_them/)（2026-11-12）；同帖回复：「understanding something and being able to recall it a week later are two separate skills, and the second one fades fast unless you come back to it.」（理解与一周后回忆是两种能力，后者不回头就消失）— [评论](https://www.reddit.com/r/GetStudying/comments/1xu4qtw/long_time_to_understand_things_but_forget_them/19sif4qx3lz1e/)
- r/GetStudying：「You spend hours reviewing lectures… or asking ChatGPT to explain something. It makes sense while you're reading the explanation, but when you face a new exam question, you still don't know how to approach it.」（让 ChatGPT 讲的时候都懂，遇到新题仍然不会）— [1xycmon](https://www.reddit.com/r/GetStudying/comments/1xycmon/anyone_else_study_for_hours_but_still_struggle_to/)（2026-11-16）
- r/GetStudying：「Nobody really sat us down and showed us how memory works. So we do what feels productive: reread the chapter, highlight half of it… a week later most of it is gone.」（没人教过我们记忆怎么运作；于是重读、划重点，一周后全没了）— [1xkkxee](https://www.reddit.com/r/GetStudying/comments/1xkkxee/most_of_us_were_never_taught_how_to_study_only/)（529 分）；同帖回复把这一点讲得更直白：「the rereading thing was my biggest trap. looked so productive but i'd finish a chapter and realize i couldn't explain any of it to someone else.」（[评论](https://www.reddit.com/r/GetStudying/comments/1xkkxee/most_of_us_were_never_taught_how_to_study_only/19ry4cnwq4d4z/)）
- 研究侧同一结论：MIT 媒体实验室的「Your Brain on ChatGPT」显示，用 LLM 写作的三组里，LLM 组的脑电参与度最低，且换回无工具写作时仍表现出后续不足（[arXiv:2506.08872](https://arxiv.org/abs/2506.08872)，[MIT 页面](https://www.media.mit.edu/publications/your-brain-on-chatgpt/)，2025-06-10）；2026 年的从业者灰文献综述（76 篇）把这种"能跑但不懂"的积累命名为 cognitive debt（[arXiv:2610.37888](https://arxiv.org/abs/2610.37888)，2026-10-27）。

**现有产品错在哪**：主流 AI 把"解释清楚"当成终点，会话结束即结束；没有把"刚才讲过的东西"变成未来某天的检索事件。

### 2.2 "我不知道该问它什么"

- r/GetStudying：「whenever I sit down at the desk to review my lessons, i suddenly don't know which one to look at and which one i don't have to.」（坐下复习时突然不知道看哪个）— [1xnk1l2](https://www.reddit.com/r/GetStudying/comments/1xnk1l2/how_to_know_what_to_study/)（2026-11-04）
- Hacker News 关于 Khanmigo 的两年实验：「the hard part is getting the kids motivated to actually ask the AI any questions.」（难的是让孩子愿意真的去问 AI）— [HN 50146768](https://news.ycombinator.com/item?id=50146768)（2026-10-18）
- r/ChatGPT 里用户自己摸索出的补丁，恰恰说明产品没做：「a standing instruction helps more than the plan, something like explain it like I'm new, ask me three questions, and don't move on until I get it.」（真正有用的是"先问我三个问题，我懂了再往下"这种常驻指令）— [1y154i9 评论](https://www.reddit.com/r/ChatGPT/comments/1y154i9/can_chatgpt_plus_really_teach_better_than_free_or/19sxf5q7jmht1/)（2026-11-21）
- Hacker News 对"AI 导师"的批评一针见血：「Tutors are proactive, not reactive.」（家教是主动的，不是被动的）— [HN 49974615](https://news.ycombinator.com/item?id=49974615)（2026-10-06）
- 研究侧：一项预注册随机田野实验（86 名 MBA 学生）发现**教学结构**比交互模态重要——结构化的辅导组比对照多 6.63 分（p=.007），而语音 vs 文字对学习没有差异（[arXiv:2609.23958](https://arxiv.org/abs/2609.23958)，2026-09-21）。"更像人"不等于"更会教"。

**错在哪**：所有主流聊天工具都把发起权交给用户——用户不问，它就不动。

### 2.3 "我想要它考我，而不是给我答案"

- r/GetStudying：用户已经在自己拼装这个需求，因为工具不做——「I had to copy-paste everything into a Word doc to test myself later. Super annoying, and I always lost track of which questions I kept getting wrong.」（让 ChatGPT 出题，然后手动复制到 Word 自测，还记不住错过哪些）— [1xplhwh](https://www.reddit.com/r/GetStudying/comments/1xplhwh/i_made_a_tool_where_you_just_tell_your_chatbot/)（2026-11-07）
- Anki 官方论坛上一个新用户宁愿花钱买人教：「I've never used Anki before and don't have time to read and try to understand the manual. I'm willing to pay an experienced user for a tutoring session to help me understand the app…」（没时间读手册，愿意付钱请人带一次）— [Anki 论坛 21251](https://forums.ankiweb.net/t/21251)（2022-07-06）
- 同一论坛的 AI 语音抽背工具帖：「review your cards by talking」（用说的复习卡片）本身就是需求信号 — [Anki 论坛 69298](https://forums.ankiweb.net/t/69298)（2026-03-31）
- r/GetStudying 高分回答反复把答案压在"被考"上：「Active recall (forcing yourself to answer without looking up the answer) + spaced study… are scientifically proven」（主动回忆＋分散学习）— [1xzfv3r 评论](https://www.reddit.com/r/GetStudying/comments/1xzfv3r/asked_the_guy_who_got_the_highest_grade_on_the/19strtm9fg9gh/)（301 分）
- 中文样本（Bilibili，「如何借助AI高效背书」）的置顶评论把同一需求说成流程：「本视频深度拆解了如何利用AI工具重构背书流程，将低效的"死记硬背"转化为高效的"主动输出"…第二步：即时复盘。利用模拟抽背与答题话术优化」（把"死记硬背"换成"主动输出"，并用模拟抽背即时复盘）— [BV17FLR6dE3u 评论](https://www.bilibili.com/video/BV17FLR6dE3u)（2026-06-17）；同视频下有观众追问「原来不止我一个人意识到 ai 背书的高效吗」（原来不止我一人觉得 AI 抽背有效）。
- 研究侧：英国五校 RCT（N=165）里，专家辅导者给 AI 的苏格拉底式提问稿 76.4% 几乎原样通过，学生解决新题的比例比纯人类辅导高 5.5 个百分点（[arXiv:2512.23633](https://arxiv.org/abs/2512.23633)，2025-12-29）。

**错在哪**：聊天工具默认"有问必答"；"考我"要靠用户每次手动下指令，而且出完题没有地方存、没有下次。

### 2.4 "开始用的成本太高"——建卡、建系统、挑插件

- r/Anki：「i do not freaking know how to not waste trillion hours making anki cards」（不知道怎样才能不把天文数字般的时间花在做卡上）— [1y0jkgd](https://www.reddit.com/r/Anki/comments/1y0jkgd/guys_i_need_urgent_help_before_i_lose_my_brain/)（2026-11-20）
- r/Anki：「the basic question of whether something even belongs in Anki at all.」（连"这条该不该做成卡"都判断不了）— [1u3uupt](https://www.reddit.com/r/Anki/comments/1u3uupt/how_do_you_decide_what_actually_deserves_a_card/)（2026-06-12）
- Obsidian 官方论坛：「Obsidian seems to have dozens of Anki plugins, and it's difficult to know which are the most useful and reliable.」（几十个插件，根本不知道哪个靠谱）— [forum.obsidian.md/t/113776](https://forum.obsidian.md/t/113776)（2026-04-28）
- r/productivity：「your system is the coffee cup and productivity is the coffee. We sometimes obsess over the look and feel of the coffee cup and forget to drink the coffee.」（把杯子当成了咖啡）— [1tfbvty 评论](https://www.reddit.com/r/productivity/comments/1tfbvty/should_i_just_abandon_my_digital_second_brain_for/om8it3h/)（2026-05-17）；同帖有人直接放弃：「it was a massive waste of time」（2026-05-17）
- r/productivity 推荐替代品时的理由：「its less flexible than Notion but thats kind of the point, you dont have to design your own system before you can start using it.」（不用先设计一套系统才能开始用）— [1xid69e 评论](https://www.reddit.com/r/productivity/comments/1xid69e/do_anyone_use_any_apps_or_some_type_of_different/19rtz5fblrm1v/)（2026-10-29）
- 中文样本（Bilibili）：「想要一个 ai 自动把知识整理成口诀，再把口诀画成一幅画。」（想要 AI 自动整理口诀再画成图）— [BV1ts421M73Y 评论](https://www.bilibili.com/video/BV1ts421M73Y)（2024-06-22）
- 研究侧：926 名瑞士大学生的调查里，学生对 AI Buddy 的期待集中在**省时间、个性化、学习组织**（[arXiv:2603.20909](https://arxiv.org/abs/2603.20909)，2026-03-21）。

**错在哪**：工具把"配置"当成用户的乐趣，而大多数人只想要"坐下就能开始"。

### 2.5 "AI 说的我不敢全信，还得自己核一遍"

- r/Anki 最热批评：「it just makes bad flashcards? Whenever I ask it to generate some flashcards, almost none of them are of good enough quality that I'd actually want to use them.」（44 分）— [1mewr8p 评论](https://www.reddit.com/r/Anki/comments/1mewr8p/problem_with_aigenerated_flashcards/n6dfj9q/)（2025-08-02）
- r/Anki：「if it makes a mistake youre commiting it to memory」（它一错，你就把错背下来了）— [1w7ibck](https://www.reddit.com/r/Anki/comments/1w7ibck/maybe_controversial_opinion_using_artificial/)（2026-09-05）
- r/Anki：「it really depends on how you're using AI, but yeah definitely don't do it without checking the output.」（千万别不核就用）— [1j1rpfd 评论](https://www.reddit.com/r/Anki/comments/1j1rpfd/unpopular_opinion_you_shouldnt_use_ai_to_create/mfm4dg6/)（2025-03-02）
- r/languagelearning 1312 分的警告帖：「Please beware of AI when learning languages, it's not only about hallucinations, it's much worse and subtle」（不只是幻觉，更隐蔽）— [1wf4fz6](https://www.reddit.com/r/languagelearning/comments/1wf4fz6/please_beware_of_ai_when_learning_languages_its/)（2026-09-13）
- 初学者尤其没法自查：「The tricky part is using it for a language I'm a complete beginner in, since I can't really tell if it's right or wrong.」（初学阶段我根本判断不了对错）— [1wsfuub 评论](https://www.reddit.com/r/languagelearning/comments/1wsfuub/do_you_use_ai_chat_bots_for_practicing_languages/pcl1bhn/)（2026-09-28）
- r/ADHD：「AI still gets lots of shit wrong. If you're going to use it, make sure you fact check it.」（34 分）— [1jew3bs 评论](https://www.reddit.com/r/ADHD/comments/1jew3bs/ai_is_a_powerful_tool_for_people_with_adhd/mim019q/)（2025-03-19）
- 中文样本：「我是拿来学习用的，不是来学习软件的。」（Anki 移动端 1 星，[App Store 中国区](https://apps.apple.com/cn/app/id373493387)，2025-09-13）——同一条批评的另一半是"要我去网上找教程"。

**错在哪**：AI 输出被当成可信文本直接入库；没有"这条是模型生成的、待核对"的标记，也没有核对之后的采纳路径。

### 2.6 "我不知道自己到底会不会、有没有进步"

- r/GetStudying：「It's frustrating to spend an evening studying and still feel unsure whether you're ready… when a question appears without the explanation beside it, you don't know where to begin.」（学了一晚，仍不知道行不行；题一出现就懵）— [1xwecg6](https://www.reddit.com/r/GetStudying/comments/1xwecg6/you_studied_for_two_hours_what_can_you_do_now/)（2026-11-15）
- r/GetStudying：「I feel like i'm not getting the grades that one would typically get with a bunch of studying… I make mistakes like… feeling lazy and letting ai show me how to solve something instead of struggling with it myself for a short time.」（投入时间不少，回报不成比例；还容易让 AI 直接演示）— [1xq2ba4](https://www.reddit.com/r/GetStudying/comments/1xq2ba4/how_do_you_effectively_study_and_evaluate_your/)（2026-11-07）
- r/GetStudying：「I understand what I study, but I struggle to remember and distinguish…」（懂但混、记不住）— [1xzahqg](https://www.reddit.com/r/GetStudying/comments/1xzahqg/i_understand_what_i_study_but_i_struggle_to/)（2026-11-18）
- r/languagelearning 付了钱也没进步：「i am stuck at IELTS speaking 6.5 for three practice tests despite 2x/week tutoring… My brain just got too good at specific rehearsed questions, not at speaking under pressure.」（练熟了背过的题，压力下还是不行）— [1x7lv8j](https://www.reddit.com/r/languagelearning/comments/1x7lv8j/anyone_else_feel_like_theyre_paying_for_tutoring/)（2026-10-17）
- 研究侧：职业场景里学生会出现"元认知懒惰"——高能力者拿它做验证，低能力者拿它跳过思考，整体评估成绩没有提升（[arXiv:2512.12306](https://arxiv.org/abs/2512.12306)，2025-12-13）；在 AI 回复旁给出元认知提示（N=146）能让人更主动地核对与记笔记（[arXiv:2603.19634](https://arxiv.org/abs/2603.19634)，2026-03-20）。

另有面向知识工作者的调查研究（标题与摘要见 [Microsoft Research](https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/)；该页正文在本机被拦，故只引它自述的结论方向）报告：对 GenAI 越有信心的人，自述的批判性思考越少——这与学生的"我感觉在学，其实在跳过"是同一枚硬币。

**错在哪**：仪表盘给"时长/连续天数/正确率"，但这些都不回答"我能不能**在没有解释的情况下**把它说出来"。

### 2.7 "聊着聊着它就忘了"——聊天记录不是学习记录

- r/ChatGPT：「I'm on my sixth chat due to the whole memory thing, and I think it's starting to forget things」（因为记忆问题已经开到第六个对话了）— [1y1m9nk](https://www.reddit.com/r/ChatGPT/comments/1y1m9nk/using_chatgpt_for_godot/)（2026-11-21）
- r/ChatGPT：「ChatGPT seems to forget what we talked about even just earlier in the day.」（27 分）— [1xz5ihs](https://www.reddit.com/r/ChatGPT/comments/1xz5ihs/chat_window_context/)（2026-11-18）
- 用户自己发明的对策，正是本地笔记该做的事：「i keep a separate doc with key details and update it after each session. gpt forgets the tiny stuff, but the doc doesn't.」（我另开一个文档记要点；GPT 会忘，文档不会）— [1y0mpgz 评论](https://www.reddit.com/r/ChatGPT/comments/1y0mpgz/how_do_you_deal_with_the_poor_memory_of_chat_gpt/19sw4b61q45up/)（2026-11-20）

**错在哪**：会话边界＝学习边界。跨会话只有"记忆条目"，没有"我上次错在哪、这次先练什么"。

### 2.8 "数据得是我的，别把我当提款机"

- r/ObsidianMD：「I like to for my data to say mine.」（数据得是我的）— [1xpbr05](https://www.reddit.com/r/ObsidianMD/comments/1xpbr05/yet_another_notion_to_obsidian_post/)（2026-11-06）
- r/ObsidianMD 有人专门做"模型装进笔记软件里"的插件：「No Ollama, no LM Studio, no server on localhost, no API key — there is nothing running alongside it.」（不要额外服务、不要密钥、能离线）— [1w8hgmq](https://www.reddit.com/r/ObsidianMD/comments/1w8hgmq/i_got_tired_of_keeping_ollama_running_next_to/)（2026-09-06）
- App Store：Knowt 1 星「Last year my state banned any apps that sell your information in schools.」（我们州禁止在学校用卖数据的应用）— [Knowt](https://apps.apple.com/us/app/id6463744184)（2026-05-13）；Noji 1 星「The app only allows you to download a few decks for offline use」（2026-10-08）
- App Store：Quizlet 2 星「I think it's stupid to make us have to pay to finish studying… it said I have to upgrade to review the remaining 32 terms!」（学到一半让你付费才能看完剩下的 32 个词，这很蠢）— [Quizlet](https://apps.apple.com/us/app/id546473125)（2026-11-18）
- 中文样本：「基本上就是经常出活动逼着你氪金，出皮肤，恶心你」（Duolingo 1 星，[App Store 中国区](https://apps.apple.com/cn/app/id570060128)，2026-11-20）
- 研究侧：同一份 926 人调查里，学生最担心的两件事就是**数据隐私**与**过度依赖**（[arXiv:2603.20909](https://arxiv.org/abs/2603.20909)）。
- 本地化的替代方案也有人在自建（中文样本，Bilibili 上一位作者介绍自己的开源工具，非第三方评价）：「刷题交给纸质试卷…刷完之后打开「素读」——像高中放在手边那本单词本一样，在刚才做过的原文里圈出卡住的词、连同原句收进词条，用离线词典和自带大模型整理理解…不联网无广告」（刷完题把卡住的词连原句收进离线词条）— [BV1hcsb6aE1S](https://www.bilibili.com/video/BV1hcsb6aE1S)（2026-11-19）

**错在哪**：云优先工具的商业模式与"学习数据属于我"直接冲突；本地工具又常常把配置成本转嫁给用户。

## 3. 用户明说想要、主流 AI 工具却默认不做的

1. **让 AI 先开口**：「Tutors are proactive, not reactive.」— [HN 49974615](https://news.ycombinator.com/item?id=49974615)
2. **讲之前先诊断**：「ask me three questions, and don't move on until I get it」— [1y154i9 评论](https://www.reddit.com/r/ChatGPT/comments/1y154i9/can_chatgpt_plus_really_teach_better_than_free_or/19sxf5q7jmht1/)
3. **出完题有地方存、下次还认得**：「lost track of which questions I kept getting wrong」— [1xplhwh](https://www.reddit.com/r/GetStudying/comments/1xplhwh/i_made_a_tool_where_you_just_tell_your_chatbot/)
4. **学习状态跨会话延续**：「gpt forgets the tiny stuff, but the doc doesn't」— [1y0mpgz 评论](https://www.reddit.com/r/ChatGPT/comments/1y0mpgz/how_do_you_deal_with_the_poor_memory_of_chat_gpt/19sw4b61q45up/)
5. **可信度可见**：「definitely don't do it without checking the output」— [1j1rpfd 评论](https://www.reddit.com/r/Anki/comments/1j1rpfd/unpopular_opinion_you_shouldnt_use_ai_to_create/mfm4dg6/)
6. **不用先建系统**：「you dont have to design your own system before you can start using it」— [1xid69e 评论](https://www.reddit.com/r/productivity/comments/1xid69e/do_anyone_use_any_apps_or_some_type_of_different/19rtz5fblrm1v/)
7. **数据自持、可离线**：「No Ollama… no API key」— [1w8hgmq](https://www.reddit.com/r/ObsidianMD/comments/1w8hgmq/i_got_tired_of_keeping_ollama_running_next_to/)
8. **"被考"而不是"被讲"**：「review your cards by talking」— [Anki 论坛 69298](https://forums.ankiweb.net/t/69298)

## 4. 与 ASAKI 现状对照

（CHANGELOG 行号指本文写作时的 `CHANGELOG.md`。）

| 聚类 | 现状 | 依据 | 缺口 |
| --- | --- | --- | --- |
| 2.1 讲懂但记不住 | **半处理** | 「阿咲当老师」（L11）、「证据驱动的复习调度」（L14）已把"答错 → 错题 → 跨天复习"闭环 | 解释性对话与未来检索之间没有自动桥：用户不说「考考我」，讲完就断了 |
| 2.2 不知道该问什么 | **半处理** | 「掌握感知讲解」（L25）会选示例先行/先练后讲，「今日页」（L51）置顶接下来该做的 1–3 件事 | 阿咲仍是被动的；不会自己提议"上次你在这错了，练三道？" |
| 2.3 想被考 | **已处理** | `create_practice_set` 工具 + 「简答题与自由回忆」（L17）+ 「交错混练」（L20）+ 「掌握门控」（L22） | 「考考我」要用户说出口；没有定时/到期的主动抽测 |
| 2.4 启动成本高 | **半处理** | 「今日页」「首次运行」（L71）把入口收到一处；无插件市场；但「视频笔记/课件」（L45、L48）本身是重流程 | 从"我刚学到的这条"到"明天的复习题"仍要用户开口 |
| 2.5 内容不可信 | **半处理** | 「视频课件」有润色、事实核查与质量报告（L48） | 练习题题干/答案/解析没有"模型生成，待核对"标记与采纳路径 |
| 2.6 不知道有没有进步 | **半处理** | 「把握度校准」（L29）、「学习热力图与正确率趋势」（L35）、「周复盘带真实数据」（L43） | 缺"关掉解释、用自己的话说出来"这一档；校准只给数字不给下一步 |
| 2.7 会话记忆 | **已处理** | 本地 markdown 知识库 + 「本次参考」（L59）+ 「我的资料」（L53）；README 声明本地优先 | 这是相对 ChatGPT 的真实优势，应继续守 |
| 2.8 数据自持 | **已处理** | README L12：「无账号、无服务器、无遥测；知识库是纯 markdown」；密钥只进 `safeStorage` | 无 |

**结论**：2.1–2.6 的缺口有同一根轴——**ASAKI 会做题、会存题，但不会自己发起"考一下"**。2.7/2.8 已经是强项，不需要再投入。

## 5. 排序后的待办（≤8 项，按需求 × 契合 × 成本）

排位说明：每组给出"用户痛点 1 行 + 最小可行做法 + 挂靠的现有界面 + 证据强度（可引用条数 + 研究支持）"。**明确标注**：任何一项都不以"考试/押题/排名"为前提——主人已排除考试专属假设；下面第 3、5 项尤其容易被写成考试话术，实现时必须用"能不能用自己的话讲出来"而不是"能拿多少分"来验收。

1. **「讲完 → 明天抽测」自动桥接**
   痛点：解释完就结束，下次不会回头。
   做法：一轮讲解产出后，若用户做了题或复述，默认把那 1 条挂进错题本/复习排期；不做题不硬塞。
   挂靠：阿咲当老师（L11）+ 错题本 + 复习调度（L14）。
   证据：4 帖 + 3 条评论（2.1 的 1xcpfll、1xu4qtw、1xycmon、1xkkxee 及两条同帖评论；2.7 的 1y0mpgz 评论）+ 研究（[2506.08872](https://arxiv.org/abs/2506.08872)、[2610.37888](https://arxiv.org/abs/2610.37888)）。

2. **阿咲主动提议一次 5 分钟抽测**
   痛点：用户不问，工具不动；用户自己也不知道该练什么。
   做法：今日页/检查消息里，当有到期错题或某项近 8 周正确率偏低时，给一句"要不要现在抽 3 道？"点一下即进入。
   挂靠：今日页（L51）+ 提醒生命周期（L66）+ `create_practice_set`。
   证据：5 条（[1xnk1l2](https://www.reddit.com/r/GetStudying/comments/1xnk1l2/how_to_know_what_to_study/)、[HN 50146768](https://news.ycombinator.com/item?id=50146768)、[HN 49974615](https://news.ycombinator.com/item?id=49974615)、[HN 49973492](https://news.ycombinator.com/item?id=49973492)、[1y154i9](https://www.reddit.com/r/ChatGPT/comments/1y154i9/can_chatgpt_plus_really_teach_better_than_free_or/)）+ 研究（[2609.23958](https://arxiv.org/abs/2609.23958) 结构 > 模态）。

3. **讲解前 1–2 个诊断问题**
   痛点：讲太浅没用、讲太深听不下去，且用户自己说不清哪里不懂。
   做法：在现有「掌握感知讲解」提示里加一条——新主题先问 1 个、最多 2 个具体问题，答完再决定示例先行还是先练后讲；不做问卷。
   挂靠：掌握感知讲解（L25）。
   证据：3 条（[1y154i9](https://www.reddit.com/r/ChatGPT/comments/1y154i9/can_chatgpt_plus_really_teach_better_than_free_or/)、[1xnk1l2](https://www.reddit.com/r/GetStudying/comments/1xnk1l2/how_to_know_what_to_study/)、[1xycmon](https://www.reddit.com/r/GetStudying/comments/1xycmon/anyone_else_study_for_hours_but_still_struggle_to/)）+ 研究（[2512.23633](https://arxiv.org/abs/2512.23633) 苏格拉底提问稿、[2603.19634](https://arxiv.org/abs/2603.19634)）。

4. **「用自己的话讲一遍」纳入掌握判定**
   痛点：看得懂 ≠ 说得出；现有掌握判定只是"隔 3 天又答对"。
   做法：短答题（L17）已具备；把"关掉材料复述一次"作为可选的加严条件，只在用户自己勾选"我想更严"时生效。
   挂靠：简答题与自由回忆（L17）+ 掌握门控（L22）+ 复盘页。
   证据：4 条（[1xwecg6](https://www.reddit.com/r/GetStudying/comments/1xwecg6/you_studied_for_two_hours_what_can_you_do_now/)、[1xq2ba4](https://www.reddit.com/r/GetStudying/comments/1xq2ba4/how_do_you_effectively_study_and_evaluate_your/)、[1xzahqg](https://www.reddit.com/r/GetStudying/comments/1xzahqg/i_understand_what_i_study_but_i_struggle_to/)、[1xkkxee 评论](https://www.reddit.com/r/GetStudying/comments/1xkkxee/most_of_us_were_never_taught_how_to_study_only/19ry4cnwq4d4z/)）+ 研究（[2506.08872](https://arxiv.org/abs/2506.08872)）。**风险**：若被写成"考试模拟"就跑偏了，见小节开头的警示。

5. **一周「诚实回执」：校准 + 下一步**
   痛点：仪表盘给了数字，没给判断。
   做法：周复盘（L43）加两行——"有把握但错 N 道 / 没把握但对 N 道"和"下周先练这 2 个"，无数据时整段不出现（沿用现有空状态规则）。
   挂靠：把握度校准（L29）+ 周复盘（L43）。
   证据：3 条（[1xwecg6](https://www.reddit.com/r/GetStudying/comments/1xwecg6/you_studied_for_two_hours_what_can_you_do_now/)、[1xq2ba4](https://www.reddit.com/r/GetStudying/comments/1xq2ba4/how_do_you_effectively_study_and_evaluate_your/)、[1x7lv8j](https://www.reddit.com/r/languagelearning/comments/1x7lv8j/anyone_else_feel_like_theyre_paying_for_tutoring/)）+ 研究（[2512.12306](https://arxiv.org/abs/2512.12306)、[2603.19634](https://arxiv.org/abs/2603.19634)）。

6. **生成内容标「待核对」，一键采纳或丢弃**
   痛点：AI 出的题/解析对错无人担保，用户要么全信要么全核。
   做法：练习集与解析落盘时带 `source: 'model'`，界面显示一个小标记；用户点"我看过了"即转为已核。沿用视频课件既有的质量报告思路。
   挂靠：练习集编辑 + 视频课件质量报告（L48）。
   证据：6 条（[1mewr8p](https://www.reddit.com/r/Anki/comments/1mewr8p/problem_with_aigenerated_flashcards/)、[1w7ibck](https://www.reddit.com/r/Anki/comments/1w7ibck/maybe_controversial_opinion_using_artificial/)、[1j1rpfd](https://www.reddit.com/r/Anki/comments/1j1rpfd/unpopular_opinion_you_shouldnt_use_ai_to_create/)、[1wf4fz6](https://www.reddit.com/r/languagelearning/comments/1wf4fz6/please_beware_of_ai_when_learning_languages_its/)、[1wsfuub](https://www.reddit.com/r/languagelearning/comments/1wsfuub/do_you_use_ai_chat_bots_for_practicing_languages/)、[1jew3bs](https://www.reddit.com/r/ADHD/comments/1jew3bs/ai_is_a_powerful_tool_for_people_with_adhd/)）。

7. **单题入库，而不是整套卡**
   痛点：要么手工做卡、要么让 AI 灌一整套垃圾。
   做法：错题本/练习记录里任意一条可"转为复习卡"；批量生成保持现状（已有），不新增"一键全课成卡"。
   挂靠：错题本 + 学习页练习模块。
   证据：4 条（[1y0jkgd](https://www.reddit.com/r/Anki/comments/1y0jkgd/guys_i_need_urgent_help_before_i_lose_my_brain/)、[1u3uupt](https://www.reddit.com/r/Anki/comments/1u3uupt/how_do_you_decide_what_actually_deserves_a_card/)、[1mewr8p](https://www.reddit.com/r/Anki/comments/1mewr8p/problem_with_aigenerated_flashcards/)、[1ray0h6](https://www.reddit.com/r/Anki/comments/1ray0h6/ranki_rule_updates_aigenerated_content_and_ai/)）。

8. **首次运行里明说「你不用配置任何系统」**
   痛点：用户被"先建系统才能开始"劝退。
   做法：首次运行对话框（L71）加一行事实陈述（不是营销词），并指明数据落在哪个目录。
   挂靠：首次运行（L71）。
   证据：4 条（[forum.obsidian.md/t/113776](https://forum.obsidian.md/t/113776)、[1tfbvty](https://www.reddit.com/r/productivity/comments/1tfbvty/should_i_just_abandon_my_digital_second_brain_for/)、[1xid69e](https://www.reddit.com/r/productivity/comments/1xid69e/do_anyone_use_any_apps_or_some_type_of_different/)、[1xpbr05](https://www.reddit.com/r/ObsidianMD/comments/1xpbr05/yet_another_notion_to_obsidian_post/)）。

## 6. 反功能（用户会要，但我们不该做）

| 反功能 | 用户的原话 | 为什么不做 |
| --- | --- | --- |
| 经验值 / 宝石 / 皮肤 / 抽卡 | 「You spend more time clicking through stupid cartoons, winning worthless gems… It sounds like you're in a casino playing a slot machine.」（[Duolingo 1 星](https://apps.apple.com/us/app/duolingo-language-lessons/id570060128)，2026-11-19）；中文「逼着你氪金，出皮肤，恶心你」（[中国区](https://apps.apple.com/cn/app/id570060128)） | 用户确实会要（Knowt 5 星：「I love how it has streaks, XP, and coins to make it more fun」，[Knowt](https://apps.apple.com/us/app/id6463744184)），但这是把学习时间换成道具时间；Anki 社区把这类插件单列成一整个"游戏化 add-on 清单"正是它喧宾夺主的证据（[1y13nkj 评论](https://www.reddit.com/r/Anki/comments/1y13nkj/is_there_like_a_way_to_make_the_reviewing_process/19sx9jj1ak5l0/)） |
| 连续打卡的罪恶感 | 「Duolingo texts me like a toxic ex about streak freezes but i learn a lot so it's ok」（[Duolingo 5 星](https://apps.apple.com/us/app/duolingo-language-lessons/id570060128)）；「每次我快忘记打卡的时候，拽姐就不能正常地提醒我吗」（[中国区](https://apps.apple.com/cn/app/id570060128)）；「I want all my streak back?!?!」（[Khan Academy](https://apps.apple.com/us/app/id469863705)，2026-09-24） | 连"喜欢它"的人都用"有毒前任"形容；断签 → 弃用是常见链条。ASAKI 已有「落后提醒」且只在完成不到一半时发一条温和提醒（L40），这个尺度就是上限 |
| 排行榜 / 社交比较 | 「How do I stop feeling demotivated because other people have already seen me fail」（[1xt39eu](https://www.reddit.com/r/GetStudying/comments/1xt39eu/how_do_i_stop_feeling_demotivated_because_other/)） | 学习进度因人而异，排名只会把"我有没有进步"换成"我比谁差" |
| 一键摘要 / 替用户读 | 「putting every information for AI to analyse and make a short summary while the person is not really trying to understand」（[1hun8uh 评论](https://www.reddit.com/r/Anki/comments/1hun8uh/what_are_your_honest_thoughts_on_ai_and_anki/m5mtw4g/)）；「letting ai show me how to solve something instead of struggling」（[1xq2ba4](https://www.reddit.com/r/GetStudying/comments/1xq2ba4/how_do_you_effectively_study_and_evaluate_your/)） | 这是 cognitive debt 的直接来源（[2610.37888](https://arxiv.org/abs/2610.37888)）；ASAKI 的「视频笔记/课件」是**加工**，边界应该停在"给我材料"，不越到"替我懂" |
| 全自动生成整套卡/整套题 | 「almost none of them are of good enough quality that I'd actually want to use them」；「Every other post seems to be "I made a tool to instantly turn your notes into anki cards!", and it's basically just an AI prompt」（[1ray0h6 评论](https://www.reddit.com/r/Anki/comments/1ray0h6/ranki_rule_updates_aigenerated_content_and_ai/o6n07dz/)，109 分） | 质量不可控时，省下的做卡时间会以"背错"和"逐条核对"加倍还回去；r/Anki 甚至为此专门改版规 |
| 考试模式 / 押题 / 排名式模拟考 | 「the subreddit seems to focus on exam study quite a bit. A lot of it is just advice for memorization.」（[1xkkxee 评论](https://www.reddit.com/r/GetStudying/comments/1xkkxee/most_of_us_were_never_taught_how_to_study_only/19rzsde6gu0ed/)） | 主人已明确排除考试专属假设；且用户自己也在抱怨学习社区"只会考试" |
| 为了"像人"而加语音/拟人 | 「Voice nearly doubled conversational interaction… yet it produced weekly mastery statistically equivalent to text, even as students came to prefer it.」（[2609.23958](https://arxiv.org/abs/2609.23958)） | 成本 2.8 倍、学习效果无差异；用户"更喜欢"不等于"学得更好" |

## 7. 引用清单（按首次出现顺序）

**Reddit（帖子）**——正文中凡引用具体评论的，链接已指到该评论自己的 permalink（形如 `/comments/<帖 ID>/<slug>/<评论 ID>/`）；下面只列帖子本体。
1. [r/GetStudying 1xcpfll](https://www.reddit.com/r/GetStudying/comments/1xcpfll/how_do_you_study_theory_subjects_effectively_need/) — 2026-10-23
2. [r/GetStudying 1xu4qtw](https://www.reddit.com/r/GetStudying/comments/1xu4qtw/long_time_to_understand_things_but_forget_them/) — 2026-11-12
3. [r/GetStudying 1xycmon](https://www.reddit.com/r/GetStudying/comments/1xycmon/anyone_else_study_for_hours_but_still_struggle_to/) — 2026-11-16
4. [r/GetStudying 1xkkxee](https://www.reddit.com/r/GetStudying/comments/1xkkxee/most_of_us_were_never_taught_how_to_study_only/) — 2026-11-01（529 分）
5. [r/GetStudying 1xnk1l2](https://www.reddit.com/r/GetStudying/comments/1xnk1l2/how_to_know_what_to_study/) — 2026-11-04
6. [r/GetStudying 1xplhwh](https://www.reddit.com/r/GetStudying/comments/1xplhwh/i_made_a_tool_where_you_just_tell_your_chatbot/) — 2026-11-07
7. [r/GetStudying 1xwecg6](https://www.reddit.com/r/GetStudying/comments/1xwecg6/you_studied_for_two_hours_what_can_you_do_now/) — 2026-11-15
8. [r/GetStudying 1xq2ba4](https://www.reddit.com/r/GetStudying/comments/1xq2ba4/how_do_you_effectively_study_and_evaluate_your/) — 2026-11-07
9. [r/GetStudying 1xzahqg](https://www.reddit.com/r/GetStudying/comments/1xzahqg/i_understand_what_i_study_but_i_struggle_to/) — 2026-11-18
10. [r/GetStudying 1xzfv3r](https://www.reddit.com/r/GetStudying/comments/1xzfv3r/asked_the_guy_who_got_the_highest_grade_on_the/) — 2026-11-18（1875 分）
11. [r/GetStudying 1xt39eu](https://www.reddit.com/r/GetStudying/comments/1xt39eu/how_do_i_stop_feeling_demotivated_because_other/) — 2026-11-11
12. [r/Anki 1y0jkgd](https://www.reddit.com/r/Anki/comments/1y0jkgd/guys_i_need_urgent_help_before_i_lose_my_brain/) — 2026-11-20
13. [r/Anki 1u3uupt](https://www.reddit.com/r/Anki/comments/1u3uupt/how_do_you_decide_what_actually_deserves_a_card/) — 2026-06-12
14. [r/Anki 1mewr8p](https://www.reddit.com/r/Anki/comments/1mewr8p/problem_with_aigenerated_flashcards/) — 2025-08-01
15. [r/Anki 1w7ibck](https://www.reddit.com/r/Anki/comments/1w7ibck/maybe_controversial_opinion_using_artificial/) — 2026-09-05
16. [r/Anki 1j1rpfd](https://www.reddit.com/r/Anki/comments/1j1rpfd/unpopular_opinion_you_shouldnt_use_ai_to_create/) — 2025-03-02
17. [r/Anki 1hun8uh](https://www.reddit.com/r/Anki/comments/1hun8uh/what_are_your_honest_thoughts_on_ai_and_anki/) — 2025-01-06
18. [r/Anki 1ray0h6](https://www.reddit.com/r/Anki/comments/1ray0h6/ranki_rule_updates_aigenerated_content_and_ai/) — 2026-02-22
19. [r/Anki 1y13nkj](https://www.reddit.com/r/Anki/comments/1y13nkj/is_there_like_a_way_to_make_the_reviewing_process/) — 2026-11-20
20. [r/languagelearning 1wf4fz6](https://www.reddit.com/r/languagelearning/comments/1wf4fz6/please_beware_of_ai_when_learning_languages_its/) — 2026-09-13（1312 分）
21. [r/languagelearning 1wsfuub](https://www.reddit.com/r/languagelearning/comments/1wsfuub/do_you_use_ai_chat_bots_for_practicing_languages/) — 2026-09-28
22. [r/languagelearning 1x7lv8j](https://www.reddit.com/r/languagelearning/comments/1x7lv8j/anyone_else_feel_like_theyre_paying_for_tutoring/) — 2026-10-17
23. [r/ChatGPT 1y1m9nk](https://www.reddit.com/r/ChatGPT/comments/1y1m9nk/using_chatgpt_for_godot/) — 2026-11-21
24. [r/ChatGPT 1xz5ihs](https://www.reddit.com/r/ChatGPT/comments/1xz5ihs/chat_window_context/) — 2026-11-18
25. [r/ChatGPT 1y0mpgz](https://www.reddit.com/r/ChatGPT/comments/1y0mpgz/how_do_you_deal_with_the_poor_memory_of_chat_gpt/) — 2026-11-20
26. [r/ChatGPT 1y154i9](https://www.reddit.com/r/ChatGPT/comments/1y154i9/can_chatgpt_plus_really_teach_better_than_free_or/) — 2026-11-20
27. [r/ObsidianMD 1xpbr05](https://www.reddit.com/r/ObsidianMD/comments/1xpbr05/yet_another_notion_to_obsidian_post/) — 2026-11-06
28. [r/ObsidianMD 1w8hgmq](https://www.reddit.com/r/ObsidianMD/comments/1w8hgmq/i_got_tired_of_keeping_ollama_running_next_to/) — 2026-09-06
29. [r/productivity 1tfbvty](https://www.reddit.com/r/productivity/comments/1tfbvty/should_i_just_abandon_my_digital_second_brain_for/) — 2026-05-17
30. [r/productivity 1xid69e](https://www.reddit.com/r/productivity/comments/1xid69e/do_anyone_use_any_apps_or_some_type_of_different/) — 2026-10-29
31. [r/ADHD 1jew3bs](https://www.reddit.com/r/ADHD/comments/1jew3bs/ai_is_a_powerful_tool_for_people_with_adhd/) — 2025-03-19

**Hacker News**
32. [HN 50146768](https://news.ycombinator.com/item?id=50146768) — 2026-10-18
33. [HN 49974615](https://news.ycombinator.com/item?id=49974615) — 2026-10-06
34. [HN 49973492](https://news.ycombinator.com/item?id=49973492) — 2026-10-06

**论坛**
35. [forum.obsidian.md/t/113776](https://forum.obsidian.md/t/113776) — 2026-04-28
36. [forums.ankiweb.net/t/21251](https://forums.ankiweb.net/t/21251) — 2022-07-06
37. [forums.ankiweb.net/t/69298](https://forums.ankiweb.net/t/69298) — 2026-03-31

**App Store（评论正文经 Apple 评论 RSS 读取，日期为评论日期；链接指向应用页）**
38. [AnkiMobile 中文评论](https://apps.apple.com/cn/app/id373493387) — 2025-09-13
39. [Duolingo 英文评论](https://apps.apple.com/us/app/duolingo-language-lessons/id570060128) — 2026-11-19
40. [Duolingo 中文评论](https://apps.apple.com/cn/app/id570060128) — 2026-11-20
41. [Quizlet](https://apps.apple.com/us/app/id546473125) — 2026-11-18
42. [Knowt](https://apps.apple.com/us/app/id6463744184) — 2026-05-13 / 2026-10-01
43. [Khan Academy](https://apps.apple.com/us/app/id469863705) — 2026-09-24
44. [Noji (formerly Anki Pro)](https://apps.apple.com/us/app/id1573585542) — 2026-10-08

**Bilibili**
45. [BV17FLR6dE3u「如何借助 AI 高效背书」](https://www.bilibili.com/video/BV17FLR6dE3u) — 2026-06-17
46. [BV1ts421M73Y「AI 已经进化到能帮你提高记忆力了」](https://www.bilibili.com/video/BV1ts421M73Y) — 2024-06-22
47. [BV1hcsb6aE1S「刷题留给试卷，背单词交给它」](https://www.bilibili.com/video/BV1hcsb6aE1S) — 2026-11-19

**论文 / 机构**
48. Kosmyna et al. (2025). Your Brain on ChatGPT — [arXiv:2506.08872](https://arxiv.org/abs/2506.08872) / [MIT Media Lab](https://www.media.mit.edu/publications/your-brain-on-chatgpt/)
49. Cognitive Debt in the GenAI Era（76 篇灰文献综述）— [arXiv:2610.37888](https://arxiv.org/abs/2610.37888)（2026-10-27）
50. When AI Tutors Speak（N=86 预注册 RCT）— [arXiv:2609.23958](https://arxiv.org/abs/2609.23958)（2026-09-21）
51. AI tutoring can safely and effectively support students（英国五校 RCT，N=165）— [arXiv:2512.23633](https://arxiv.org/abs/2512.23633)（2025-12-29）
52. From Co-Design to Metacognitive Laziness — [arXiv:2512.12306](https://arxiv.org/abs/2512.12306)（2025-12-13）
53. Towards an AI Buddy for every University Student?（N=926 调查）— [arXiv:2603.20909](https://arxiv.org/abs/2603.20909)（2026-03-21）
54. MetaCues（N=146）— [arXiv:2603.19634](https://arxiv.org/abs/2603.19634)（2026-03-20）
55. The Impact of Generative AI on Critical Thinking（Microsoft Research 知识工作者调查）— [Microsoft](https://www.microsoft.com/en-us/research/publication/the-impact-of-generative-ai-on-critical-thinking-self-reported-reductions-in-cognitive-effort-and-confidence-effects-from-a-survey-of-knowledge-workers/)

## 8. 一句话结论

用户要的不是"更聪明的解释器"，而是**一个会自己开口考我、记得我上次错在哪、并且能让我在没有解释的情况下把知识说出来的伙伴**——这正好落在 ASAKI 已有能力（错题调度、短答、校准、本地知识库）的延长线上，不需要新建产品形态；最该补的是"由它发起"和"生成内容可核对"这两件事。
