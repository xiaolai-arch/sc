# ASAKI 第二轮迭代计划（2026-11-21）

**规范：** `docs/superpowers/specs/2026-11-15-personal-assistant-core-redesign.md` §4.3、§5.3、§6.2、§7、§8.3、§8.4
**基线：** `master` @ `30a4ba7`（今日 `a946860..30a4ba7` 已关闭 §10 的 5 个 PARTIAL；工作树干净）
**方式：** 逐条打开当前 `src/` 代码核对，未改动产品代码、`src/` 或 `tests/`；只新增本报告。

## 状态口径

- **已实现**：规范建议的行为在代码中有直接实现，且能从文件位置复述。
- **部分实现**：主干存在，但某个子行为缺失、只在部分入口生效，或只在 main 侧存在而没有接到用户可见层。
- **未实现**：在当前 `src/` 中找不到对应实现。
- 本报告只检查规范明确建议、但 §10 验收清单**没有**钉死的条目；已由 §10 交付的 run store、model catalogs、profile candidates、plan linkage、reminders persistence 不重复立项。

## 汇总

| 章节 | 已实现 | 部分实现 | 未实现 | 条目数 |
| --- | --- | --- | --- | --- |
| §4.3 工作过程展示 | 2 | 4 | 1 | 7 |
| §5.3 设置页 | 8 | 2 | 0 | 10 |
| §6.2 个人档案与检索 | 5 | 2 | 0 | 7 |
| §7 计划→任务→提醒 | 3 | 4 | 0 | 7 |
| §8.3 导航 | 0 | 2 | 0 | 2 |
| §8.4 页面 | 2 | 4 | 0 | 6 |
| **合计** | **20** | **18** | **1** | **39** |

---

## 1. 逐条核对

### 1.1 §4.3 工作过程：解决“有思考，但感觉不到”

| # | 规范建议 | 状态 | 证据（文件:行 + 实际内容） |
| --- | --- | --- | --- |
| 1 | 运行中默认展开一个工作过程区，显示“正在为你安排本周任务 · 已运行 18 秒”式的整体进度 | 部分实现 | 推理块在流式期间自动展开：`src/renderer/shell/TraceFlow.tsx:64` `useState(streaming)`；但只在推理行内，没有跨工具的“工作过程区”表头。全仓 grep `已运行` 无命中。工具行 `ToolRow` 默认收起：`TraceFlow.tsx:210` `useState(false)`。 |
| 2 | 进行中显示当前步骤、已完成项和耗时 | 部分实现 | 耗时只挂在推理行：`TraceFlow.tsx:119-131` `role="status"` 显示 `${elapsed}s` / `${elapsed} 秒`；工具行只有 running/done/failed：`TraceFlow.tsx:215-222`。没有“当前步骤 + 全部已完成项 + 总耗时”的汇总。 |
| 3 | 回答开始后压缩成“参考 3 项资料，完成 2 项操作”，保留查看过程的入口 | 部分实现 | 回答开始后推理行折成“思考过程 + 已思考 N 秒”并保留一个点击入口：`TraceFlow.tsx:85-89`、`:132-146`；引用在回答下方以 `本次参考 · N` 折叠：`src/renderer/shell/ChatPane.tsx:85`。但没有“参考 N 项 / 完成 N 项操作”这类总量摘要，grep 无命中。 |
| 4 | 用户手动展开后尊重其选择，不因每次新事件反复折叠 | 已实现 | `TraceFlow.tsx:65` `touchedRef`；`:80-89` 只在 `streaming` 变化时折叠，且 `if (!touchedRef.current)`；`:99-102` 手动切换置位。工具行同样只在用户点击时切换（`TraceFlow.tsx:210`、`:275-281`）。 |
| 5 | 结束后给出结果入口：“查看长期计划”“查看今日任务”“查看新增记忆” | 未实现 | 全仓 grep `查看长期计划`/`查看今日任务`/`查看新增记忆` 均为 0。回答下方只有 `本次参考` 和消息操作（复制/重新生成）：`ChatPane.tsx:340-345`、`:354-360`。 |
| 6 | 历史保存公开的步骤、来源和结果摘要；原始推理文本不自动进入永久个人记忆 | 已实现 | 只持久化工具步骤与引用：`src/main/butler/butler-service.ts:611-619` 写入 `text`、`steps`、`references`；推理明确不持久化：`src/renderer/shell/trace.ts:3` 注释“Persisted tool steps survive restarts; reasoning is session-only.”。 |
| 7 | 统一事件含 status、reasoning-summary、assistant-text、tool-start、tool-progress、tool-result、artifact、usage、error、done | 部分实现 | 现有事件只有 `reasoning`/`narration`/`text`/`tool-start`/`tool-result`/`error`/`done`：`src/shared/butler-stream.ts:30-51`；`usage` 只在 `done` 内，没有独立事件。模型层同样只有 `reasoning`/`text`/`tool-start`/`tool-result`：`src/main/agent/model-client.ts:88-104`。缺 `status`、`tool-progress`、`artifact`。 |

### 1.2 §5.3 CLI 设置：继承本机配置

| # | 规范建议 | 状态 | 证据（文件:行 + 实际内容） |
| --- | --- | --- | --- |
| 1 | 第一次打开自动扫描，后续用缓存快速显示，并提供重新扫描 | 已实现 | 自动加载：`src/renderer/settings/SettingsPage.tsx:302-307` `void localCliModels.load()`；缓存与强制刷新：`src/renderer/local-cli-models.ts:68-101`（`if (!force && this.state.scan) return;`）；按钮：`SettingsPage.tsx:835-843` “重新扫描”。 |
| 2 | 下拉列表只来自本机有效配置 / CLI 目录 / 当前已配置项，并展示模型来源 | 已实现 | 选项来源标签：`SettingsPage.tsx:75-81` `config/catalog/alias/mapping/cli`；下拉渲染带来源：`:783-787` `${optionLabel(option)}（${cliModelOriginLabels[option.origin]}）`；来源文件明示：`:799-805` “来源：…”。 |
| 3 | 没有列表时保留“继承 CLI 默认”，不让用户猜型号 | 已实现 | 首项始终存在：`SettingsPage.tsx:779` `<option value="">{cliInheritLabel}</option>`；空列表文案：`:804` “本机配置里没有读到模型列表；留空表示完全跟随 CLI 自己的设置”。计算函数：`local-cli-models.ts:128-131`。 |
| 4 | 默认不传 `--model` 和推理强度覆盖，显式选择才覆盖 | 已实现 | 保存时只有非空才写 `model`：`SettingsPage.tsx:431` `cliAgent !== 'zcode' && model.trim() ? { model: model.trim() } : {}`；推理强度空值不写：`:432-438`；文案：`:994` “不选模型时 ASAKI 不会传 --model”。 |
| 5 | 同一份发现结果同时供设置页和聊天输入框使用 | 已实现 | 单一 store：`local-cli-models.ts:10-16` 注释“Settings and the chat model picker must offer the same choices…”; 设置页 `SettingsPage.tsx:142-144`；聊天侧 `src/renderer/shell/Workspace.tsx:20`、`:250` `useLocalCliModels()`，`:1960` 传给 `ModelPickerDialog`。 |
| 6 | 命令路径、权限模式、配置作用域放进高级设置；API 接入保留为高级选项 | 部分实现 | 命令路径/原生工具/隔离已收进 `details`：`SettingsPage.tsx:996-1044` “高级设置（命令路径、原生工具、隔离模式）”。但权限模式不在设置页（全仓 `SettingsPage.tsx` 无 permissions），也没有“配置作用域”字段（grep `配置作用域`/`configScope` 为 0）。API 提供商仍在主下拉：`:750-760`，API Key/Base URL 在主模型卡：`:1059-1126`。 |
| 7 | Claude、Codex、OpenCode 分别实现配置适配器，不假设都支持 `models` 命令 | 已实现 | 四个独立适配器与分发：`src/main/agent/cli-model-config.ts:163-206`（Codex）、`:251-312`（Claude）、`:327-368`（OpenCode）、`:370-395`（ZCode）、`:402-419` `switch (agent)`。 |
| 8 | 读取模型字段时忽略凭据字段；解析失败回退到 CLI 默认，不覆盖原配置 | 已实现 | 头部注释：`cli-model-config.ts:11-13` “The adapters only read the fields they need and never keep credential fields…”; 失败只记 warning：`:180-201`、`:280-283`、`:344-346`；返回空目录由调用方保留继承项。 |
| 9 | 用户当前模型配置不一致时保留原选项并显示来源，保存时不静默换模型 | 已实现 | 未知 id 保持为自定义且可编辑：`SettingsPage.tsx:608-616` `cliModelIsCustom`；`:790-798` 自定义输入；测试 `tests/renderer/settings-models.test.tsx:99`、`:173`。 |
| 10 | 主界面只保留“本机 AI / 扫描结果 / 当前使用 / 模型 / 推理强度 / 重新扫描 / 测试连接” | 部分实现 | 已具备摘要与扫描结果：`SettingsPage.tsx:986-995` “当前使用…不选模型时…”，`:860-947` 扫描列表。但同一张主模型卡仍直接暴露全部提供商、API Key、Base URL：`:744-760`、`:1059-1126`，不是“只保留”的简化界面。 |

### 1.3 §6.2 个人档案与知识检索

| # | 规范建议 | 状态 | 证据（文件:行 + 实际内容） |
| --- | --- | --- | --- |
| 1 | 新增全局个人档案，项目记忆作为补充 | 已实现 | 全局 `profile.md` 在 vault 根：`src/shared/profile.ts:1-4` “It lives in `profile.md` at the vault root… applies to every project”；服务路径：`src/main/memory/profile-service.ts:12`、`:52` `profileFile(root)`；项目记忆仍在上下文：`src/main/butler/context.ts:112`、`:142`。 |
| 2 | 每条记忆记录来源、时间、适用范围、有效状态，区分“用户明确提供”与“模型推测” | 已实现 | 类型字段：`src/shared/profile.ts:15-28` `category/source/confidence/status/origin/createdAt/updatedAt`；模型来源默认 `candidate`：`profile-service.ts:85-90`；页面显示“你提供/模型推测 · 来源 · 更新于”：`src/renderer/shell/ProfilePage.tsx:240-251`。 |
| 3 | 档案可查看、编辑、删除和标记过期；旧事实被替换时保留来源，避免互相矛盾 | 部分实现 | 查看/编辑/确认/过期/恢复/删除均已接上：`ProfilePage.tsx:90-119`、`:253-289`、`:302-347`。但 `update` 编辑文本时直接替换旧文本：`profile-service.ts:181-196`，没有保留旧值或替换链，只更新 `origin/updatedAt`；“旧事实被替换时保留来源”仅部分满足。 |
| 4 | 对话先加载少量稳定档案，再用现有 MiniSearch 检索与当前问题相关的笔记、任务、计划和记忆 | 部分实现 | 档案先进 prompt：`src/main/butler/prompt.ts:106-115`；检索结果确实生成：`src/main/butler/references.ts:52-83`，`src/main/butler/butler-service.ts:750-761`。**但检索结果只用于“本次参考”展示，没有进入模型 prompt**：`butler-service.ts:507-527` `buildModelMessages` 只用 `context` + 历史 + 用户文本，不含 references。 |
| 5 | 先做关键词检索、项目过滤和相关性排序；需要时再评估向量检索 | 已实现 | MiniSearch 关键词 + 前缀/模糊 + 标题加权：`src/main/search/search-service.ts:60-68`；按 workspace 检索：`:312-337`；全库按 `score` 排序：`:361`。未见向量检索依赖。 |
| 6 | 对话里可见“本次参考”，点击可打开原记录 | 已实现 | 折叠列表：`src/renderer/shell/ChatPane.tsx:83-86` “本次参考 · {items.length}”；点击回调：`ChatPane.tsx:99-101`，接线在 `Workspace.tsx:1309` “本次参考 rows open the record…”。 |
| 7 | 用户明确要求“记住”时保存；模型对性格/能力的推测作为候选 | 已实现 | 系统提示要求明确信息才 `save_profile`、推测标待确认：`src/main/butler/prompt.ts:29`；服务默认候选：`profile-service.ts:85-90`；测试 `tests/main/profile-service.test.ts:44`（猜测保持 candidate）。 |

### 1.4 §7 从长期计划到今日提醒的闭环

| # | 规范建议 | 状态 | 证据（文件:行 + 实际内容） |
| --- | --- | --- | --- |
| 1 | 每个任务关联 goalId、planId、planItemId；同一计划条目重复加入时返回已有任务 | 部分实现 | 任务有稳定计划来源：`src/shared/workspace.ts:45-50` `planId/planWeekId/planItemId`，去重见 `tests/main/plan-closure.test.ts:70`。**没有 `goalId`**：全仓 grep `goalId`/`goal_id` 为 0；目标只以 `Workspace.goal` 字符串和 `LongPlan.workspaceId` 存在（`shared/plans.ts:74`）。 |
| 2 | 今日任务勾选完成后更新长期计划进度，或由同一事实派生进度 | 已实现 | `src/main/context.ts:738-755` 更新任务后按 `planId/planWeekId/planItemId` 调 `longPlans.setItemDone({ kind: 'day', done: task.status === 'done' })`；测试 `tests/main/plan-closure.test.ts:97`。 |
| 3 | 计划调整保留已完成记录，仅修改未执行的安排，展示变更摘要 | 已实现 | 重排从第一个“无进度”的当前/未来周开始，绝不重写有勾选的周：`src/main/plans/long-plan-service.ts:418-426`；保留旧阶段：`:459-464`；记录 `recalibratedFrom`：`:509-510`；页面显示“已按进度重排第 N 周起”：`src/renderer/shell/LongPlanPage.tsx:714-717`。变更摘要是单行提示，不是逐条 diff。 |
| 4 | 明确固定时间、预计时长、截止日期的区别，不能把“23:30 睡觉”当普通顺序任务排到中午 | 部分实现 | 三个字段存在：`shared/workspace.ts:34` `durationMin`、`:38` `due`、`:43-44` `startAt`。但 `due` 只是日期（`:142-143` “Local ISO date”），没有时刻；“固定事件 vs 可移动任务”没有类型区分，未设 `startAt` 的任务一律从 08:00 顺序排：`src/renderer/shell/schedule.ts:30-33`、`:129-159`。 |
| 5 | 提醒记录待触发、已触发、已完成、延后和失败状态；跨重启验证幂等性与漏提醒处理 | 部分实现 | **两种读法：**（a）提醒实体本身应有生命周期状态——`Reminder` 只有 `id/time/label/enabled/days`（`src/shared/workspace.ts:74-84`），没有状态字段；（b）投递侧已有触发/失败/幂等——`src/main/scheduler/scheduler.ts:299` 已投递跳过，`:301-307` DND 不消费，`:312-329` sink 失败重试，`:406-433` 投递日志跨重启。两者合起来仍缺“已完成/延后”的持久状态与用户延后动作。 |
| 6 | 时间到达与系统通知不依赖模型；模型不可用时仍能提醒 | 已实现 | Scheduler 只查 `getReminders`/`notify`，模型只在 check-in 回调里可选：`scheduler.ts:212-223`、`:344-374`；正文直接来自 `Reminder`：`:137-145`；测试 `tests/main/scheduler-reminders.test.ts:245`。 |
| 7 | 桌面后台提醒要求应用/后台进程运行；休眠、关机、退出后的补提醒规则要写清楚，不承诺离线关机仍准时 | 部分实现 | 代码注释说明了“睡醒后补一次、之后不重复”：`scheduler.ts:166-175` “catch-up-once semantics after the machine sleeps…”。但没有用户可见文档，也没有明确写出“退出/关机期间不补”的规则；`delivery-log.ts:26-31` 只保留当天 key，跨天即忘。 |

### 1.5 §8.3 建议导航

| # | 规范建议 | 状态 | 证据（文件:行 + 实际内容） |
| --- | --- | --- | --- |
| 1 | 导航为“阿咲：今日/对话/目标与计划/我的资料/知识库；项目；底部通知中心·设置”，提醒与复盘归入今日/目标流程 | 部分实现 | 分组已存在但不同：`src/renderer/shell/NavigationSidebar.tsx:91-116` — “阿咲：今日/日常/知识库/我的资料”，“目标与计划：今日安排/长期计划/复盘”，“记录与提醒：记忆/提醒”。`对话` 仍叫“日常”，提醒独立在“记录与提醒”；底部只有设置按钮 `:895` `aria-label="打开设置"`，没有“通知中心”。 |
| 2 | “工作区”对用户称为“项目”，概念只出现一次 | 部分实现 | 同一处混用：`NavigationSidebar.tsx:643` 分组标题“工作区”，`:765` “新建工作区”，但空态写 `:659` “项目会由阿咲在对话里创建。”；对话行兜底标签 `:462` 也是“工作区”。 |

### 1.6 §8.4 建议页面

| # | 规范建议 | 状态 | 证据（文件:行 + 实际内容） |
| --- | --- | --- | --- |
| 1 | 今日：置顶“现在最值得做的 1~3 件事”，接着今日时间表、临近提醒、目标进度和一句话输入框 | 部分实现 | 已置顶 1-3 件事：`src/renderer/shell/TodayOverview.tsx:36-51` `slice(0, 3)`，`:111-176`；临近提醒 `:178-215`；目标进度 `:217-265`。**没有内嵌今日时间表**（那是独立 `SchedulePage`），底部是“问阿咲今天怎么安排”按钮 `:169-175`，不是输入框。 |
| 2 | 对话：顶部显示当前项目、CLI、模型和运行状态；可折叠右侧面板“本次参考”“已产生结果”；宽屏才显示右栏 | 部分实现 | 顶部只有“阿咲 / 项目或上下文 / 日期”：`src/renderer/shell/ChatPane.tsx:216-232`；模型标签在输入框附近（`src/renderer/shell/Composer.tsx:327`、`:332`），不在顶栏；运行状态在侧栏徽标（`NavigationSidebar.tsx:197-202`）。**没有右侧“本次参考/已产生结果”面板**：引用内联在消息下方 `ChatPane.tsx:340-345`；全仓 grep `已产生结果` 为 0。 |
| 3 | 目标与计划：每个目标显示下一步、进度和风险；长期计划、每日任务、复盘放在同一目标下 | 部分实现 | 现在分成三个独立页面：`NavigationSidebar.tsx:102-107`（今日安排/长期计划/复盘各自 section）；grep `下一步`/`风险` 在 `LongPlanPage.tsx`、`SchedulePage.tsx`、`ProjectsPage.tsx` 均为 0。只有今日页显示计划百分比：`TodayOverview.tsx:222-260`。 |
| 4 | 我的资料：展示“关于我、偏好约束、能力经验、近期变化”，每项可查看来源和更新时间 | 已实现 | 四类分组：`src/shared/profile.ts:70-82`；页面按类渲染：`ProfilePage.tsx:187-297`；来源/来源说明/更新时间：`:240-251`。 |
| 5 | 知识库：保留目录和笔记正文；证据与关系按需展开 | 已实现 | 目录 + 单篇笔记 + 视图切换：`src/renderer/shell/KnowledgePage.tsx:135`、`:352-366`、`:416-418`、`:488-495`；笔记面板接线 `Workspace.tsx:1842`。 |
| 6 | 设置：按“本机 AI、提醒与后台、个人与外观、数据与备份”分组，默认展示普通用户需要的选项 | 部分实现 | 四个分组与锚点完全一致：`src/renderer/settings/SettingsPage.tsx:86-91` `SETTINGS_GROUPS`；但仍是单页长卡片堆叠（个人/模型/预算/用量/备份/通知/外观/启动全部同时展开）：`:730-1476`，没有“默认只显示普通选项”的收起。 |

---

## 2. 第二轮：工作包

按用户价值排序；每个包独立可交付，规模控制在一个 agent-day 内。包与包之间没有硬依赖，可按顺序插入。

### P1（first slice）运行工作过程可见 + 结束结果入口

- **目标：** 用户在一次流式回答中能一直看到“正在做什么、做了多久、完成了哪些步骤”，回答结束后能一键跳到长期计划、今日任务或新记忆。
- **验收（可测试）：**
  1. 渲染测试：一条流式回复同时带推理与工具步骤时，会话顶部显示工作过程表头（含运行秒数，`role="status"`），且工具步骤按顺序显示 running→done。
  2. 用户点开某一步后，后续事件到达时 `aria-expanded` 保持为 `true`（现有 `touchedRef` 行为有测试）。
  3. 结束事件带 `plan`/`task`/`profile` 结果引用时，回答下方出现对应“查看长期计划/查看今日任务/查看新增记忆”链接；没有对应结果时不渲染假链接。
- **改动文件：** `src/renderer/shell/TraceFlow.tsx`、`src/renderer/shell/ChatPane.tsx`、`src/renderer/shell/Workspace.tsx`、`src/renderer/shell/types.ts`、`src/renderer/shell/trace.ts`、`tests/renderer/trace-flow.test.tsx`（新增用例）。
- **规模：** M（约 0.5–1 天）。
- **风险：** 结果链接必须从本轮真实工具/引用派生，不能按关键词猜测，否则会重演“假步骤”；窄屏（<768px）表头与折叠区会挤压正文，需要沿用 `PageFrame` 的单列约束；推理缺失时只能显示工具状态，不能补写“思考文字”。

### P2 把检索结果真正送进模型上下文

- **目标：** “本次参考”列出的本地记录，模型在这一次回答里确实读过，而不是只在 UI 上展示。
- **验收（可测试）：**
  1. main 测试：给定一条能命中笔记/任务/计划的用户问题，`buildModelMessages` 产出的 system 消息包含带截断的检索摘要，顺序与 `collectReferences` 的 references 一致。
  2. 检索失败或 `getSearch` 为空时，prompt 与今天一致（不新增伪内容），回答仍然成功。
  3. 现有 `references` 事件与持久化不回归（复用 `tests/main/*references*`）。
- **改动文件：** `src/main/butler/butler-service.ts`（`loadReferences` 与 `buildModelMessages` 串起来）、`src/main/butler/prompt.ts`（新增“本次检索”段）、`tests/main/references.test.ts`（新增或扩展）。
- **规模：** S（约 0.5 天）。
- **风险：** prompt token 预算；必须复用 `MAX_REFERENCE_DETAIL`/截断并限制条数，不能把整页笔记塞进去；检索是 best-effort，任何失败都不能阻断回答。

### P3 提醒生命周期与漏提醒规则

- **目标：** 提醒从“只有一个时间点”升级为可追踪的生命周期（待触发/已触发/已完成/延后/失败），并把后台运行与补提醒规则写进用户可见说明。
- **验收（可测试）：**
  1. main 测试：模拟应用在提醒时间之后启动，当天提醒投递一次；再次 tick 不重复（幂等）。
  2. 用户对某个提醒执行“延后”，状态与新的触发时间持久化，重启后仍生效；“完成/失败”可从页面看到。
  3. 文档：README 或设置页说明“应用/后台进程运行时才提醒；休眠后补一次；关机/退出期间不补”。
- **改动文件：** `src/shared/workspace.ts`（`Reminder` 增加状态字段与迁移默认）、`src/main/workspace/records/reminders.ts`、`src/main/scheduler/scheduler.ts`、`src/main/scheduler/delivery-log.ts`、`src/renderer/shell/RemindersPage.tsx`、`tests/main/scheduler-reminders.test.ts`。
- **规模：** M（约 1 天）。
- **风险：** 旧 `reminders.md` 的兼容读取（缺字段按“待触发”处理）；状态不要与 `enabled` 混淆；延后不能破坏 DND 不消费触发的语义。

### P4 今日页补全时间表与一句话输入

- **目标：** 打开“今日”就能从置顶 1-3 件事一路看到时间表、临近提醒和目标进度，并直接输入一句话让阿咲安排。
- **验收（可测试）：**
  1. 渲染测试：今日页同时存在“接下来”“今日时间表”“最近提醒”“目标进度”四个 region，以及一个可输入的 composer。
  2. 今日页的时间表复用 `buildDailySchedule`，与 `SchedulePage` 对同一组任务产出相同条目。
  3. 1440×900 与 1366×768 下正文不被侧栏挤压（复用今日新增的 e2e 视口断言）。
- **改动文件：** `src/renderer/shell/TodayOverview.tsx`、`src/renderer/shell/Workspace.tsx`、可能新增 `src/renderer/shell/TodaySchedule.tsx`、`tests/renderer/today-overview.test.tsx`。
- **规模：** S–M（约 0.5–1 天）。
- **风险：** 今日页与今日安排页出现两份时间表容易漂移，必须共用 `schedule.ts`；输入框要避免和首页的空态输入框抢焦点。

### P5 设置页高级收敛

- **目标：** 主设置页默认只展示“本机 AI、当前使用、模型来源、推理强度、重新扫描/测试连接”，把命令路径、权限模式、配置作用域和 API 接入收进高级区。
- **验收（可测试）：**
  1. 渲染测试：默认视图不含 API Key 输入框和 Base URL；展开“高级”后才出现。
  2. 已有 API 用户打开高级区仍能编辑和清除 Key（现有 `settings.test.tsx:211` 语义保持）。
  3. 设置分组跳转仍指向四个锚点（`SETTINGS_GROUPS`）。
- **改动文件：** `src/renderer/settings/SettingsPage.tsx`、`tests/renderer/settings.test.tsx`、`tests/renderer/settings-models.test.tsx`。
- **规模：** M（约 1 天）。
- **风险：** 隐藏 API 配置会让“最常见配置 = 本机 CLI”更顺，但会让纯 API 用户多一步；需要保留搜索/跳转，避免“找不到设置”。

---

## 3. 暂不做（not doing now）

- **按目标合并的“目标与计划”大页（§8.4）**：需要把 `SchedulePage`、`LongPlanPage`、`ReviewPage` 三个页面重构成同一目标下的子视图，规模超过一个 agent-day，且是纯信息架构调整，先让真数据跑顺再合并。
- **完整导航重设计（§8.3，含通知中心）**：会牵动侧栏、项目树、路由和现有 8 个入口；等提醒生命周期（P3）确定后再做“通知中心”，避免先做一个空壳。
- **goalId 数据模型与历史迁移（§7）**：当前 `Workspace.goal` 已能支撑进度显示；给任务增加 `goalId` 需要迁移大量既有任务文件，收益低于 P1–P3，先不加。
- **向量检索（§6.2）**：关键词 + MiniSearch 已覆盖当前 vault 规模；规范也写明“需要时再评估”，现在引入 embedding 会增加依赖与索引成本。
- **Codex app-server 结构化服务（§5.3 末段/§9）**：会改动会话协议，风险高；先把配置读取和默认继承做稳（已完成）。
- **配置作用域字段（§5.3）**：本机 CLI 配置本身已有作用域，ASAKI 再加一层会制造第二事实源；暂不引入。
- **权限模式进设置页（§5.3）**：权限现在是每轮/每会话能力（Composer），移到全局设置会削弱“按对话选择”的语义。
- **“已产生结果”独立右侧面板（§8.4）**：P1 先把结果入口放进消息流；右侧面板需要宽屏断点、抽屉和状态同步，等 P1 验证用户是否真的会点再决定。
- **提醒“已完成”与任务完成合并（§7）**：需要先想清楚提醒完成与任务完成是不是同一事实；P3 只记录状态，不强行合并。

---

## 4. 第一切片（first slice）

**P1 运行工作过程可见 + 结束结果入口。**

理由：它直接解决规范 §4 的核心症状“有思考，但感觉不到”，并且是唯一同时提升“运行中可信度”和“结束后可行动性”的包；改动集中在已存在的 `TraceFlow`/`ChatPane` 渲染层，不需要新数据模型或迁移，一个 agent-day 内可交付并用渲染测试证明。P2 虽然更小且修的是“参考是否真实”，但用户感知弱，放在第二包。
