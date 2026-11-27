# iter33 P2a 主观题量规自评（item 67，批次 3/4）交付报告

> 分支 `xiaolai/iter33-p2a` ｜ HEAD `0dcc2e7`（rebase 到 master `048738a` 之后）｜ 2026-11-27
> 基线：开工时 master `1bce8fa`（按派单基线切出）；收尾时 master 已被 P1 批次前移至 `048738a`，经协调者裁决（msg_8bf48ac69650）rebase 解冲突后交付。
> spec：`docs/superpowers/specs/2026-11-27-next-step-fluency-rubric-focus.md` P2a 节 + 验收 12–17。AI 打分整轮不做；照片类、P2b 不做。

## 分支与提交

| 提交 | 内容 |
|---|---|
| `35d1535` | feat(practice): iter33 P2a 主观题量规自评——检查点自查（rebase 后重放） |
| `def317e` | fix(test): tool.parameters 读取前的类型收窄 |
| `0dcc2e7` | test(practice-ui): 短题提交断言并入 P1 `durationMs`（rebase 后交互修复） |

最终 diff（vs master `048738a`）：10 文件，+708 / −6。

## 五道门禁（提交 `0dcc2e7` 后实跑，逐字）

| 门禁 | 命令 | exit code | 输出摘要 |
|---|---|---|---|
| 1 | `npm run typecheck` | **0** | `tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json` 无错误 |
| 2 | `npm run typecheck:e2e` | **0** | `tsc --noEmit -p e2e/tsconfig.json` 无错误 |
| 3 | `npx vitest run --maxWorkers=4` | **0** | `Test Files  213 passed | 1 skipped (214)`；`Tests  2344 passed | 3 skipped (2347)` |
| 4 | `npm run build` | **0** | `✓ built in 227ms`（out/main·preload·renderer 全量产出） |
| 5 | `npm run test:e2e` | **0** | `26 passed (50.6s)` —— 口径 26/26 |

## merge-tree 互探（三次）

1. **开工探针**（HEAD 基于 `1bce8fa` 时）：`git merge-tree --write-tree master xiaolai/iter33-p1` = `0bd1d25`，**无冲突**（当时 P1 尚未合入 master）。
2. **收尾互探**（P1 中途合入 master 后，rebase 前）：`git merge-tree --write-tree master xiaolai/iter33-p2a` 探出 **4 文件真冲突**（已按裁决 rebase 解除，详见下节）。
3. **终探**（HEAD `0dcc2e7`）：`git merge-tree --write-tree master xiaolai/iter33-p2a` = `4b673d3`，**单树哈希、零冲突行**。未推送 origin。

## 冲突解法（逐文件，经协调者逐条核过）

P1 的 `durationMs` 与 P2a 的 `checkpointHits` 在四处同一插入点相邻行相撞，全部为「双侧新增」型冲突：

1. `src/shared/practice.ts` — `PracticeAttempt` 接口：`durationMs?: number`（P1）与 `checkpointHits?: boolean[]`（P2a）**两字段并存**，注释各自保留。
2. `src/main/practice/practice-service.ts` — `submitShortAnswer` attempt 构造：两个条件 spread 并存（`...(durationMs !== undefined …)` + `...(checkpointHits !== undefined …)`）。
3. `src/main/practice/records.ts` — 三处：imports 并集（`normalizeCheckpoints` + `normalizePracticeDurationMs` 合并进同一 value import；coerce 加 `asBooleanArray`）；`parseAttemptFile` 读侧并存（`durationMs` 归一读 + `checkpointHits` 原样读）；attempt spread 并存。
4. `src/renderer/shell/LearningPane.tsx` — 两处：`selfAssess` 提交参数并存（P1 口径 B `durationMs: measuredDurationMs()` + P2a `checkpointHits` spread）；`restart()` **取 P1 版**（复用 `resetAnswerState()`，P2a 的 `setSelfChecked/setChecks` 重置已在 `resetAnswerState()` 内）。

## 实现要点与测试证据

### 检查点生成（验收 12）

- 但只走建模集路径：`src/main/butler/tools.ts` 的 `create_practice_set` schema 在 `questions.items.properties` **末尾追加唯一新属性 `checkpoints`**，指令文本写明「仅短答题（kind 为 short 且有 referenceAnswer）提供：从参考答案里拆出 2-3 条句子级检查点……供学习者对答案前自查『答到了吗』。选择题和没有参考答案的短答题不要提供本字段」。
- 拆分由模型按提示词完成，本地不做确定性拆句、不合成、不强制（缺/checkpoint 不达标 → 无检查点，宽容不报错）。
- 测试：`tests/main/butler-tools.test.ts` 「passes short-question checkpoints through and drops stray ones」——2 条生效、空串丢弃、1 条视为无、choice 题丢弃、未提供则为无；且 `source:'model'` 随集走（`reviewedAt` 待核对沿用既有机制，无新增按题标记）。

### 「choice 与无 referenceAnswer 短题提示词逐字节不变」的证明

测试「create_practice_set schema carries the checkpoint instruction and nothing else changes」断言：

- `Object.keys(questions.items.properties)` 恰为既有 6 键 + 末尾追加 `checkpoints`（键序不变，既有键的字节位置不动）；
- `required` 仍为 `['prompt']`；
- 工具 `description`、`kind`/`prompt`/`options`/`answer`/`referenceAnswer`/`explanation` 六个既有属性的 description **逐字等于 P2a 前字面量**（快照断言，改动即红）。

### 容错与截断（验收 12/13 数据面、15）

- 共享助手 `src/shared/practice.ts`：`normalizeCheckpoints`（空串/纯空白丢弃、超 3 截前 3、<2 → `undefined` 视为无）与 `alignCheckpointHits`（按索引截断对齐、缺失=未勾、非布尔=未勾、题目无 checkpoints → `undefined` 不落字段）。但ler 工具、vault 读（`coerceQuestion`）、服务写（`normalizeQuestions`）、渲染端（LearningPane 渲染前再归一）共用同一实现，无第二套口径。
- `CreatePracticeQuestionInput.checkpoints`：手工建集（`source:'user'`/缺省）与建模集同一条 `normalizeQuestions` 路径——填 1 条 → 整字段省略（服务测试「createSet keeps 2-3 checkpoints…」覆盖 0/1/2/3/4 与 choice 各例）。
- `checkpointHits`：`submitShortAnswer` 服务端 `alignCheckpointHits(input.checkpointHits, question.checkpoints)` 对齐后落盘；旧调用方不带 hits → 全 false 对齐数组（「缺失视为未勾」落到写侧）；题目无 checkpoints → 永不写字段（含多余 hits 输入，测试「writes no checkpointHits for questions without checkpoints」）。3 checkpoints / 2 hits 负例：落盘 `[true,false,false]`（测试「aligns checkpointHits with the question checkpoints (3 vs 2 negative case)」）。读侧 `parseAttemptFile` **逐索引 `=== true`**（与 `alignCheckpointHits` 同一语义）：原长度保留、非布尔记未勾，与题目 checkpoints 的对齐只发生在统计时——手编文件 `checkpointHits: [true, x, true]` 解析为 `[true,false,true]` 而非 `[true,true]`（测试「parseAttemptFile keeps raw length and reads non-boolean hits as unchecked」）。
- IPC `requireSubmitShortAnswer`（`src/main/ipc.ts`）：`checkpointHits` 数组透传、非数组视为无；`requireCreatePracticeSet`/`requireUpdatePracticeSet` 本就 spread/questions 透传，`checkpoints` 无需改即达。

### 作答流（验收 14）

`src/renderer/shell/LearningPane.tsx`，仅带检查点的 short 题出现第三步：

- 写答案 → **提交**（进入「对照检查点自查」面板，spec 默认决定 7 标题逐字；**不展示 referenceAnswer**——测试断言 `queryByText(/参考答案：/)` 为 null）→ 逐条自勾「答到了吗」（checkbox）→ **对答案**（新按钮，揭示参考答案 + 答对了/没答对，基线自评 UI 原样）→ **自评点击之后**渲染漏勾回看：漏勾项以中性琥珀高亮（`#8a5a00`/`#ffb340`，浅底 `#ffb340/10`）并缀「（没答到）」，勾到的显示 `✓`；**不给分、不进错题本、不进调度**。
- **高亮时机按 spec 字面（自评后，item 67 裁 A）**：对答案揭示面板**不即时高亮**——「检查点对照」列表整体挂 `answered && hasCheckpoints` 条件，自评点击前不出现。渲染位置：`LearningPane` 组件 short 题揭示面板（`revealed ?` 分支内）的 `<ul aria-label="检查点对照">` 块；若日后改回即时揭示，把该块条件从 `answered && hasCheckpoints` 改回 `hasCheckpoints` 即可，一行条件。
- 负例：无 checkpoints 的 short 题作答流与基线两步逐字节一致（提交直达参考答案+自评；测试断言不出现「对照检查点自查」与「对答案」按钮，提交参数不含 `checkpointHits`）。
- UI 测试顺序与 spec :42 逐条对应：提交 → 自查（无参考答案）→ 对答案（揭示，断言 `queryByRole('list', { name: '检查点对照' })` 为 null、无「（没答到）」）→ 答对了 → 断言 `data-hit`/中性琥珀/「（没答到）」缀注。

### 判分链零改动与无 AI 打分（验收 16）

- `selfCorrect` 判分链：`practice-service.ts:603-604`（submitShortAnswer）与 `:716-717`（reviewMistake）在 P1 合入后的现行行号下**零改动**（P2a diff 只在其 attempt 构造中新增字段，不触碰判分行）；全部既有判分/调度测试回归通过（门禁 3 全绿）。
- grep 断言：`git diff master..HEAD -U0 -- src/ | grep '^+' | grep -icE 'ai-sdk|anthropic|generateText|streamText|openai|completeChat'` = **0** —— P2a 代码路径无任何新增模型调用。

### 明文可读（验收 17）

临时 vault 探针测试：「checkpoints round-trip through the vault and stay readable as plain markdown」——set 文件 frontmatter 逐条可见（`checkpoints:` + 每条明文句子），「checkpoints round-trip」旧集合（无 checkpoints）`serialize→parse→serialize` 逐字节相等且输出不含 `checkpoints` 字样；「submitShortAnswer aligns…」——attempt 文件 frontmatter 可见 `checkpointHits` 与布尔值。

## 验收 12–17 逐条对照

| # | 验收 | 状态 | 证据 |
|---|---|---|---|
| 12 | butler 建 short 题建模集 → 每题 2–3 条检查点、`source:'model'`+`reviewedAt` 待核对；choice/无 referenceAnswer 短题零检查点、提示词其余逐字节不变 | ✅ | butler 两测试 + service createSet 测试；提示词快照断言见上 |
| 13 | 手工建集可自填 0–3 条；填 1 条 → 字段省略 | ✅（数据面，见「偏离」①） | service「createSet keeps 2-3 checkpoints…」1 条 → `undefined` |
| 14 | 作答流顺序可测：提交 → 自查不显示参考答案 → 对答案后显示并高亮漏勾；负例基线两步一致 | ✅（高亮时机按 item 67 裁 A：自评点击后） | practice-ui 两个新测试（正例四步顺序 + 基线负例） |
| 15 | hits 与 checkpoints 等长才入统计；不等长按索引截断、缺失记未勾（3/2 负例） | ✅ | service 对齐测试 + helper 测试（读侧原样、统计侧 `alignCheckpointHits`） |
| 16 | selfCorrect 判分与统计链零改动（`:603-604`、`:716-717` 回归）；无 AI 打分调用 | ✅ | 门禁 3 全绿 + grep = 0（见上） |
| 17 | 明文可读（临时 vault 探针） | ✅ | 两组 vault 探针测试 |

## 与 P1 的交互面

- **合并**：rebase 到 `048738a`，4 文件冲突按裁决全解（见上）；合并后唯一语义交互是 P1 口径 B 的 `durationMs` 现在随每次 short 提交（`selfAssess` 一次调用同时带 `durationMs` 与 `checkpointHits`），我的两个 UI 测试断言已更新为两字段并存（`0dcc2e7`），并构成 P1×P2a 同调用的回归断言。
- **B 口径交互**：带检查点题的自查+高亮回看发生在提交之后、自评点击之前，落在 P1 计时窗（呈现→自评点击）内——该类题 `durationMs` 含自查时长，影响「自动召回 <10s」分级。协调者已裁（msg_8bf48ac69650）：此为 item 67「B 污染回看，先单一口径跑，等真实反馈」明文接受的对价，现状保持，统计侧另行处理属潜在 v2 事项，本批不动。
- **不越界**：P1 的统计区块（`FluencyTrend`/`accuracy-trend` 等）未触碰；P2b 未做；`reviewMistake` 流（错题复习）不带 checkpoints（mistake 快照无该字段，spec 未要求）。

## 偏离 spec 之处

1. **验收 13 的「手工建集可自填」只做了数据/服务层，未加对话框 UI 字段**。现状 `PracticeSetDialog` 本就不支持编写 short 题（`draftFrom` 不带 `kind`/`referenceAnswer`，重命名含 short 题的集会在对话框校验层报「至少需要 2 个选项」——P2a 之前即如此），没有可挂「检查点 0–3 条输入框」的 short 题编辑器；新增 short 题编辑器是超出本批范围的新功能。`CreatePracticeQuestionInput.checkpoints` 已全链路可用（对话框之外的手工建集调用方、未来 UI 皆可直接传），服务层测试覆盖 0–3 条与 <2 省略。建议后续批次随「对话框支持 short 题」一并补 UI。
2. **高亮时机（已按 sc-lead 裁 A 收口）**：首版实现曾取「对答案揭示时即高亮」；item 67 裁 A 改为 spec :42 字面顺序——漏勾高亮（含「（没答到）」缀注）在**自评点击之后**才渲染，揭示面板不即时高亮。**注记（sc-lead 指定原文要点）：高亮时机按 spec 字面（自评后）；若日后改回即时揭示，为一行条件**——`LearningPane` 揭示面板内 `<ul aria-label="检查点对照">` 块的条件由 `answered && hasCheckpoints` 改回 `hasCheckpoints` 即可。
3. **旧调用方写全 false hits**：题目带 checkpoints 而提交方未带 hits（旧调用方/服务直调）时落盘全 false 对齐数组而非省略字段——依据 spec「缺失视为未勾」把对齐Invariant 固化为「有 checkpoints 的 attempt 必有 checkpointHits」，便于统计；渲染端真实作答流总是带真实勾选。
4. 行号引用漂移：任务书里的 `practice-service.ts:585-586、690-691` 是基线 `4752928`/`1bce8fa` 行号，P1 合入后同一判分逻辑现位于 `:603-604`、`:716-717`（零改动已核）。

## 遗留

无。分支未推送 origin；合并由 sc-release 收口。
