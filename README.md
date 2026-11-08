# 阿咲 ASAKI

本地优先的**个人管家与学习工作台**。

它可以当老师、做规划、做记录、做督促。考研只是它服务的一个 workspace，英语、项目、生活同样适用。

- **老师**：讲解、答疑、练习、根据记录指出薄弱点
- **规划**：目标 → 周计划 → 今日任务
- **记录**：笔记、日志、复盘、可见的个人画像
- **督促**：提醒、打卡、连续反馈

所有数据本地优先：无账号、无服务器、无遥测；知识库是纯 markdown，Obsidian 可以直接打开。API key 只进入 Electron `safeStorage`（系统钥匙串），不会写进 vault、日志或测试快照。

## 截图

今日安排把长期计划拆到今天：时间、时长、所属工作区和来源都在一屏。

![今日安排：时间表、任务、时长与所属工作区](docs/screenshots/home.png)

长期计划按「阶段 → 周 → 日」展开，页面同时显示计划依据、已参考的知识主题和完成进度；进度落后时可以从当前进度重排剩余周次。

![长期计划：阶段、周计划、每日任务与完成进度](docs/screenshots/long-plan.png)

重排只覆盖还没开始的周，已经勾选进度的周会原样保留：

![长期计划：按当前进度重排剩余安排](docs/screenshots/plan-recalibrate.png)

知识库把目录、可编辑笔记和证据/反向链接放在同一屏：

![知识库：预览模式，左侧主题目录，中间笔记，右侧证据与反向链接](docs/screenshots/knowledge-preview.png)

![知识库：编辑模式，自动保存并显示已保存状态](docs/screenshots/knowledge-editing.png)

窄窗口下，证据与反向链接折叠到笔记下方：

![知识库：窄窗口下的可折叠证据与反向链接](docs/screenshots/knowledge-narrow.png)

`⌘K` 一次搜索对话、笔记、任务、长期计划和知识库，回车直接跳到对应内容：

![全局搜索：对话、任务、长期计划与知识库结果混排](docs/screenshots/global-search.png)

任务、提醒、长期计划都能在页面上直接维护，不用回到对话里改：

![项目页：就地编辑任务标题、科目和时长](docs/screenshots/task-editing.png)

![提醒：编辑时间、内容与每周重复](docs/screenshots/reminder-editing.png)

![长期计划：修改目标与每周投入](docs/screenshots/plan-edit.png)

重复的知识主题可以一键合并，别名、证据和笔记都留在目标主题里：

![知识库：合并重复主题](docs/screenshots/knowledge-merge.png)

漏掉的复盘可以按日期补录，练习集也能自己出题：

![复盘：补录过去日期的完成、卡点与明日安排](docs/screenshots/review-backfill.png)

![学习：自建练习集，带错题本与答题历史](docs/screenshots/practice.png)

## 功能

- **管家**：每日简报、管家对话、建议提问、连续复盘提醒
- **全局搜索**：`⌘K` 统一检索对话、笔记、任务、长期计划和知识库主题/笔记，支持方向键选择并跳转到对应页面
- **长期计划**：按总时长生成「阶段 → 周 → 日」计划；可粘贴参考资料或先联网调研，计划页标注依据来源；勾选每日任务与周验收，可把今天的一行加入今日安排；进度落后时可只重排剩余周次，已有进度的周不会被覆盖；也可直接修改计划目标与每周投入
- **今日安排**：目标、任务列表、完成状态、计时；可手动新增、编辑、删除任务，任务可按每天/工作日/每周重复，完成后自动生成下一次
- **记录**：Obsidian 风格笔记、标签、关联笔记；笔记可编辑、可直接删除（知识库中已积累的证据会保留）；记录超过十条可一键展开
- **学习**：自建练习题、答题反馈、完整错题本与答题历史；到期错题可直接在错题本里复习，也可手动标记已掌握，复习记录会写进答题历史；练习集可编辑题目（增删题、改答案）或删除，错题与答题历史保留
- **复盘**：复盘问题、画像与记忆、督促提醒；可补录过去日期的复盘；本周概览汇总任务完成、专注时长、答题正确率、复盘天数、到期错题与知识主题，并点出最薄弱的在学主题
- **知识库**：目录 + 可编辑笔记（`knowledge/notes/`），证据自动从任务/笔记/复盘积累，`[[主题名]]` 跳转与反向链接，长期规划据此跳过已学内容；另有无障碍的关系图谱视图（无连线时提示如何建立 `[[链接]]`，有连线时提示哪些主题还没有连上）；笔记自动保存并检测 Obsidian 等应用的外部修改，冲突时由你选择保留哪一版；重复主题可一键合并（别名、证据与笔记都会保留）
- **视频笔记**：知识库右上角的「视频笔记」选择本地网课视频，用 MiMo ASR 转写、再用当前模型整理成带时间戳的笔记；每讲输出 `notes.md`、可直接打开的 `notes.html`、`transcript.json` 与 `meta.json`，并生成整门课的 `index.html` 索引。输出到指定文件夹，不写入知识库。转写服务与密钥在「设置 → 视频笔记转写」单独配置，需要本机安装 `ffmpeg`/`ffprobe`（可用 `ASAKI_FFMPEG_PATH`、`ASAKI_FFPROBE_PATH` 指定路径）
- **记忆与提醒**：手动新增记忆并即时更新个人画像；提醒支持工作日/周末重复、编辑、删除与单独开关
- **项目管理**：编辑项目名称、目标与描述；删除项目会移入 `workspaces/.trash/` 以便找回
- **设置**：模型、预算、通知、启动；可设置阿咲对你的称呼
- **工作区切换**：全部 / 考研 / 英语 / 项目 / 生活

考研是最完整的示例 workspace；英语、项目、生活用来验证“不只是考研”。

## 开发

需要 Node.js 24+。

视频笔记功能另外需要 `ffmpeg` 与 `ffprobe` 在 `PATH` 中（或通过 `ASAKI_FFMPEG_PATH` / `ASAKI_FFPROBE_PATH` 指向可执行文件）；缺失时应用会在开始生成前给出提示。

```bash
npm install
npm run dev        # Electron 桌面应用（真实 main/preload/renderer + 本地 vault）
```

浏览器原型（使用 mock API，不读写真实 vault）：

```bash
npm run dev:web
```

打开终端里打印的地址（默认 `http://localhost:5173`）。

隔离本地数据（可选）：设置 `STUDY_COACH_USER_DATA_DIR` 后，Electron 的 `userData`（`state.json`、密钥）会写到该目录，便于开发时使用一次性 profile。例如：

```bash
STUDY_COACH_USER_DATA_DIR=/tmp/study-coach-dev npm run dev
```

### 在 Windows 上开发

需要 Windows 10/11、Node.js 24 LTS（最低 22）、Git for Windows。命令与 macOS 相同：

```powershell
git clone <仓库地址> asaki
cd asaki
npm ci
npm run dev        # Electron 桌面应用
npm test           # 单元 + 集成测试
npm run build
```

PowerShell 里设置临时环境变量：

```powershell
$env:STUDY_COACH_USER_DATA_DIR = "$env:TEMP\study-coach-dev"
npm run dev

# 真机验收（可选）
$env:ASAKI_ACCEPTANCE_VAULT = "$env:USERPROFILE\Documents\StudyCoachVault"
$env:ASAKI_ACCEPTANCE_WORKSPACE = "kaoyan"
npm run test:acceptance
```

默认 vault 位于 `%USERPROFILE%\Documents\StudyCoachVault`。设置页里的本地 CLI agent 会从 `PATH` 和 `%APPDATA%\npm` 查找 `codex`、`claude`、`zcode`、`opencode`，npm 全局安装的 `.cmd` shim 会自动通过 `cmd.exe` 启动；扫描时用 `where` 兜底查找 App Execution Alias。

Windows 可以本地打包（x64，未签名）：

```powershell
npm run package:win   # 快速验证：dist/win-unpacked/ASAKI.exe
npm run dist:win      # 安装包 + 便携版
```

`dist:win` 生成 `dist/ASAKI-1.0.0-x64-setup.exe`（NSIS 安装包）和 `dist/ASAKI-1.0.0-x64-portable.exe`（免安装）。未签名产物首次运行会触发 SmartScreen 提示；签名方式见 `docs/releases/windows.md`。e2e 在 Windows 上通过临时 `.cmd` shim 启动 fake CLI，CI 会同时跑 macOS 和 Windows。

## 测试

```bash
npm run typecheck     # TypeScript strict（main/preload/shared + renderer/web）
npm test              # Vitest：单元 + 集成测试
npm run typecheck:e2e # Playwright e2e 的 TypeScript 检查
npm run test:e2e      # 构建 Electron 产物并运行 Playwright e2e
```

`e2e/**` 用 Playwright 的 `_electron` 启动**真实 Electron 应用**，覆盖 onboarding → 今日安排（写入真实 vault 任务）→ 管家对话。模型层使用仓库内的 fake CLI（`e2e/fixtures/fake-codex.mjs`），不联网、不需要 API key，也不读取真实 CLI 凭据；测试进程会主动移除 `*_API_KEY`、`*_TOKEN`、`*_SECRET` 等环境变量。每个 e2e 使用临时 `userData` 与临时 vault，结束后删除。

单独运行：

```bash
npm run build
npx playwright test --config e2e/playwright.config.ts
```

真机验收（可选，不进入 CI）：需要本机已有一份真实 vault。脚本会把它复制到临时目录、使用临时 `userData`，跑完任务/提醒/记忆/项目/长期计划/知识合并/复盘补录/自建练习集/练习集编辑与删除/笔记创建、编辑与删除，并在成功退出时清理临时数据。

```bash
npm run test:acceptance
```

默认读取 `~/Documents/StudyCoachVault`，并选择 `workspaces/` 下排序第一的工作区；可以用环境变量覆盖：

```bash
ASAKI_ACCEPTANCE_VAULT=/path/to/vault \
ASAKI_ACCEPTANCE_WORKSPACE=kaoyan \
ASAKI_ACCEPTANCE_MERGE_TARGET=LangChain \
ASAKI_ACCEPTANCE_SHOTS=/tmp/asaki-shots \
npm run test:acceptance
```

验收失败时会保留临时 vault 并打印路径，方便排查；成功时也会打印截图目录。

## 打包

`electron-builder.yml` 配置 macOS arm64 的 `dir`（快速本地验证）、`zip` 和 `dmg`，以及 Windows x64 的 `nsis` 安装包和 `portable` 便携版：

```bash
# macOS
npm run build
npx electron-builder --dir     # 只生成未签名 .app，最快
npm run package                # 同上（build + --dir）
npm run dist                   # build + zip + dmg

# Windows
npm run package:win            # build + 未签名 dist/win-unpacked
npm run dist:win               # build + NSIS 安装包 + 便携版
```

产物在 `dist/`，例如 `dist/mac-arm64/ASAKI.app`、`dist/ASAKI-1.0.0-arm64.dmg`、`dist/ASAKI-1.0.0-x64-setup.exe`、`dist/ASAKI-1.0.0-x64-portable.exe`。

默认不签名，本地没有证书也能构建：

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --dir
```

需要签名/分发时，在环境中提供 electron-builder 支持的凭据（如 `CSC_LINK` + `CSC_KEY_PASSWORD`，或钥匙串里的 `CSC_NAME`）；`electron-builder.yml` 已开启 `hardenedRuntime`，未提供凭据时会自动跳过签名。CI 只做未签名的 Windows 打包冒烟检查，不接触任何证书。

## 架构

```text
src/
  main/        Electron 主进程
    index.ts      app 生命周期、窗口、scheduler/tray 启动
    ipc.ts        channel 表、handler、错误脱敏、preload bridge
    context.ts    组合 state/settings/secrets/workspace/butler
    workspace/    真实 vault 的读写（markdown + YAML frontmatter）
    planning/     WorkspacePlanner（模型 JSON + 模板回退）
    plans/        长期计划（阶段/周/日生成、勾选进度、vault 持久化）
    practice/     题库、判分、错题、间隔重复
    memory/       复盘 → 记忆 → 画像
    knowledge/    知识主题、证据时间线与自动链接（任务/笔记/复盘）
    agent/        Anthropic/OpenAI-compatible/Ollama + 本地 CLI client
    butler/       管家 prompt、上下文和工具循环
    scheduler/    早间/晚间提醒、免打扰
  preload/     contextBridge 暴露类型化 window.studyCoach
  renderer/    React 19 + Tailwind 工作台 UI
  shared/      主进程 / preload / renderer 共用的契约和纯函数
web/           浏览器原型（mock API，不接触真实数据）
e2e/           Playwright Electron e2e + fake CLI
tests/         Vitest 单元/集成测试
```

**数据流**：renderer 调用 `window.studyCoach.*` → preload 通过 `ipcRenderer.invoke` 走 `study-coach:*` channel → main 的 IPC handler 校验参数 → workspace/butler/settings 服务读写 vault 或返回结果。错误在进入 renderer 前会脱敏（如 `sk-...`），密钥只存在内存和系统加密存储。

**Vault 布局**（纯 markdown，可用 Obsidian 直接打开）：

```text
<vault>/
  workspaces/<id>/workspace.md              workspace 资料（名称、目标、类型）
  workspaces/<id>/tasks/YYYY-MM-DD.md       每日任务
  workspaces/<id>/notes/*.md                笔记
  workspaces/<id>/plans/*.md                长期计划（阶段、周、每日任务、验收）
  workspaces/<id>/memory.md                 管家记忆
  workspaces/<id>/reviews/YYYY-MM-DD.md     按 workspace 的复盘
  reviews/YYYY-MM-DD.md                     vault 级复盘
  knowledge/topics/*.md                     知识主题（全局或按 workspace，含证据）
  reminders.md                              全局提醒
```

frontmatter 是机器可读的事实源，正文是给人看的渲染；索引可以随时重建。默认 vault 是 `~/Documents/StudyCoachVault`（设置里的 `vaultPath`）。主进程每次读取都重新读磁盘，因此外部编辑（包括 Obsidian）会被下一次调用看到。

长期计划的依据同样落盘：用户粘贴的参考资料存进 `references`，联网调研只接受 `http(s)` 来源并存进 `sources`。调研失败、模型或 CLI 不支持联网时计划照常生成，但页面和文件都会标注「模型知识（未联网核实）」，不会伪造来源。

知识库把「学过什么」变成结构化主题：完成任务、写笔记、提交复盘时自动匹配主题并追加证据，管家对话里说「今天学了 LangChain」会调用 `record_knowledge` 记录。活跃主题（已掌握 / 在学）会进入长期规划和管家上下文，规划时跳过已掌握的基础；自动链接失败只影响证据，不会阻断任务、笔记或复盘本身的写入。每个主题有一篇可编辑笔记，存放在 `knowledge/notes/`，支持 `[[主题名]]` 跳转与反向链接。

## 用真实 provider / CLI 做本地冒烟测试

这些步骤需要你本机已安装对应 CLI 或拥有真实凭据，**不要**把 key 写进代码、测试、CI 或提交记录。

### 本地 CLI agent（不需要 API key）

```bash
# 任选其一并确认已安装、已登录：
codex --version
claude --version

npm run dev
```

打开 **设置 → 模型 → 本地 CLI agent**，点 **扫描本机 CLI**。应用会检查 PATH、Homebrew、nvm/asdf/mise 和登录 shell，列出 `codex`/`claude`/`zcode`/`opencode` 的安装路径、版本、登录状态以及原生能力（流式、思考、会话、MCP、技能、联网、沙箱、模型列表等）；opencode 还会列出本机可用模型。选中一项即可填入 agent 和命令。

默认把 CLI 当作一次性文本模型：在临时目录中运行，由应用注入工具协议。勾选 **使用 CLI 原生工具** 后切换为完整 agent 模式：CLI 在当前 vault workspace 中运行，直接使用它自己的文件、搜索、命令行和联网工具；Codex 使用 `--sandbox workspace-write`，Claude 使用 `--add-dir` + `--permission-mode acceptEdits`，opencode 使用 `run --auto`，zcode 使用 `--cwd` + `--mode edit`。原始 key/token 不会进入设置、日志或扫描结果。

### 真实 API provider

1. `npm run dev` 启动应用。
2. 打开 **设置 → 模型**，选择 Anthropic / OpenAI 兼容 / Ollama，填写模型名（以及 Base URL），保存。
3. 在 API key 输入框输入 key 并保存；它通过 Electron `safeStorage` 写入系统钥匙串，不会出现在 `state.json`、vault、日志或测试快照里。
4. 回管家发一条消息做冒烟测试。Ollama 可指向本地 `http://127.0.0.1:11434/v1`，同样不会把 key 写进配置文件。

自动化测试永远不调用真实 provider；`e2e` 和 Vitest 都使用 fake/injected model，CI 不需要任何 secret。

## 设计文档

- 个人管家 workspace 设计：`docs/superpowers/specs/2026-10-31-personal-butler-workspace.md`
- v1 完成计划：`docs/superpowers/plans/2026-11-01-v1-completion.md`
- 原 M1 考研后端计划：`docs/superpowers/plans/2026-10-31-study-coach-m1-foundation.md`
- Web 原型实施计划：`docs/superpowers/plans/2026-10-31-study-coach-web-prototype.md`

## 变更记录

见 [CHANGELOG.md](CHANGELOG.md)。各平台打包、签名与发布步骤见 `docs/releases/`。

## License

MIT，见 [LICENSE](LICENSE)。
