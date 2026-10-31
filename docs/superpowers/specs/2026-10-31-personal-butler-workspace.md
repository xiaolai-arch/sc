# Study Coach：个人管家工作台设计（2026-10-31）

## 一句话

Study Coach 不是考研专用 App，而是一个本地优先的**个人管家**：可以当老师、做规划、做记录、做督促。考研只是其中一个 workspace，英语、项目、生活同样适用。

## 为什么

长期目标需要的不只是“每天一张任务清单”，而是一个能持续了解你、帮你安排、提醒你、记录你进展的 agent。DeepTutor 展示了“agent-native 学习工作台”的方向；我们只借鉴它的 workspace / 学习 / 资源 / 记忆思路，不复制它的全栈多 agent、Partners/IM、Books/Mastery 等完整平台。

## 四个角色

| 角色 | 用户期待 | 对应界面 |
|---|---|---|
| 老师 | 讲解、答疑、练习、指出薄弱点 | 管家、学习、记录 |
| 规划 | 目标 → 周计划 → 今日任务 | 计划、管家 |
| 记录 | 笔记、日志、复盘、可见画像 | 记录、复盘 |
| 督促 | 提醒、打卡、连续反馈 | 管家、复盘、设置 |

## Workspaces

用户可以拥有多个 workspace：

- 考研（exam）：考试日期、科目、大纲、每日可用时间
- 英语（study）：外刊、写作、词汇
- 项目（project）：需求、开发、上线
- 生活（life）：作息、运动、习惯

每个 workspace 有自己的目标、任务、笔记、练习和记忆；工作台可以切到「全部工作区」查看当天跨域安排。考研只是最完整的模板，不是产品边界。

## 数据模型（方向）

- `Workspace { id, name, kind, goal, description }`
- `Goal { id, workspaceId, title, progress }`
- `Task { id, workspaceId, title, subject, durationMin, status, acceptance, due? }`
- `Note { id, workspaceId, title, tags, body, related }`
- `Memory { id, workspaceId, text, source }`：可见、可编辑，能追溯到复盘/记录
- `Reminder { id, time, label }`
- `Review { date, workspaceId?, answers }`

真实的 vault 仍是纯 markdown + YAML frontmatter + wikilinks；workspace 对应 vault 里的文件夹。索引可删除重建。

## 界面

三栏工作台：

- **左侧**：窗口感、品牌、管家/计划/记录/学习/复盘/设置、工作区列表、最近、用户
- **中间**：上下文列表（任务 / 笔记 / 练习 / 复盘日）
- **主区**：管家对话 + 每日简报、计划任务、笔记正文、练习题、复盘表单 + 记忆、设置
- **底部**：composer（管家对话），支持「记一下…」「提醒我…」「帮我排…」

## v1 范围

- 通用 workspace 模型 + 多 workspace demo（考研/英语/项目/生活）
- 六个面：管家、计划、记录、学习、复盘、设置
- 管家对话可记录笔记、给出原型回复、展示督促信息
- 练习支持选择、判分、解析、错题记录（原型）
- 复盘支持三个问题、保存/跳过、可见记忆、连续复盘
- 真实数据接入复用 M1 的 vault / Settings / IPC；提醒/调度后续接 Electron 托盘

## 非目标

- 不做考研专用产品；考研是模板
- 不复刻 DeepTutor 的 Books / Mastery Paths / Partners / IM 通道 / 多引擎 RAG / 多 agent 编排
- 不做云端账号、遥测或服务器端存储

## 下一步

1. 把 demo 数据接到 M1 的 VaultService / Settings / typed IPC
2. 管家对话接真实模型与工具：读计划、写笔记、更新画像
3. 提醒/督促接调度器与托盘
4. 每个 workspace 的模板（考研/英语/项目/生活）逐步加深
5. 之后再评估练习题库、Books/Mastery、记忆图等 DeepTutor 能力
