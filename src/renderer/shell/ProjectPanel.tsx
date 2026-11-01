import { cn } from '../ui/cn';
import { CheckIcon, ChevronRightIcon } from '../ui/icons';
import type { ReviewRecord } from '../../shared/ipc';
import type { LearnerProfile } from '../../shared/memory';
import type { Reminder, Workspace, WorkspaceNote, WorkspaceTask } from '../../shared/workspace';

export type ProjectPanelTab = 'plan' | 'records' | 'review' | 'reminders';

type ProjectPanelProps = {
  open: boolean;
  workspace: Workspace | null;
  workspaces: Workspace[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  reviews: ReviewRecord[];
  reminders: Reminder[];
  profile: LearnerProfile | null;
  tab: ProjectPanelTab;
  onTabChange: (tab: ProjectPanelTab) => void;
  onClose: () => void;
  onSelectWorkspace: (id: string) => void;
  onPrompt: (prompt: string) => void;
  onPreviewNote: (note: WorkspaceNote) => void;
};

const TABS: Array<{ id: ProjectPanelTab; label: string }> = [
  { id: 'plan', label: '计划' },
  { id: 'records', label: '记录' },
  { id: 'review', label: '复盘' },
  { id: 'reminders', label: '提醒' }
];

function statusDot(status: WorkspaceTask['status']) {
  if (status === 'done') return 'bg-[#34c759]';
  if (status === 'in-progress') return 'bg-[#0071e3]';
  return 'bg-[#c9c4bc]';
}

function Empty({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-[#ddd8d0] px-3 py-5 text-center">
      <p className="text-[11px] leading-5 text-[#8a8a8e]">{text}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-2 text-[11px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
      >
        {action}
      </button>
    </div>
  );
}

export function ProjectPanel({
  open,
  workspace,
  workspaces,
  tasks,
  notes,
  reviews,
  reminders,
  profile,
  tab,
  onTabChange,
  onClose,
  onSelectWorkspace,
  onPrompt,
  onPreviewNote
}: ProjectPanelProps) {
  if (!open) return null;

  const filteredTasks = tasks.filter((task) => !workspace || task.workspaceId === workspace.id);
  const filteredNotes = notes.filter((note) => !workspace || note.workspaceId === workspace.id);
  const filteredReviews = reviews.filter(
    (review) => !workspace || review.workspaceId === workspace.id
  );
  const latestReview = filteredReviews[0];
  const done = filteredTasks.filter((task) => task.status === 'done').length;

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-l border-[#e8e5e0] bg-[#fdfdfc] md:w-[300px]">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-[#ece9e4] px-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-[#1d1d1f]">
              {workspace?.name ?? '项目'}
            </span>
            {profile ? (
              <span className="shrink-0 rounded-full bg-[#f1eee8] px-1.5 py-0.5 text-[9px] text-[#6b6b70]">
                {profile.weaknesses.length} 个薄弱点
              </span>
            ) : null}
          </div>
          <div className="mt-0.5 truncate text-[10px] text-[#8a8a8e]">
            {workspace?.goal || '告诉管家你想做什么，他会创建项目。'}
          </div>
        </div>
        <button
          type="button"
          aria-label="关闭项目面板"
          onClick={onClose}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8a8a8e] hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </header>

      <div className="shrink-0 border-b border-[#ece9e4] px-3 py-2">
        <select
          aria-label="切换项目"
          value={workspace?.id ?? ''}
          onChange={(event) => onSelectWorkspace(event.target.value)}
          className="h-8 w-full rounded-md border border-[#e5e1da] bg-white px-2 text-[11px] text-[#3c3c3f] outline-none focus:border-[#0071e3]"
        >
          <option value="">全部项目</option>
          {workspaces.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-[#ece9e4] px-3 py-2">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => onTabChange(item.id)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
              tab === item.id
                ? 'bg-[#0071e3] text-white'
                : 'bg-[#f1eee8] text-[#6b6b70] hover:bg-[#e9e6e0]'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {tab === 'plan' ? (
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[11px] font-semibold text-[#1d1d1f]">今天</span>
              <span className="text-[10px] text-[#8a8a8e]">
                {done} / {filteredTasks.length} 完成
              </span>
            </div>
            <div className="mb-3 h-1 overflow-hidden rounded-full bg-[#ece9e4]">
              <div
                className="h-full rounded-full bg-[#0071e3]"
                style={{
                  width: `${filteredTasks.length === 0 ? 0 : (done / filteredTasks.length) * 100}%`
                }}
              />
            </div>
            {filteredTasks.length === 0 ? (
              <Empty
                text="这个项目还没有任务。让管家帮你排一个。"
                action="让管家排计划"
                onAction={() => onPrompt('帮我排一下这个项目的计划')}
              />
            ) : (
              <div className="divide-y divide-[#f0ece6]">
                {filteredTasks.map((task) => (
                  <div key={task.id} className="flex items-start gap-2 py-2">
                    <span
                      aria-hidden="true"
                      className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', statusDot(task.status))}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'text-[11px] leading-5',
                          task.status === 'done'
                            ? 'text-[#9a9a9e] line-through'
                            : 'text-[#1d1d1f]'
                        )}
                      >
                        {task.title}
                      </p>
                      <p className="mt-0.5 truncate text-[9px] text-[#8a8a8e]">
                        {task.subject} · {task.durationMin} 分钟
                      </p>
                    </div>
                    {task.status === 'done' ? <CheckIcon className="mt-1 h-3 w-3 text-[#34c759]" /> : null}
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onPrompt('帮我调整一下今天的任务安排')}
              className="mt-3 text-[11px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              让管家调整
            </button>
          </div>
        ) : null}

        {tab === 'records' ? (
          <div>
            {filteredNotes.length === 0 ? (
              <Empty
                text="这个项目还没有记录。"
                action="让管家记一条"
                onAction={() => onPrompt('记一下：')}
              />
            ) : (
              <div className="divide-y divide-[#f0ece6]">
                {filteredNotes.slice(0, 10).map((note) => (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => onPreviewNote(note)}
                    className="flex w-full flex-col gap-0.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                  >
                    <span className="truncate text-[11px] font-medium text-[#1d1d1f]">
                      {note.title}
                    </span>
                    <span className="truncate text-[9px] text-[#8a8a8e]">
                      {note.subject} · {note.updated}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onPrompt('记一下：')}
              className="mt-3 text-[11px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              让管家记一条
            </button>
          </div>
        ) : null}

        {tab === 'review' ? (
          <div>
            {latestReview ? (
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-[#1d1d1f]">
                    {latestReview.date}
                  </span>
                  <span className="text-[9px] text-[#8a8a8e]">最近一次</span>
                </div>
                <p className="mt-2 line-clamp-3 text-[10px] leading-5 text-[#5f5f63]">
                  {latestReview.completed || '没有填写完成内容'}
                </p>
                {latestReview.stuck ? (
                  <p className="mt-1 line-clamp-2 text-[10px] leading-5 text-[#d70015]">
                    卡点：{latestReview.stuck}
                  </p>
                ) : null}
              </div>
            ) : (
              <Empty
                text="还没有复盘记录。"
                action="开始今天复盘"
                onAction={() => onPrompt('我们开始今天复盘')}
              />
            )}
            <button
              type="button"
              onClick={() => onPrompt('我们开始今天复盘')}
              className="mt-3 text-[11px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              开始复盘
            </button>
          </div>
        ) : null}

        {tab === 'reminders' ? (
          <div>
            <p className="mb-2 text-[9px] text-[#8a8a8e]">全部提醒</p>
            {reminders.length === 0 ? (
              <Empty
                text="还没有提醒。"
                action="让管家设提醒"
                onAction={() => onPrompt('帮我设一个提醒：')}
              />
            ) : (
              <div className="divide-y divide-[#f0ece6]">
                {reminders.map((reminder) => (
                  <div key={reminder.id} className="flex items-center gap-2 py-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full',
                        reminder.enabled ? 'bg-[#34c759]' : 'bg-[#c9c4bc]'
                      )}
                    />
                    <span className="w-10 shrink-0 text-[10px] tabular-nums text-[#6b6b70]">
                      {reminder.time}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[10px] text-[#1d1d1f]">
                      {reminder.label}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button"
              onClick={() => onPrompt('帮我设一个提醒：')}
              className="mt-3 text-[11px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              让管家设提醒
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
