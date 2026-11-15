# ASAKI：视频转课件（完整课件模式）设计（2026-11-15）

> 状态：草案。需求来自 2026-11-14～15 的需求追问（Q1～Q13，全部按推荐确认）。标"建议"的条目是本文新提的方案，尚未确认，汇总在第 7 节。

## 一句话

在现有的视频笔记旁边加一个「完整课件」模式。除了转写语音，再抽关键帧读出屏幕上的文字，按 video-md-ppt 的规范生成分页课件：每页标来源，带补充卡片，生成后独立核查一遍。任务在后台排队，可以取消，中断后可以接着跑。

## 1. 背景

### 1.1 现状

- 入口：知识库页的「视频笔记」按钮（`src/renderer/shell/KnowledgePage.tsx:361`）。
- 流水线（`src/main/video-notes/service.ts`）：读视频时长 → 抽音频，每 180 秒一段送 MiMo 转写（质量不合格的段对半再切，最多切两层）→ 调一次模型生成笔记（转写超过 12 万字时按 6 万字分段提炼再合并）→ 写 `notes.md`、`notes.html`、`transcript.json`，最后写 `meta.json`。
- 课件效果：笔记按二级标题切页，一节一页，内容多了就在页内滚动（`src/main/video-notes/html.ts:133`）。模型输出里的 HTML 会被转义（`src/main/video-notes/html.ts:91`），图片只显示占位文字（`src/main/video-notes/html.ts:92`）。没有关键帧，没有来源标注，也没有核查。
- 运行方式：同一时间只能跑一个任务（`src/main/video-notes/service.ts:548`）；任务运行时对话框关不掉（`src/renderer/shell/VideoNotesDialog.tsx:212`）；不能取消；一次最多选 50 个文件（`src/renderer/shell/VideoNotesDialog.tsx:22`）。
- 模型接口只能传文字（`src/main/agent/model-client.ts:18`）。
- 用量：每次模型调用都记进每日用量（`src/main/context.ts:313`）。当天用量达到预算（默认 20 万 tokens）后，主动提醒暂停（`src/main/check-ins/proactive-check-in-service.ts:97`）；手动对话超出预算时，每次启动应用确认一次（`src/renderer/shell/Workspace.tsx:476`）。视频笔记不检查预算。
- 这台机器上还没用 ASAKI 生成过视频笔记：没存 MiMo key，也没有转写缓存。

### 1.2 参照：video-md-ppt

本地项目 `C:\Users\34191\orca\projects\video-md-ppt`（Python + Marp）。流程：转写（faster-whisper）→ 关键帧 → 大纲 → 笔记 → 补充卡片 → 独立核查（两轮）→ 课件规划 → Marp 课件、PDF 和逐页截图自检。出完大纲和做完课件规划后各停一次，等人确认。

02 讲（45:11）的成品有 58 页，其中补充页 28 页，共 170 处来源角标，用了 57 张关键帧。核查记录 37 条，改正 6 处错误，收紧 12 处说得太绝对的地方。第一部分 12 讲共 547 页，已经交付在 `F:\四级课件`。

借鉴的部分：

- 内容规范：`docs/需求文档.md` 的 8.5（补充卡片）、9.2（页面类型）、9.3（密度与排版）、9.4（视觉与交互）。
- 提示词：`prompts/s3-outline.md`、`prompts/s4-notes.md`、`prompts/s4.5-enrichment.md`、`prompts/s4.6-factcheck.md`、`prompts/s5-slides.md`，改写成 ASAKI 各步骤的提示词。
- 关键帧算法和参数：`scripts/keyframes.py`、`config.toml:29`（参数见 4.3）。
- 主题：青绿 `#0f766e` 配橙 `#c2410c`，以及 `.src`、`.why`、`.compare`、`.flow`、`.quiz` 等版式。
- 版面检查：720px 高的页面，内容底边不能超过 656px（`scripts/check_slides.py:21`）。

不借鉴的部分：Python 运行时、faster-whisper（02 讲上 MiMo 转得更准，见 1.3）、运行时用 `npx` 调 Marp，以及中途停下等确认（Q6）。

### 1.3 实测结论

以下结论都在这台机器上实测过（2026-11-14～15）：

- **屏幕上的内容比语音多。** 我从写作、阅读、听力真题课和听力技巧课里各抽了 3 帧。题干、选项、范文和老师的勾画都在屏幕上，老师讲课时不会逐字念。写作课和阅读课里，老师常站在画面右侧，挡住一部分文字。只用转写会丢掉这些内容。
- **本机 Claude CLI 能读图。** 用 `claude -p --input-format stream-json` 把两张帧放进同一条消息里，23 秒返回。听力选项逐字抄对了，被挡住的地方按要求标了〔遮挡〕，没有乱猜。
- **调用开销取决于是否加载工具。** 一次纯文字调用：用默认工具集时输入约 1.58 万 tokens（含缓存命中），加 `--tools ""` 后约 1800 tokens。一张 1280px 的帧大约多 650 个输入 tokens。所以流水线里的调用必须关掉工具（见 4.5）。
- **本机 claude CLI 实际接的模型是 `opencode-go/deepseek-v4.1-flash`**（stderr 里有提示）。上面的读图效果是这个配置下测出来的，换了模型要重测。
- **02 讲 MiMo 比 whisper 准。** MiMo 的原始转写里没有术语错误，英文例句保持英文原文。whisper 在 CPU 上跑了 33 分钟，事后还要用 35 条规则修正 125 处。
- **转写时间戳只精确到分段起点。** 02 讲的旧 MiMo 转写共 20 段、35,178 字，每段起点相隔 90～180 秒，段内没有更细的时间。关键帧的时间精确到秒，所以每页的回看时间优先取该页对应的关键帧（见 4.4）。
- **02 讲的场景检测从没触发过。** video-md-ppt 在 02 讲选出的 57 帧全部来自定时采样。翻页靠老师点击，画面变化小，`scene > 0.3` 的阈值抓不到翻页。

### 1.4 已确认的需求

| 编号 | 决定 |
|---|---|
| Q1 | 课件主要给自己复习：不重看整段视频也能理解知识点、看懂例题、记住易错点，再用小题自测；有疑问时点时间戳跳回视频。 |
| Q2 | 12 月 12 日四级考试前的课件继续用 video-md-ppt 做；ASAKI 这个功能以质量为准，不赶考试。 |
| Q3 | 产出离线单文件 HTML 课件，并能导出 PDF；不做 .pptx。 |
| Q4 | 抽关键帧，由模型读出屏幕上的文字，整理成文字并标〔画面〕；只有图表、手写批注等整理不成文字的内容才放截图。 |
| Q5 | 加补充卡片，每条标〔视频〕〔推演〕〔扩展〕；生成后自动做一轮独立核查：错误删掉或改正，说得太绝对的收紧，有争议的标"待确认"。 |
| Q6 | 一键跑完，中途不停；最后出一份质量报告，列出未覆盖的内容、核查改了什么、哪些页内容超出页面。 |
| Q7 | 通用：任何学科的讲课视频，中文讲或中英混讲都可以；四级课只用来验收，提示词里不写死四级内容。 |
| Q8 | 保留现有的快速笔记；对话框里在「快速笔记」和「完整课件」之间二选一，默认完整课件。 |
| Q9 | 本次一起做：任务在后台排队，可以关掉对话框，可以取消；每一步的结果都存盘，失败或中断后从断点接着跑；可以直接选整个文件夹。 |
| Q10 | 视频课件的用量照常记入每日用量，但判断主动提醒是否暂停时不算这部分；开始前在对话框里显示这批视频的预估用量。 |
| Q11 | 小测只放在课件里，点开看答案；本次不接 ASAKI 的练习集。 |
| Q12 | 核查用同一个模型，另开一次全新调用，不带写作时的上下文。 |
| Q13 | 用浏览器看课件；ASAKI 里只放生成入口和"打开"按钮，不加课件库页面。 |

## 2. 目标与非目标

### 目标

- 新增「完整课件」模式，质量以 video-md-ppt 的 02 讲为标准，具体指标见第 6 节。
- 读屏：抽关键帧，读出屏幕上的文字并整理进课件（Q4）。
- 补充卡片带来源标注，生成后做独立核查（Q5、Q12）。
- 一键跑完，最后给出质量报告（Q6）。
- 后台排队、取消、断点续跑、选择整个文件夹（Q9）。快速笔记模式也一起用上这套机制。
- 视频课件的用量单独标记，开始前显示预估用量（Q10）。
- 产出单文件 HTML 和 PDF（Q3），学科不限（Q7）。

### 非目标

- 不做 .pptx（Q3），不在应用里加课件库或播放器（Q13），不接练习集和知识库（Q11），不做中途审阅（Q6），不换用其他 CLI 交叉核查（Q12）。
- 不做讲者模式或放映视图，不在应用里编辑课件。
- 不导入 video-md-ppt 已经做好的 547 页课件。
- 同一任务里的多讲按顺序处理，不并行。
- 不引入 Python、whisper、Marp 或 `npx` 运行时。

### 约束

- 不新增运行时依赖。用现有的 `zod`、`marked` 和 Electron；ffmpeg 仍然在外部，沿用 `ASAKI_FFMPEG_PATH`、`ASAKI_FFPROBE_PATH`。
- 本地优先：只有 MiMo 转写和你配置的模型会联网，产物只存在本地。
- 模型不直接写 HTML，只输出结构化 JSON，由 ASAKI 校验后渲染。模型给的文本一律转义。
- 所有写入走 `writeFileAtomic`（`src/main/workspace/fs-utils.ts:33`）。

## 3. 模块划分

主进程的流水线不依赖 Electron，方便测试。版面测量和导出 PDF 需要浏览器，通过接口从 Electron 入口注入，做法和现有的文件选择器、`shell.openPath` 一样（`src/main/context.ts:586`）。

| 模块 | 位置 | 职责 | 改动 |
|---|---|---|---|
| 任务队列 | `src/main/video-notes/jobs.ts` | 排队、串行执行、取消、存盘、重启后恢复 | 新增 |
| 步骤存档 | `src/main/video-notes/checkpoint.ts` | 每步结果连同输入指纹一起存盘，续跑时跳过已完成的步骤 | 新增 |
| 流水线编排 | `src/main/video-notes/service.ts` | 拆成独立步骤，按模式选用；把 AbortSignal 传给每一步 | 修改 |
| 媒体 | `src/main/video-notes/media.ts` | 增加抽帧和读取原始像素，支持取消 | 修改 |
| 转写 | `src/main/video-notes/mimo.ts` | 接入取消信号，逻辑不变 | 修改 |
| 关键帧 | `src/main/video-notes/keyframes.ts` | 候选帧采样、dHash 和像素差去重、清晰度、帧数预算 | 新增 |
| 读屏 | `src/main/video-notes/screen-read.ts` | 分批把帧交给模型，得到每帧的文字 | 新增 |
| 课件内容 | `src/main/video-notes/deck/{prompts,outline,notes,enrich,factcheck,compose}.ts` | 大纲 → 笔记 → 补充卡片 → 核查 A → 分章组页 → 核查 B | 新增 |
| 课件结构 | `src/main/video-notes/deck/schema.ts` | 用 zod 定义课件 JSON 并校验 | 新增 |
| 渲染 | `src/main/video-notes/deck/{render,theme}.ts` | JSON 转单文件 HTML，内含主题和翻页脚本 | 新增 |
| 版面与 PDF 接口 | `src/main/video-notes/deck/browser.ts` | 定义 `DeckBrowser` 接口：测量每页内容底边、导出 PDF | 新增 |
| 版面与 PDF 实现 | `src/main/deck-browser.ts` | 用隐藏的 `BrowserWindow` 实现上面的接口 | 新增 |
| 质量报告 | `src/main/video-notes/deck/report.ts` | 汇总覆盖情况、核查结果、超出页面的页 | 新增 |
| 快速笔记 | `src/main/video-notes/{notes,html}.ts` | 保持不变；课程索引增加课件链接 | 小改 |
| 模型接口 | `src/main/agent/{model-client,ai-sdk-client,cli-agent-client}.ts` | 支持传图片和无工具调用 | 修改 |
| 用量 | `src/shared/usage.ts`、`src/main/usage/*`、`src/main/context.ts` | 用量记录增加 `feature` 标记；主动提醒的预算判断不算视频课件 | 修改 |
| IPC | `src/shared/video-notes.ts`、`src/main/ipc.ts`、`src/main/index.ts` | 任务相关的通道、选择文件夹、预估用量 | 修改 |
| 界面 | `src/renderer/shell/VideoNotesDialog.tsx`、`src/renderer/shell/VideoJobList.tsx` | 切换模式、选文件夹、显示预估；任务列表 | 修改和新增 |

## 4. 接口与数据流

### 4.1 流水线与断点续跑

每讲按下面的步骤顺序执行。「快速笔记」只跑第 1、2、10 步，用现有的 `generateNoteBody` 和 `renderLessonHtml`。

| # | 步骤 | 输入 | 输出（`work/` 下） | 模型调用 |
|---|---|---|---|---|
| 1 | probe | 视频 | `probe.json`（时长） | 0 |
| 2 | transcribe | 音频 | 沿用现有缓存，另写 `transcript.json` | MiMo，每 180 秒一次 |
| 3 | keyframes | 视频 | `keyframes.json` 和 `frames/*.jpg` | 0 |
| 4 | screen-read | 关键帧 | `screen.json`（每帧的文字、版面类型、遮挡标记） | 每 4 帧一次 |
| 5 | outline | 转写 + 读屏 | `outline.json`（章节、起止时间、知识点） | 1 |
| 6 | notes | 大纲 + 转写 + 读屏 | `notes.json` 和 `notes.md` | 1；转写超过 12 万字时按章节分次 |
| 7 | enrich | 笔记 | `enrich.json`（补充卡片） | 1～2 |
| 8 | factcheck-a | 笔记 + 补充卡片 + 转写 | `factcheck-a.json`，修订后的笔记和卡片 | 1 次核查 + 1 次修订 |
| 9 | compose | 修订后的内容 + 关键帧 | `deck.json`（课件 JSON） | 每章 1 次 |
| 10 | render | `deck.json` | `slides.html` | 0 |
| 11 | layout | `slides.html` | `layout.json`（每页的内容底边） | 超出页面的页各重排 1 次 |
| 12 | factcheck-b | `deck.json` + 修订后的笔记 | `factcheck-b.json`，最终的 `deck.json` | 1 次核查 + 按需修订 |
| 13 | export | `slides.html` | `slides.pdf` | 0 |
| 14 | report | 以上全部 | `report.md` | 0 |
| 15 | meta | — | `meta.json`（最后写） | 0 |

说明：

- **核查 B 在版面检查之后。** 版面检查会拆页或改写要点，所以核查要放在最终内容上做。核查 B 改过的页再走一遍第 10、11 步，最多重来一次。
- **步骤存档。** 每步写一个 `work/<step>.json`，内容是 `{ version, step, fingerprint, output, usage, finishedAt }`。`fingerprint` 是上游各步输出、本步提示词版本、模型名和选项拼接后的 sha1。续跑时，指纹没变的步骤直接跳过。存档写完才算这一步完成，写一半就中断的视为没跑过。
- **转写缓存。** 沿用 `userData/video-notes-cache/<sha1>`，指纹包含视频路径、大小、修改时间、语言和 ASR 模型（`src/main/video-notes/service.ts:178`），换个输出目录也能命中缓存。
- **取消。** 任务持有一个 `AbortController`，信号传给 ffmpeg 子进程、MiMo 请求和模型调用。CLI 客户端已经支持 `signal`（`src/main/agent/cli-agent-client.ts:383`）。取消后保留已完成步骤的存档，下次从断点接着跑。
- **单讲失败不影响其他讲。** 和现在一样记进 `failures`，队列继续处理下一讲。失败的讲可以在任务列表里单独重试。
- **模型输出校验。** 每次模型调用的输出都用 zod 校验。校验失败时，把错误信息附在请求里重试一次；再失败，这一步就算失败。

### 4.2 产物目录

沿用现有规则：默认输出到第一个视频所在目录下的 `笔记`；同一个视频再生成时复用原来的讲次文件夹，别人的文件夹不覆盖（`src/main/video-notes/service.ts:152`）。

```
<输出目录>/
  index.html                 课程索引，每讲列出笔记和课件链接
  <讲次文件夹>/
    notes.md                 笔记（两种模式都有）
    notes.html               快速笔记的网页（仅快速笔记模式）
    transcript.json
    slides.html              完整课件，单文件，图片内嵌
    slides.pdf
    report.md                质量报告
    frames/                  选中的关键帧，1280px JPEG
    work/                    步骤存档，可以删；删了下次就从头跑
    meta.json                最后写
```

- `meta.json` 升到 `version: 2`，新增 `mode`（`quick` 或 `deck`）、`slidesPath`、`pdfPath`、`reportPath`、`slideCount`。**`readMeta` 必须同时接受 1 和 2**。现在它只认 1（`src/main/video-notes/service.ts:116`），不改的话，旧的讲次文件夹会被当成"别人的"，结果新建出 `-2` 文件夹，索引里也找不到旧讲次。
- 候选帧放在系统临时目录，选完就删。
- 任务队列存在 `userData/video-notes-jobs.json`（见 4.6）。

### 4.3 关键帧与读屏

**选帧**：把 `scripts/keyframes.py` 的算法移植成 TypeScript，参数沿用 `config.toml:29`。

1. 候选帧：每 12 秒取一帧，用 `select='isnan(prev_selected_t)+gte(t-prev_selected_t,12)'`。不用 `fps=1/12`，因为在 ffmpeg 7.1 上它给出的时间戳不对，video-md-ppt 实测过。另外用 `select='gt(scene,0.3)'` 补抓场景切换。两路候选都缩到 320px 宽，以 `-f rawvideo -pix_fmt rgb24` 从 stdout 流出，时间从 `showinfo` 的 `pts_time` 解析。一帧约 170 KB，边读边算，不落盘，也不引入图像库。
2. 聚类：按时间顺序和当前簇的代表帧比较。dHash（9×8 灰度）汉明距离 ≤6，且 32×32 RGB 平均差 ≤0.08，就算同一页。簇内保留最清晰的一帧，清晰度用拉普拉斯方差衡量。
3. 去掉翻页过渡：簇的停留时间不足 2 秒，并且和前后簇的间隔都不足 2 秒，就丢掉。
4. 最小间隔：相邻保留帧至少相隔 20 秒，场景切换帧不受这条限制。
5. 预算：每 10 分钟最多 12 帧，全片最多 80 帧，超出时均匀抽稀。
6. 导出：对选中的时间点再调一次 ffmpeg，输出 1280px 宽的 JPEG 到 `frames/<毫秒>.jpg`。

**读屏**：每次调用传 4 帧（1280px），关掉工具（见 4.5）。每帧返回：

```ts
type ScreenRead = {
  frame: string;            // frames/ 下的文件名
  t: number;                // 秒
  kind: 'slide' | 'handwriting' | 'figure' | 'speaker-only' | 'other';
  text: string;             // 逐字抄写；被挡住、看不清的地方写〔遮挡〕
  occluded: boolean;
  keepImage: boolean;       // 图表或手写批注，整理不成文字，需要放截图
};
```

- `speaker-only`（画面只有老师，没有文字）的帧不进入后续步骤。
- 读屏的文字是"画面"来源，进入课件时标〔画面 mm:ss〕。
- 提示词要求只抄不补：看不清就标〔遮挡〕，不许猜。这一点 1.3 实测过。
- 建议：一个簇里有 3 帧以上时，再附上簇内离代表帧最远的一帧，让模型拼出被挡住的文字。老师会走动，不同帧挡住的位置不一样。每多一帧，输入大约多 650 tokens。

### 4.4 课件 JSON 与渲染

**结构**（`deck/schema.ts`，用 zod 校验）：

```ts
type Source =
  | { kind: 'video'; t: number }       // 〔视频 mm:ss〕老师讲的
  | { kind: 'screen'; t: number }      // 〔画面 mm:ss〕屏幕上的
  | { kind: 'infer' }                  // 〔推演〕由视频内容直接推出
  | { kind: 'ext' };                   // 〔扩展〕视频以外的知识

type SlideBase = {
  id: string;
  title: string;                       // 结论式标题
  sources: Source[];                   // 至少一个
  t?: number;                          // 回看时间，优先取对应关键帧的时间
  status?: 'contested';                // 核查判为有争议，页面上显示"待确认"
  tip?: string;                        // 建议：复习提示，见第 7 节
};

type Slide = SlideBase & (
  | { type: 'cover'; subtitle?: string }
  | { type: 'agenda'; items: string[] }                          // ≤8
  | { type: 'section'; lead: string }
  | { type: 'points'; bullets: string[] }                        // ≤5
  | { type: 'passage'; lines: string[] }                         // 屏幕原文：题干、选项、范文
  | { type: 'figure'; frame: string; captions: string[] }        // 截图 + ≤3 条说明
  | { type: 'compare'; columns: { heading: string; items: string[] }[] }   // 2～3 栏
  | { type: 'insight'; principle: string; examples: { wrong?: string; right: string }[];
      pitfall: string; transfer: string }                        // 补充卡片，examples ≥2
  | { type: 'derive'; steps: string[] }                          // 迁移到新题的判断步骤
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; code: string }             // ≤12 行
  | { type: 'quiz'; question: string; options?: string[]; answer: string; explanation: string }
  | { type: 'summary'; points: string[]; next?: string }         // ≤3
);

type Deck = { version: 1; title: string; sourcePath: string; durationSeconds: number;
  chapters: { title: string; start: number; slides: Slide[] }[] };
```

- 页面类型和数量上限取自 video-md-ppt 需求文档 9.2、9.3。`insight` 对应补充卡片的七个字段：对应视频、一句话、原理、例、易错、迁移、来源。
- 校验规则：`video` 和 `screen` 来源的时间不能超过视频时长；`figure.frame` 必须是 `frames/` 里实际存在且 `keepImage` 为真的帧；`ext` 来源的页里不能出现"老师说""视频里讲"这类话。

**渲染**（`deck/render.ts`）：

- 输出单个 HTML 文件，CSS、脚本和图片（base64）全部内嵌，不引用任何外部资源。参考体积：02 讲的成品是 666 KB。
- 舞台按 1280×720 排版，整体缩放到窗口大小。页内不滚动，内容放不下就靠版面检查拆页。
- 交互：← → 和空格翻页，手机上可以滑动翻页；有进度条和页码；目录页的条目可以点击跳转；地址里的 `#12` 表示第 12 页，刷新后停在原页；小测点击后展开答案。
- 每页角落显示来源标记，带时间的标记点击后跳到原视频的对应位置（`file://...#t=`）。只允许链接到本讲自己的视频，规则沿用 `safeHref`（`src/main/video-notes/html.ts:53`）。
- 模型给的文本一律转义。只认两种行内标记：`**粗体**` 和 `==重点==`，用自己写的小函数处理，不经过 `marked`。
- 加 CSP：`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'`。
- 主题（建议）：沿用 video-md-ppt 的青绿和橙色，颜色全部定义成 CSS 变量；跟随系统切换深色和浅色，也可以手动切换；打印时固定用浅色。字体用系统字体栈（含 Microsoft YaHei），不下载网络字体。

**版面检查与 PDF**（`DeckBrowser`，在 Electron 入口里实现）：

- 用隐藏的 `BrowserWindow` 按 1280×720 加载 `slides.html`，调用页面里的 `__deckLayout()`，返回每页内容的底边位置。超过 656px 的页算超出页面。
- 超出的页把这一页的 JSON 和测量结果交给模型，要求拆成两页或精简要点，最多两轮。仍然超出的写进质量报告。不靠缩小字号来塞内容（需求文档 9.3）。
- PDF 用 `webContents.printToPDF`，纸张 13.333×7.5 英寸，打印背景色。打印样式下每页一张，小测答案全部展开。
- 窗口安全设置：`sandbox: true`、`contextIsolation: true`、不开 `nodeIntegration`；拦截所有跳转和新窗口；用完立即销毁。

### 4.5 模型接口：图片与无工具调用

`src/main/agent/model-client.ts` 加三个可选字段。不传时行为和现在一样，现有调用不用改：

```ts
interface ModelImage { path: string; mediaType: 'image/jpeg' | 'image/png' }
interface ModelMessage { /* 现有字段 */ images?: ModelImage[] }   // 只在 user 消息上生效
interface ModelRequest {
  /* 现有字段 */
  noTools?: boolean;      // 纯生成调用，不加载任何工具
  timeoutMs?: number;     // 覆盖 CLI 默认的 180 秒（cli-agent-client.ts:118）
}
```

不同 provider 的实现方式：

| Provider | 传图片 | `noTools` |
|---|---|---|
| claude CLI | 带图片时改用 `--input-format stream-json`，从 stdin 写入一条 user 消息，内容是文字块加 base64 图片块。1.3 实测可用。 | `--tools ""` |
| codex CLI | `-i <文件>`，可以重复多次 | 不支持，照常调用 |
| opencode CLI | `--file <文件>`，可以重复多次 | 不支持，照常调用 |
| zcode CLI | 不支持 | 不支持 |
| AI SDK（anthropic、openai-compatible、ollama） | `toAiSdkMessages` 给 user 消息加 `{ type: 'image', image: Buffer, mediaType }` 内容块（改 `src/main/agent/ai-sdk-client.ts:212`） | 本来就不带工具 |

- 不支持图片的 provider 收到带图片的请求时，直接报错"当前模型不支持读图"，不会悄悄把图片丢掉。
- 流水线开始前先探测一次。如果不能读图，跳过读屏，课件只用转写；质量报告和对话框里都写明"本讲没有读屏"（建议，见第 7 节）。
- 流水线的每次调用都设 `noTools: true` 和 `timeoutMs: 15 分钟`。不加载工具的话，claude 每次调用的固定输入从约 1.58 万 tokens 降到约 1800（1.3 实测）。
- `--tools ""` 在 Windows 上会经过 `cmd /c`，空字符串要按 `quoteWindowsArgument` 的规则转成 `""`（`src/main/agent/cli-command.ts:99`），单测要覆盖这种情况。
- 不需要新的密钥或权限。图片只从 `frames/` 读取，路径由流水线自己生成，不接受渲染进程传来的路径。

### 4.6 任务队列与 IPC

**任务**：

```ts
type VideoJobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';
type VideoJob = {
  id: string;
  mode: 'quick' | 'deck';
  videoPaths: string[];
  outputDir: string;
  language: VideoNotesLanguage;
  status: VideoJobStatus;
  createdAt: string;
  lessons: {
    videoPath: string;
    status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
    step?: string;                // 当前步骤，对应 4.1 的表
    message?: string;
    lessonDir?: string;
    usage: ModelUsage;
  }[];
  estimate: { tokens: number; minutes: number };
  usage: ModelUsage;
};
```

- 队列存在 `userData/video-notes-jobs.json`，用 `writeFileAtomic` 写入。完成的任务保留最近 50 个。
- 一次只跑一个任务，任务里的各讲按顺序处理。新提交的任务排在队尾。
- 关掉对话框不影响任务。退出应用时，在 `before-quit`（`src/main/index.ts:388`）里取消正在跑的任务，并把它标成 `interrupted`。下次启动不会自动接着跑，任务列表里显示"已中断"和"继续"按钮。点继续就从断点开始（建议，见第 7 节）。
- 重试：失败的讲可以单独重试，从失败的步骤开始。
- 去重：同一个视频已经在排队或正在跑时，再提交会提示"已在队列中"。
- 选文件夹：主进程递归扫描，只取支持的媒体格式，按文件名自然排序（`2` 排在 `10` 前面）。一个任务最多 200 个文件（建议，现在的上限是 50）。

**IPC**（`study-coach:video-notes:*`）：

| 通道 | 方向 | 说明 |
|---|---|---|
| `enqueue` | 渲染 → 主 | `{ mode, videoPaths?, folder?, outputDir?, language }`，返回 `VideoJob` |
| `estimate` | 渲染 → 主 | 参数同上，返回 `{ lessons, durationSeconds, tokens, minutes }`，只计算不执行 |
| `list-jobs` | 渲染 → 主 | 返回全部任务 |
| `cancel-job`、`resume-job`、`retry-lesson`、`remove-job` | 渲染 → 主 | 按 id 操作 |
| `pick-video-folder` | 渲染 → 主 | 打开系统的文件夹选择框 |
| `jobs-changed` | 主 → 所有窗口 | 推送任务快照，频率最多每秒 2 次 |

- 现在的 `generate`（阻塞调用）改为调用 `enqueue`。`tests/main/ipc-video-notes.test.ts` 随之更新。
- 参数在 IPC 边界校验：路径必须是绝对路径且格式受支持，`mode` 和 `language` 只接受枚举值，id 只接受队列里已有的。
- 界面：对话框加模式切换（默认完整课件）、"选择文件夹"和预估用量；运行时可以关闭。知识库页的「视频笔记」按钮旁显示进行中的任务数，点开是任务列表（`VideoJobList.tsx`），可以看每讲的进度，也可以取消、继续、重试、打开课件和打开报告。

### 4.7 用量、预算与预估

**标记来源**：

- `UsageEntry` 加 `feature?: 'video-notes'`，不填就是对话。`UsageStore.record` 合并记录时，把 `feature` 也算进同一行的判定条件（`src/main/usage/usage-store.ts:87`）。旧数据没有这个字段，按对话处理。
- `createRecordingModelClient` 的 `meta` 加 `feature`。视频笔记改用单独构建的客户端，打上 `feature: 'video-notes'`，不再复用对话客户端（`src/main/context.ts:451`）。

**预算规则（Q10）**：

- 主动提醒用到的 `dailyTokensUsed`（`src/main/context.ts:202`）不计算 `video-notes` 的用量。
- 设置页的"预算已用完，主动检查会暂停"（`src/renderer/settings/SettingsPage.tsx:613`）也按同样的口径计算，否则提示会和实际行为对不上。用量统计里分开显示"对话"和"视频笔记"两个数。
- 手动对话超预算时的确认（`src/renderer/shell/Workspace.tsx:476`）沿用现在的口径。是否也排除视频用量，放在第 7 节待确认。
- 视频任务本身不检查预算，开始前显示预估用量，由你决定跑不跑。

**预估**：

- 下表是按 02 讲（45 分钟，转写 35k 字，57 帧）的产出量推算的，还没实测：

| 步骤 | 输入 tokens | 输出 tokens |
|---|---|---|
| 读屏（15 次，每次 4 帧） | 约 6.5 万 | 约 2 万 |
| 大纲 + 笔记 | 约 9 万 | 约 1.3 万 |
| 补充卡片 | 约 1.5 万 | 约 1.2 万 |
| 核查 A + 修订 | 约 9 万 | 约 3 万 |
| 分章组页（约 10 章） | 约 8 万 | 约 5 万 |
| 重排超出页面的页 + 核查 B + 修订 | 约 8 万 | 约 2 万 |
| 合计 | 约 42 万 | 约 13 万 |

- 也就是一讲 45 分钟的课大约 50 万 tokens，比 Q8 里说的 30 万～40 万多。以第 1 期实测为准再校准。
- 预估公式：`tokens = 时长（分钟）× 系数`，默认系数取 11,000/分钟。有已完成的讲次后，改用最近 10 讲的实际平均值。耗时同样按每分钟视频的实际平均耗时估算。
- 快速笔记的预估沿用每讲约 5 万 tokens。

## 5. 分阶段交付

每一期结束时 `npm run typecheck`、`npm test`、`npm run build` 都必须通过，做完一期就能单独使用。

### 第 0 期：任务基础（先用在快速笔记上）

- 任务队列、后台执行、取消、退出时标为中断、断点续跑、单讲重试、选择文件夹（4.1 的步骤存档、4.6）。
- `meta.json` 升到 v2，同时兼容 v1（4.2）。
- 用量加 `feature` 标记，主动提醒的预算判断不算视频用量，设置页按同样口径显示（4.7）。
- 对话框改为提交任务后即可关闭；新增任务列表。
- 测试：队列状态流转、取消信号能传到 ffmpeg 和模型调用、指纹没变时跳过步骤、v1 讲次文件夹能复用、自然排序、用量按来源区分；更新 `tests/main/ipc-video-notes.test.ts` 和 `tests/renderer/video-notes-dialog.test.tsx`。
- 好处：现有的快速笔记马上就能后台跑整个文件夹。

### 第 1 期：读屏和新课件

- 模型接口支持传图片和 `noTools`（4.5）。
- 关键帧（4.3），用固定的测试帧和 02 讲的时间点做回归测试。
- 读屏、大纲、笔记、分章组页，生成课件 JSON（4.1 第 4～6、9 步）。
- 渲染、主题、翻页、回看链接（4.4）。
- 版面检查、重排超出页面的页、导出 PDF（`DeckBrowser`）。
- 这一期没有补充卡片和核查。对话框里显示"完整课件（预览）"。
- 测试：zod 校验和失败后重试、模型文本转义、CSP、回看链接只能指向本讲视频、`--tools ""` 在 Windows 上的引号处理、claude 传图时的 stdin 消息格式、ai-sdk 的图片内容块。版面测量在 CI 里用模拟的 `DeckBrowser`，真窗口只在本机验收时跑。
- 验收：用 02 讲跑通，对照第 6 节的版面、读屏和离线条目。实测 tokens 和耗时，校准预估系数。

### 第 2 期：补充卡片和核查

- 补充卡片（4.1 第 7 步），提示词按 `s4.5-enrichment.md` 和需求文档 8.5 改写。
- 核查 A 和核查 B，分级为 OK、WEAK、ERROR、CONTESTED；修订；CONTESTED 的页面显示"待确认"。
- 质量报告（第 14 步）。
- 去掉"预览"标记。
- 测试：每次核查都是全新调用，不带写作时的消息；ERROR 没处理完就判为失败；〔扩展〕页里出现"老师说"会被拦下；报告内容和统计数一致。
- 验收：第 6 节全部条目。

### 第 3 期：收尾

- 预估改用实测平均值，任务列表显示每讲实际用了多少 tokens。
- E2E：用一段 30 秒的测试视频和模拟模型，跑完"提交 → 关闭对话框 → 取消 → 继续 → 打开课件"。
- 更新用户文档：设置 MiMo key、两种模式的区别、用量说明。

粗略工期（建议）：第 0 期 2～3 天，第 1 期 4～6 天，第 2 期 3～4 天，第 3 期 1～2 天。和 Q2 的估计一致，都在考试之后才完成，不影响考前复习。

## 6. 验收标准

### 6.1 自动检查（每讲都跑，结果写进质量报告）

- 课件 JSON 通过 zod 校验。`figure` 引用的帧都存在。
- 每页至少有一个来源标记，带时间的来源都不超过视频时长。
- 覆盖：大纲各章时长之和至少占视频时长的 95%（video-md-ppt 需求文档 8.4），每章至少有一页。
- 版面：每页内容底边不超过 656px。重排两轮后仍然超出的页列进报告。
- 核查：ERROR 全部处理完毕；CONTESTED 的页面显示"待确认"；〔扩展〕页里不出现"老师说""视频里讲"。
- 离线：HTML 里没有 `http(s)` 资源引用，CSP 生效。

### 6.2 02 讲人工验收

对照 video-md-ppt 的成品 `F:\四级课件\02_名词_动词1_主谓一致_03abaaa8`：

- 页数在 40～60 之间；`insight` 和 `derive` 两类页合计占 30%～50%（成品是 28/58，占 48%）；补充卡片 15～25 张。
- 抽查 10 个时间戳，跳到视频后讲的内容和页面对得上。
- 抽查 20 条补充内容，明确的错误为 0 条。
- 在 1366×768 和 1920×1080 下都没有横向滚动，没有文字超出页面。
- PDF 页数和课件页数一致，中文显示正常。
- 断网时双击 `slides.html` 能正常翻页，DevTools 里没有请求错误。

### 6.3 其他类型的视频（建议，见 7.1）

- 真题阅读：真题第一套 `05 仔细阅读1`。题干和选项以 `passage` 页的形式出现，抽查 10 页，和画面逐字一致。
- 真题听力：真题第一套 `07 听力 新闻1`。老师只占角落的小窗，选项能完整抄出来。
- 真题写作：真题第一套 `01 写作`。被老师挡住的地方标了〔遮挡〕，没有编造。

### 6.4 任务与用量

- 点取消后 10 秒内，ffmpeg 和模型子进程都停止。继续跑时跳过已完成的步骤，这些步骤的存档时间不变。
- 退出应用后，任务标成"已中断"；重新打开点"继续"，从断点接着跑。
- 跑完一整讲完整课件后，当天的主动提醒不会因为预算暂停。
- 第 1 期校准系数后，预估用量和实际用量的误差在 ±30% 以内（建议）。
- 快速笔记的行为和现在一致，现有测试全部通过。

## 7. 风险与待确认

### 7.1 待确认（本文新提的建议，未在追问中确认）

| # | 事项 | 建议 |
|---|---|---|
| A1 | 讲者备注 | 不做讲者备注。改成可选的 `tip`（这页怎么复习），只在部分页底部显示一行。课件是给自己复习用的（Q1）。 |
| A2 | 主题配色 | 沿用 video-md-ppt 的青绿配橙，和成品 547 页保持一致；不用 ASAKI 的蓝色。 |
| A3 | 深色模式 | 跟随系统，也可以手动切换；打印时固定浅色。 |
| A4 | 模型不能读图时 | 跳过读屏继续生成，在报告和对话框里写明"本讲没有读屏"；不直接报错。 |
| A5 | 重启后的任务 | 中断的任务不自动继续，由你点"继续"。 |
| A6 | 文件数上限 | 一个任务最多 200 个文件。 |
| A7 | 手动对话的超预算确认 | 也不算视频用量，和主动提醒的口径一致。否则跑完一讲课件，当天第一次对话就会弹出确认。 |
| A8 | 遮挡补帧 | 簇里有 3 帧以上时，多传一帧给读屏，用来拼出被挡住的文字。 |
| A9 | 验收视频 | 02 讲，加上 6.3 的三讲真题课。 |
| A10 | 页数与补充比例 | 沿用 video-md-ppt：45 分钟的课 40～60 页，补充页占 30%～50%；不靠缩小字号来塞内容。 |
| A11 | 工期 | 第 5 节的粗略工期。 |

### 7.2 风险

- **用量大。** 一讲 45 分钟的完整课件约 50 万 tokens（推算），是每日预算的 2.5 倍；一个 14 讲的文件夹约 700 万。按 token 计费的 provider 要算好成本。应对：开始前显示预估；需要省用量时用快速笔记。
- **质量取决于模型。** 本机 claude CLI 实际调用的是 `opencode-go/deepseek-v4.1-flash`。验收用当前配置做，换模型后要重新验收。
- **抽帧耗时没测过。** 定时采样和场景检测各要解码一遍整段视频。第 1 期实测 45 分钟视频的耗时；太慢的话，用 ffmpeg 的 `split` 把两路合并成一次解码。
- **可能漏页。** 翻页类课程里场景检测基本不触发（1.3），关键帧主要靠每 12 秒采样一次。停留不到 12 秒的画面可能漏掉，好在转写里仍有讲解内容。
- **读屏可能抄错。** 模型可能抄错形近的字母，或者自作主张补全被挡住的字。应对：提示词禁止猜测，核查 A 对照画面原文，验收时人工抽查。
- **回看链接依赖浏览器。** `file://...#t=` 需要浏览器支持媒体片段，Chrome 和 Edge 可以。默认浏览器是其他浏览器时，可能只打开视频、不跳到对应时间。
- **字体随机器变化。** 版面检查和 PDF 在同一台机器上生成，两者一致。换一台没有 Microsoft YaHei 的机器打开 HTML，排版可能略有不同。
- **MiMo key 还没配置。** 开始验收前要在设置里填好。

## 8. 变更记录（2026-11-15）

### 8.1 删除语音转写与快速笔记

- 删除 MiMo ASR 接入（`src/main/video-notes/mimo.ts`）、旧的快速笔记生成（`src/main/video-notes/notes.ts`，`summarizeNote` 移入 `service.ts`）、`renderLessonHtml` 与课程页的笔记样式。
- 删除 `TranscriptionSettings`、密钥存储与 IPC 通道（`getTranscriptionConfig`/`saveTranscriptionConfig`），设置页的「语音转写」整块内容随之去掉。
- 删除 `VideoNotesMode`、`language` 字段与 `AUDIO_EXTENSIONS`；任务队列、预估、界面、测试里不再出现模式或语言选项。
- 已保存的旧任务如果是快速笔记模式，加载时标为失败并提示「快速笔记已移除，请重新生成课件」；旧课的 `notes.html` 只在历史记录里保留打开入口。

### 8.2 只看画面

- 课件内容只来自关键帧和读屏结果：大纲 `{kind:'infer'}`、屏幕文字 `{kind:'screen',t}`、外部知识 `{kind:'ext'}`，任何产物里都不再出现 `{kind:'video'}`（schema 保留该分支仅为兼容旧存档）。
- 笔记正文逐字复制读屏结果（保留〔遮挡〕），`source` 固定为 `'screen'`；要点只概括画面上的内容，提示词明确禁止「老师说」这类说法。
- 补全卡片过滤掉语音来源，没有来源的卡片直接丢弃；成品课件和核查提示词同样禁止引用讲话内容。
- 所有提示词版本号升到 2。流水线步骤固定为 probe → keyframes → screen-read → outline → notes → enrich → factcheck-a → compose → render → layout → factcheck-b → export → report。

### 8.3 产物与报告

- `meta.json` 升到 v3：新增 `screenReadCount`、`keyframeCount`、`slideCount`、`slidesPath`、`pdfPath`、`reportPath`、`noteChars`，不再记录转写字数与分段；读取时仍兼容 v1/v2。
- 课程索引对 v3 课显示「N 条画面文字」，只有旧课才显示「字转录」。
- `report.md` 去掉转写字数和分段数，改为「画面文字 N 条」和「依据：只有画面文字，没有语音转写」；限制一节写明不覆盖语音内容、可能漏页和抄错。
- 预估只保留课件用量：每分钟视频 11,000 tokens，生成时间按视频时长的 1.5 倍估算（最少 1 分钟）；时长未知时按每讲 30 分钟视频估算。
