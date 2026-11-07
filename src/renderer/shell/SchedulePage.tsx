import { useState, type PointerEvent as ReactPointerEvent } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type {
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceTask
} from '../../shared/workspace';
import { CheckIcon } from '../ui/icons';
import { PageFrame } from './PageFrame';
import { buildDailySchedule, type ScheduleEntry } from './schedule';

type SchedulePageProps = {
  today: string;
  dateLabel: string;
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  onOpenSidebar: () => void;
  onOpenWorkspace: (workspaceId: string) => void;
  onPrompt: (prompt: string) => void;
  onUpdateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
};

const ADJUST_PROMPT =
  '帮我调整今天的安排：结合各工作区的待办、优先级和预计时长，重新排一份具体时间表。';

const SNAP_MINUTES = 5;
const EARLIEST_MINUTES = 5 * 60;
const LATEST_MINUTES = 23 * 60 + 55;

function toMinutes(time: string): number {
  const [hour, minute] = time.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function formatTime(minutes: number): string {
  const hour = String(Math.floor(minutes / 60)).padStart(2, '0');
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour}:${minute}`;
}

function snapMinutes(minutes: number): number {
  const snapped = Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
  return Math.min(Math.max(snapped, EARLIEST_MINUTES), LATEST_MINUTES);
}

type DragState = {
  id: string;
  startY: number;
  original: number;
  preview: number;
};

export function SchedulePage({
  today,
  dateLabel,
  tasks,
  workspaces,
  onOpenSidebar,
  onOpenWorkspace,
  onPrompt,
  onUpdateTask
}: SchedulePageProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const { entries, unscheduled } = buildDailySchedule(
    tasks,
    workspaces,
    8,
    new Date(`${today}T00:00:00`)
  );
  const sourceCounts = new Map<string, number>();
  for (const entry of entries) {
    sourceCounts.set(entry.tag, (sourceCounts.get(entry.tag) ?? 0) + 1);
  }
  const sources = [...sourceCounts.entries()]
    .map(([tag, count]) => `${tag} ${count}`)
    .join(' · ');

  function update(input: UpdateWorkspaceTaskInput) {
    setUpdateError(null);
    try {
      void onUpdateTask(input).catch((cause) =>
        setUpdateError(friendlyErrorMessage(cause, '保存任务修改失败，请重试。'))
      );
    } catch (cause) {
      setUpdateError(friendlyErrorMessage(cause, '保存任务修改失败，请重试。'));
    }
  }

  function startDrag(entry: ScheduleEntry, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const original = toMinutes(entry.time);
    setDrag({ id: entry.id, startY: event.clientY, original, preview: original });
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (drag === null) return;
    const delta = event.clientY - drag.startY;
    const preview = snapMinutes(drag.original + Math.round(delta));
    if (preview !== drag.preview) setDrag({ ...drag, preview });
  }

  function endDrag() {
    if (drag === null) return;
    const { id, original, preview } = drag;
    setDrag(null);
    if (preview === original) return;
    update({ taskId: id, startAt: `${today}T${formatTime(preview)}` });
  }

  function nudge(entry: ScheduleEntry, deltaMinutes: number) {
    const next = snapMinutes(toMinutes(entry.time) + deltaMinutes);
    if (next === toMinutes(entry.time)) return;
    update({ taskId: entry.id, startAt: `${today}T${formatTime(next)}` });
  }

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
        {updateError ? (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-[#ff3b30]/10 px-4 py-2.5 text-[13px] text-[#d70015] dark:bg-[#ff3b30]/15 dark:text-[#ff7b72]"
          >
            <span className="min-w-0 truncate">{updateError}</span>
            <button
              type="button"
              onClick={() => setUpdateError(null)}
              className="shrink-0 rounded-full px-2 py-1 font-medium text-[#0071e3] dark:text-[#4da3ff]"
            >
              知道了
            </button>
          </div>
        ) : null}
        <div className="mb-6 text-center">
          <h2 className="text-[22px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">
            今天的时间表
          </h2>
          <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            {entries.length > 0
              ? '拖动左侧时间可以改时间，点圆点标记完成。'
              : '阿咲还没有排今天的任务。'}
          </p>
        </div>

        <section className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1c1c1e] md:p-8">
          {entries.length > 0 ? (
            <div className="flex items-center justify-end">
              <span className="text-[11px] text-gray-400 dark:text-[#8e8e93]">
                {entries.some((entry) => entry.pinned) ? '已固定的时间会保留' : '阿咲排的'}
              </span>
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
              {entries.map((entry) => {
                const dragging = drag?.id === entry.id;
                const done = entry.status === 'done';
                const time =
                  drag !== null && drag.id === entry.id ? formatTime(drag.preview) : entry.time;
                return (
                  <li
                    key={entry.id}
                    className={`flex items-start gap-3 py-3.5 ${
                      dragging ? 'rounded-xl bg-[#0071e3]/5 dark:bg-[#0a84ff]/10' : ''
                    }`}
                  >
                    <button
                      type="button"
                      aria-label={`调整「${entry.title}」的时间`}
                      title="上下拖动调整时间，或用方向键微调"
                      onPointerDown={(event) => startDrag(entry, event)}
                      onPointerMove={moveDrag}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onLostPointerCapture={endDrag}
                      onKeyDown={(event) => {
                        if (event.key === 'ArrowUp') {
                          event.preventDefault();
                          nudge(entry, -15);
                        } else if (event.key === 'ArrowDown') {
                          event.preventDefault();
                          nudge(entry, 15);
                        }
                      }}
                      className={`w-12 shrink-0 cursor-grab touch-none rounded-lg pt-0.5 text-right text-[12px] tabular-nums transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 active:cursor-grabbing ${
                        dragging
                          ? 'text-[#0071e3] dark:text-[#4da3ff]'
                          : 'text-gray-400 hover:text-[#0071e3] dark:text-[#8e8e93] dark:hover:text-[#4da3ff]'
                      }`}
                    >
                      {time}
                    </button>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={done}
                      aria-label={`完成任务：${entry.title}`}
                      onClick={() =>
                        // Pin the block when it is checked so the completed or
                        // reopened task keeps its place for the rest of the day.
                        update({
                          taskId: entry.id,
                          status: done ? 'pending' : 'done',
                          startAt: entry.startAt ?? `${today}T${entry.time}`
                        })
                      }
                      className={`mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 ${
                        done
                          ? 'border-[#0071e3] bg-[#0071e3] text-white dark:border-[#0a84ff] dark:bg-[#0a84ff]'
                          : 'border-gray-300 bg-transparent text-transparent hover:border-[#0071e3] dark:border-white/30 dark:hover:border-[#4da3ff]'
                      }`}
                    >
                      <CheckIcon className="h-2.5 w-2.5" />
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onOpenWorkspace(entry.workspaceId)}
                          className={`max-w-full truncate text-left text-[14px] font-medium transition-colors duration-200 hover:text-[#0071e3] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:hover:text-[#4da3ff] ${
                            done
                              ? 'text-gray-400 line-through dark:text-[#8e8e93]'
                              : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                          }`}
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
                        {entry.pinned ? (
                          <span className="shrink-0 text-[10px] text-gray-400 dark:text-[#8e8e93]">
                            已固定
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                        {entry.detail}
                      </p>
                    </div>
                  </li>
                );
              })}
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
