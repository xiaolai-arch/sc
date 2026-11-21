import { useMemo, useState, type FormEvent } from 'react';
import { formatLocalDate } from '../../shared/date';
import { planProgress } from '../../shared/plans';
import type { LongPlan } from '../../shared/plans';
import type { Reminder, Workspace, WorkspaceTask } from '../../shared/workspace';
import { ChevronRightIcon, CheckIcon, SendIcon } from '../ui/icons';
import { PageFrame } from './PageFrame';
import { nextScheduledDay } from './schedule';
import { TodaySchedule } from './TodaySchedule';

export type TodayOverviewProps = {
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  reminders: Reminder[];
  longPlans: LongPlan[];
  today: string;
  /** Compact form sits inside the chat home; the page form has its own frame. */
  compact?: boolean;
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

function upcomingReminders(reminders: Reminder[]): Reminder[] {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (time: string): number => {
    const [hour, minute] = time.split(':').map(Number);
    return (hour ?? 0) * 60 + (minute ?? 0);
  };
  return reminders
    .filter((reminder) => reminder.enabled)
    .sort((a, b) => {
      const aNext = toMinutes(a.time) >= minutes ? 0 : 1;
      const bNext = toMinutes(b.time) >= minutes ? 0 : 1;
      return aNext - bNext || toMinutes(a.time) - toMinutes(b.time);
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
  compact = false,
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
  const upcoming = useMemo(() => upcomingReminders(reminders), [reminders]);
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

  function submitAsk(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = askDraft.trim();
    if (!text) return;
    setAskDraft('');
    onPrompt(text);
  }

  const body = (
    <div className={compact ? 'space-y-4' : 'space-y-6'}>
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
          <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/10">
            {priorities.map((task) => {
              const start = timeOf(task.startAt);
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
                </div>
              </li>
              );
            })}
          </ul>
        )}
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
                    {reminder.time}
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
    <PageFrame title="今日" subtitle={formatLocalDate(new Date())} onOpenSidebar={onOpenSidebar}>
      <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
        不用先想清楚全部，只需要知道现在最值得做的一件事。
      </p>
      <div className="mt-5">{body}</div>
    </PageFrame>
  );
}
