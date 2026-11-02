# ASAKI：知识库可视化与主题笔记（2026-11-02）

## 一句话

知识库从卡片列表变成「目录 + 内容」：左边按工作区列出主题，右边每个主题是一篇可编辑的 markdown 笔记；证据时间线和反向链接常驻右栏，证据继续自动积累，永远不会覆盖笔记。

## 为什么

现有知识库只能看：主题是一张卡片，展开看证据，想记点什么只能改摘要。用户要的是 Obsidian 式的体验——打开一个知识点，左边目录、右边一篇能写的笔记。

旧的实现里主题文件正文由 frontmatter 重新生成（`serializeKnowledgeTopicFile`），在正文里写东西，下一次追加证据就会被覆盖。所以笔记不能塞进主题文件，必须独立存储。

## 目标（本轮）

- 知识库页改为三栏：目录 / 笔记 / 证据与反向链接（用户选定的 C 布局）。
- 每个主题一篇可编辑 markdown 笔记，自动保存，切换主题不丢字。
- 笔记里写 `[[主题名]]`，预览时可点击跳到对应知识点；右栏显示反向链接。
- 目录按工作区分组，搜索、新建、编辑、删除、状态与掌握程度全部保留。
- 窄窗口仍然可用：三栏降为两栏，再降为单栏。
- 证据仍然只追加，笔记与证据互不覆盖。

## 非目标（本轮）

- 不做 Obsidian 克隆：没有 Canvas、Dataview、图谱、插件、模板、标签面板。
- 不做块引用、`![[嵌入]]`、附件/图片、表格、任务列表；预览只支持现有 `MarkdownText` 的能力（标题、列表、粗体/斜体、行内代码、代码块、http 链接）加 `[[wiki 链接]]`。
- 不做笔记版本历史、回收站、多篇笔记/文件夹。
- 不做外部编辑器同时修改的冲突检测；原子写入 + 最后写入者胜出。
- 不做 Electron 退出拦截。这里说的「关闭页面前保存」只指离开知识库页面/组件卸载；直接退出应用时，最多丢失最后 600ms 内未落盘的输入。
- **不把笔记正文注入管家或长期规划 prompt**。本轮管家仍然只看到主题名、状态和最近证据；笔记进上下文是下一轮单独的决定（涉及 token 预算与隐私边界）。
- 不做改名时批量重写其他笔记里的旧链接；旧链接会变成未解析状态。
- 不改变证据自动积累、去重、匹配规则。

## 约束

- 本地优先：不联网、不上传、不加账号；不涉及 API key。
- 不新增依赖或 UI 库；复用 `PageFrame`、`Dialog`、`MarkdownText` 和现有样式。
- vault 仍是 markdown + YAML frontmatter；所有写入走 `writeFileAtomic`。
- 文件名和 id 用 `assertSafeSegment` 校验，任何 id 都不能逃出 vault。
- 产品文案不出现 Obsidian 商标作为功能名；文档里只作为体验参照。

## 存储

笔记独立存放：

```
<vault>/knowledge/notes/<topicId>.md
```

示例：

```markdown
---
type: note
source: user
kind: knowledge-note
topicId: kt-abc123
title: LangGraph
aliases:
  - LangGraph
  - LangGraph.js
updated: 2026-11-02T10:30:00.000Z
---

状态图用 `StateGraph` 定义节点和边。

- 条件边：`add_conditional_edges`
- 持久化：Checkpointer

相关：[[LangChain]]、[[AgentExecutor]]
```

规则：

- 正文就是用户写的 markdown，原样保存；界面标题来自主题，不在正文里自动加 H1，避免「改了 H1 却没改名」。
- frontmatter 的 `title` / `aliases` 跟主题同步，方便 Obsidian 把 `[[LangGraph]]` 解析到这篇笔记（Obsidian 的 aliases 是可链接名称）。
- 主题改名或改别名时，重写笔记 frontmatter，正文逐字节保留。同步失败不影响主题更新（下一次保存笔记会再同步）；主题是唯一事实源。
- 删除主题时同时删除笔记文件。删除笔记失败只留下孤儿文件，列表会忽略它，不报错。
- 笔记不存在 = 空正文；`updatedAt` 为空字符串。保存空正文会写一个空文件。
- 读取时以**路径中的 topicId** 为准，frontmatter 里的 `topicId` 只作参考，不参与寻址。
- 手写文件缺少 `kind` 时仍把正文当作笔记读；title/aliases 回退到主题。
- 保存时**保留未知 frontmatter 键**（例如在 Obsidian 里加的 `tags`、`cssclass`）：解析时连原始 meta 一起返回，序列化只覆盖我们拥有的字段，正文逐字节保留。frontmatter 本身无法解析时以我们的字段为准，未知键无法保留。
- 单个笔记上限 200,000 字符（IPC 与服务层都校验），超出提示「笔记不能超过 200000 字。」
- 保存笔记**不更新**主题的 `updatedAt`，避免打字时目录顺序跳动。

## Wiki 链接与反向链接

语法：

- `[[主题名]]`
- `[[主题名|显示文字]]`

解析规则：

- 目标去首尾空白、忽略大小写，与主题的 `name` + `aliases` **完全相等**才算匹配。
- 唯一匹配：预览里渲染成可点击链接，点击切换当前主题。
- 没有匹配：显示为带虚线下划线的普通文字，不可点击，`title` 提示「没有这个知识点」。
- 多个主题同名/同别名：视为有歧义，不可点击，不产生反向链接，避免乱跳。
- 自链接允许存在，点击后停在原地。
- 编辑模式显示原始文本；只有预览解析链接。
- 没有传入解析器的场景（聊天、计划等使用 `MarkdownText` 的地方）保持原样，`[[...]]` 按字面显示。

反向链接由主进程计算：

- 读取全部笔记正文，提取 wiki 链接目标；**先剔除 fenced code block 和行内代码**，代码里的 `[[...]]` 不算链接，保证计数与预览一致。
- 目标唯一解析到当前主题的，记为一条反向链接，返回来源主题的 `{ topicId, name }`，按名称排序。
- 忽略自链接和歧义链接。
- 反向链接不缓存；每次打开主题时计算一次，数据量是主题数 × 笔记大小，当前规模足够。

改名不会重写其他笔记里的旧链接；旧链接在预览中变成未解析状态，这是有意为之（不做隐式文件改写）。

## 界面（C 布局）

```
知识库                                                    [+ 新增主题]
┌ 目录 260px ──────┐ ┌ 笔记 ──────────────────┐ ┌ 证据 240px ─────┐
│ [搜索主题或别名…] │ │ LangGraph  [在学] L3    │ │ 证据 · 3         │
│ 12 个主题 · 4 已掌握│ │ [编辑][预览]    已保存 │ │ 11/2 复习 · …    │
│                  │ │                        │ │ 11/1 任务 · …    │
│ AI Agent 学习     │ │ # LangGraph            │ │                  │
│ ● LangChain 已掌握│ │ 状态图用 StateGraph…   │ │ 反向链接 · 2     │
│ ● LangGraph 在学  │ │                        │ │ LangChain        │
│ ● RAG 计划中      │ │ 相关：[[LangChain]]    │ │ AgentExecutor    │
│ 英语              │ │                        │ │                  │
│ ● 长难句 暂停     │ │                        │ │                  │
│ 全局              │ │                        │ │                  │
│ ● 番茄工作法 已掌握│ │                        │ │                  │
└───────────────────┘ └────────────────────────┘ └──────────────────┘
```

目录：

- 按工作区分组；组标题就是工作区名，空工作区不显示；全局主题单独一组放最后。
- 每行：状态圆点（已掌握绿、在学蓝、计划中灰、暂停橙）+ 主题名；状态文字用小号灰字。
- 顶部搜索框过滤名称、别名、摘要；搜索只影响目录，当前选中的主题即使不在结果里也继续显示。筛选结果为空时目录显示「没有匹配的主题」，内容区不变。
- 目录顶部显示统计：「12 个主题 · 4 已掌握 · 5 在学」。
- 默认选中服务端排序后的第一个主题；当前选中主题被删除或已不存在时，选中第一个可见主题；没有主题则显示空状态。只被搜索隐藏不算不存在，不触发改选。
- 点击 wiki 链接跳转时清空搜索，确保目标在目录中可见并选中。
- 取消原来的「按工作区筛选」下拉框，分组已经覆盖这个需求。

内容区：

- 头部：主题名、状态 pill、Lx（有 level 时）、所属工作区；名称下方一行灰色摘要（过长截断，完整内容仍可在编辑对话框里改）。右侧「编辑」「删除」沿用现有对话框与确认逻辑。
- 编辑 / 预览切换；编辑模式是纯 `<textarea>`，预览模式用 `MarkdownText`。
- 保存状态显示在头部右侧：`未保存` / `保存中…` / `已保存` / `保存失败`；失败时提供「重试」。
- 自动保存：停止输入 600ms 后保存；失焦立即保存；切换主题、切到预览、离开知识库页面（组件卸载）前立即保存；`Cmd/Ctrl+S` 立即保存并阻止默认行为。
- 加载中显示编辑区占位；加载失败显示错误和「重试」，不阻断主题信息。
- 占位文案：「写点什么… 用 [[主题名]] 链接其他知识点」。

右栏：

- 证据：数量 + 倒序时间线（最新在上），空状态「还没有证据。」
- 反向链接：数量 + 来源主题名列表，点击跳转；空状态「还没有反向链接。」
- 在 `< 1280px` 时右栏不再常驻，改成笔记下方可折叠的「证据与反向链接」区块；`< 768px` 时目录和内容单栏切换：未选中时显示目录，选中后显示内容并提供「返回目录」。

布局实现：

- `PageFrame` 新增 `fill?: boolean`：为 true 时不加内边距和 max-width，内容占满高度、自己管理滚动；知识库页使用 `fill`，内部再包 `mx-auto max-w-[1160px]`。
- 目录固定 260px（`md` 以上），右栏固定 240px（`xl` 以上），笔记区自适应且最小宽度约 360px。
- 三级响应式：`xl` 三栏 → `md` 两栏（证据在笔记下方）→ 单栏切换。
- 空状态：「还没有知识主题。完成学习任务、写笔记，或对阿咲说“今天学了 X”。」+ 新增按钮。

## 契约与 IPC

新增共享类型（`src/shared/knowledge.ts`）：

```ts
interface KnowledgeNote {
  topicId: string;
  body: string;
  updatedAt: string; // '' = 从未保存
}

interface SaveKnowledgeNoteInput {
  topicId: string;
  body: string;
}

interface KnowledgeBacklink {
  topicId: string;
  name: string;
}

const MAX_KNOWLEDGE_NOTE_LENGTH = 200_000;

interface KnowledgeService {
  // 现有方法不变，新增：
  getNote(topicId: string): Promise<KnowledgeNote>;
  saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
}

interface KnowledgeApi {
  // 现有方法不变，新增：
  getKnowledgeNote(topicId: string): Promise<KnowledgeNote>;
  saveKnowledgeNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getKnowledgeBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
}
```

新增 channel：

- `study-coach:knowledge:note:get`
- `study-coach:knowledge:note:save`
- `study-coach:knowledge:backlinks`

走现有 channel 表 + preload 桥 + renderer api 模式。主进程校验：

- `getKnowledgeNote` / `getKnowledgeBacklinks`：`topicId` 必须是非空字符串。
- `saveKnowledgeNote`：`topicId` 非空，`body` 必须是字符串且不超过 200,000 字符。
- 服务层再校验 `assertSafeSegment(topicId)`；保存前确认主题存在，否则「知识主题不存在。」

同时提供纯函数（放 `src/shared/knowledge.ts`，主进程和渲染进程共用）：

```ts
function normalizeKnowledgeTerm(value: string): string;
function wikiLinkTargets(text: string): string[];
function resolveKnowledgeLink(
  topics: KnowledgeTopic[],
  target: string
): KnowledgeTopic | null; // 唯一匹配才返回
```

## 主要文件

- `src/shared/knowledge.ts`：新类型与纯函数。
- `src/main/workspace/paths.ts`：`knowledgeNotesDir` / `knowledgeNoteFile`，更新 vault 布局注释。
- `src/main/knowledge/notes.ts`（新）：笔记文件解析/序列化、wiki 链接提取。
- `src/main/knowledge/create-knowledge-service.ts`：`getNote` / `saveNote` / `getBacklinks`、改名同步、删除级联。
- `src/main/ipc.ts`：channel、handler、输入校验。
- `src/preload/index.ts`（或实际桥接文件）：暴露三个方法。
- `src/renderer/shell/KnowledgePage.tsx`：目录 + 内容编排 + 对话框。
- `src/renderer/shell/KnowledgeNotePane.tsx`（新）：编辑器、预览、自动保存。
- `src/renderer/shell/KnowledgeSidePanel.tsx`（新）：证据 + 反向链接。
- `src/renderer/shell/useKnowledgeNote.ts`（新）：加载、防抖保存、竞态处理。
- `src/renderer/shell/MarkdownText.tsx`：可选 `resolveWikiLink` / `onWikiLink`，不传时行为完全不变。
- `src/renderer/shell/PageFrame.tsx`：`fill` 模式。
- `web/mock-api.ts`：内存笔记，供浏览器原型与渲染测试使用。
- `tests/...`：见下。

## 自动保存的竞态规则

- **内存草稿**：`useKnowledgeNote` 维护 `Map<topicId, body>`。任何输入先写入当前主题的草稿；保存成功才清除该主题的草稿。
- **切换主题**：立即触发旧主题保存，并 `await` 它完成，再加载新主题的笔记和反向链接（这样新主题的反向链接能看到刚保存的 `[[...]]`）。保存失败不阻断切换：继续加载新主题，旧主题的草稿留在内存里，切回去时优先显示草稿并标记「保存失败」，可重试。
- **加载竞态**：每次加载递增请求号，只应用最新一次结果；切主题后旧请求返回不能覆盖新主题。目标主题已有草稿时直接用草稿，不被磁盘内容覆盖。
- **保存竞态**：保存请求带发起时的 `topicId`；同一主题的保存在主进程用现有 mutex 串行化；跨进程最后写入者胜出。
- **正文未变化**不发保存请求。
- 草稿只在内存里，不写 localStorage；应用退出时最多丢失最后 600ms 内未落盘的输入（不做退出拦截）。

## 验收场景

1. 打开知识库：目录按工作区分组；选中 LangGraph，笔记为空；输入内容后失焦，重新打开应用仍在；`knowledge/notes/<id>.md` 出现，主题文件正文没有变化。
2. 笔记存在时完成一个匹配该主题的任务：主题证据 +1，笔记正文逐字节不变。
3. 笔记里写 `[[LangChain]]`，预览中点击 → 切到 LangChain；LangChain 的反向链接出现 LangGraph。
4. 写 `[[不存在的主题]]`：显示虚线下划线、不可点击，不产生反向链接；写一个重名别名同理。
5. 把 LangGraph 改名为 LangGraph.js：笔记 frontmatter 的 title/aliases 更新，正文不变；新名字链接可解析，旧 `[[LangGraph]]` 变成未解析。
6. 删除主题：主题文件和笔记文件都消失；重新创建同名主题不会读到旧笔记。
7. 搜索「LC」：目录只剩匹配项，当前内容区不被清空；把当前主题也筛掉时不改选，目录空结果显示「没有匹配的主题」；点 wiki 链接跳到被搜索隐藏的主题时清空搜索并选中目标。窗口缩到 900px 和 600px 时仍能选主题、写笔记、看证据。
8. 模拟保存失败：显示「保存失败」与重试；切到别的主题再切回来，编辑区仍是未保存的草稿；重试成功后变「已保存」，草稿清除。不丢编辑区内容。
9. 聊天里的 `[[...]]` 文本保持原样；知识库预览才解析。代码块和行内代码里的 `[[...]]` 不算链接，也不产生反向链接。
10. 在 Obsidian 里给笔记加 `tags: [ai]`，在 ASAKI 里编辑并保存后，该键仍在。
11. 全程无网络请求，不读取或写入任何 API key。

## 给 builder 的默认决定

- 三栏宽度 260 / 自适应 / 240，断点用 `md`（768）和 `xl`（1280）。
- 防抖 600ms；上限 200,000 字符；文件用 id 命名，靠 frontmatter aliases 兼容 Obsidian 链接。
- 预览复用 `MarkdownText` 并新增可选 wiki 链接回调；不重写 markdown 渲染器。
- 切主题时 `await` 旧主题保存；失败不阻断切换，草稿留在内存并优先于磁盘内容；不做退出拦截，不存 localStorage。
- 保存笔记时合并原始 frontmatter，保留未知键；正文逐字节保留。
- 反向链接先剔除代码块和行内代码，再提取 wiki 链接。
- 摘要显示在内容头部的一行副标题，目录行保持紧凑。
- 改名不重写旧链接；不更新主题 `updatedAt`。
- 笔记不进入本轮 prompt 上下文。
- 不引入任何新依赖。
