import { useMemo } from 'react';
import type { Workspace, WorkspaceTask } from '../../shared/workspace';
import { ChevronRightIcon } from '../ui/icons';
import { buildDailySchedule } from './schedule';

type TodayScheduleProps = {
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  today: string;
  onOpenSchedule: () => void;
};

/**
 * The day's time blocks on the 今日 page. It renders exactly what
 * `buildDailySchedule` produces for the 今日安排 page — same helper, same
 * inputs — so the two views cannot drift; this region only omits the drag
 * handles and completion toggles of the full page.
 */
export function TodaySchedule({ tasks, workspaces, today, onOpenSchedule }: TodayScheduleProps) {
  const { entries, unscheduled } = useMemo(
    () => buildDailySchedule(tasks, workspaces, 8, new Date(`${today}T00:00:00`)),
    [tasks, workspaces, today]
  );

  return (
    <section
      aria-label="今日时间表"
      className="rounded-2xl border border-black/[0.06] bg-white p-4 dark:border-white/10 dark:bg-[#1c1c1e]"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold text-black dark:text-[#f5f5f7]">今日时间表</h2>
        <button
          type="button"
          onClick={onOpenSchedule}
          className="flex items-center gap-0.5 text-[12px] text-[#0071e3] hover:underline"
        >
          今日安排
          <ChevronRightIcon className="h-3 w-3" />
        </button>
      </div>
      {entries.length === 0 ? (
        <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]">
          今天还没有安排。告诉阿咲你想推进什么，就会排出时间。
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-black/[0.06] dark:divide-white/10">
          {entries.map((entry) => {
            const done = entry.status === 'done';
            return (
              <li key={entry.id} className="flex items-start gap-2.5 py-2">
                <span className="w-10 shrink-0 pt-0.5 text-[12px] tabular-nums text-gray-400 dark:text-[#8e8e93]">
                  {entry.time}
                </span>
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-[13px] font-medium ${
                      done
                        ? 'text-gray-400 line-through dark:text-[#8e8e93]'
                        : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                    }`}
                  >
                    {entry.title}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-[#8e8e93]">
                    {entry.detail}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unscheduled > 0 ? (
        <p className="mt-2 text-[11px] text-gray-400 dark:text-[#8e8e93]">
          还有 {unscheduled} 个任务未排入，完整列表见今日安排。
        </p>
      ) : null}
    </section>
  );
}
