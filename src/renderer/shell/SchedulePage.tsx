import type { Workspace, WorkspaceTask } from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { buildDailySchedule } from './schedule';

type SchedulePageProps = {
  dateLabel: string;
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  onOpenSidebar: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onPrompt: (prompt: string) => void;
};

const ADJUST_PROMPT =
  '帮我调整今天的安排：结合各工作区的待办、优先级和预计时长，重新排一份具体时间表。';

export function SchedulePage({
  dateLabel,
  tasks,
  workspaces,
  onOpenSidebar,
  onOpenWorkspace,
  onPrompt
}: SchedulePageProps) {
  const { entries, unscheduled } = buildDailySchedule(tasks, workspaces);
  const sourceCounts = new Map<string, number>();
  for (const entry of entries) {
    sourceCounts.set(entry.tag, (sourceCounts.get(entry.tag) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .map(([tag, count]) => `${tag} ${count}`)
    .join(' · ');

  return (
    <PageFrame
      title="今日安排"
      subtitle={dateLabel}
      onOpenSidebar={onOpenSidebar}
      action={
        <button
          type="button"
          onClick={() => onPrompt(ADJUST_PROMPT)}
          className="rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
        >
          让阿咲调整
        </button>
      }
    >
      <div className="mx-auto w-full max-w-[720px]">
        <div className="mb-6 text-center">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
            今天的时间表
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            {entries.length > 0
              ? '阿咲按各工作区的待办和预计时长顺排，可以随时让他调整。'
              : '阿咲还没有排今天的任务。'}
          </p>
        </div>

        <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1c1c1e] md:p-8">
          {entries.length > 0 ? (
            <div className="flex items-center justify-end">
              <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">阿咲排的</span>
            </div>
          ) : null}

          {entries.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                今天还没有安排
              </p>
              <p className="mx-auto mt-2 max-w-[320px] text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                告诉阿咲今天想推进什么，他会结合工作区里的任务排出顺序。
              </p>
              <button
                type="button"
                onClick={() => onPrompt(ADJUST_PROMPT)}
                className="mt-5 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
              >
                让阿咲安排
              </button>
            </div>
          ) : (
            <ol className="mt-3 divide-y divide-gray-100 dark:divide-white/[0.08]">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 py-3.5">
                  <span className="w-11 shrink-0 pt-0.5 text-right text-[12px] tabular-nums text-gray-400 dark:text-[#8e8e93]">
                    {entry.time}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full ${
                      entry.status === 'in-progress' ? 'bg-[#0071e3]' : 'bg-gray-300 dark:bg-white/30'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpenWorkspace(entry.workspaceId)}
                        className="max-w-full truncate text-left text-[14px] font-medium text-[#1d1d1f] transition-colors duration-200 hover:text-[#0071e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#f5f5f7] dark:hover:text-[#4da3ff]"
                      >
                        {entry.title}
                      </button>
                      <span className="shrink-0 rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
                        {entry.tag}
                      </span>
                      {entry.status === 'in-progress' ? (
                        <span className="shrink-0 rounded-full bg-[#0071e3]/10 px-2 py-0.5 text-[11px] text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]">
                          进行中
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                      {entry.detail}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          {entries.length > 0 ? (
            <p className="mt-3 text-[11px] text-gray-400 dark:text-[#8e8e93]">
              来源：{sources}
              {unscheduled > 0 ? ` · 还有 ${unscheduled} 个任务未排入` : ''}
            </p>
          ) : null}
        </section>
      </div>
    </PageFrame>
  );
}
