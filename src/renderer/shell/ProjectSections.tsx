import { useState } from 'react';
import {
  addLocalDays,
  formatMonthDay,
  isLocalDate,
  isLocalDateTime,
  isMutedOn
} from '../../shared/date';
import { friendlyErrorMessage } from '../../shared/errors';
import { cn } from '../ui/cn';
import { CheckIcon } from '../ui/icons';
import { Select } from '../ui/Select';
import { effectiveReminderState, daysUntilTarget, MAX_TASK_CUE_LENGTH } from '../../shared/workspace';
import type { CommitmentSummary } from '../../shared/notifications';
import type { ResolveCommitmentEntryInput } from '../../shared/ipc';
import type { ReviewRecord } from '../../shared/ipc';
import {
  TASK_REPEAT_LABELS,
  TASK_REPEATS,
  type TaskRepeat
} from '../../shared/recurrence';
import type {
  CreateMemoryInput,
  DeleteMemoryInput,
  LearnerProfile,
  MemoryKind,
  MemoryRecord,
  UpdateMemoryInput
} from '../../shared/memory';
import type {
  CreateNoteInput,
  CreateReminderInput,
  CreateTaskInput,
  DeleteNoteInput,
  DeleteReminderInput,
  DeleteTaskInput,
  Reminder,
  ReminderState,
  UpdateReminderInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceTask,
  WorkspaceTaskStatus
} from '../../shared/workspace';
import { FocusTimer } from './FocusTimer';
import type { FocusSession } from './focus-timer';

export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = {
  weakness: '薄弱点',
  strength: '优势',
  preference: '偏好',
  plan: '计划',
  fact: '事实'
};

const MEMORY_KIND_ORDER: MemoryKind[] = [
  'weakness',
  'strength',
  'preference',
  'plan',
  'fact'
];

export function memorySourceLabel(source: string): string {
  const match = /^review:(\d{4}-\d{2}-\d{2})$/.exec(source);
  return match ? `来自 ${match[1]} 复盘` : `来自 ${source || '阿咲记录'}`;
}

export function memoryWhyRemembered(record: MemoryRecord): string {
  const label = MEMORY_KIND_LABELS[record.kind];
  const match = /^review:(\d{4})-(\d{2})-(\d{2})$/.exec(record.source);
  if (!match) {
    return record.source ? `${label} · 来自 ${record.source}` : `${label} · 由阿咲记录`;
  }
  const day = `${match[2]}-${match[3]}`;
  switch (record.kind) {
    case 'weakness':
      return `${label} · 来自 ${day} 复盘里提到的卡点`;
    case 'strength':
      return `${label} · 来自 ${day} 复盘里提到的完成项`;
    case 'preference':
      return `${label} · 来自 ${day} 复盘里提到的调整`;
    case 'plan':
      return `${label} · 来自 ${day} 复盘里提到的明日安排`;
    default:
      return `${label} · 来自 ${day} 复盘`;
  }
}

function memoryKindClass(kind: MemoryKind): string {
  switch (kind) {
    case 'weakness':
      return 'bg-[#ff3b30]/10 text-[#d70015] dark:bg-[#ff3b30]/20 dark:text-[#ff7b72]';
    case 'strength':
      return 'bg-[#34c759]/10 text-[#1d7f3a] dark:bg-[#34c759]/20 dark:text-[#7ee2a0]';
    case 'preference':
      return 'bg-[#0071e3]/10 text-[#0071e3] dark:bg-[#0a84ff]/20 dark:text-[#4da3ff]';
    case 'plan':
      return 'bg-[#f5f5f7] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]';
    default:
      return 'bg-[#f5f5f7] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]';
  }
}

const actionClass =
  'rounded-full px-2.5 py-1 text-[13px] font-medium text-gray-500 transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-black/[0.04] hover:text-black hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]';

const primaryButtonClass =
  'rounded-full bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100';

const inputClass =
  'h-9 min-w-0 rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-[#1d1d1f] outline-none transition-all duration-200 [color-scheme:light] placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7] dark:[color-scheme:dark]';

function messageOf(cause: unknown) {
  return friendlyErrorMessage(cause);
}

/** The next full hour, used as the default reminder time. */
export function nextReminderTime(now: Date = new Date()): string {
  const cursor = new Date(now.getTime());
  cursor.setMinutes(0, 0, 0);
  cursor.setHours(cursor.getHours() + 1);
  return `${String(cursor.getHours()).padStart(2, '0')}:00`;
}

type ReminderRepeat = 'daily' | 'weekdays' | 'weekend' | 'custom';
const WEEKDAY_DAYS = [1, 2, 3, 4, 5];
const WEEKEND_DAYS = [0, 6];
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

function repeatOf(days: number[] | undefined): ReminderRepeat {
  if (!days || days.length === 0) return 'daily';
  if (days.length === 5 && WEEKDAY_DAYS.every((day) => days.includes(day))) return 'weekdays';
  if (days.length === 2 && WEEKEND_DAYS.every((day) => days.includes(day))) return 'weekend';
  return 'custom';
}

function daysOfRepeat(repeat: ReminderRepeat): number[] | undefined {
  if (repeat === 'weekdays') return [...WEEKDAY_DAYS];
  if (repeat === 'weekend') return [...WEEKEND_DAYS];
  return undefined;
}

function repeatLabel(days: number[] | undefined): string {
  const repeat = repeatOf(days);
  if (repeat === 'daily') return '每天';
  if (repeat === 'weekdays') return '工作日';
  if (repeat === 'weekend') return '周末';
  return (days ?? []).map((day) => `周${WEEKDAY_NAMES[day] ?? ''}`).join('、');
}

/** Chinese label and chip colour for each persisted reminder lifecycle state. */
const REMINDER_STATE_CHIPS: Record<ReminderState, { label: string; className: string }> = {
  pending: {
    label: '待触发',
    className: 'bg-black/[0.05] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]'
  },
  fired: {
    label: '已触发',
    className: 'bg-[#0071e3]/10 text-[#0071e3] dark:bg-[#0a84ff]/20 dark:text-[#4da3ff]'
  },
  done: {
    label: '已完成',
    className: 'bg-[#34c759]/10 text-[#1a8a3c] dark:bg-[#34c759]/20 dark:text-[#5ddc7f]'
  },
  postponed: {
    label: '已延后',
    className: 'bg-[#ff9500]/10 text-[#a35a00] dark:bg-[#ff9500]/20 dark:text-[#ffb340]'
  },
  failed: {
    label: '失败',
    className: 'bg-[#d70015]/10 text-[#d70015] dark:bg-[#ff7b72]/20 dark:text-[#ff7b72]'
  }
};

/** `2026-11-21T14:30` → `11-21 14:30`, enough context without the year. */
function shortLocalDateTime(value: string): string {
  return value.length >= 16 ? `${value.slice(5, 10)} ${value.slice(11, 16)}` : value;
}

function reminderStateOf(reminder: Reminder, today: string): ReminderState {
  // The single next-day rule: `done` only holds on the day it was set.
  return effectiveReminderState(reminder, today);
}

/**
 * What the user sees right after 标为完成, in one line: a weekly reminder says
 * which weekday comes next, a daily one says tomorrow. Computed from the
 * passed-in today and the reminder's own `days`, never from a fresh clock.
 */
function completionNotice(reminder: Reminder, today: string): string {
  const days = reminder.days ?? [];
  if (days.length === 0) return '今天不再提醒。明天照常。';
  const base = new Date(`${today}T00:00:00`).getDay();
  for (let offset = 1; offset <= 7; offset += 1) {
    const weekday = (base + offset) % 7;
    if (days.includes(weekday)) return `今天不再提醒。下次提醒：周${WEEKDAY_NAMES[weekday]}`;
  }
  return '今天不再提醒。明天照常。';
}

function statusDot(status: WorkspaceTask['status']) {
  if (status === 'done') return 'bg-[#34c759]';
  if (status === 'in-progress') return 'bg-[#0071e3]';
  return 'bg-gray-300 dark:bg-white/30';
}

function Empty({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-6 text-center dark:border-white/10">
      <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">{text}</p>
      <button
        type="button"
        onClick={onAction}
        className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
      >
        {action}
      </button>
    </div>
  );
}

function SectionHeading({ title }: { title: string }) {
  return (
    <h3 className="mb-3 text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
      {title}
    </h3>
  );
}

function filterTasks(tasks: WorkspaceTask[], workspace: Workspace | null) {
  return tasks.filter((task) => !workspace || task.workspaceId === workspace.id);
}

function filterNotes(notes: WorkspaceNote[], workspace: Workspace | null) {
  return notes.filter((note) => !workspace || note.workspaceId === workspace.id);
}

/** Splits a free-form tag input on Chinese/English commas and newlines. */
function parseNoteTags(value: string): string[] {
  const tags = new Set<string>();
  for (const part of value.split(/[,，\n]/)) {
    const tag = part.trim();
    if (tag) tags.add(tag);
  }
  return [...tags];
}

function filterMemories(memoryRecords: MemoryRecord[], workspace: Workspace | null) {
  return memoryRecords
    .filter((record) => !workspace || record.workspaceId === workspace.id)
    .slice()
    .sort(
      (a, b) =>
        (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id)
    );
}

function filterReviews(reviews: ReviewRecord[], workspace: Workspace | null) {
  return reviews.filter((review) => !workspace || review.workspaceId === workspace.id);
}

type PlanSectionProps = {
  workspace: Workspace | null;
  tasks: WorkspaceTask[];
  busy?: boolean;
  onCreateTask?: (input: CreateTaskInput) => Promise<WorkspaceTask>;
  onUpdateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
  onDeleteTask?: (input: DeleteTaskInput) => Promise<void>;
  onPrompt: (prompt: string) => void;
  focus: FocusSession | null;
  focusNotice: string | null;
  canStartFocus: boolean;
  onStartFocus: (taskId: string) => void;
  onStartDefaultFocus: () => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onResetFocus: () => void;
};

type TaskDraft = {
  title: string;
  subject: string;
  duration: string;
  acceptance: string;
  cue: string;
  due: string;
  startAt: string;
  repeat: TaskRepeat | '';
};

function draftFrom(task: WorkspaceTask): TaskDraft {
  return {
    title: task.title,
    subject: task.subject,
    duration: String(task.durationMin),
    acceptance: task.acceptance,
    cue: task.cue ?? '',
    due: task.due ?? '',
    startAt: task.startAt ?? '',
    repeat: task.repeat ?? ''
  };
}

export function PlanSection({
  workspace,
  tasks,
  busy = false,
  onCreateTask,
  onUpdateTask,
  onDeleteTask,
  onPrompt,
  focus,
  focusNotice,
  canStartFocus,
  onStartFocus,
  onStartDefaultFocus,
  onPauseFocus,
  onResumeFocus,
  onResetFocus
}: PlanSectionProps) {
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [taskError, setTaskError] = useState<{ id: string; message: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingPending, setCreatingPending] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<TaskDraft>({
    title: '',
    subject: '',
    duration: '30',
    acceptance: '',
    cue: '',
    due: '',
    startAt: '',
    repeat: ''
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<TaskDraft | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const filteredTasks = filterTasks(tasks, workspace);
  const done = filteredTasks.filter((task) => task.status === 'done').length;
  const canCreate = workspace !== null && onCreateTask !== undefined;

  function parseDuration(value: string): number | null {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    return Math.round(minutes);
  }

  /** '' keeps/clears nothing; a filled field must be a real date. */
  function parseDraftDue(value: string): string | null {
    const due = value.trim();
    if (!due) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('截止日期需为 YYYY-MM-DD 格式的日期。');
    return due;
  }

  /** '' means no pinned time; a filled field must be a local datetime. */
  function parseDraftStartAt(value: string): string | null {
    const startAt = value.trim();
    if (!startAt) return null;
    if (!isLocalDateTime(startAt)) throw new Error('固定开始时间无效，需要具体的日期和时刻。');
    return startAt;
  }

  async function createTask() {
    if (!workspace || !onCreateTask || creatingPending) return;
    const title = newDraft.title.trim();
    const durationMin = parseDuration(newDraft.duration);
    if (!title) {
      setCreateError('请填写任务标题。');
      return;
    }
    if (durationMin === null) {
      setCreateError('任务时长需要大于 0 分钟。');
      return;
    }
    let due: string | null;
    let startAt: string | null;
    try {
      due = parseDraftDue(newDraft.due);
      startAt = parseDraftStartAt(newDraft.startAt);
    } catch (cause) {
      setCreateError(messageOf(cause));
      return;
    }
    setCreatingPending(true);
    setCreateError(null);
    try {
      await onCreateTask({
        workspaceId: workspace.id,
        title,
        subject: newDraft.subject.trim() || workspace.name,
        durationMin,
        acceptance: newDraft.acceptance.trim(),
        ...(newDraft.cue.trim() ? { cue: newDraft.cue.trim() } : {}),
        ...(due ? { due } : {}),
        ...(startAt ? { startAt } : {}),
        ...(newDraft.repeat ? { repeat: newDraft.repeat } : {})
      });
      setNewDraft({
        title: '',
        subject: '',
        duration: '30',
        acceptance: '',
        cue: '',
        due: '',
        startAt: '',
        repeat: ''
      });
      setCreating(false);
    } catch (cause) {
      setCreateError(messageOf(cause));
    } finally {
      setCreatingPending(false);
    }
  }

  async function saveEdit(task: WorkspaceTask) {
    if (editDraft === null) return;
    const title = editDraft.title.trim();
    const durationMin = parseDuration(editDraft.duration);
    if (!title) {
      setTaskError({ id: task.id, message: '请填写任务标题。' });
      return;
    }
    if (durationMin === null) {
      setTaskError({ id: task.id, message: '任务时长需要大于 0 分钟。' });
      return;
    }
    let due: string | null;
    let startAt: string | null;
    try {
      due = parseDraftDue(editDraft.due);
      startAt = parseDraftStartAt(editDraft.startAt);
    } catch (cause) {
      setTaskError({ id: task.id, message: messageOf(cause) });
      return;
    }
    setPendingTaskId(task.id);
    setTaskError(null);
    try {
      await onUpdateTask({
        taskId: task.id,
        title,
        subject: editDraft.subject,
        durationMin,
        acceptance: editDraft.acceptance,
        cue: editDraft.cue.trim() || null,
        // An emptied field clears the stored value; null is the contract.
        due,
        startAt,
        repeat: editDraft.repeat || null
      });
      setEditingId(null);
      setEditDraft(null);
    } catch (cause) {
      setTaskError({ id: task.id, message: messageOf(cause) });
    } finally {
      setPendingTaskId(null);
    }
  }

  async function deleteTask(task: WorkspaceTask) {
    if (!onDeleteTask) return;
    if (confirmDeleteId !== task.id) {
      setConfirmDeleteId(task.id);
      return;
    }
    setPendingTaskId(task.id);
    setTaskError(null);
    try {
      await onDeleteTask({ taskId: task.id });
      setConfirmDeleteId(null);
      if (editingId === task.id) {
        setEditingId(null);
        setEditDraft(null);
      }
    } catch (cause) {
      setTaskError({ id: task.id, message: messageOf(cause) });
    } finally {
      setPendingTaskId(null);
    }
  }

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

  function draftFields(
    draft: TaskDraft,
    onChange: (next: TaskDraft) => void,
    keyPrefix: string
  ) {
    return (
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          aria-label={`${keyPrefix}标题`}
          placeholder="任务标题"
          value={draft.title}
          onChange={(event) => onChange({ ...draft, title: event.target.value })}
          className={`${inputClass} sm:col-span-2`}
        />
        <input
          aria-label={`${keyPrefix}科目`}
          placeholder="科目（可选）"
          value={draft.subject}
          onChange={(event) => onChange({ ...draft, subject: event.target.value })}
          className={inputClass}
        />
        <input
          aria-label={`${keyPrefix}时长`}
          placeholder="时长（分钟）"
          inputMode="numeric"
          value={draft.duration}
          onChange={(event) => onChange({ ...draft, duration: event.target.value })}
          className={inputClass}
        />
        <input
          aria-label={`${keyPrefix}验收标准`}
          placeholder="验收标准（可选）"
          value={draft.acceptance}
          onChange={(event) => onChange({ ...draft, acceptance: event.target.value })}
          className={`${inputClass} sm:col-span-2`}
        />
        <input
          aria-label={`${keyPrefix}触发时机`}
          placeholder="例如：晚饭后、下班回家后"
          maxLength={MAX_TASK_CUE_LENGTH}
          value={draft.cue}
          onChange={(event) => onChange({ ...draft, cue: event.target.value })}
          className={`${inputClass} sm:col-span-2`}
        />
        <label className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
          <span className="grid gap-1">
            <input
              aria-label={`${keyPrefix}截止日期`}
              type="date"
              value={draft.due}
              onChange={(event) => onChange({ ...draft, due: event.target.value })}
              className={inputClass}
            />
            <span className="text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
              截止日期只是「什么时候之前要做完」。
            </span>
          </span>
          <span className="grid gap-1">
            <input
              aria-label={`${keyPrefix}固定开始时间`}
              type="datetime-local"
              value={draft.startAt}
              onChange={(event) => onChange({ ...draft, startAt: event.target.value })}
              className={inputClass}
            />
            <span className="text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
              固定开始时间会占住时间表，不会被自动排程挪走。
            </span>
          </span>
        </label>
        <Select
          aria-label={`${keyPrefix}重复`}
          size="sm"
          value={draft.repeat}
          onChange={(event) =>
            onChange({ ...draft, repeat: event.target.value as TaskRepeat | '' })
          }
          className="sm:col-span-2"
        >
          <option value="">不重复</option>
          {TASK_REPEATS.map((repeat) => (
            <option key={repeat} value={repeat}>
              {TASK_REPEAT_LABELS[repeat]}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  return (
    <section aria-label="计划">
      <div className="mb-3 flex items-center justify-between gap-2">
        <SectionHeading title="计划" />
        {canCreate ? (
          <button
            type="button"
            onClick={() => {
              setCreating((current) => !current);
              setCreateError(null);
            }}
            className={actionClass}
          >
            {creating ? '收起' : '新增任务'}
          </button>
        ) : null}
      </div>
      <FocusTimer
        session={focus}
        notice={focusNotice}
        canStart={canStartFocus}
        onStartDefault={onStartDefaultFocus}
        onPause={onPauseFocus}
        onResume={onResumeFocus}
        onReset={onResetFocus}
      />

      {creating && canCreate ? (
        <form
          aria-label="新增任务"
          className="mb-4 rounded-2xl bg-[#f5f5f7] p-3 dark:bg-white/[0.06]"
          onSubmit={(event) => {
            event.preventDefault();
            void createTask();
          }}
        >
          {draftFields(newDraft, setNewDraft, '新任务')}
          {createError ? (
            <p role="alert" className="mt-2 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
              {createError}
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setCreateError(null);
              }}
              className={actionClass}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={creatingPending}
              className={primaryButtonClass}
            >
              保存任务
            </button>
          </div>
        </form>
      ) : null}

      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">今天</span>
        <span className="text-[12px] text-gray-500 dark:text-[#8e8e93]">
          {done} / {filteredTasks.length} 完成
        </span>
      </div>
      <div className="mb-3 h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
        <div
          className="h-full rounded-full bg-[#0071e3]"
          style={{
            width: `${filteredTasks.length === 0 ? 0 : (done / filteredTasks.length) * 100}%`
          }}
        />
      </div>
      {filteredTasks.length === 0 ? (
        <Empty
          text="这个项目还没有任务。让阿咲帮你排一个。"
          action="让阿咲排计划"
          onAction={() => onPrompt('帮我排一下这个项目的计划')}
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {filteredTasks.map((task) => (
            <div key={task.id} className="py-2">
              {editingId === task.id && editDraft !== null ? (
                <form
                  aria-label={`编辑任务：${task.title}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveEdit(task);
                  }}
                >
                  {draftFields(editDraft, setEditDraft, '编辑任务')}
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setEditDraft(null);
                      }}
                      className={actionClass}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={pendingTaskId === task.id}
                      className={primaryButtonClass}
                    >
                      保存修改
                    </button>
                  </div>
                </form>
              ) : (
                <>
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
                          'text-[14px] leading-6',
                          task.status === 'done'
                            ? 'text-gray-400 line-through dark:text-[#8e8e93]'
                            : 'text-[#1d1d1f] dark:text-[#f5f5f7]'
                        )}
                      >
                        {task.title}
                      </p>
                      <p className="mt-0.5 truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
                        {task.subject} · {task.durationMin} 分钟
                        {task.repeat ? ` · ${TASK_REPEAT_LABELS[task.repeat]}` : ''}
                        {typeof task.actualMin === 'number' ? ` · 已练 ${task.actualMin} 分钟` : ''}
                      </p>
                      {task.cue ? (
                        <span className="mt-1 inline-block max-w-full truncate rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-gray-500 dark:bg-white/[0.08] dark:text-[#8e8e93]">
                          {task.cue}
                        </span>
                      ) : null}
                      {/* A plan-derived task names the goal it serves, when the
                          goal it points at is the project being viewed. */}
                      {workspace && task.goalId !== undefined && task.goalId === workspace.goalId ? (
                        <span
                          aria-label={`任务目标：${workspace.goal}`}
                          className="mt-1 ml-1 inline-block max-w-full truncate rounded-full bg-[#0071e3]/10 px-1.5 py-0.5 text-[11px] text-[#0071e3] dark:bg-[#0a84ff]/15 dark:text-[#4da3ff]"
                        >
                          目标：{workspace.goal}
                        </span>
                      ) : null}
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
                    <button
                      type="button"
                      aria-label={`编辑任务：${task.title}`}
                      disabled={busy || pendingTaskId === task.id}
                      onClick={() => {
                        setEditingId(task.id);
                        setEditDraft(draftFrom(task));
                        setTaskError(null);
                      }}
                      className={actionClass}
                    >
                      编辑
                    </button>
                    {onDeleteTask ? (
                      <button
                        type="button"
                        aria-label={
                          confirmDeleteId === task.id
                            ? `确认删除任务：${task.title}`
                            : `删除任务：${task.title}`
                        }
                        disabled={busy || pendingTaskId === task.id}
                        onClick={() => void deleteTask(task)}
                        className={cn(
                          actionClass,
                          confirmDeleteId === task.id
                            ? 'text-[#d70015] dark:text-[#ff7b72]'
                            : ''
                        )}
                      >
                        {confirmDeleteId === task.id ? '确认删除' : '删除'}
                      </button>
                    ) : null}
                  </div>
                </>
              )}
              {taskError?.id === task.id ? (
                <p role="alert" className="mt-1 pl-3.5 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
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
        className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
      >
        让阿咲调整
      </button>
    </section>
  );
}

type RecordsSectionProps = {
  workspace: Workspace | null;
  notes: WorkspaceNote[];
  onCreateNote: (input: CreateNoteInput) => Promise<WorkspaceNote>;
  onPreviewNote: (note: WorkspaceNote) => void;
  onUpdateNote?: (input: UpdateWorkspaceNoteInput) => Promise<WorkspaceNote>;
  onDeleteNote?: (input: DeleteNoteInput) => Promise<void>;
  onPrompt: (prompt: string) => void;
};

export function RecordsSection({
  workspace,
  notes,
  onCreateNote,
  onPreviewNote,
  onUpdateNote,
  onDeleteNote,
  onPrompt
}: RecordsSectionProps) {
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [editingNote, setEditingNote] = useState<WorkspaceNote | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editTags, setEditTags] = useState('');
  const [editRelated, setEditRelated] = useState<string[]>([]);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const filteredNotes = filterNotes(notes, workspace);
  const visibleNotes = showAllNotes ? filteredNotes : filteredNotes.slice(0, 10);

  function startEditNote(note: WorkspaceNote) {
    if (!onUpdateNote) return;
    setEditingNote(note);
    setEditTitle(note.title);
    setEditBody(note.body);
    setEditTags(note.tags.join('，'));
    setEditRelated([...note.related]);
    setEditError(null);
    setNoteFormOpen(false);
    setNoteError(null);
  }

  async function saveEditedNote() {
    if (!editingNote || !onUpdateNote || savingEdit) return;
    const body = editBody.trim();
    if (!body) return;
    const firstLine = body.split('\n').map((line) => line.trim()).find(Boolean) ?? '';
    const title = editTitle.trim() || firstLine;
    setSavingEdit(true);
    setEditError(null);
    try {
      await onUpdateNote({
        noteId: editingNote.id,
        title,
        body,
        tags: parseNoteTags(editTags),
        related: editRelated
      });
      setEditingNote(null);
    } catch (cause) {
      setEditError(messageOf(cause));
    } finally {
      setSavingEdit(false);
    }
  }

  async function deleteNote(note: WorkspaceNote) {
    if (!onDeleteNote) return;
    if (confirmDeleteId !== note.id) {
      setConfirmDeleteId(note.id);
      return;
    }
    setPendingDeleteId(note.id);
    setDeleteError(null);
    try {
      await onDeleteNote({ noteId: note.id });
      setConfirmDeleteId(null);
    } catch (cause) {
      setDeleteError(messageOf(cause));
    } finally {
      setPendingDeleteId(null);
    }
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

  return (
    <section aria-label="记录">
      <SectionHeading title="记录" />
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
          <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]">先选择项目</p>
        ) : null}
        {noteFormOpen && workspace ? (
          <div className="mt-2 rounded-xl bg-[#f5f5f7] p-3 dark:bg-white/[0.06]">
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
              className="mt-2 w-full resize-none rounded-xl border-0 bg-white px-3 py-2 text-[13px] leading-6 text-[#1d1d1f] outline-none transition-all duration-200 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
            />
            {noteError ? (
              <p role="alert" className="mt-1 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
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
        {editingNote ? (
          <div className="mt-2 rounded-xl bg-[#f5f5f7] p-3 dark:bg-white/[0.06]">
            <input
              aria-label="编辑记录标题"
              placeholder="标题（可选）"
              value={editTitle}
              onChange={(event) => setEditTitle(event.target.value)}
              className={`${inputClass} w-full`}
            />
            <textarea
              aria-label="编辑记录正文"
              rows={3}
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
              className="mt-2 w-full resize-none rounded-xl border-0 bg-white px-3 py-2 text-[13px] leading-6 text-[#1d1d1f] outline-none transition-all duration-200 placeholder:text-gray-400 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
            />
            <input
              aria-label="编辑记录标签"
              placeholder="标签，用逗号分隔"
              value={editTags}
              onChange={(event) => setEditTags(event.target.value)}
              className={`${inputClass} mt-2 w-full`}
            />
            {filteredNotes.some((note) => note.id !== editingNote.id) ? (
              <fieldset className="mt-2">
                <legend className="text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  关联记录
                </legend>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                  {filteredNotes
                    .filter((note) => note.id !== editingNote.id)
                    .map((note) => (
                      <label
                        key={note.id}
                        className="flex items-center gap-1.5 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]"
                      >
                        <input
                          type="checkbox"
                          aria-label={`关联记录：${note.title}`}
                          checked={editRelated.includes(note.id)}
                          onChange={(event) =>
                            setEditRelated((current) =>
                              event.target.checked
                                ? [...current, note.id]
                                : current.filter((id) => id !== note.id)
                            )
                          }
                          className="h-3.5 w-3.5 accent-[#0071e3]"
                        />
                        <span className="max-w-[180px] truncate">{note.title}</span>
                      </label>
                    ))}
                </div>
              </fieldset>
            ) : null}
            {editError ? (
              <p role="alert" className="mt-1 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                {editError}
              </p>
            ) : null}
            <div className="mt-2 flex justify-end gap-1">
              <button
                type="button"
                onClick={() => {
                  setEditingNote(null);
                  setEditError(null);
                }}
                className={actionClass}
              >
                取消
              </button>
              <button
                type="button"
                disabled={!editBody.trim() || savingEdit}
                onClick={() => void saveEditedNote()}
                className={primaryButtonClass}
              >
                保存修改
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {deleteError ? (
        <p role="alert" className="mb-2 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
          {deleteError}
        </p>
      ) : null}

      {filteredNotes.length === 0 ? (
        <Empty
          text="这个项目还没有记录。"
          action="让阿咲记一条"
          onAction={() => onPrompt('记一下：')}
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {visibleNotes.map((note) => (
            <div key={note.id} className="flex items-center gap-2 py-2">
              <button
                type="button"
                onClick={() => onPreviewNote(note)}
                className="flex min-w-0 flex-1 flex-col gap-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
              >
                <span className="truncate text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {note.title}
                </span>
                <span className="truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  {note.subject} · {note.updated}
                </span>
              </button>
              {onUpdateNote ? (
                <button
                  type="button"
                  aria-label={`编辑记录：${note.title}`}
                  onClick={() => startEditNote(note)}
                  className={cn(actionClass, 'shrink-0')}
                >
                  编辑
                </button>
              ) : null}
              {onDeleteNote ? (
                <button
                  type="button"
                  aria-label={
                    confirmDeleteId === note.id
                      ? `确认删除记录：${note.title}`
                      : `删除记录：${note.title}`
                  }
                  disabled={pendingDeleteId === note.id}
                  onClick={() => void deleteNote(note)}
                  className={cn(
                    actionClass,
                    'shrink-0',
                    confirmDeleteId === note.id
                      ? 'text-[#d70015] dark:text-[#ff7b72]'
                      : ''
                  )}
                >
                  {confirmDeleteId === note.id ? '确认删除' : '删除'}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      {filteredNotes.length > 10 ? (
        <button
          type="button"
          onClick={() => setShowAllNotes((current) => !current)}
          className="mt-2 rounded-full px-3 py-1.5 text-[12px] font-medium text-[#0071e3] transition-colors duration-200 hover:bg-[#0071e3]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
        >
          {showAllNotes ? '收起记录' : `查看全部记录（${filteredNotes.length}）`}
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => onPrompt('记一下：')}
        className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
      >
        让阿咲记一条
      </button>
    </section>
  );
}

type MemorySectionProps = {
  workspace: Workspace | null;
  workspaces?: Workspace[];
  memoryRecords: MemoryRecord[];
  onCreateMemory?: (input: CreateMemoryInput) => Promise<MemoryRecord>;
  onUpdateMemory: (input: UpdateMemoryInput) => Promise<MemoryRecord>;
  onDeleteMemory: (input: DeleteMemoryInput) => Promise<void>;
};

export function MemorySection({
  workspace,
  workspaces = [],
  memoryRecords,
  onCreateMemory,
  onUpdateMemory,
  onDeleteMemory
}: MemorySectionProps) {
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [memoryText, setMemoryText] = useState('');
  const [memoryKind, setMemoryKind] = useState<MemoryKind>('fact');
  const [memoryError, setMemoryError] = useState<{ id: string; message: string } | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [confirmMemoryId, setConfirmMemoryId] = useState<string | null>(null);
  const [pendingMemoryId, setPendingMemoryId] = useState<string | null>(null);
  const [creatingMemory, setCreatingMemory] = useState(false);
  const [newMemoryText, setNewMemoryText] = useState('');
  const [newMemoryKind, setNewMemoryKind] = useState<MemoryKind>('preference');
  const [newMemoryWorkspaceId, setNewMemoryWorkspaceId] = useState('');
  const [creatingMemoryPending, setCreatingMemoryPending] = useState(false);
  const filteredMemories = filterMemories(memoryRecords, workspace);
  const targetWorkspaceId =
    workspace?.id ?? (newMemoryWorkspaceId || workspaces[0]?.id || '');

  async function createMemory() {
    if (!onCreateMemory || creatingMemoryPending) return;
    const text = newMemoryText.trim();
    if (!targetWorkspaceId) {
      setMemoryError({ id: 'new', message: '请选择一个项目。' });
      return;
    }
    if (!text) {
      setMemoryError({ id: 'new', message: '记忆内容不能为空。' });
      return;
    }
    setCreatingMemoryPending(true);
    setMemoryError(null);
    try {
      await onCreateMemory({
        workspaceId: targetWorkspaceId,
        text,
        kind: newMemoryKind
      });
      setNewMemoryText('');
      setNewMemoryKind('preference');
      setCreatingMemory(false);
    } catch (cause) {
      setMemoryError({ id: 'new', message: messageOf(cause) });
    } finally {
      setCreatingMemoryPending(false);
    }
  }

  function startMemoryEdit(record: MemoryRecord) {
    setEditingMemoryId(record.id);
    setMemoryText(record.text);
    setMemoryKind(record.kind);
    setMemoryError(null);
    setConfirmMemoryId(null);
  }

  function cancelMemoryEdit() {
    setEditingMemoryId(null);
    setMemoryError(null);
  }

  async function saveMemory(record: MemoryRecord) {
    if (savingMemory) return;
    const text = memoryText.trim();
    if (!text) {
      setMemoryError({ id: record.id, message: '记忆内容不能为空。' });
      return;
    }
    setSavingMemory(true);
    setMemoryError(null);
    try {
      await onUpdateMemory({
        workspaceId: record.workspaceId,
        id: record.id,
        text,
        kind: memoryKind
      });
      setEditingMemoryId(null);
    } catch (cause) {
      setMemoryError({ id: record.id, message: messageOf(cause) });
    } finally {
      setSavingMemory(false);
    }
  }

  async function removeMemory(record: MemoryRecord) {
    if (confirmMemoryId !== record.id) {
      setConfirmMemoryId(record.id);
      setMemoryError(null);
      return;
    }
    setPendingMemoryId(record.id);
    setMemoryError(null);
    try {
      await onDeleteMemory({ workspaceId: record.workspaceId, id: record.id });
      setConfirmMemoryId(null);
      setEditingMemoryId((current) => (current === record.id ? null : current));
    } catch (cause) {
      setMemoryError({ id: record.id, message: messageOf(cause) });
    } finally {
      setPendingMemoryId(null);
    }
  }

  const createForm = onCreateMemory ? (
    <div className="mb-3">
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          onClick={() => {
            setCreatingMemory((current) => !current);
            setMemoryError(null);
          }}
          className={actionClass}
        >
          {creatingMemory ? '收起' : '新增记忆'}
        </button>
      </div>
      {creatingMemory ? (
        <form
          aria-label="新增记忆"
          onSubmit={(event) => {
            event.preventDefault();
            void createMemory();
          }}
          className="rounded-2xl bg-[#f5f5f7] p-3 dark:bg-white/[0.06]"
        >
          {!workspace && workspaces.length > 0 ? (
            <Select
              aria-label="新记忆项目"
              size="sm"
              value={targetWorkspaceId}
              onChange={(event) => setNewMemoryWorkspaceId(event.target.value)}
              className="mb-2"
              disabled={savingMemory}
            >
              {workspaces.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </Select>
          ) : null}
          <textarea
            aria-label="新记忆内容"
            placeholder="记一条你希望阿咲记住的事实或偏好"
            rows={3}
            value={newMemoryText}
            onChange={(event) => setNewMemoryText(event.target.value)}
            className={`${inputClass} w-full resize-none leading-6`}
          />
          <Select
            aria-label="新记忆类型"
            size="sm"
            value={newMemoryKind}
            onChange={(event) => setNewMemoryKind(event.target.value as MemoryKind)}
            className="mt-1"
            disabled={savingMemory}
          >
            {MEMORY_KIND_ORDER.map((kind) => (
              <option key={kind} value={kind}>
                {MEMORY_KIND_LABELS[kind]}
              </option>
            ))}
          </Select>
          {memoryError?.id === 'new' ? (
            <p role="alert" className="mt-1 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
              {memoryError.message}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => {
                setCreatingMemory(false);
                setMemoryError(null);
              }}
              className={actionClass}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!newMemoryText.trim() || creatingMemoryPending}
              className={primaryButtonClass}
            >
              保存新记忆
            </button>
          </div>
        </form>
      ) : null}
    </div>
  ) : null;

  if (filteredMemories.length === 0) {
    return (
      <div>
        {createForm}
        <div className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-6 text-center dark:border-white/10">
          <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            还没有记忆。完成一次复盘后，阿咲会记住你的卡点和偏好。
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {createForm}
      <div className="space-y-2">
      {filteredMemories.map((memory) => {
        const editing = editingMemoryId === memory.id;
        const confirming = confirmMemoryId === memory.id;
        return (
          <div
            key={memory.id}
            className="rounded-2xl bg-white p-4 shadow-sm dark:bg-[#1c1c1e]"
          >
            <div className="flex items-center justify-between gap-1">
              <span
                className={cn(
                  'rounded-full px-2 py-1 text-[11px] font-medium',
                  memoryKindClass(memory.kind)
                )}
              >
                {MEMORY_KIND_LABELS[memory.kind]}
              </span>
              {!editing ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`编辑记忆：${memory.text}`}
                    disabled={pendingMemoryId === memory.id}
                    onClick={() => startMemoryEdit(memory)}
                    className={actionClass}
                  >
                    编辑
                  </button>
                  <button
                    type="button"
                    aria-label={
                      confirming
                        ? `确认删除记忆：${memory.text}`
                        : `删除记忆：${memory.text}`
                    }
                    disabled={pendingMemoryId === memory.id}
                    onClick={() => void removeMemory(memory)}
                    className={cn(actionClass, confirming ? 'text-[#d70015] dark:text-[#ff7b72]' : '')}
                  >
                    {confirming ? '确认删除' : '删除'}
                  </button>
                </div>
              ) : null}
            </div>

            {editing ? (
              <div className="mt-1">
                <textarea
                  aria-label="记忆内容"
                  rows={3}
                  value={memoryText}
                  onChange={(event) => setMemoryText(event.target.value)}
                  className="w-full resize-none rounded-xl border-0 bg-[#f5f5f7] px-3 py-2 text-[13px] leading-6 text-[#1d1d1f] outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#f5f5f7]"
                />
                <Select
                  aria-label="记忆类型"
                  size="sm"
                  value={memoryKind}
                  onChange={(event) =>
                    setMemoryKind(event.target.value as MemoryKind)
                  }
                  className="mt-1"
                  disabled={savingMemory}
                >
                  {MEMORY_KIND_ORDER.map((kind) => (
                    <option key={kind} value={kind}>
                      {MEMORY_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
                {memoryError?.id === memory.id ? (
                  <p role="alert" className="mt-1 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                    {memoryError.message}
                  </p>
                ) : null}
                <div className="mt-2 flex justify-end gap-1">
                  <button
                    type="button"
                    onClick={cancelMemoryEdit}
                    className={actionClass}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={!memoryText.trim() || savingMemory}
                    onClick={() => void saveMemory(memory)}
                    className={primaryButtonClass}
                  >
                    保存记忆
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="mt-2 text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
                  {memory.text}
                </p>
                <p className="mt-1.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                  {memorySourceLabel(memory.source)}
                </p>
                <p className="text-[12px] text-gray-400 dark:text-[#8e8e93]">
                  {memoryWhyRemembered(memory)}
                </p>
                {memoryError?.id === memory.id ? (
                  <p role="alert" className="mt-1 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                    {memoryError.message}
                  </p>
                ) : null}
              </>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

type ReviewSectionProps = {
  workspace: Workspace | null;
  reviews: ReviewRecord[];
  onPrompt: (prompt: string) => void;
};

export function ReviewSection({ workspace, reviews, onPrompt }: ReviewSectionProps) {
  const filteredReviews = filterReviews(reviews, workspace);
  const latestReview = filteredReviews[0];

  if (filteredReviews.length === 0) {
    return (
      <Empty
        text="还没有复盘记录。"
        action="开始今天复盘"
        onAction={() => onPrompt('我们开始今天复盘')}
      />
    );
  }

  return (
    <div>
      {latestReview ? (
        <div className="rounded-2xl bg-white p-5 shadow-sm dark:bg-[#1c1c1e]">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
              {latestReview.date}
            </span>
            <span className="text-[11px] text-gray-500 dark:text-[#8e8e93]">最近一次</span>
          </div>
          <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
            {latestReview.completed || '没有填写完成内容'}
          </p>
          {latestReview.stuck ? (
            <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-[#d70015] dark:text-[#ff7b72]">
              卡点：{latestReview.stuck}
            </p>
          ) : null}
        </div>
      ) : null}

      <h3 className="mb-2 mt-6 text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
        最近复盘
      </h3>
      <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
        {filteredReviews.map((review) => (
          <div key={`${review.date}-${review.submittedAt}`} className="py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                {review.date}
              </span>
              <span className="text-[11px] text-gray-500 dark:text-[#8e8e93]">
                {review.workspaceId
                  ? workspace?.id === review.workspaceId
                    ? workspace.name
                    : '项目复盘'
                  : '全局复盘'}
              </span>
            </div>
            <p className="mt-1 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">
              完成：{review.completed || '—'}
            </p>
            <p className="text-[13px] leading-6 text-[#d70015] dark:text-[#ff7b72]">
              卡点：{review.stuck || '—'}
            </p>
            <p className="text-[13px] leading-6 text-[#0071e3] dark:text-[#4da3ff]">
              明天：{review.tomorrow || '—'}
            </p>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onPrompt('我们开始今天复盘')}
        className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
      >
        开始复盘
      </button>
    </div>
  );
}

function ReminderStateChip({ reminder, today }: { reminder: Reminder; today: string }) {
  const state = reminderStateOf(reminder, today);
  const chip = REMINDER_STATE_CHIPS[state];
  // The postponed time belongs in the badge itself: a tooltip is not visible at
  // a glance, and users need to know when the reminder will actually fire.
  const postponedTime =
    state === 'postponed' && reminder.postponedTo
      ? reminder.postponedTo.slice(11, 16)
      : null;
  const failedReason = state === 'failed' && reminder.lastError ? reminder.lastError : null;
  const detail = postponedTime ?? failedReason;
  return (
    <span
      data-reminder-state={state}
      title={
        postponedTime && reminder.postponedTo
          ? shortLocalDateTime(reminder.postponedTo)
          : detail ?? chip.label
      }
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
        chip.className
      )}
    >
      {detail ? `${chip.label} · ${detail}` : chip.label}
    </span>
  );
}

type CommitmentsSectionProps = {
  /** Every promise: open first, closed appended, as the service projects them. */
  commitments: CommitmentSummary[];
  workspaces: Workspace[];
  today: string;
  onResolve: (input: ResolveCommitmentEntryInput) => Promise<CommitmentSummary>;
  onPrompt: (prompt: string) => void;
};

/**
 * 「承诺」: the promises the user spoke in chat, with the three corrections the
 * reminders page now owns (改期 / 放下 / 完成). These are not tasks; the copy
 * says so. A project opted out of check-ins still shows its promise, tagged so
 * the user is not left wondering why it was never asked about.
 */
export function CommitmentsSection({
  commitments,
  workspaces,
  today,
  onResolve,
  onPrompt
}: CommitmentsSectionProps) {
  const [showResolved, setShowResolved] = useState(false);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkInOff = new Set(
    workspaces.filter((workspace) => workspace.checkIn === 'off').map((workspace) => workspace.id)
  );
  const open = commitments
    .filter((entry) => entry.status === 'open')
    .sort(
      (a, b) =>
        Number(b.due < today) - Number(a.due < today) ||
        a.due.localeCompare(b.due) ||
        (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    );
  const resolved = commitments.filter((entry) => entry.status !== 'open');
  const maxDate = addLocalDays(today, 365);

  async function runAction(
    entry: CommitmentSummary,
    input: ResolveCommitmentEntryInput
  ): Promise<void> {
    setPendingId(entry.id);
    setError(null);
    try {
      await onResolve(input);
      setReschedulingId(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setPendingId(null);
    }
  }

  async function saveReschedule(entry: CommitmentSummary): Promise<void> {
    const due = rescheduleDate.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      setError('请选择一个新的日期。');
      return;
    }
    // "Not before today" is the service's rule, not the UI's: it holds for
    // every caller (IPC, the butler tool, a script), so the UI does not keep a
    // second copy. Only the one-year UX cap stays here, next to the date
    // picker's own max.
    if (due > maxDate) {
      setError('新日期不能超过 365 天以后。');
      return;
    }
    await runAction(entry, { id: entry.id, action: 'reschedule', due });
  }

  function overdueDays(entry: CommitmentSummary): number | null {
    const days = daysUntilTarget(entry.due, today);
    return days !== null && days < 0 ? -days : null;
  }

  function startReschedule(entry: CommitmentSummary): void {
    setError(null);
    setReschedulingId(entry.id);
    setRescheduleDate(entry.due < today ? today : entry.due);
  }

  return (
    <div className="mt-8">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
          承诺
        </h3>
        <button
          type="button"
          role="switch"
          aria-checked={showResolved}
          aria-label="显示已结束"
          onClick={() => setShowResolved((current) => !current)}
          className={actionClass}
        >
          {showResolved ? '隐藏已结束' : '显示已结束'}
        </button>
      </div>
      <p className="mb-3 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
        你说过的、还开着的事。这里能改日期，也能放下。
      </p>
      {error ? (
        <p role="alert" className="mb-2 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
          {error}
        </p>
      ) : null}
      {open.length === 0 && (!showResolved || resolved.length === 0) ? (
        <div className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-6 text-center dark:border-white/10">
          <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            还没有记下的承诺。你在对话里说「我明天做 X」，阿咲才会记一条。
          </p>
          <button
            type="button"
            onClick={() => onPrompt('我明天想做：')}
            className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
          >
            在对话里说一件事
          </button>
        </div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {open.map((entry) => {
            const overdue = overdueDays(entry);
            const busy = pendingId === entry.id;
            const editing = reschedulingId === entry.id;
            const off = entry.workspaceId !== undefined && checkInOff.has(entry.workspaceId);
            return (
              <div key={entry.id} className="py-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span className="min-w-0 flex-1 text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {entry.text}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-[#a1a1a6]">
                    原定 {entry.due.slice(5)}
                    {overdue !== null ? ` · 已过期 ${overdue} 天` : ''}
                  </span>
                  {off ? (
                    <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[11px] text-gray-400 dark:bg-white/[0.08] dark:text-[#8e8e93]">
                      不会主动问你
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`改期：${entry.text}`}
                    disabled={busy}
                    onClick={() => startReschedule(entry)}
                    className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                  >
                    改期
                  </button>
                  <button
                    type="button"
                    aria-label={`放下：${entry.text}`}
                    disabled={busy}
                    onClick={() => void runAction(entry, { id: entry.id, action: 'drop' })}
                    className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                  >
                    放下
                  </button>
                  <button
                    type="button"
                    aria-label={`完成：${entry.text}`}
                    disabled={busy}
                    onClick={() => void runAction(entry, { id: entry.id, action: 'done' })}
                    className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                  >
                    完成
                  </button>
                </div>
                {editing ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      type="date"
                      aria-label={`新日期：${entry.text}`}
                      value={rescheduleDate}
                      min={today}
                      max={maxDate}
                      onChange={(event) => setRescheduleDate(event.target.value)}
                      className={`${inputClass} w-[150px] shrink-0`}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveReschedule(entry)}
                      className={primaryButtonClass}
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReschedulingId(null);
                        setError(null);
                      }}
                      className={actionClass}
                    >
                      取消
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
          {showResolved
            ? resolved.map((entry) => (
                <div key={entry.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <span className="min-w-0 flex-1 text-[13px] text-gray-400 line-through dark:text-[#8e8e93]">
                    {entry.text}
                  </span>
                  <span className="shrink-0 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                    {entry.status === 'done' ? '已完成' : '已放下'}
                    {entry.resolvedAt && isLocalDate(entry.resolvedAt.slice(0, 10))
                      ? ` · ${formatMonthDay(entry.resolvedAt.slice(0, 10))}`
                      : ''}
                  </span>
                </div>
              ))
            : null}
        </div>
      )}
      <p className="mt-2 text-[11px] leading-5 text-gray-400 dark:text-[#8e8e93]">
        这是你答应的事，不是任务。
      </p>
    </div>
  );
}

type RemindersSectionProps = {
  reminders: Reminder[];
  /** The shell's single clock, forwarded here — never re-derived in the section. */
  today: string;
  onCreateReminder: (input: CreateReminderInput) => Promise<Reminder>;
  onUpdateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  onDeleteReminder?: (input: DeleteReminderInput) => Promise<void>;
  snoozedUntil: string;
  onSnoozeCheckIns: (days: number) => void;
  onResumeCheckIns: () => void;
  onPrompt: (prompt: string) => void;
};

export function RemindersSection({
  reminders,
  today,
  onCreateReminder,
  onUpdateReminder,
  onDeleteReminder,
  snoozedUntil,
  onSnoozeCheckIns,
  onResumeCheckIns,
  onPrompt
}: RemindersSectionProps) {
  const [reminderTime, setReminderTime] = useState(() => nextReminderTime());
  const [reminderLabel, setReminderLabel] = useState('');
  const [reminderRepeat, setReminderRepeat] = useState<ReminderRepeat>('daily');
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [pendingReminderId, setPendingReminderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTime, setEditTime] = useState('');
  const [editLabel, setEditLabel] = useState('');
  const [editRepeat, setEditRepeat] = useState<ReminderRepeat>('daily');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [lifecycleNotice, setLifecycleNotice] = useState<string | null>(null);
  // The stored date is the last muted day; today is only used to choose the
  // copy, never to re-derive the target date. It comes from the caller so the
  // badge, the 重新启用 button and the mute copy all share one clock with the
  // rest of the page — a clock this section does not own.
  const muted = isMutedOn(snoozedUntil, today);

  async function addReminder() {
    const label = reminderLabel.trim();
    if (!label || creatingReminder) return;
    setCreatingReminder(true);
    setReminderError(null);
    try {
      const days = daysOfRepeat(reminderRepeat);
      await onCreateReminder({ time: reminderTime, label, ...(days ? { days } : {}) });
      setReminderLabel('');
      setReminderTime(nextReminderTime());
      setReminderRepeat('daily');
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

  /** Lifecycle action: 延后 by N minutes, 标为完成, or 重新启用. */
  async function changeReminderLifecycle(
    reminder: Reminder,
    patch: Pick<UpdateReminderInput, 'state' | 'postponeMinutes' | 'enabled'>
  ) {
    setPendingReminderId(reminder.id);
    setReminderError(null);
    setLifecycleNotice(null);
    try {
      await onUpdateReminder({ id: reminder.id, ...patch });
      // One factual line after 标为完成; nothing pops up.
      if (patch.state === 'done') setLifecycleNotice(completionNotice(reminder, today));
    } catch (cause) {
      setReminderError(messageOf(cause));
    } finally {
      setPendingReminderId(null);
    }
  }

  function startReminderEdit(reminder: Reminder) {
    setEditingId(reminder.id);
    setEditTime(reminder.time);
    setEditLabel(reminder.label);
    setEditRepeat(repeatOf(reminder.days));
    setReminderError(null);
  }

  async function saveReminderEdit(reminder: Reminder) {
    const label = editLabel.trim();
    if (!label) {
      setReminderError('请填写提醒内容。');
      return;
    }
    setPendingReminderId(reminder.id);
    setReminderError(null);
    try {
      const days = daysOfRepeat(editRepeat);
      await onUpdateReminder({
        id: reminder.id,
        time: editTime,
        label,
        days: days ?? null
      });
      setEditingId(null);
    } catch (cause) {
      setReminderError(messageOf(cause));
    } finally {
      setPendingReminderId(null);
    }
  }

  async function deleteReminder(reminder: Reminder) {
    if (!onDeleteReminder) return;
    if (confirmDeleteId !== reminder.id) {
      setConfirmDeleteId(reminder.id);
      return;
    }
    setPendingReminderId(reminder.id);
    setReminderError(null);
    try {
      await onDeleteReminder({ id: reminder.id });
      setConfirmDeleteId(null);
      if (editingId === reminder.id) setEditingId(null);
    } catch (cause) {
      setReminderError(messageOf(cause));
    } finally {
      setPendingReminderId(null);
    }
  }

  function repeatSelect(
    label: string,
    value: ReminderRepeat,
    onChange: (next: ReminderRepeat) => void,
    disabled = false
  ) {
    return (
      <Select
        aria-label={label}
        size="sm"
        fullWidth={false}
        value={value}
        onChange={(event) => onChange(event.target.value as ReminderRepeat)}
        className="w-[96px] shrink-0"
        disabled={disabled}
      >
        <option value="daily">每天</option>
        <option value="weekdays">工作日</option>
        <option value="weekend">周末</option>
        {value === 'custom' ? <option value="custom">自定义</option> : null}
      </Select>
    );
  }

  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void addReminder();
        }}
        className="mb-4 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-white/[0.06]"
      >
        <div className="flex items-center gap-2">
          <input
            type="time"
            aria-label="提醒时间"
            value={reminderTime}
            onChange={(event) => setReminderTime(event.target.value)}
            className={`${inputClass} w-[108px] shrink-0 tabular-nums`}
          />
          <input
            aria-label="提醒内容"
            placeholder="提醒内容"
            value={reminderLabel}
            onChange={(event) => setReminderLabel(event.target.value)}
            className={`${inputClass} flex-1`}
          />
          {repeatSelect('提醒重复', reminderRepeat, setReminderRepeat, creatingReminder)}
        </div>
        {reminderError ? (
          <p role="alert" className="mt-1 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
            {reminderError}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end">
          <button
            type="submit"
            disabled={!reminderLabel.trim() || creatingReminder}
            className={primaryButtonClass}
          >
            添加提醒
          </button>
        </div>
      </form>

      <p className="mb-2 text-[12px] text-gray-500 dark:text-[#8e8e93]">全部提醒</p>
      <p
        data-reminder-rule="true"
        className="mb-3 rounded-xl bg-[#f5f5f7] px-3 py-2 text-[12px] leading-5 text-gray-500 dark:bg-white/[0.06] dark:text-[#8e8e93]"
      >
        提醒只在 ASAKI 运行时发出。电脑休眠醒来后，错过的那次最多补一次，不会重复播放；应用退出期间不会提醒。
      </p>
      {lifecycleNotice ? (
        <p
          role="status"
          className="mb-3 text-[12px] leading-5 text-[#1d7f3a] dark:text-[#7ee2a0]"
        >
          {lifecycleNotice}
        </p>
      ) : null}
      {reminders.length === 0 ? (
        <Empty
          text="还没有提醒。"
          action="让阿咲设提醒"
          onAction={() => onPrompt('帮我设一个提醒：')}
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {reminders.map((reminder) => (
            <div key={reminder.id} className="py-2">
              {editingId === reminder.id ? (
                <form
                  aria-label={`编辑提醒：${reminder.label}`}
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveReminderEdit(reminder);
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <input
                    type="time"
                    aria-label="编辑提醒时间"
                    value={editTime}
                    onChange={(event) => setEditTime(event.target.value)}
                    className={`${inputClass} w-[108px] shrink-0 tabular-nums`}
                  />
                  <input
                    aria-label="编辑提醒内容"
                    value={editLabel}
                    onChange={(event) => setEditLabel(event.target.value)}
                    className={`${inputClass} min-w-[120px] flex-1`}
                  />
                  {repeatSelect(
                    '编辑提醒重复',
                    editRepeat,
                    setEditRepeat,
                    pendingReminderId === reminder.id
                  )}
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className={actionClass}
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    disabled={pendingReminderId === reminder.id}
                    className={primaryButtonClass}
                  >
                    保存
                  </button>
                </form>
              ) : (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      reminder.enabled ? 'bg-[#34c759]' : 'bg-gray-300'
                    )}
                  />
                  <span className="w-10 shrink-0 text-[12px] tabular-nums text-gray-500 dark:text-[#a1a1a6]">
                    {reminder.time}
                  </span>
                  {/* A real minimum width keeps the reminder readable when the
                      six actions need room at the default 890px window; the row
                      wraps the actions instead of squeezing this column to 0. */}
                  <span className="min-w-[6rem] flex-1 truncate text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {reminder.label}
                    <span className="ml-1.5 text-[11px] text-gray-400 dark:text-[#8e8e93]">
                      {repeatLabel(reminder.days)}
                    </span>
                  </span>
                  <ReminderStateChip reminder={reminder} today={today} />
                  {reminderStateOf(reminder, today) === 'done' ? (
                    <button
                      type="button"
                      aria-label={`重新启用：${reminder.label}`}
                      disabled={pendingReminderId === reminder.id}
                      // 重新启用 both clears `done` and turns the schedule switch
                      // back on, so the promise "stops firing until re-enabled"
                      // holds even if the reminder was also switched off.
                      onClick={() =>
                        void changeReminderLifecycle(reminder, {
                          state: 'pending',
                          enabled: true
                        })
                      }
                      className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                    >
                      重新启用
                    </button>
                  ) : reminder.enabled ? (
                    <>
                      <button
                        type="button"
                        aria-label={`延后 10 分钟：${reminder.label}`}
                        disabled={pendingReminderId === reminder.id}
                        onClick={() =>
                          void changeReminderLifecycle(reminder, { postponeMinutes: 10 })
                        }
                        className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                      >
                        延后 10 分钟
                      </button>
                      <button
                        type="button"
                        aria-label={`延后 1 小时：${reminder.label}`}
                        disabled={pendingReminderId === reminder.id}
                        onClick={() =>
                          void changeReminderLifecycle(reminder, { postponeMinutes: 60 })
                        }
                        className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                      >
                        延后 1 小时
                      </button>
                      <button
                        type="button"
                        aria-label={`标为完成：${reminder.label}`}
                        disabled={pendingReminderId === reminder.id}
                        onClick={() => void changeReminderLifecycle(reminder, { state: 'done' })}
                        className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                      >
                        标为完成
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`编辑提醒：${reminder.label}`}
                    disabled={pendingReminderId === reminder.id}
                    onClick={() => startReminderEdit(reminder)}
                    className={cn(actionClass, 'shrink-0 whitespace-nowrap')}
                  >
                    编辑
                  </button>
                  {onDeleteReminder ? (
                    <button
                      type="button"
                      aria-label={
                        confirmDeleteId === reminder.id
                          ? `确认删除提醒：${reminder.label}`
                          : `删除提醒：${reminder.label}`
                      }
                      disabled={pendingReminderId === reminder.id}
                      onClick={() => void deleteReminder(reminder)}
                      className={cn(
                        actionClass,
                        'shrink-0 whitespace-nowrap',
                        confirmDeleteId === reminder.id
                          ? 'text-[#d70015] dark:text-[#ff7b72]'
                          : ''
                      )}
                    >
                      {confirmDeleteId === reminder.id ? '确认删除' : '删除'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={reminder.enabled}
                    aria-label={`${reminder.label} 提醒开关`}
                    disabled={pendingReminderId === reminder.id}
                    onClick={() => void toggleReminder(reminder)}
                    className={cn(
                      'relative h-5 w-9 shrink-0 rounded-full transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100',
                      reminder.enabled ? 'bg-[#0071e3]' : 'bg-gray-300 dark:bg-white/20'
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform duration-300 motion-reduce:transition-none',
                        reminder.enabled ? 'translate-x-[18px]' : 'translate-x-0.5'
                      )}
                    />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-white/[0.06]">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">主动检查</p>
        <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
          仅暂停主动检查，不影响你设的提醒。
        </p>
        {muted ? (
          <>
            <p className="mt-2 text-[12px] text-gray-500 dark:text-[#a1a1a6]">
              {snoozedUntil === today
                ? '今天已静音，明天恢复'
                : `已静音至 ${formatMonthDay(snoozedUntil)}`}
            </p>
            <button
              type="button"
              onClick={onResumeCheckIns}
              className="mt-3 rounded-full bg-black/[0.05] px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-white/10 dark:text-[#f5f5f7]"
            >
              恢复提醒
            </button>
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSnoozeCheckIns(0)}
              className="rounded-full bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
            >
              今天别再提醒我
            </button>
            <button
              type="button"
              onClick={() => onSnoozeCheckIns(3)}
              className="rounded-full bg-black/[0.05] px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-white/10 dark:text-[#f5f5f7]"
            >
              暂停 3 天
            </button>
            <button
              type="button"
              onClick={() => onSnoozeCheckIns(7)}
              className="rounded-full bg-black/[0.05] px-3 py-1.5 text-[13px] font-medium text-[#1d1d1f] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:bg-white/10 dark:text-[#f5f5f7]"
            >
              暂停 7 天
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export type MemoryProfileSummaryProps = {
  profile: LearnerProfile | null;
};

/** Small aggregate shown above the memory list on the memory page. */
export function MemoryProfileSummary({ profile }: MemoryProfileSummaryProps) {
  if (!profile) return null;
  return (
    <div className="mb-5 rounded-2xl bg-[#f5f5f7] p-5 dark:bg-white/[0.06]">
      <p className="text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">{profile.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <span className="rounded-full bg-[#ff3b30]/10 px-2.5 py-1 text-[11px] text-[#d70015] dark:bg-[#ff3b30]/20 dark:text-[#ff7b72]">
          {profile.weaknesses.length} 个薄弱点
        </span>
        <span className="rounded-full bg-[#34c759]/10 px-2.5 py-1 text-[11px] text-[#1d7f3a] dark:bg-[#34c759]/20 dark:text-[#7ee2a0]">
          {profile.strengths.length} 个优势
        </span>
        <span className="rounded-full bg-[#0071e3]/10 px-2.5 py-1 text-[11px] text-[#0071e3] dark:bg-[#0a84ff]/20 dark:text-[#4da3ff]">
          {profile.preferences.length} 个偏好
        </span>
      </div>
    </div>
  );
}
