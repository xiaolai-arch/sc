import { useState } from 'react';
import { cn } from '../ui/cn';
import { CheckIcon, ChevronRightIcon } from '../ui/icons';
import type { ReviewRecord } from '../../shared/ipc';
import type { LearnerProfile } from '../../shared/memory';
import type {
  CreateNoteInput,
  CreateReminderInput,
  Reminder,
  UpdateReminderInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceTask,
  WorkspaceTaskStatus
} from '../../shared/workspace';
import { FocusTimer } from './FocusTimer';
import type { FocusSession } from './focus-timer';

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
  onOpenPractice: () => void;
  busy?: boolean;
  onUpdateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
  onCreateNote: (input: CreateNoteInput) => Promise<WorkspaceNote>;
  onCreateReminder: (input: CreateReminderInput) => Promise<Reminder>;
  onUpdateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  focus: FocusSession | null;
  focusNotice: string | null;
  canStartFocus: boolean;
  onStartFocus: (taskId: string) => void;
  onStartDefaultFocus: () => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onResetFocus: () => void;
};

const TABS: Array<{ id: ProjectPanelTab; label: string }> = [
  { id: 'plan', label: '计划' },
  { id: 'records', label: '记录' },
  { id: 'review', label: '复盘' },
  { id: 'reminders', label: '提醒' }
];

const actionClass =
  'rounded px-1.5 py-0.5 text-[10px] text-[#6b6b70] transition-colors hover:bg-black/[0.05] hover:text-black disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

const primaryButtonClass =
  'rounded-md bg-[#0071e3] px-2 py-1 text-[10px] font-medium text-white disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30';

const inputClass =
  'h-7 min-w-0 rounded-md border border-[#e5e1da] bg-white px-2 text-[10px] text-[#1d1d1f] outline-none placeholder:text-[#9a9a9e] focus:border-[#0071e3]/40 focus:ring-2 focus:ring-[#0071e3]/20';

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
}

/** The next full hour, used as the default reminder time. */
export function nextReminderTime(now: Date = new Date()): string {
  const cursor = new Date(now.getTime());
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  return `${String(cursor.getHours()).padStart(2, '0')}:00`;
}

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
  onPreviewNote,
  onOpenPractice,
  busy = false,
  onUpdateTask,
  onCreateNote,
  onCreateReminder,
  onUpdateReminder,
  focus,
  focusNotice,
  canStartFocus,
  onStartFocus,
  onStartDefaultFocus,
  onPauseFocus,
  onResumeFocus,
  onResetFocus
}: ProjectPanelProps) {
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<{ id: string; message: string } | null>(null);
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [reminderTime, setReminderTime] = useState(() => nextReminderTime());
  const [reminderLabel, setReminderLabel] = useState('');
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [pendingReminderId, setPendingReminderId] = useState<string | null>(null);

  if (!open) return null;

  const filteredTasks = tasks.filter((task) => !workspace || task.workspaceId === workspace.id);
  const filteredNotes = notes.filter((note) => !workspace || note.workspaceId === workspace.id);
  const filteredReviews = reviews.filter(
    (review) => !workspace || review.workspaceId === workspace.id
  );
  const latestReview = filteredReviews[0];
  const done = filteredTasks.filter((task) => task.status === 'done').length;

  async function updateTaskStatus(taskId: string, status: WorkspaceTaskStatus) {
    setPendingTaskId(taskId);
    setTaskError(null);
    try {
      await onUpdateTask({ taskId, status });
    } catch (cause) {
      setTaskError({ id: taskId, message: messageOf(cause) });
    } finally {
      setPendingTaskId(null);
    }
  }

  function taskAction(
    task: WorkspaceTask,
    label: string,
    status: WorkspaceTaskStatus
  ) {
    return (
      <button
        key={`${task.id}-${label}`}
        type="button"
        aria-label={`${label}：${task.title}`}
        disabled={busy || pendingTaskId === task.id}
        onClick={() => void updateTaskStatus(task.id, status)}
        className={actionClass}
      >
        {label}
      </button>
    );
  }

  async function saveNote() {
    const body = noteBody.trim();
    if (!workspace || !body || savingNote) return;
    const firstLine = body.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    const title = noteTitle.trim() || firstLine;
    setSavingNote(true);
    setNoteError(null);
    try {
      await onCreateNote({
        workspaceId: workspace.id,
        title,
        subject: workspace.name,
        body
      });
      setNoteTitle('');
      setNoteBody('');
      setNoteFormOpen(false);
    } catch (cause) {
      setNoteError(messageOf(cause));
    } finally {
      setSavingNote(false);
    }
  }

  async function addReminder() {
    const label = reminderLabel.trim();
    if (!label || creatingReminder) return;
    setCreatingReminder(true);
    setReminderError(null);
    try {
      await onCreateReminder({ time: reminderTime, label });
      setReminderLabel('');
      setReminderTime(nextReminderTime());
    } catch (cause) {
      setReminderError(messageOf(cause));
    } finally {
      setCreatingReminder(false);
    }
  }

  async function toggleReminder(reminder: Reminder) {
    setPendingReminderId(reminder.id);
    setReminderError(null);
    try {
      await onUpdateReminder({ id: reminder.id, enabled: !reminder.enabled });
    } catch (cause) {
      setReminderError(messageOf(cause));
    } finally {
      setPendingReminderId(null);
    }
  }

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
          onClick={onOpenPractice}
          className="shrink-0 rounded-md px-2 py-1 text-[10px] font-medium text-[#0071e3] hover:bg-[#e8f2ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
        >
          练习
        </button>
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
            <FocusTimer
              session={focus}
              notice={focusNotice}
              canStart={canStartFocus}
              onStartDefault={onStartDefaultFocus}
              onPause={onPauseFocus}
              onResume={onResumeFocus}
              onReset={onResetFocus}
            />

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
                  <div key={task.id} className="py-2">
                    <div className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                          statusDot(task.status)
                        )}
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
                          {typeof task.actualMin === 'number' ? ` · 已练 ${task.actualMin} 分钟` : ''}
                        </p>
                      </div>
                      {task.status === 'done' ? (
                        <CheckIcon className="mt-1 h-3 w-3 text-[#34c759]" />
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 pl-3.5">
                      {task.status === 'pending' ? taskAction(task, '开始', 'in-progress') : null}
                      {task.status === 'in-progress' ? taskAction(task, '完成', 'done') : null}
                      {task.status === 'pending' || task.status === 'in-progress'
                        ? taskAction(task, '跳过', 'skipped')
                        : null}
                      {task.status === 'done' ? taskAction(task, '撤销', 'pending') : null}
                      {task.status === 'skipped' ? taskAction(task, '恢复', 'pending') : null}
                      <button
                        type="button"
                        aria-label={`专注：${task.title}`}
                        disabled={busy}
                        onClick={() => onStartFocus(task.id)}
                        className={actionClass}
                      >
                        专注
                      </button>
                    </div>
                    {taskError?.id === task.id ? (
                      <p role="alert" className="mt-1 pl-3.5 text-[10px] text-[#d70015]">
                        {taskError.message}
                      </p>
                    ) : null}
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
            <div className="mb-2">
              <button
                type="button"
                aria-expanded={noteFormOpen}
                disabled={!workspace}
                onClick={() => {
                  setNoteFormOpen((current) => !current);
                  setNoteError(null);
                }}
                className={primaryButtonClass}
              >
                写一条记录
              </button>
              {!workspace ? (
                <p className="mt-1 text-[10px] text-[#8a8a8e]">先选择项目</p>
              ) : null}
              {noteFormOpen && workspace ? (
                <div className="mt-2 rounded-lg border border-[#e5e1da] bg-white p-2">
                  <input
                    aria-label="记录标题"
                    placeholder="标题（可选）"
                    value={noteTitle}
                    onChange={(event) => setNoteTitle(event.target.value)}
                    className={`${inputClass} w-full`}
                  />
                  <textarea
                    aria-label="记录正文"
                    rows={3}
                    placeholder="记下今天发生了什么…"
                    value={noteBody}
                    onChange={(event) => setNoteBody(event.target.value)}
                    className="mt-1 w-full resize-none rounded-md border border-[#e5e1da] bg-white px-2 py-1.5 text-[10px] leading-5 text-[#1d1d1f] outline-none placeholder:text-[#9a9a9e] focus:border-[#0071e3]/40 focus:ring-2 focus:ring-[#0071e3]/20"
                  />
                  {noteError ? (
                    <p role="alert" className="mt-1 text-[10px] text-[#d70015]">
                      {noteError}
                    </p>
                  ) : null}
                  <div className="mt-2 flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setNoteFormOpen(false);
                        setNoteError(null);
                      }}
                      className={actionClass}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      disabled={!noteBody.trim() || savingNote}
                      onClick={() => void saveNote()}
                      className={primaryButtonClass}
                    >
                      保存记录
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

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
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void addReminder();
              }}
              className="mb-3 rounded-lg border border-[#e5e1da] bg-white p-2"
            >
              <div className="flex items-center gap-1">
                <input
                  type="time"
                  aria-label="提醒时间"
                  value={reminderTime}
                  onChange={(event) => setReminderTime(event.target.value)}
                  className={`${inputClass} w-[74px] shrink-0 tabular-nums`}
                />
                <input
                  aria-label="提醒内容"
                  placeholder="提醒内容"
                  value={reminderLabel}
                  onChange={(event) => setReminderLabel(event.target.value)}
                  className={`${inputClass} flex-1`}
                />
              </div>
              {reminderError ? (
                <p role="alert" className="mt-1 text-[10px] text-[#d70015]">
                  {reminderError}
                </p>
              ) : null}
              <div className="mt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={!reminderLabel.trim() || creatingReminder}
                  className={primaryButtonClass}
                >
                  添加提醒
                </button>
              </div>
            </form>

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
                    <button
                      type="button"
                      role="switch"
                      aria-checked={reminder.enabled}
                      aria-label={`${reminder.label} 提醒开关`}
                      disabled={pendingReminderId === reminder.id}
                      onClick={() => void toggleReminder(reminder)}
                      className={cn(
                        'relative h-4 w-7 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30',
                        reminder.enabled ? 'bg-[#0071e3]' : 'bg-[#d8d4cc]'
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform',
                          reminder.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                        )}
                      />
                    </button>
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
