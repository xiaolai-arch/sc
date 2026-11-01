# ASAKI：知识库设计（2026-11-01）

## 一句话

知识库是阿咲对用户的持续认识：你学过什么、到什么程度、证据是什么。长期规划和对话都以它为依据，而不是每次从零开始。

## 为什么

用户中午已经学了 LangChain，长期规划却又排了一遍——因为规划只拿到工作区目标、周数和手填背景，看不到完成的任务、写过的笔记、复盘和旧计划进度。

现有「记忆」是按工作区、从复盘提炼的自由文本（`MemoryRecord`），适合提醒薄弱点，但回答不了「这个主题学没学过、学到哪」。知识库补的是**结构化的主题状态**，记忆继续保留。

目标不是把 Obsidian 搬进来，而是让阿咲更了解用户。知识库文件仍是纯 markdown，Obsidian 可以直接打开 ASAKI 的 vault。

## 目标（v1）

- 主题条目：名称、别名、状态、程度、所属工作区、证据、摘要。
- 自动积累：完成任务、写笔记、提交复盘时，按主题名/别名匹配并追加证据。
- 手动纠正：管家工具 `record_knowledge`（「今天学了 LangChain」）和知识库页面增删改。
- 规划接地：创建长期计划时自动带上「已掌握 / 在学」主题，并禁止重排已掌握内容；计划页显示「已参考知识库」。
- 对话接地：管家上下文加入知识库摘要，对话不再建议从头学已掌握的主题。

## 非目标（v1）

- 不做 Obsidian 克隆：不实现 Dataview、Canvas、Bases、图谱、双向同步。以后可做「只读导入 Obsidian vault」。
- 不做基于模型的深度掌握度推断；自动证据只追加，不自动判定「已掌握」。
- 不做间隔重复、跨设备同步、附件/图片管理。
- 不改现有「记忆」的数据与页面（两者并存，各司其职）。

## 数据模型

```ts
type KnowledgeStatus = 'planned' | 'learning' | 'mastered' | 'paused';

interface KnowledgeEvidence {
  id: string;
  kind: 'task' | 'note' | 'review' | 'chat' | 'manual';
  /** 源记录 id（task/note/conversation），review 用日期 */
  refId?: string;
  title: string;
  date: string; // YYYY-MM-DD
  note?: string;
}

interface KnowledgeTopic {
  id: string;            // kt-xxxx
  name: string;          // LangChain
  aliases: string[];     // LangChain.js、LC
  status: KnowledgeStatus;
  level?: number;        // 1–5，掌握程度，可空
  workspaceId?: string;  // 空 = 全局主题
  summary: string;       // 一句话：学到哪、下一步
  evidence: KnowledgeEvidence[];
  createdAt: string;
  updatedAt: string;
}
```

规则：

- 证据按 `kind + refId` 去重（仅当 `refId` 存在）；`refId` 为空的口述/手动证据每次都追加，不互相吞掉。每个主题最多 50 条，超出丢最旧的。
- 自动证据只在**已存在主题**上追加，不自动新建主题（避免任务/笔记把知识库灌成噪音）。
- 自动状态迁移只有一种：`planned` 收到第一条证据时变 `learning`。`mastered` 只能由用户或 `record_knowledge` 设置。
- 主题名最长 60 字，别名最多 8 个；`level` 只在 1–5 之间。
- **frontmatter 是唯一事实源**：正文由字段重新渲染，在 Obsidian 里改正文不会被读回，下次保存会覆盖。正文包含摘要和证据时间线。

作用域：

- `list(workspaceId)` = 该工作区主题 + 全局主题；不传 = 全部主题。
- 自动匹配（任务/笔记/复盘）只在「当前工作区 + 全局」里找；没有工作区的复盘匹配全部主题。
- 知识库页筛选某个工作区时，全局主题仍然显示。

存储：`<vault>/knowledge/topics/<topic-id>.md`，frontmatter `kind: knowledge-topic` + 上述字段。路径用 id 而不是名称，避免主题改名后文件漂移。目录不存在视为空。

## 如何积累

| 来源 | 触发点 | 行为 |
|---|---|---|
| 手动 | 知识库页「新增主题 / 编辑状态」 | 直接增改删 |
| 对话 | 管家工具 `record_knowledge` | 「今天学了 X」→ 新建或追加证据 |
| 任务完成 | `updateWorkspaceTask` 状态变为 done | 用 title + subject 匹配主题，追加 task 证据 |
| 笔记 | 创建/更新笔记 | 用 title + tags 匹配主题，追加 note 证据 |
| 复盘 | 提交复盘后（IPC 与管家 `save_review` 两条路径） | 用 completed + stuck 匹配主题，追加 review 证据；stuck 作为 note；无工作区的复盘匹配全部主题 |

匹配：名称/别名去空白后不区分大小写；中文按子串匹配，拉丁主题要求词边界（避免 `Java` 命中 `JavaScript`）。匹配到多个主题时全部追加。所有自动写入 best-effort：知识库读失败或写入失败绝不阻断任务、笔记、复盘本身。

接入点（两条路径都要接，管家工具不经过 IPC 包装）：

- IPC 路径在 `context.ts` 的 `updateWorkspaceTask` / `createNote` / `updateNote` / `submitReview` 包装里调用 `knowledgeService.linkTask/linkNote/linkReview`。
- 管家工具路径在 `update_task` / `write_note` / `save_review` 执行后调用同样的方法；`createButlerService` 和 `ButlerToolContext` 新增 `knowledgeService` 注入。
- `submitReview` 的 `workspaceId` 可以为空；`linkReview` 接受 `workspaceId?: string`，为空时匹配全部主题。

## 如何在长期规划中使用

- `createLongPlanService` 新增可选 `knowledgeService`。生成前取当前工作区 + 全局主题，按状态排序（mastered → learning → planned），最多 20 条。
- `buildLongPlanPrompt` 增加 `knownTopics`，prompt 中明确：「已掌握的主题不要从头安排，最多安排一次复习检查；在学主题从当前进度继续，不要重讲基础」。
- `LongPlan` 新增可选快照 `knowledge?: { name: string; status: KnowledgeStatus }[]`，写入 frontmatter；计划页显示「已参考知识库：LangChain（已掌握）、RAG（在学）」。
- 模板回退无法利用知识库，页面按现状标注「通用框架」；不假装参考过。
- 知识库读取失败时规划照常进行，`knowledge` 留空。

## 管家对话

- `ButlerContext` 增加 `knowledge: KnowledgeTopic[]`，只含 `mastered` 和 `learning` 两种活跃主题；排序 mastered 在前，再按 `updatedAt` 倒序，最多 15 条。prompt 渲染「已掌握：… / 正在学：… / 最近证据：…」。
- 新工具 `record_knowledge`：参数 `name`（必填）、`status`、`level`、`note`、`workspaceId`（默认当前工作区）。服务层新增 `record()`：按名称/别名在作用域内查重，存在则追加 `kind: 'chat'` 证据（`refId` 为空，不去重），不存在则新建主题（`status` 默认 `learning`；没有工作区时建全局主题）。返回「已记录：LangChain（已掌握）」或「已追加证据」。
- 工具失败如实告知，不假装记住。

## 界面

侧边栏新增「知识库」，放在「记忆」之前；桌面与移动抽屉沿用现有导航模式。

```
知识库       全部工作区 ▾        [+ 新增主题]
[搜索主题或别名…]  [全部 | 已掌握 | 在学 | 暂停]
12 个主题 · 5 已掌握 · 3 在学 · 最近更新 11/1

┌ LangChain                    已掌握 · L4 · agent 开发求职 ┐
│ 学到 AgentExecutor 和工具调用；下一步补 LangGraph         │
│ 证据：11/1 完成任务「LangChain AgentExecutor」            │
│       10/31 笔记「LangChain 笔记」                        │
│ [编辑] [删除]                                             │
└──────────────────────────────────────────────────────────┘
```

- 卡片默认折叠证据，点主题展开时间线。
- 状态、名称、别名、摘要、程度、所属工作区可编辑；删除需确认。
- 新增/编辑表单包含工作区选择，「全局（所有工作区）」对应空 `workspaceId`；筛选某工作区时全局主题仍显示。
- 空状态：「还没有知识主题。完成学习任务、写笔记，或对阿咲说“今天学了 X”。」
- 不做图谱视图；搜索覆盖名称、别名、证据标题。

## 契约与 IPC

```ts
interface CreateKnowledgeTopicInput {
  name: string;
  aliases?: string[];
  status?: KnowledgeStatus;      // 默认 learning
  level?: number;
  workspaceId?: string;          // 空 = 全局
  summary?: string;
}

interface UpdateKnowledgeTopicInput {
  id: string;
  name?: string;
  aliases?: string[];
  status?: KnowledgeStatus;
  level?: number | null;         // null 清除
  workspaceId?: string | null;   // null 改为全局
  summary?: string;
}

interface RecordKnowledgeInput {
  name: string;
  status?: KnowledgeStatus;      // 新主题默认 learning
  level?: number;
  note?: string;
  workspaceId?: string;          // 空 = 全局
}

interface KnowledgeService {
  list(workspaceId?: string): Promise<KnowledgeTopic[]>;
  get(id: string): Promise<KnowledgeTopic | null>;
  create(input: CreateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  update(input: UpdateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  delete(id: string): Promise<void>;
  record(input: RecordKnowledgeInput): Promise<KnowledgeTopic>;
  linkTask(task: WorkspaceTask): Promise<void>;
  linkNote(note: WorkspaceNote): Promise<void>;
  linkReview(input: {
    workspaceId?: string;
    date: string;
    answers: ReviewAnswers;
  }): Promise<void>;
}
```

新增 channel：`listKnowledgeTopics`、`createKnowledgeTopic`、`updateKnowledgeTopic`、`deleteKnowledgeTopic`，走现有 channel 表 + preload 桥 + renderer api 模式。输入在主进程校验（名称、状态、level、别名上限）。

## 隐私与可靠性

- 只读本地 vault，不发网络请求；不涉及 API key。
- 主题文件随 vault 备份；自动证据只引用本地记录 id，不复制任务/笔记正文。
- 所有新增数据都是可选字段，旧 vault 与旧计划文件无需迁移即可读取。

## 验收场景

1. 新建主题「LangChain」并设为已掌握；创建目标「系统学习 AI Agent」的长期计划 → prompt 含「已掌握：LangChain」，计划页显示「已参考知识库」，且不把 LangChain 基础再排一遍。
2. 完成任务「LangChain AgentExecutor 练习」→ 主题证据 +1；重复完成同一任务不重复追加。
3. 提交复盘，completed 提到 LangChain → 追加 review 证据。
4. 对话说「今天学了 LangGraph」→ 管家调用 `record_knowledge`，知识库页出现该主题。
5. 知识库目录损坏/不可读 → 任务完成、规划、对话都照常工作，只是没有知识上下文。

## 给 builder 的默认决定

- 主题匹配、去重、上限、状态迁移规则如上，无需再确认。
- 页面用现有 `PageFrame` / 卡片样式，不引入新依赖。
- `level` 用 1–5 的整数；界面允许留空。
- Obsidian 导入不在 v1；如果后续要做，按只读索引设计，不复制文件。
