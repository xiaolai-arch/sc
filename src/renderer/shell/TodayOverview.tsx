import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import { quizOffer, type QuizOffer } from '../../main/practice/quiz-offer';
import type { KnowledgeTopic } from '../../shared/knowledge';
import type { PracticeAttempt, PracticeMistake } from '../../shared/practice';
import { planProgress } from '../../shared/plans';
import type { LongPlan } from '../../shared/plans';
import type { Reminder, Workspace, WorkspaceTask } from '../../shared/workspace';
import { daysUntilTarget, effectiveReminderState, reminderState, targetCountdownLabel } from '../../shared/workspace';
import { accuracyTrend } from './accuracy-trend';
import { ChevronRightIcon, CheckIcon, SendIcon } from '../ui/icons';
import { PageFrame } from './PageFrame';
import { nextScheduledDay } from './schedule';
import { TodaySchedule } from './TodaySchedule';

/** One knowledge topic that is due for a retrieval today. */
export type TodayRevisit = {
  topicId: string;
  name: string;
};

/**
 * The opt-in "今日只做一件" preference: the mode, the local day the choice
 * belongs to, and the chosen task. A new local day keeps `enabled` and forgets
 * `taskId`, so the mode survives a restart and the choice does not.
 */
export type OneThingPreference = {
  enabled: boolean;
  /** Local day (YYYY-MM-DD) the stored choice belongs to. */
  date: string;
  taskId: string | null;
};

/**
 * Where the preference lives. The shell passes the localStorage-backed store
 * from Workspace.tsx (the same lightweight-prefs store as the quiz-offer
 * cooldown); tests and the compact card may leave it out, in which case the
 * mode still works for this render but is forgotten on unmount.
 */
export type OneThingStore = {
  load: () => OneThingPreference | null;
  save: (preference: OneThingPreference) => void;
};

export type TodayOverviewProps = {
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  reminders: Reminder[];
  longPlans: LongPlan[];
  today: string;
  /** Topics whose revisit day (revisitDue) is today or earlier. */
  revisits?: TodayRevisit[];
  /** Proactive practice offer from the data itself, or null when silent. */
  quizOffer?: QuizOffer | null;
  /** Compact form sits inside the chat home; the page form has its own frame. */
  compact?: boolean;
  /** Persistence for 今日只做一件; only the page form offers the mode. */
  oneThingStore?: OneThingStore;
  onOpenSidebar?: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onOpenSchedule: () => void;
  onOpenPlan: () => void;
  onOpenReminders: () => void;
  onToggleTask: (task: WorkspaceTask) => void;
  onPrompt: (prompt: string) => void;
};

function workspaceName(workspaces: Workspace[], id: string): string {
  return workspaces.find((workspace) => workspace.id === id)?.name ?? '未分组';
}

/**
 * The target date the Today page counts down to: the soonest deadline still
 * ahead, or the most recent one once every deadline has passed. Projects
 * without a target date are ignored, so nothing renders when none is set.
 */
export function countdownWorkspace(
  workspaces: Workspace[],
  today: string
): Workspace | null {
  const dated = workspaces
    .map((workspace) => ({
      workspace,
      days: workspace.targetDate ? daysUntilTarget(workspace.targetDate, today) : null
    }))
    .filter(
      (entry): entry is { workspace: Workspace; days: number } => entry.days !== null
    );
  if (dated.length === 0) return null;
  const upcoming = dated.filter((entry) => entry.days >= 0);
  const pool = upcoming.length > 0 ? upcoming : dated;
  pool.sort((a, b) => (upcoming.length > 0 ? a.days - b.days : b.days - a.days));
  return pool[0]?.workspace ?? null;
}

/** The old quick-ask button, kept as a suggestion that fills the input. */
const TODAY_SUGGESTION = '帮我看今天最重要的三件事，并给出具体下一步。';

function timeOf(startAt: string | undefined): string | null {
  const match = /T(\d{2}:\d{2})/.exec(startAt ?? '');
  return match?.[1] ?? null;
}

/** Up to three things that deserve the next free hour. */
export function nextTasks(tasks: WorkspaceTask[], today: string): WorkspaceTask[] {
  return tasks
    .filter((task) => task.status === 'pending' || task.status === 'in-progress')
    .filter((task) => task.startAt === undefined || task.startAt.startsWith(today))
    .sort((a, b) => {
      const rank = (task: WorkspaceTask): number =>
        task.status === 'in-progress' ? 0 : task.startAt ? 1 : 2;
      return (
        rank(a) - rank(b) ||
        (a.startAt ?? '9999').localeCompare(b.startAt ?? '9999') ||
        (a.due ?? '9999').localeCompare(b.due ?? '9999')
      );
    })
    .slice(0, 3);
}

/**
 * Topics whose revisit day has come (revisitDue today or earlier, so an
 * overdue revisit never disappears), oldest due date first.
 */
export function dueRevisitTopics(
  topics: KnowledgeTopic[],
  today: string
): TodayRevisit[] {
  return topics
    .filter((topic) => topic.revisitDue !== undefined && topic.revisitDue <= today)
    .sort((a, b) => (a.revisitDue ?? '').localeCompare(b.revisitDue ?? ''))
    .map((topic) => ({ topicId: topic.id, name: topic.name }));
}

/**
 * The proactive quiz offer, from the practice data the shell already holds:
 * the 8-week accuracy window comes from the same aggregation the 复盘 trend
 * uses, and `lastOfferDate` is the stored date the offer last showed (null
 * when never). Pure, so the today page and its tests both call this directly;
 * the decision rules live in `src/main/practice/quiz-offer.ts`.
 */
export function todayQuizOffer(
  attempts: readonly PracticeAttempt[],
  mistakes: readonly PracticeMistake[],
  today: string,
  lastOfferDate: string | null
): QuizOffer | null {
  const totals = accuracyTrend(attempts, new Date(`${today}T00:00:00`)).totals;
  const daysSinceLastOffer =
    lastOfferDate === null
      ? null
      : Math.round(
          (parseLocalDate(today).getTime() - parseLocalDate(lastOfferDate).getTime()) /
            86_400_000
        );
  return quizOffer({
    today,
    mistakes,
    recentAccuracy: totals.accuracy === null ? null : Math.round(totals.accuracy * 100),
    recentAnswered: totals.answered,
    daysSinceLastOffer
  });
}

/** The time a reminder will actually fire: its postpone target when it has one. */
function reminderTime(reminder: Reminder): string {
  return reminderState(reminder) === 'postponed' && reminder.postponedTo
    ? reminder.postponedTo.slice(11, 16)
    : reminder.time;
}

function upcomingReminders(reminders: Reminder[], today: string): Reminder[] {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (time: string): number => {
    const [hour, minute] = time.split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  };
  return reminders
    // `done` means the user finished it, so it is no longer upcoming — but only
    // for the day it was finished. `today` is threaded in from the caller (the
    // shell's single clock), never recomputed here, so crossing midnight
    // restores the reminder on the next render.
    .filter((reminder) => reminder.enabled && effectiveReminderState(reminder, today) !== 'done')
    .sort((a, b) => {
      const aTime = reminderTime(a);
      const bTime = reminderTime(b);
      const aNext = toMinutes(aTime) >= minutes ? 0 : 1;
      const bNext = toMinutes(bTime) >= minutes ? 0 : 1;
      return aNext - bNext || toMinutes(aTime) - toMinutes(bTime);
    })
    .slice(0, 3);
}

/**
 * "What should I do next, and what is coming up?" — the first thing the
 * dashboard shows. It is pure presentation: completion and navigation are
 * callbacks so the same block can sit on the home page and the Today page.
 */
export function TodayOverview({
  tasks,
  workspaces,
  reminders,
  longPlans,
  today,
  revisits = [],
  quizOffer = null,
  compact = false,
  oneThingStore,
  onOpenSidebar,
  onOpenWorkspace,
  onOpenSchedule,
  onOpenPlan,
  onOpenReminders,
  onToggleTask,
  onPrompt
}: TodayOverviewProps) {
  const priorities = useMemo(() => nextTasks(tasks, today), [tasks, today]);
  const upcomingDay = useMemo(
    () =>
      priorities.length === 0
        ? nextScheduledDay(tasks, workspaces, new Date(`${today}T00:00:00`))
        : null,
    [priorities, tasks, workspaces, today]
  );
  const upcoming = useMemo(() => upcomingReminders(reminders, today), [reminders, today]);
  // recomputed from `today` on every render, never cached at plan time.
  // The countdown belongs to the Today page, not the compact chat-home card.
  const countdown = useMemo(() => {
    if (compact) return null;
    const workspace = countdownWorkspace(workspaces, today);
    if (!workspace) return null;
    const label = targetCountdownLabel(workspace.targetDate, today);
    if (!label) return null;
    // Name the project only when several deadlines compete for the line.
    const dated = workspaces.filter(
      (entry) => entry.targetDate && daysUntilTarget(entry.targetDate, today) !== null
    );
    return { label, name: dated.length > 1 ? workspace.name : null };
  }, [workspaces, today, compact]);
  const activePlans = useMemo(
    () =>
      longPlans
        .map((plan) => ({ plan, progress: planProgress(plan) }))
        .filter((entry) => entry.progress.percent < 100)
        .sort((a, b) => b.progress.percent - a.progress.percent)
        .slice(0, compact ? 1 : 3),
    [longPlans, compact]
  );
  // One-line ask draft; the window-level chat composer owns its own draft, so
  // this one never autofocuses on mount.
  const [askDraft, setAskDraft] = useState('');

  // 今日只做一件 is opt-in and purely local to the Today page: the shell
  // persists it (see OneThingStore), the compact chat-home card never offers
  // it. A stored choice from an earlier local day is forgotten on load; the
  // mode itself stays on.
  const oneThingOffered = !compact && oneThingStore !== undefined;
  // A store that fails or holds junk simply means "mode off"; the render and
  // the toggle still work, and nothing is written until the user acts.
  const [oneThing, setOneThing] = useState<OneThingPreference>(() => {
    const empty: OneThingPreference = { enabled: false, date: today, taskId: null };
    try {
      const stored = oneThingStore?.load() ?? null;
      if (!stored) return empty;
      // A new local day keeps the toggle and forgets the choice.
      return stored.date === today ? stored : { ...stored, date: today, taskId: null };
    } catch {
      return empty;
    }
  });
  const [oneThingExpanded, setOneThingExpanded] = useState(false);

  // The day can roll over while the window stays open. When it does, the
  // toggle stays on and the choice is dropped, matching a fresh mount.
  useEffect(() => {
    setOneThing((current) =>
      current.date === today ? current : { enabled: current.enabled, date: today, taskId: null }
    );
    setOneThingExpanded(false);
  }, [today]);

  function updateOneThing(next: OneThingPreference) {
    setOneThing(next);
    try {
      oneThingStore?.save(next);
    } catch {
      // Storage unavailable; the mode still holds for this render.
    }
  }

  function toggleOneThing() {
    const enabled = !oneThing.enabled;
    // Turning the mode off drops the choice; turning it on picks nothing yet.
    setOneThingExpanded(false);
    updateOneThing({ enabled, date: today, taskId: enabled ? oneThing.taskId : null });
  }

  function chooseOneThing(taskId: string) {
    setOneThingExpanded(false);
    updateOneThing({ enabled: true, date: today, taskId });
  }

  const chosenTask =
    oneThing.enabled && oneThing.taskId !== null
      ? tasks.find((task) => task.id === oneThing.taskId)
      : undefined;
  const chosenPriority =
    oneThing.enabled && oneThing.taskId !== null
      ? priorities.find((task) => task.id === oneThing.taskId) ?? null
      : null;
  // Only an actually-done task earns the honest prompt. A skipped or deleted
  // one simply stops folding, so nothing stays hidden behind a stale choice.
  const chosenCompleted = oneThing.enabled && chosenTask?.status === 'done';
  const foldActive =
    oneThingOffered && oneThing.enabled && (chosenPriority !== null || chosenCompleted);
  // Completing the chosen task takes it out of the next list; the rest of the
  // list then stays folded behind the same line, and the header gets honest.
  const folded = foldActive && !oneThingExpanded;
  const listFolded = folded && chosenPriority !== null;
  const shownTasks = listFolded ? [chosenPriority] : priorities;
  // When the chosen task is done, the rest stays folded behind the same line
  // until the user expands and picks again.
  const showList = !folded || chosenPriority !== null;
  const hiddenCount = foldActive
    ? chosenPriority !== null
      ? priorities.length - 1
      : priorities.length
    : 0;

  function submitAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = askDraft.trim();
    if (!text) return;
    setAskDraft('');
    onPrompt(text);
  }

  const body = (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
      {countdown ? (
        <p
          role="status"
          aria-label="目标倒计时"
          className="text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]"
        >
          {countdown.label}
          {countdown.name ? `（${countdown.name}）` : ''}
        </p>
      ) : null}
      <section
        aria-label="接下来"
        className="rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/10 dark:bg-[#1c1c1e]"
      >
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-black dark:text-[#f5f5f7]">
            接下来做什么
          </h2>
          <button
            type="button"
            onClick={onOpenSchedule}
            className="flex items-center gap-0.5 text-[12px] text-[#0071e3] hover:underline"
          >
            今日安排
            <ChevronRightIcon className="h-3 w-3" />
          </button>
        </div>
        {priorities.length === 0 ? (
          <p className="mt-2 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
            {upcomingDay
              ? `今天没有任务。下一份安排从${upcomingDay.label}开始，共 ${upcomingDay.entries.length} 个。`
              : '今天还没有任务。告诉阿咲你想推进什么，就能排出第一批。'}
          </p>
        ) : (
          <>
            {foldActive ? (
              <p className="mt-2 text-[11px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                {chosenCompleted ? '做完了。要不要再选一件？' : '今天只做这一件。做完再选下一件。'}
              </p>
            ) : null}
            {showList ? (
              <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/10">
                {shownTasks.map((task) => {
                  const start = timeOf(task.startAt);
                  const chosen = foldActive && task.id === oneThing.taskId;
                  return (
                  <li key={task.id} className="flex items-start gap-2.5 py-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={false}
                      aria-label={`完成任务：${task.title}`}
                      onClick={() => onToggleTask(task)}
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-gray-300 text-transparent transition-colors hover:border-[#0071e3] hover:text-[#0071e3] dark:border-white/30"
                    >
                      <CheckIcon className="h-2.5 w-2.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => onOpenWorkspace(task.workspaceId)}
                        className="block max-w-full truncate text-left text-[14px] font-medium text-[#1d1d1f] hover:text-[#0071e3] dark:text-[#f5f5f7] dark:hover:text-[#4da3ff]"
                      >
                        {task.title}
                      </button>
                      <p className="mt-0.5 text-[11px] text-gray-500 dark:text-[#8e8e93]">
                        {workspaceName(workspaces, task.workspaceId)}
                        {start ? ` · ${start} 开始` : ` · ${task.durationMin} 分钟`}
                        {task.due ? ` · 截止 ${task.due.slice(5)}` : ''}
                      </p>
                      {task.cue ? (
                        <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#8e8e93]">
                          如果 {task.cue}，就先做「{task.title}」
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5 pt-0.5 whitespace-nowrap text-[11px]">
                      {oneThingOffered && oneThing.enabled ? (
                        <button
                          type="button"
                          aria-pressed={chosen}
                          aria-label={`只做这件：${task.title}`}
                          onClick={() => chooseOneThing(task.id)}
                          className={`transition-colors ${
                            chosen
                              ? 'text-[#0071e3] dark:text-[#4da3ff]'
                              : 'text-gray-400 hover:text-[#0071e3] dark:text-[#6e6e73] dark:hover:text-[#4da3ff]'
                          }`}
                        >
                          {chosen ? '就做这件' : '只做这件'}
                        </button>
                      ) : null}
                      {/* Stuck on starting, not on knowing what to do: ask for one
                          smallest action instead of a plan. */}
                      <button
                        type="button"
                        aria-label={`我卡住了：${task.title}`}
                        onClick={() => onPrompt(`我卡住了：「${task.title}」`)}
                        className="text-gray-400 transition-colors hover:text-[#0071e3] dark:text-[#6e6e73] dark:hover:text-[#4da3ff]"
                      >
                        我卡住了
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            ) : null}
            {foldActive && hiddenCount > 0 ? (
              <button
                type="button"
                aria-expanded={oneThingExpanded}
                onClick={() => setOneThingExpanded(!oneThingExpanded)}
                className="mt-2 text-[11px] text-gray-400 transition-colors hover:text-[#0071e3] dark:text-[#8e8e93] dark:hover:text-[#4da3ff]"
              >
                {oneThingExpanded ? '收起' : `还有 ${hiddenCount} 件（展开）`}
              </button>
            ) : null}
          </>
        )}
        {revisits.length > 0 ? (
          <ul className="mt-2 space-y-1 border-t border-black/[0.06] pt-2 dark:border-white/10">
            {revisits.map((revisit) => (
              <li
                key={revisit.topicId}
                className="flex items-center justify-between gap-2"
              >
                <span
                  className="min-w-0 truncate text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]"
                  aria-label={`${revisit.name} 回访日`}
                >
                  今天是「{revisit.name}」的回访日：让阿咲抽 3 道？
                </span>
                <button
                  type="button"
                  aria-label={`抽 3 道复习「${revisit.name}」`}
                  onClick={() => onPrompt(`考考我「${revisit.name}」，出 3 道题`)}
                  className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-[#0071e3] transition-colors hover:bg-[#0071e3]/10 dark:bg-white/[0.08] dark:text-[#4da3ff] dark:hover:bg-[#4da3ff]/15"
                >
                  抽 3 道
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {quizOffer ? (
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-black/[0.06] pt-2 dark:border-white/10">
            <span className="min-w-0 truncate text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
              {quizOffer.text}
            </span>
            <button
              type="button"
              onClick={() => onPrompt('考考我，出 3 道题')}
              className="shrink-0 rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] font-medium text-[#0071e3] transition-colors hover:bg-[#0071e3]/10 dark:bg-white/[0.08] dark:text-[#4da3ff] dark:hover:bg-[#4da3ff]/15"
            >
              开始 3 道
            </button>
          </div>
        ) : null}
      </section>

      {!compact ? (
        <TodaySchedule
          tasks={tasks}
          workspaces={workspaces}
          today={today}
          onOpenSchedule={onOpenSchedule}
        />
      ) : null}

      <div className={compact ? 'grid gap-4' : 'grid gap-6 md:grid-cols-2'}>
        <section
          aria-label="最近提醒"
          className="rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/10 dark:bg-[#1c1c1e]"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-black dark:text-[#f5f5f7]">最近提醒</h2>
            <button
              type="button"
              onClick={onOpenReminders}
              className="flex items-center gap-0.5 text-[12px] text-[#0071e3] hover:underline"
            >
              全部
              <ChevronRightIcon className="h-3 w-3" />
            </button>
          </div>
          {upcoming.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]">
              还没有开启的提醒。
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {upcoming.map((reminder) => (
                <li
                  key={reminder.id}
                  className="flex items-baseline justify-between gap-2 text-[12px]"
                >
                  <span className="min-w-0 truncate text-gray-700 dark:text-[#c7c7cc]">
                    {reminder.label}
                  </span>
                  <span className="shrink-0 tabular-nums text-gray-400 dark:text-[#8e8e93]">
                    {reminderTime(reminder)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section
          aria-label="目标进度"
          className="rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/10 dark:bg-[#1c1c1e]"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[13px] font-semibold text-black dark:text-[#f5f5f7]">目标进度</h2>
            <button
              type="button"
              onClick={onOpenPlan}
              className="flex items-center gap-0.5 text-[12px] text-[#0071e3] hover:underline"
            >
              长期计划
              <ChevronRightIcon className="h-3 w-3" />
            </button>
          </div>
          {activePlans.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]">
              还没有进行中的长期目标。
            </p>
          ) : (
            <ul className="mt-2 space-y-2.5">
              {activePlans.map(({ plan, progress }) => (
                <li key={plan.id}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 truncate text-[12px] text-gray-700 dark:text-[#c7c7cc]">
                      {plan.goal}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-gray-400 dark:text-[#8e8e93]">
                      {progress.percent}%
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`${plan.goal} 进度`}
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/10"
                  >
                    <div
                      className="h-full rounded-full bg-[#0071e3] dark:bg-[#0a84ff]"
                      style={{ width: `${progress.percent}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!compact ? (
        <form
          onSubmit={submitAsk}
          className="rounded-2xl border border-black/[0.06] bg-white p-3 shadow-sm dark:border-white/10 dark:bg-[#1c1c1e]"
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={askDraft}
              onChange={(event) => setAskDraft(event.target.value)}
              placeholder="问阿咲今天怎么安排…"
              aria-label="问阿咲今天怎么安排"
              className="min-w-0 flex-1 bg-transparent py-1 text-[14px] text-[#1d1d1f] outline-none placeholder:text-gray-400 dark:text-[#f5f5f7] dark:placeholder:text-[#6e6e73]"
            />
            <button
              type="submit"
              aria-label="发送"
              disabled={!askDraft.trim()}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              <SendIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setAskDraft(TODAY_SUGGESTION)}
              className="rounded-full bg-black/[0.05] px-2.5 py-1 text-[11px] text-gray-600 transition-colors hover:bg-black/[0.08] dark:bg-white/[0.08] dark:text-[#c7c7cc] dark:hover:bg-white/[0.12]"
            >
              今天最重要的三件事
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );

  if (compact) return body;
  return (
    <PageFrame
      title="今日"
      subtitle={formatLocalDate(new Date())}
      onOpenSidebar={onOpenSidebar}
      action={
        oneThingOffered ? (
          <button
            type="button"
            role="switch"
            aria-checked={oneThing.enabled}
            aria-label="今日只做一件"
            onClick={toggleOneThing}
            className="flex items-center gap-1.5 text-[12px] text-gray-500 transition-colors hover:text-[#0071e3] dark:text-[#8e8e93] dark:hover:text-[#4da3ff]"
          >
            今日只做一件
            <span
              aria-hidden="true"
              className={`relative h-4 w-7 rounded-full transition-colors ${
                oneThing.enabled
                  ? 'bg-[#0071e3] dark:bg-[#0a84ff]'
                  : 'bg-gray-300 dark:bg-white/20'
              }`}
            >
              <span
                className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform motion-reduce:transition-none ${
                  oneThing.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        ) : undefined
      }
    >
      <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
        不用先想清楚全部，只需要知道现在最值得做的一件事。
      </p>
      <div className="mt-5">{body}</div>
    </PageFrame>
  );
}
