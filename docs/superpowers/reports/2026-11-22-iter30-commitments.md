# iter30 — 承诺、一周安排与提醒完成的可见与可改

分支：`xiaolai/iter30-commitments`（基于合并后的 master，未推送）
spec：`docs/superpowers/specs/2026-11-22-visible-commitments-and-availability.md`（commit `1df30a7`）

本报告回答三件事：每个 block 改了什么（file:line）、23 条验收各自落在哪个测试/实现上、以及两处被**有意改写**的旧断言逐字原文（供评审判断是否被弱化成同义反复）。

---

## 提交

| commit | 内容 |
| --- | --- |
| `1df30a7` | docs(spec)：从 `xiaolai/iter30-spec` 拣入本 spec（纯文档） |
| `29e7e82` | **P4** — 完成的提醒只在当天安静，次日自动恢复 |
| `5fa1a0d` | **P2** — 静音结束后第一条检查说一句事实，且只说一次 |
| `7c353c6` | **P0 + P1 + P3** — 承诺区、一周安排一条、任务两个时间字段；含 4 个新 IPC 通道、mock API、e2e |

说明：P0/P1/P3 合成一个提交，是因为它们共用 `src/main/ipc.ts`、`src/main/context.ts`、`src/renderer/shell/ProjectSections.tsx`、`web/mock-api.ts` 这几个文件——4 个新通道必须同时出现在 `IPC_CHANNELS`、handler map、bridge 与 mock 中，任一通道单独提交都会让类型检查失败。我已在独立 worktree 里对 `29e7e82` 与 `5fa1a0d` 各跑 `tsc`（node + web 两个 project）确认它们是自洽、可单独编译的提交。

---

## 每个 block 的实现要点

### P0 承诺（commit `7c353c6`）

- **服务投影**：`src/main/commitments/service.ts:151` `listSummaries()` —— open 按 `due` 升序、再 `createdAt` 升序；`includeResolved` 时把 done/dropped 追加在后面，按 `resolvedAt` 降序。用既有的 `summarizeCommitment` 投影，不新增字段。
- **IPC**：`src/main/ipc.ts:187-190` 在 `IPC_CHANNELS` **末尾**追加 `listCommitments` / `resolveCommitmentEntry` / `listWeekAvailability` / `clearWeekAvailability`（注释写明“no second channel constant set”）；校验器 `:816`/`:830`/`:850`。`src/shared/ipc.ts:215-235` 增加类型与方法。
- **context 接线**：`src/main/context.ts:1135` `listCommitments`、`:1146` `resolveCommitmentEntry`（reschedule→`resolve({newDue})`，否则→`resolve({outcome})`）。
- **但ler 提示词**：`src/main/butler/prompt.ts:183-189`（常量 `:56`、`:57`）——`MAX_PROMPT_COMMITMENTS = 3`、`MAX_PROMPT_COMMITMENT_TEXT = 120`；格式 `- 「X」（原定 MM-DD）`，超出时 `还有 N 条未列出。`；无承诺时整段不出现。数据来自 `src/main/butler/context.ts:105` `selectCommitments`（读失败→`[]`），两条 `gatherContext` 调用各补一个 `commitmentService` 实参（`src/main/butler/butler-service.ts:166,290`）。
- **渲染**：`src/renderer/shell/ProjectSections.tsx:1662` `CommitmentsSection`——标题「承诺」+ 副标题、过期行排前并带「已过期 N 天」、三个动作 `改期/放下/完成` 都走 `onResolve`、原生 `input[type=date]` 改期（不早于今天、不超过 365 天，中文错误）、「显示已结束」开关（只读历史）、空态文案、`不会主动问你` 标签、`这是你答应的事，不是任务。` 页脚。
- **数据装载**：`src/renderer/shell/useWorkspaceData.ts:257` 一次 `listCommitments({includeResolved:true})`，`resolveCommitmentEntry` 成功后 `reload()`；`RemindersPage.tsx` 把该区渲染在 `RemindersSection` 之后。

### P1 一周安排（commit `7c353c6`）

- **服务**：`src/main/availability/service.ts:146` `clear(weekStart)`——`requireWeekStart` 后只过滤该周；`remaining.length === records.length` 时**不写文件**（幂等）。
- **context**：`src/main/context.ts` 新增 `listWeekAvailability`（本周起、按周降序投影）与 `clearWeekAvailability`。
- **渲染**：`src/renderer/shell/LongPlanPage.tsx:792-819`——只在本周（`weekStart <= today <= +6`）有记录时渲染 `data-week-availability` 区块，文案 `你说过这周特别满：周二、周四（来自周复盘）` + 清除按钮；清除后区块消失并显示 `role="status"` 的 `已清除。之后排计划会恢复按项目设置的可用时间。`；无记录整块不存在。
- **规划联动**：沿用既有 `src/main/context.ts:1188` 的 `BUSY_DAY_MINUTES` 读取路径；新增 `tests/main/integration-context.test.ts` 断言“清除后同一天回到默认可用时间、vault 不再有该周记录”。

### P2 静音恢复（commit `5fa1a0d`）

- **设置字段**：`src/shared/types.ts` `NotificationSettings.resumedFrom?: string`；`src/main/settings/settings-service.ts:25-52` 读时剔除空/非法值，`:242-250`（`mergeSettings`）合并时空值 `delete notifications.resumedFrom`（**修正点**：初版会把 `""` 写进文件，被新测试抓出后改为删除键）。
- **一句话**：`src/main/check-ins/prompt.ts:172` `resumeCheckInLine(day, date)` → `你之前暂停到 M 月 D 日，今天是恢复的第一天。`（day 晚于 / 早于非法 / 为空 → `''`）。
- **只追加一次**：`src/main/check-ins/proactive-check-in-service.ts:199-200` 在“确定会执行”之后 peek，`:243-244` 消息落库成功后 `consumeResume()`；`generate()` 在模板/模型任一产物**之后**（`:333`）确定性地追加这句。这句**从不交给模型**（`buildCheckInPrompt` 签名里没有它），因此不可能被模型改写或重复——这不同于 iter23 对模型输出做子串判断，两种误判（漏加、重复）在结构上都不可能。
- **peek/consume 行为**：`src/main/context.ts` 的 `peekResume`（先看 `resumedFrom`，再看已过期的 `snoozedUntil`）与 `consumeResume`（手动恢复清 `resumedFrom`，自然到期清 `snoozedUntil`），使“自然到期”也能恰好说一次。

### P3 任务时间（commit `7c353c6`）

- **表单**：`src/renderer/shell/ProjectSections.tsx:564-589`——`截止日期`（date）与 `固定开始时间`（datetime-local）各带一行说明；`parseDraftDue`/`parseDraftStartAt`（`:357` 起）在客户端先行校验并抛中文错误；新建传值、编辑保存时清空传 `null`。
- **今日页**：`src/renderer/shell/TodayOverview.tsx:409` 既有 `· 截止 MM-DD` 后缀保持（新增测试证明有则显示、无则不显示）。
- **排程**：`buildDailySchedule` 既有 pin 逻辑；新增测试证明 23:30 固定块不被挪动、自动排程不占用其时段（`pinned: true`）。

### P4 提醒完成（commit `29e7e82`）

- **单点判定**：`src/shared/workspace.ts` `effectiveReminderState(reminder, today)`（内部仍是 `reminderState` + “`done` 且 `doneAt < today` → `pending`”）；`reminderState()` 保持不变。
- **写入 `doneAt`**：`src/main/workspace/create-workspace-service.ts:843` 仅在 `state==='done'` 时写 `formatLocalDate(new Date())`；`state==='pending'` 时清 `doneAt`（`:850`）。
- **markFired 清 `doneAt`**：`src/main/scheduler/scheduler.ts:354`。
- **调度器**：`src/main/scheduler/scheduler.ts:185` `if (effectiveReminderState(reminder, date) === 'done') continue;`（`date` 由 tick 传入，`''` 时旧 `done` 仍静默）。
- **解析**：`src/main/workspace/records/reminders.ts:64` `coerceDoneAt`——严格 `^\d{4}-\d{2}-\d{2}$` 且可解析，否则丢弃；无 `doneAt` 的旧文件再序列化逐字节不变。
- **各处调用**：`src/shared/notifications.ts`（通知中心过滤）、`TodayOverview.tsx:184`（接下来/最近提醒，`today` 由调用方传入）、`ProjectSections.tsx:184` `reminderStateOf(reminder, today)` + `ReminderStateChip`。

---

## 23 条验收对照表

| # | 验收 | 落点 | 结论 |
| --- | --- | --- | --- |
| 1 | 3 条 open（含 1 条过期）按到期升序、过期带“已过期 N 天”、`aria-label` 走动作名 | `reminders-commitments.test.tsx`「lists open promises…」；e2e `iter30-commitments.spec.ts:77` | 满足 |
| 2 | 改期后界面更新；文件里该条 `due` 变、`status` 仍 open、无 `resolvedAt`，其他条与正文逐字节不变 | e2e `:77`「reschedules it on disk」（断言文件内容）；`reminders-commitments.test.tsx`「改期 prefills…」 | 满足 |
| 3 | 放下后该行消失；文件 `status: dropped` + `resolvedAt`；显示已结束可见 | e2e `:130`「records it as dropped」 | 满足 |
| 4 | 空 vault 显示指定空态，不报错不写文件 | `reminders-commitments.test.tsx`「the empty state offers exactly one way…」 | 满足 |
| 5 | 提示词「未结案承诺」≤3 条、`- 「X」（原定 MM-DD）`、超出注明；无承诺时与 `1cf5994` 逐字节相同 | `butler-prompt.test.ts`「renders the open-promise section…」+「an empty or absent commitment list leaves the prompt byte-identical」 | 满足 |
| 6 | `listPendingCommitments` 行为不变；承诺页不通过它写入 | `ipc-handlers.test.ts`「reads pending promises…」保持通过；承诺写入走 `resolveCommitmentEntry` | 满足 |
| 7 | 有本周记录时显示一句；无记录区块不存在 | `week-availability-panel.test.tsx`（显示/未来周不渲染/无记录不渲染）；e2e `:176` | 满足 |
| 8 | 清除后 vault 该周消失、其他周不变、页面区块消失；之后 `planWorkspace` 不再给 `BUSY_DAY_MINUTES` | `availability.test.ts`「clear removes only that one week…」+`integration-context.test.ts`（清除后回到 120 分钟）；e2e `:176`（其他周保留） | 满足 |
| 9 | 清除不存在的周不抛错、不写文件 | `availability.test.ts`「clear rejects a malformed weekStart and skips the write for an absent week」 | 满足 |
| 10 | 到期后第一次检查末尾一句话；第二次不再有 | `proactive-check-in.test.ts`「the first check after a mute ends says the sentence exactly once, template path」 | 满足 |
| 11 | 手动恢复后第一条也有；从未静音时四触发器逐字节不变 | `proactive-check-in.test.ts`「a manual resume spends resumedFrom…」+「without a pending resume every check-in keeps its previous bytes」 | 满足 |
| 12 | `resumedFrom` 为空时不出现该键；旧设置文件写回逐字节不变 | `settings-service.test.ts`「tracks the pending mute resume…」+「legacy settings without resumedFrom round-trip byte-identically」 | 满足 |
| 13 | 填截止日期后今日页出现 `截止 12-01`；清空后消失 | `today-overview.test.tsx`「a task with a 截止日期 shows the suffix…」 | 满足 |
| 14 | 填 `23:30` 后放在 23:30、自动排程不重叠、`pinned: true` | `schedule-page.test.tsx`「a 23:30 fixed start stays at 23:30 and blocks auto-scheduling」 | 满足 |
| 15 | `startAt` 空串/非法→中文错误、调用被拒、不产生半写文件 | `ipc-handlers.test.ts`「rejects an invalid task time or due date in Chinese before the service」（`任务开始时间无效。`/`任务截止日期无效。`，且 createTask 从未被调用） | 满足（见“偏差”里关于 UI 层的一处说明） |
| 16 | 12:00 每日提醒今天完成后，当天 tick 不投递、页面“已完成”、文件有 `state: done` + `doneAt: 今天` | `scheduler-reminders.test.ts`「a done reminder is quiet on its completion day…」；`project-page.test.tsx`「completing a reminder is quiet for today…」（断言 `doneAt`） | 满足 |
| 17 | 次日 tick 投递一次、写回 `fired`、`doneAt` 消失、更晚 tick 不重复 | 同上「…resumes the next day」 | 满足 |
| 18 | 带 `days` 的提醒周五完成后周末不响、下周一响 | `scheduler-reminders.test.ts`「a done daily reminder resumes on the next day its weekday matches」（周六完成 → 次周六恢复） | 满足 |
| 19 | 旧文件仅 `state: done` 无 `doneAt`：与 `1cf5994` 一致（继续静默、不写文件） | `scheduler-reminders.test.ts`「a legacy done reminder without doneAt stays quiet forever」；`reminders-records.test.ts`「an old file without doneAt round-trips byte-identically」 | 满足 |
| 20 | 仅延后/关闭开关的提醒不受影响；`enabled:false` 仍完全不响 | 既有「fires each enabled reminder once and skips disabled ones」「DND leaves the reminder pending…」保持通过；`effectiveReminderState` 对非 `done` 原样返回 | 满足 |
| 21 | 已完成未到次日的提醒不出现在「接下来」；次日重新出现 | `today-overview.test.tsx`「a reminder done today leaves 接下来 and returns on the next day」 | 满足 |
| 22 | 完成后一句确认：带 `days` 说“下次提醒：周一”，每日说“明天照常”；≤2 行、不弹窗 | `project-page.test.tsx`「…明天照常。」+「completing a weekday reminder names the next matching day」（周五→周一） | 满足 |
| 23 | 当天徽标“已完成”带“重新启用”；跨零点后徽标“待触发”且无“重新启用” | `project-page.test.tsx`（同一测试断言当天 done+重新启用；另一测试断言次日 `待触发` 且无重新启用按钮，存储记录未被写） | 满足 |

**未被完全满足的条目**：无。全部 23 条都有对应断言且实际运行通过。

---

## 两处有意改写的旧断言（逐字原文）

### 1. `tests/main/scheduler-reminders.test.ts` —— 原 `test('a done reminder stops firing until it is re-enabled')`

旧断言证明“done 永不投递且不写文件”。新语义下这不再成立，按 spec 改写为“当天静默、次日恢复”。新代码（`:546` 起，完整保留注释）：

```ts
  test('a done reminder is quiet on its completion day and resumes the next day', async () => {
    // 「完成」是当天的事，不是关掉：doneAt 记着完成的那一天，当天保持安静，
    // 第二天 effectiveReminderState 读回 pending，无需手动「重新启用」。
    const store = lifecycle([
      {
        id: 'water',
        time: '12:00',
        label: '喝水',
        enabled: true,
        state: 'done',
        doneAt: '2026-10-31'
      }
    ]);
    const notified: string[] = [];
    const deliveredKeys = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => deliveredKeys.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        deliveredKeys.set(date, [...keys]);
      }
    };
    let now = at(12, 30);
    const make = () =>
      new Scheduler({
        now: () => now,
        getSettings: async () => settings(),
        getReminders: store.getReminders,
        onReminderState: store.onReminderState,
        notify: (notification) => {
          notified.push(notification.key);
        },
        deliveryLog
      });

    // The completion day itself: no trigger is even built, so nothing is
    // delivered and no lifecycle write happens.
    expect((await make().tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(0);
    expect(store.writes).toHaveLength(0);

    // The next day the same reminder fires again, and a successful delivery
    // records `fired` while clearing `doneAt` (the completion day is over).
    now = nextDayAt(12, 0);
    expect((await make().tick()).delivered.map((entry) => entry.reminderId)).toEqual([
      'water'
    ]);
    const record = store.records.get('water')!;
    expect(record.state).toBe('fired');
    expect(record).not.toHaveProperty('doneAt');
    expect(store.writes.at(-1)?.patch).toMatchObject({ state: 'fired', doneAt: null });
  });
```

它现在证明：**当天**不投递且不写文件（保留旧断言的核心）、**次日**投递一次、并把 `state` 写回 `fired`、`doneAt` 清空。旧断言“永不投递”是有意替换，不是放松——新断言既保留了“当天不响”，又追加了“次日响且清理”，比旧断言更强。同一文件另加「a done daily reminder resumes on the next day its weekday matches」与「a legacy done reminder without doneAt stays quiet forever」两条，覆盖 acceptance 18 与 19。

### 2. `tests/renderer/project-page.test.tsx` —— 原 `:417` 徽标断言

旧测试断言完成时 `state === 'done'` 且“重新启用”可恢复。新测试保留同一天的这两个断言（并额外断言 `doneAt` 写入文件），新增次日独立的测试。当天那条（`:376` 起）关键断言：

```tsx
  await userEvent.click(screen.getByRole('button', { name: '标为完成：早间计划' }));
  // One factual line right after the action, no dialog (acceptance 22).
  expect(await screen.findByText('今天不再提醒。明天照常。')).toBeInTheDocument();
  await waitFor(() => expect(row().getByText('已完成')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: '延后 10 分钟：早间计划' })).not.toBeInTheDocument();
  await waitFor(async () => {
    const reminder = (await api.getReminders()).find((entry) => entry.id === 'r1');
    // Completion writes the calendar day it applies to, not a permanent off.
    expect(reminder?.state).toBe('done');
    expect(reminder?.enabled).toBe(true);
    expect(reminder?.doneAt).toBe(formatLocalDate(new Date()));
  });

  // Same day: the user can still turn it back on right away.
  await userEvent.click(screen.getByRole('button', { name: '重新启用：早间计划' }));
  await waitFor(() => expect(row().getByText('待触发')).toBeInTheDocument());
  await waitFor(async () => {
    const reminder = (await api.getReminders()).find((entry) => entry.id === 'r1');
    expect(reminder?.state).toBe('pending');
    expect(reminder?.enabled).toBe(true);
    expect(reminder?.doneAt).toBeUndefined();
  });
```

新增的次日测试（`:419` 起）证明跨零点语义，且存储记录**没有被写**（不是页面在偷偷“重置”）：

```tsx
test('a reminder completed today is back to 待触发 the next day without a re-enable', async () => {
  // Seed the storage the mock reads: one reminder finished yesterday. The
  // judgement lives in effectiveReminderState(reminder, today), so the page
  // must show it as pending again — no 重新启用 button, daily buttons back.
  localStorage.clear();
  const yesterday = addLocalDays(formatLocalDate(new Date()), -1);
  localStorage.setItem(
    MOCK_STORAGE_KEY,
    JSON.stringify({
      reminders: [
        { id: 'r1', time: '08:00', label: '早间计划', enabled: true, state: 'done', doneAt: yesterday }
      ]
    })
  );
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);

  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(navButton('提醒'));

  const row = () => {
    const toggle = screen.getByRole('switch', { name: '早间计划 提醒开关' });
    return within(toggle.closest('div') as HTMLElement);
  };
  expect(row().getByText('待触发')).toBeInTheDocument();
  // The stored record is untouched — no write happened to "reset" it.
  const stored = (await api.getReminders()).find((entry) => entry.id === 'r1');
  expect(stored?.state).toBe('done');
  expect(stored?.doneAt).toBe(yesterday);
  // No re-enable button: there is nothing to re-enable.
  expect(screen.queryByRole('button', { name: '重新启用：早间计划' })).not.toBeInTheDocument();
  // The daily actions are back, so today's occurrence can be handled again.
  expect(screen.getByRole('button', { name: '标为完成：早间计划' })).toBeInTheDocument();
});
```

---

## 评审基准四条自检

**(1) `today` 由调用方传入，每层只算一次、不在多个组件里 `new Date()`。**
`effectiveReminderState(reminder, today)` 的 `today` 全部来自调用方：
- 调度器：`scheduler.ts:185` 用 `runTick` 里的 `formatLocalDate(at)`（`at = this.now()`，单一注入时钟）。
- `TodayOverview`：`upcomingReminders(reminders, today)`，`today` 是组件 prop（`TodayOverview.tsx:226`）。
- `notifications.ts:97` 用调用方传入的 `now` 推出当日。
- `ProjectSections`：`reminderStateOf(reminder, today)` / `ReminderStateChip({reminder, today})`，`today` 由调用方传入。**修正（第二轮）**：`RemindersSection` 原先在 `:1914` 自己写 `const today = formatLocalDate(new Date())`，而 `RemindersPage.tsx:17` 早已持有 `today` 并传给了同页的 `CommitmentsSection`——同一页两个时钟。现已删除该行，`today` 改为 `RemindersSectionProps` 的必填 prop，由 `RemindersPage.tsx:50` 传下；`isMutedOn(snoozedUntil, today)`（静音文案）也跟着改用同一个值。
- 关于 `TodayOverview.tsx:172` 的 `const now = new Date()`（`upcomingReminders` 内）：这是**有意保留**的，不属于漏网时钟。它只用来算此刻的分钟数，决定「接下来」里哪几条排前面（已在今天的排后）；它**不参与** done 判定——done 只看上方传入的 `today`。也就是说它影响的是顺序，不是状态，不会造成跨零点状态滞留。
- 断言（acceptance 21）：`today-overview.test.tsx`「a reminder done today leaves 接下来 and returns on the next day」用两个固定 `today` 渲染同一条记录，无 `vi.setSystemTime` 也能翻转。

**(1a) 新增测试钉住这次修正。**
`tests/renderer/project-page.test.tsx`「the reminders section reads the caller's today, never its own clock」：`vi.setSystemTime(2026-11-22)` 固定系统时钟，但给 `RemindersSection` 传 `today="2026-11-23"`，一条 `doneAt: '2026-11-22'` 的提醒必须显示「待触发」且没有「重新启用」按钮；同时 `snoozedUntil="2026-11-23"` 必须显示「今天已静音，明天恢复」（静音文案同样取传入值）。我已实测其反证力：把 `ProjectSections.tsx` 临时改回本地时钟后，该测试立刻失败于 `getByText('待触发')`（渲染出的是「已完成」），恢复后通过——这正是评审基准第 1 条要防的退化。

**(2) 投递成功后 `markFired` 清 `doneAt`。**
`scheduler.ts:348-356` 的 patch 现为 `{state:'fired', firedAt, postponedTo:null, doneAt:null, lastError:null}`；`scheduler-reminders.test.ts:320`「delivery records fired with a timestamp」的精确 patch 断言已同步包含 `doneAt: null`，另有「…resumes the next day」断言投递后 `record` 无 `doneAt`。

**(3) P2“只说一次”没有沿用 iter23 的子串判断（见偏差 A）。**
判据由代码结构保证：这句话从不进入模型提示词，只在模板/模型产物之后确定性追加；跨检查的唯一性由“消息落库成功后才 `consumeResume()`”保证。因此不存在“模型换个说法导致漏加”或“模型复述导致重复”的可能——不需要对模型文本做任何匹配。

**(4) 无 `doneAt` 的旧数据保持静默（acceptance 19）。**
`effectiveReminderState` 用 `!isTargetDate(reminder.doneAt) → 'done'`，即缺 `doneAt` 的 `done` 永远读作 `done`；`scheduler-reminders.test.ts`「a legacy done reminder without doneAt stays quiet forever」连跑三天三 tick 均不投递、不写；`reminders-records.test.ts` 断言旧文件再序列化逐字节不变。这两条测试分别钉住 acceptance 19（静默与字节）与 acceptance 21（`TodayOverview` 的次日恢复，见 (1) 的测试名）。

---

## 门禁真实输出（逐字）

以下为**第二轮修正提交**（`RemindersSection` 改收 `today` prop）上的重跑结果；
上一版 `749f9c4` 的输出见本节末尾的存档块，两者差别仅是新测试的计数。

**`npm run typecheck`**
```
> study-coach@1.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
```
（无错误输出，退出码 0）

**`npm run typecheck:e2e`**
```
> study-coach@1.1.0 typecheck:e2e
> tsc --noEmit -p e2e/tsconfig.json
```
（无错误输出，退出码 0）

**`npx vitest run --maxWorkers=4`**
```
 RUN  v5.0.5 C:/Users/34191/orca/workspaces/sc/iter30-commitments

 Test Files  198 passed (198)
      Tests  1954 passed | 2 skipped (1956)
   Start at  17:21:00
   Duration  69.17s (tests 62%, environment 18%, setup 8%, import 7%, transform 4%, worker 1%)
```

**`npm run build`**
```
out/renderer/assets/review-UuUu9mf_.js             40.19 kB
out/renderer/assets/plan-CEtKchPg.js               61.38 kB
out/renderer/assets/settings-BxsW-7Iw.js           74.79 kB
out/renderer/assets/knowledge-BcjkiER8.js         155.80 kB
out/renderer/assets/index-8CPXnTdi.js             438.79 kB
out/renderer/assets/react-dom-BOxPwYkh.js         530.47 kB

✓ built in 242ms
```

**`npm run test:e2e`（完整 tail，含 `18 passed`）**
```
Running 18 tests using 1 worker
  ok  1 e2e\desktop.spec.ts:13:7 › ASAKI desktop › conversation-first project creation and persistence (4.6s)
  ok  2 e2eeature-smoke.spec.ts:14:7 › ASAKI feature smoke › all pages render and reminders, memories, reviews and topics persist (2.9s)
  ok  3 e2e\iter30-commitments.spec.ts:77:7 › visible commitments (iter30 P0) › lists open promises, resurfaces an overdue one, and reschedules it on disk (1.4s)
  ok  4 e2e\iter30-commitments.spec.ts:130:7 › visible commitments (iter30 P0) › 放下 removes the promise from the default list and records it as dropped (1.5s)
  ok  5 e2e\iter30-commitments.spec.ts:176:7 › week availability (iter30 P1) › shows this week's packed days and clears only that week on disk (1.4s)
  ok  6 e2e\qa-learning-flows.spec.ts:184:7 › learning-science flows › 简答题: reveal, 没答对, mistake book and exported review sheet (1.6s)
  ok  7 e2e\qa-learning-flows.spec.ts:258:7 › learning-science flows › 把握度校准: a confidently wrong answer is counted, an unmarked one is not (1.8s)
  ok  8 e2e\qa-learning-flows.spec.ts:341:7 › learning-science flows › 触发线索: 今日 renders the if-then line and it disappears when the cue is cleared (2.0s)
  ok  9 e2e\qa-learning-flows.spec.ts:398:7 › learning-science flows › 交错混练: two sets alternate, state resets, mistakes land on the real sets (1.9s)
  ok 10 e2e\qa-learning-flows.spec.ts:523:7 › learning-science flows › 掌握门控: phase two stays locked until every earlier check is ticked (1.5s)
  ok 11 e2e\qa-learning-surfaces.spec.ts:349:7 › learning surfaces (heatmap, accuracy trend, mistake sheet, countdown) › 复盘 shows the study heatmap and the 8-week accuracy trend without horizontal overflow (1.3s)
  ok 12 e2e\qa-learning-surfaces.spec.ts:398:7 › learning surfaces (heatmap, accuracy trend, mistake sheet, countdown) › 错题本 exports a review sheet under practice/review-sheets/ (1.5s)
  ok 13 e2e\qa-learning-surfaces.spec.ts:440:7 › learning surfaces (heatmap, accuracy trend, mistake sheet, countdown) › 今日 and 长期计划 count down to the project target date (1.4s)
  ok 14 e2e\qa-profile-and-strict.spec.ts:328:7 › 我的资料 and 更严的掌握判定 › 我的资料: add a fact, show a model guess as 待确认, persist across restart (2.8s)
  ok 15 e2e\qa-profile-and-strict.spec.ts:393:7 › 我的资料 and 更严的掌握判定 › 更严掌握判定: choice stays active under strict, short resolves, off persists after restart (4.3s)
  ok 16 e2e\qa-reminder-row.spec.ts:16:7 › reminder row layout (runtime QA guard) › keeps the reminder text readable at the default window size (2.7s)
  ok 17 e2eiewport-layout.spec.ts:165:9 › ASAKI viewport layout (P3) › conversation home lays out at 1366x768 (1.7s)
  ok 18 e2eiewport-layout.spec.ts:165:9 › ASAKI viewport layout (P3) › conversation home lays out at 1440x900 (1.7s)

  18 passed (38.8s)
```

以上五条门禁全部由我在本 worktree 中亲自运行，数字取自实际输出。

**第一轮（`749f9c4`，修正前）存档**：vitest `Test Files 198 passed (198)` / `Tests 1953 passed | 2 skipped (1955)` / `Duration 86.20s`；build `✓ built in 249ms`（`index-D2K3XtrK.js 438.83 kB`）；e2e `18 passed (45.4s)`；两个 typecheck 同样退出码 0。

---

## 评审修复（第三轮，评审 sha `e57a4f6`）

评审结论「有阻塞项」，只修这两条，其它明令不动（P3 `Date.parse` 坑、P2 提前手动恢复语义均留给 item 39 的 M1/M2，同批不拆）。

### 阻断项 1：DND 会把「昨日已完成」改写为 pending 并留下脏 `doneAt`

**问题**：P4 只把跳过判定换成 `effectiveReminderState`（`scheduler.ts:185`），而 trigger 仍携带原始 `reminderState(reminder)`，DND 分支据此决定是否写回 `pending`。同一条“次日恢复”规则出现第二处实现、用的是旧语义。

**修法（选“trigger 不再携带原始 state”）**：`Trigger` 的 `reminderState?: ReminderState` 改为 `effectiveState?: ReminderState`（`src/main/scheduler/scheduler.ts:119`），在循环里只算一次：

```ts
const effectiveState = effectiveReminderState(reminder, date);   // :196
if (effectiveState === 'done') continue;                          // :197
```

两处 `triggers.push` 都改用 `effectiveState`（`:216`、`:233`），DND 分支的判定读 `trigger.effectiveState`（`:451-452`）。同时删掉已无用的 `reminderState` import。

**为什么选这一种**：评审给了两个选项（分支内再调一次 `effectiveReminderState`，或 trigger 不携带原始 state）。选后者是因为它在结构上排除了复发——没有地方再能拿到原始 `reminder.state` 去做 DND 判断，而“再调一次”仍留了一个“有人以后又去读原始 state”的入口。判定仍**只在 `effectiveReminderState` 一处**，scheduler 里没有任何日期比较。

**新测试**：`tests/main/scheduler-reminders.test.ts`「DND never rewrites a reminder finished yesterday back to pending」——`state: done, doneAt: '2026-10-30'`，12:00 的每日提醒在 23:31（DND 23:00–07:00）tick，断言：进入 `suppressed` 且 `reason: 'dnd'`；`store.writes` 严格等于 `[]`（无任何 lifecycle 写）；`state` 仍 `done`；`doneAt` 仍 `2026-10-30`。反证已实测：把 push 改回 `reminder.state ?? 'pending'` 后该测试红于 `expect(store.writes).toEqual([])`。

### 阻断项 2：改期「不早于今天」收口到服务层

**语义边界下沉**：`src/main/commitments/service.ts:204-212`，在 `resolve` 里、拿到 `wanted` 之后：

```ts
if (wanted !== undefined && wanted < addLocalDays(now(), 0)) {
  throw new Error('改期日期不能早于今天。');
}
```

`now` 是服务构造时注入的时钟——`context.ts:370` 传的就是 main 侧既有的 `now`（与 `today()` 同源），**没有引入新时钟**，也没让 IPC 层知道“今天”。用 `addLocalDays(now(), 0)` 而非 `formatLocalDate`，是为了和本文件已有的日期算术保持同一条路径（本地日历日，不受 UTC 偏移影响）。

**渲染层删拦截**：`src/renderer/shell/ProjectSections.tsx:1704-1720` 的 `saveReschedule` 去掉了 `if (due < today)` 分支；只保留格式校验与“不超 365 天”的 UX 上限（`:1715`）。日期选择器的 `min={today}` 仍在，属控件层面的引导。

**IPC 保留格式校验、文案透传**：`requireResolveCommitmentEntry`（`ipc.ts:838-844`）只校验 `YYYY-MM-DD`；`改期日期不能早于今天。` 由服务层抛出，经 `serializeError` 原样透传（`friendlyErrorMessage` 不去改文案），**两层只有一份文案**。

**web mock 对齐**：`web/mock-api.ts:2404-2406` 的 `resolveCommitmentEntry` 补上同一句、同一语义，让原型模式与真实 vault 行为一致（否则浏览器里能改到过去、Electron 里不能）。

**测试**：
- 服务层「resolve refuses to move a promise into the past, change or not」：`newDue` 为昨天、为更早、以及**保持原 `due` 不变**（`newDue === overdue.due`）三种都抛 `改期日期不能早于今天。`，且 `service.list()` 与改期前逐字段相同（无半写）；今天本身允许（闭区间）；`outcome` 结案不受影响。
- 非界面路径「a past reschedule is refused through the real IPC channel, not just the UI」：直接 `createIpcHandlers(context.api)` 后调 `handlers.resolveCommitmentEntry`，绕开渲染层，传过去日期被拒、文件未被改写；今天则成功。反证已实测：注释掉服务层那三行后，这两条（服务层 + IPC）同时变红。
- 渲染层原有「refuses a past date」改写为「defers the past-date rule to the service」：现在断言**调用会发出**、服务层的句子显示在页面上、编辑器保持打开，365 天上限仍在本地拦截且不发出调用。

### 明确未动（按评审要求）

- P3 `due` 校验的 `Date.parse` 坑（`ipc.ts` 里 `Number.isNaN(Date.parse(due))`，`2026-02-30` 不是 NaN）——留给 item 39 的 M1，与 `isTargetDate` 复用一起改。
- P2 提前手动恢复语义（`context.ts` 的 `peekResume` 要求 `resumedFrom <= 今天`，手动恢复写未来日期）——留给 M1/M2。
- `tests/renderer/project-editing.test.tsx` 的「非法值→空→保存为 null」回归测试未删。

### 本轮门禁（真实输出，HEAD 见提交）

**`npm run typecheck`**
```
> study-coach@1.1.0 typecheck
> tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json
```
（无错误输出，退出码 0）

**`npm run typecheck:e2e`**
```
> study-coach@1.1.0 typecheck:e2e
> tsc --noEmit -p e2e/tsconfig.json
```
（无错误输出，退出码 0）

**`npx vitest run --maxWorkers=4`**
```
 Test Files  198 passed (198)
      Tests  1957 passed | 2 skipped (1959)
   Start at  17:54:09
   Duration  64.60s (tests 60%, environment 20%, setup 9%, import 7%, transform 2%, worker 1%)
```

**`npm run build`**
```
out/renderer/assets/settings-BxsW-7Iw.js           74.79 kB
out/renderer/assets/knowledge-BcjkiER8.js         155.80 kB
out/renderer/assets/index-CEGBThaf.js             438.71 kB
out/renderer/assets/react-dom-BOxPwYkh.js         530.47 kB

✓ built in 250ms
```

**`npm run test:e2e`（完整 tail，含 `18 passed`）**
```
Running 18 tests using 1 worker
  ok  1 e2e\desktop.spec.ts:13:7 › ASAKI desktop › conversation-first project creation and persistence (4.7s)
  ok  2 e2e\feature-smoke.spec.ts:14:7 › ASAKI feature smoke › all pages render and reminders, memories, reviews and topics persist (3.7s)
  ok  3 e2e\iter30-commitments.spec.ts:77:7 › visible commitments (iter30 P0) › lists open promises, resurfaces an overdue one, and reschedules it on disk (1.7s)
  ok  4 e2e\iter30-commitments.spec.ts:130:7 › visible commitments (iter30 P0) › 放下 removes the promise from the default list and records it as dropped (1.7s)
  ok  5 e2e\iter30-commitments.spec.ts:176:7 › week availability (iter30 P1) › shows this week's packed days and clears only that week on disk (1.7s)
  ok  6 e2e\qa-learning-flows.spec.ts:184:7 › learning-science flows › 简答题: reveal, 没答对, mistake book and exported review sheet (2.0s)
  ok  7 e2e\qa-learning-flows.spec.ts:258:7 › learning-science flows › 把握度校准: a confidently wrong answer is counted, an unmarked one is not (2.2s)
  ok  8 e2e\qa-learning-flows.spec.ts:341:7 › learning-science flows › 触发线索: 今日 renders the if-then line and it disappears when the cue is cleared (2.1s)
  ok  9 e2e\qa-learning-flows.spec.ts:398:7 › learning-science flows › 交错混练: two sets alternate, state resets, mistakes land on the real sets (2.2s)
  ok 10 e2e\qa-learning-flows.spec.ts:523:7 › learning-science flows › 掌握门控: phase two stays locked until every earlier check is ticked (1.9s)
  ok 11 e2e\qa-learning-surfaces.spec.ts:349:7 › learning surfaces (heatmap, accuracy trend, mistake sheet, countdown) › 复盘 shows the study heatmap and the 8-week accuracy trend without horizontal overflow (1.7s)
  ok 12 e2e\qa-learning-surfaces.spec.ts:398:7 › learning surfaces (heatmap, accuracy trend, mistake sheet, countdown) › 错题本 exports a review sheet under practice/review-sheets/ (1.9s)
  ok 13 e2e\qa-learning-surfaces.spec.ts:440:7 › learning surfaces (heatmap, accuracy trend, mistake sheet, countdown) › 今日 and 长期计划 count down to the project target date (1.8s)
  ok 14 e2e\qa-profile-and-strict.spec.ts:328:7 › 我的资料 and 更严的掌握判定 › 我的资料: add a fact, show a model guess as 待确认, persist across restart (3.2s)
  ok 15 e2e\qa-profile-and-strict.spec.ts:393:7 › 我的资料 and 更严的掌握判定 › 更严掌握判定: choice stays active under strict, short resolves, off persists after restart (4.3s)
  ok 16 e2e\qa-reminder-row.spec.ts:16:7 › reminder row layout (runtime QA guard) › keeps the reminder text readable at the default window size (2.7s)
  ok 17 e2e\viewport-layout.spec.ts:165:9 › ASAKI viewport layout (P3) › conversation home lays out at 1366x768 (1.7s)
  ok 18 e2e\viewport-layout.spec.ts:165:9 › ASAKI viewport layout (P3) › conversation home lays out at 1440x900 (1.8s)

  18 passed (43.8s)
```

---

## 有意的偏差（供评审）

**A. P2 的“只说一次”判据**：spec 界面段（`:105`）写的是“沿用 `promiseLine` 的‘模型没提就补上，提了就不重复’做法”。我**没有**在模型输出上做 `includes` 子串判断（评审基准 (3) 明确禁止），而是把这句话彻底排除在提示词之外、在两条路径的产物之后确定性追加。结果满足 spec 的行为要求（模板路径一条、模型路径一条、总共一次），实现方式与 spec 的具体措辞不同——这一处是对 spec 提示的**主动偏离**，理由见上。

**B. 承诺数据在渲染层只取一次**：`useWorkspaceData` 一次性 `listCommitments({includeResolved:true})`，由 `CommitmentsSection` 客户端过滤“显示已结束”，而不是切换开关时再请求。减少一次往返，且开关即时；`listPendingCommitments`（通知中心）路径未动。

**C. 改期日期的边界校验分工**（**已按评审意见收口，见「评审修复」第 2 条**）：初版 IPC 只在 `requireResolveCommitmentEntry` 校验 `YYYY-MM-DD` 格式，“不早于今天 / 不超 365 天”只在渲染层 `saveReschedule`，于是非界面入口能把承诺改到过去。评审判定这是「同一语义两层各写一份」。现已把 `newDue >= 今天` 下沉到服务层 `commitments/service.ts` 作为唯一权威，渲染层删掉该拦截，只保留“不超 365 天”这条 UX 上限。

**D. acceptance 15 的 UI 层表述**：真实 `input[type=datetime-local]`（浏览器按规范）不接受 `昨天晚上` 这类非时间串，会自行清空，因此“客户端抛中文错误”在真实控件上不可达；验收的硬保证放在 IPC（`任务开始时间无效。`，createTask 从未被调用，不产生半写文件）。`project-editing.test.tsx` 另有一条测试记录该控件的真实行为（非法值→空→保存为 null）。

---

## 测试文件清单（新增/改写）

- 新增：`tests/main/reminders-records.test.ts`、`tests/renderer/reminders-commitments.test.tsx`、`tests/renderer/week-availability-panel.test.tsx`、`e2e/iter30-commitments.spec.ts`
- 扩展：`tests/main/commitments.test.ts`、`availability.test.ts`、`settings-service.test.ts`、`ipc-preload.test.ts`、`ipc-handlers.test.ts`、`butler-prompt.test.ts`、`check-in-prompt.test.ts`、`proactive-check-in.test.ts`、`integration-context.test.ts`、`butler-tools.test.ts`（stub 补 `listSummaries`）、`butler-week-availability.test.ts`（stub 补 `clear`）；`tests/renderer/project-editing.test.tsx`、`schedule-page.test.tsx`、`today-overview.test.tsx`
- 改写：`tests/main/scheduler-reminders.test.ts`、`tests/renderer/project-page.test.tsx`（见上）
- 第三轮（评审修复）：`tests/main/scheduler-reminders.test.ts` 加「DND never rewrites a reminder finished yesterday back to pending」；`tests/main/commitments.test.ts` 加「resolve refuses to move a promise into the past, change or not」；`tests/main/ipc-handlers.test.ts` 加「a past reschedule is refused through the real IPC channel, not just the UI」；`tests/renderer/reminders-commitments.test.tsx` 把过去日期的用例改写为 delegating 语义
