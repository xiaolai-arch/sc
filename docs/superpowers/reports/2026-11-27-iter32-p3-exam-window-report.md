# iter32 P3 考前窗口（G6）交付报告

**分支：** `xiaolai/iter32-p3-exam-window`　**HEAD：** 分支顶端为本报告 docs 提交（实现内容 = `5ebe52c` feat，未推送 origin）
**任务：** spec `docs/superpowers/specs/2026-11-27-streak-plan-realism-exam.md` 仅 P3（验收 26–30，27 为交付门控无需测试）；P0/P1/P2a 已在基线，P2b 未碰，P4 不做。
**基线：** 分支从 master `6dd3253`（P2a 整卷模拟已合入）切出，实现期间 master 前进到 `94296d5`（P2b 回访阶梯合入）；按任务纪律**未**把 master 并入本分支（见 merge-tree 节，两种口径都干净）。

## 交付门控（验收 27）

P2a 已合入基线 master（`6dd3253`）后才开工。提示行指向的整卷入口在基线上真实存在：`LearningPane.tsx` 的「整卷模拟」按钮（`整卷模拟` 配置行、倒计时、结卷摘要，`web/e2e` 亦有整链路用例）——本分支的 `LearningPane.tsx` 相对基线**零改动**，该入口即基线原物；e2e 第 4 条 `a whole-paper simulation runs to the summary and records mistakes` 在本分支实跑通过。

## 五道门禁（实跑）

先在 `5ebe52c`（feat 提交）实跑一遍全绿；补本报告 docs 提交后（唯一差异是一个不被任何代码引用的 markdown 文件）在分支顶端再实跑一遍，结果相同：

| # | 命令 | exit code | 摘要 |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | node + web 两个 tsconfig 通过 |
| 2 | `npm run typecheck:e2e` | 0 | 通过 |
| 3 | `npx vitest run --maxWorkers=4` | 0 | 205 文件 / 2193 通过 / 2 skipped（既有 skip） |
| 4 | `npm run build` | 0 | electron-vite 构建通过 |
| 5 | `npm run test:e2e`（build + playwright） | 0 | **26/26 全绿**（P2a 合入后的标准口径，含整卷链路用例） |

## merge-tree（实跑于 `5ebe52c`，报告 docs 提交前；提交后在顶端复跑同样 exit 0 无冲突，树哈希随报告自身内容漂移不落哈希）

- 对基线 master：`git merge-tree --write-tree 6dd3253 xiaolai/iter32-p3-exam-window` → **exit 0，无冲突**，干净树 `3d97f078c4e799824ff73477133954eed44bef9a`。
- 对当前 master（P2b 已合入）：`git merge-tree --write-tree master xiaolai/iter32-p3-exam-window` → **exit 0，无冲突**，干净树 `6b3a4e450882c524dac54d95f2b0dc7dbfeef627`。与 P2b 的文件零相交（P2b 动 knowledge/butler/revisit 与其测试；本分支动 TodayOverview/ReviewRecords/ReviewPage/Workspace/shared/workspace.ts + today-revisits.test.tsx，`today-revisits.test.tsx` P2b 最终未触碰）。

## 实现要点

### 提示行门控的纯函数形态

- `src/shared/workspace.ts` 增补 `EXAM_WINDOW_DAYS = 14` 与 `examWindowDaysLeft(workspace, today)`（紧挨 `daysUntilTarget`/`targetCountdownLabel`）：kind 为 exam 且 `0 ≤ days ≤ 14` 返回天数；项目缺失、非 exam、无 targetDate、越窗（< 0 或 > 14）返回 null。**提示行与复盘开场追问共用这一个门控**，两处语义天然一致。
- `src/renderer/shell/TodayOverview.tsx` 增补 `examWholePaperHint(workspace, today)`：null（不渲染）或整句 `距考试还有 {N} 天——适合来一次整卷模拟（学习 → 练习集）。`。边界单测在 `tests/renderer/today-revisits.test.tsx`（days = 0/14/15/-1、kind = exam/study/project/life、无 targetDate、null workspace）。
- 渲染：倒计时 memo 在原 `countdownWorkspace` 结果上追加算 `examHint`（倒计时项目的窗口），非 compact 且有值时在倒计时行**下**渲染一行；配色与倒计时行同款 `text-gray-500 dark:text-[#8e8e93]`（中性灰，无红色、无焦虑样式）。`countdownWorkspace`/`targetCountdownLabel` 既有逻辑逐字节零改动；倒计时行自身（`role="status"` aria-label `目标倒计时`）文案不变。

### 一次性写作标记的键设计与注入方式

- 类型 `ExamWritingStore { load(targetDate) → string | null; save(targetDate, sentOn) }`，定义在 `ReviewRecords.tsx`（与 `OneThingStore` 同款注入模式）。
- 真实实现在 `Workspace.tsx`：localStorage 轻量偏好，**键 = `asaki:exam-writing-asked:<targetDate>`，值 = 发送日**（`YYYY-MM-DD`）。键带 `asaki:` 前缀是刻意的（见「偏离」1），前缀后逐字是任务指定的 `exam-writing-asked:<targetDate>`。存取各自 try/catch，存储不可用退化为「下次再问」。与 quiz-offer 冷却、今日只做一件同一家 lightweight-prefs 家族，不进 AppSettings、无新设置项、无 IPC 变化。
- 注入链：`Workspace` → `ReviewPage`（新可选 prop `examWritingStore`）→ `ReviewRecords`；`today` 由 `ReviewPage` 既有本地日传入。**两者都注入才启用**（`startReview` 双检查）——轻量调用方不注入即特性关闭，与 oneThingStore 的 opt-in 模式一致。
- 「当前项目」的解析：复盘页筛选到具体项目用该项目（`workspace` prop）；「全部项目」回落到 `countdownWorkspace(workspaces, today)`（今日页倒计时正盯着的那个项目），故默认视图在窗口内同样会问、筛选到无关项目则不问。

### 两次点击的字节级差异（测试锁死，`today-revisits.test.tsx`）

- 第一次（窗口内，`targetDate = 2026-11-25`，today = `2026-11-21`）：

  `我们开始今天复盘 先花两分钟写下你现在最担心考试的一件事，写完我们继续复盘。`

  （开场句 + 半个空格 U+0020 + 追加句；追加句为 spec「界面」节原句。）同时 `store.map['2026-11-25'] === '2026-11-21'`（发送即写标记，标记写在同一同步 handler 里、随发送落地）。

- 第二次（同一 `targetDate`，标记已在）：

  `我们开始今天复盘`

  与基线开场**逐字节相等**（字符串全等断言；JS 字符串全等即 UTF-16 码元逐个相等）。净差异恰为追加句本身：`' 先花两分钟写下你现在最担心考试的一件事，写完我们继续复盘。'`，再无其他任何字节。

- 清空 store（`map.clear()`）后再点：追问再次出现，除「是否再问」外无任何其他副作用（仍是一次点击一条消息）。

### 无新字段、无情绪分析出口（验收 29）

- 追加句是开场消息字符串的后缀，随同一条消息进管家对话；用户写下的内容由管家照常走既有 `save_review` 管线——`SubmitReviewInput`/`ReviewAnswers`/`save_review` 工具零改动，无新字段、无新 IPC、无任何分析出口。
- 测试证明：`reviewOpeningPrompt` 纯构造器返回**一个字符串**；组件点击后 `onPrompt` **恰好被调一次、单字符串实参**（无第二参数、无第二通道）；「标记已在」与非窗口两种情形返回值与基线字符串全等（无残留 payload）。

## 测试清单（全部通过；既有 3 条回访用例原样保持）

`tests/renderer/today-revisits.test.tsx` 3 → 17 条，新增 14 条：

1. `examWindowDaysLeft` 边界：days = 0、14 在窗内（返回天数），15、-1 越窗（null）。
2. `examWindowDaysLeft` kind 门控：study/project/life 一律 null；无 targetDate、null 项目 null。
3. `examWholePaperHint` 整句精确断言（含「学习 → 练习集」）与越窗 null。
4. 窗口内今日页渲染：提示行在、文案精确、倒计时行文案不变、提示行配色 = 倒计时行同款中性灰（无红色类）。
5. 窗口边界渲染：day 0 与 day 14 出现，day 15 与已过日期不出现。
6. 非 exam 倒计时项目：倒计时行在、提示行不出。
7. compact 聊天首页卡：无提示行。
8. 首点追加 + 写标记（标记键 = targetDate、值 = 发送日）。
9. 二点不追加：与基线 `'我们开始今天复盘'` 全等。
10. 清 store 再点再问；仍是一条点击一条消息。
11. 非窗口三态（study / >14 / <0）：开场与基线全等、不写任何标记。
12. 「全部项目」回落倒计时项目：窗口内追问、标记落到其 targetDate。
13. 未注入 store：基线开场（特性纯 opt-in）。
14. `reviewOpeningPrompt` 纯函数：askedOn 已设/非窗口 → 基线；输出恒为单字符串（验收 29 的消息构造层证明）。

既有回归保持：`navigation.test.tsx`「starts a chat review」（demo `kaoyan` 为 exam 但无 targetDate → 基线开场）、`target-countdown.test.tsx`、`review-backfill.test.tsx`、`project-page.test.tsx` 全部原样通过（全量 vitest 205 文件无一失败）。

## 偏离 spec 之处（含理由）

1. **标记键带 `asaki:` 前缀**（`asaki:exam-writing-asked:<targetDate>`，任务原文为 `exam-writing-asked:<targetDate>`）：spec 要求「与 quiz-offer 冷却/今日只做一件同一家轻量 store」，该家族两个既有键均带 `asaki:` 命名空间前缀（`asaki:today-quiz-offer-date`、`asaki:today-one-thing`）；跟随家族约定，前缀后逐字保留指定键名。
2. **「全部项目」筛选回落到倒计时项目**：spec/任务只写「当前项目是 exam 且在窗口内」，未定义无筛选（全部项目，复盘页默认视图）时的行为。选择回落 `countdownWorkspace`：与提示行盯同一项目、默认视图在窗口内才会问、筛选到无关项目不问；「非窗口项目与基线逐字节一致」不受影响（回落项目非 exam 或越窗即基线）。已有专门测试锁此行为。
3. **门控纯函数落在 `src/shared/workspace.ts`**（`examWindowDaysLeft`）而非组件内联：spec 测试点允许「归属你定」；紧挨 `daysUntilTarget` 同文件，提示行与复盘开场共用同一门控，边界可直接单测。
4. **提示行渲染把原倒计时 `<p>` 包进一层 `<div className="space-y-1">`**：为让提示行紧贴倒计时行之下（行距 4px）且不扰动外层 `space-y-6` 的既有间距；倒计时 `<p>` 自身属性与文案逐字节不变。
5. **`ReviewPage` 的 `today` 一并传给 `ReviewRecords`**（复用其既有 `formatLocalDate(new Date())` 本地日）：`startReview` 需要本地日做窗口判定与标记值；不新增时钟来源。
