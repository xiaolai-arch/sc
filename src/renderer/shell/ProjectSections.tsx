import { useState } from 'react';
import { cn } from '../ui/cn';
import { CheckIcon } from '../ui/icons';
import type { ReviewRecord } from '../../shared/ipc';
import type {
  DeleteMemoryInput,
  LearnerProfile,
  MemoryKind,
  MemoryRecord,
  UpdateMemoryInput
} from '../../shared/memory';
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
  onUpdateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
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

export function PlanSection({
  workspace,
  tasks,
  busy = false,
  onUpdateTask,
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
  const filteredTasks = filterTasks(tasks, workspace);
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

  return (
    <section aria-label="计划">
      <SectionHeading title="计划" />
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
  onPrompt: (prompt: string) => void;
};

export function RecordsSection({
  workspace,
  notes,
  onCreateNote,
  onPreviewNote,
  onPrompt
}: RecordsSectionProps) {
  const [noteFormOpen, setNoteFormOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const filteredNotes = filterNotes(notes, workspace);

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
      </div>

      {filteredNotes.length === 0 ? (
        <Empty
          text="这个项目还没有记录。"
          action="让阿咲记一条"
          onAction={() => onPrompt('记一下：')}
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {filteredNotes.slice(0, 10).map((note) => (
            <button
              key={note.id}
              type="button"
              onClick={() => onPreviewNote(note)}
              className="flex w-full flex-col gap-0.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              <span className="truncate text-[14px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                {note.title}
              </span>
              <span className="truncate text-[12px] text-gray-500 dark:text-[#8e8e93]">
                {note.subject} · {note.updated}
              </span>
            </button>
          ))}
        </div>
      )}
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
  memoryRecords: MemoryRecord[];
  onUpdateMemory: (input: UpdateMemoryInput) => Promise<MemoryRecord>;
  onDeleteMemory: (input: DeleteMemoryInput) => Promise<void>;
};

export function MemorySection({
  workspace,
  memoryRecords,
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
  const filteredMemories = filterMemories(memoryRecords, workspace);

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

  if (filteredMemories.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-gray-300/80 px-4 py-6 text-center dark:border-white/10">
        <p className="text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
          还没有记忆。完成一次复盘后，阿咲会记住你的卡点和偏好。
        </p>
      </div>
    );
  }

  return (
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
                <select
                  aria-label="记忆类型"
                  value={memoryKind}
                  onChange={(event) =>
                    setMemoryKind(event.target.value as MemoryKind)
                  }
                  className={`${inputClass} mt-1 w-full`}
                >
                  {MEMORY_KIND_ORDER.map((kind) => (
                    <option key={kind} value={kind}>
                      {MEMORY_KIND_LABELS[kind]}
                    </option>
                  ))}
                </select>
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
      <div>
        <Empty
          text="还没有复盘记录。"
          action="开始今天复盘"
          onAction={() => onPrompt('我们开始今天复盘')}
        />
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

type RemindersSectionProps = {
  reminders: Reminder[];
  onCreateReminder: (input: CreateReminderInput) => Promise<Reminder>;
  onUpdateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  snoozedToday: boolean;
  onSnoozeCheckIns: () => void;
  onPrompt: (prompt: string) => void;
};

export function RemindersSection({
  reminders,
  onCreateReminder,
  onUpdateReminder,
  snoozedToday,
  onSnoozeCheckIns,
  onPrompt
}: RemindersSectionProps) {
  const [reminderTime, setReminderTime] = useState(() => nextReminderTime());
  const [reminderLabel, setReminderLabel] = useState('');
  const [reminderError, setReminderError] = useState<string | null>(null);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [pendingReminderId, setPendingReminderId] = useState<string | null>(null);

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
      {reminders.length === 0 ? (
        <Empty
          text="还没有提醒。"
          action="让阿咲设提醒"
          onAction={() => onPrompt('帮我设一个提醒：')}
        />
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-white/[0.08]">
          {reminders.map((reminder) => (
            <div key={reminder.id} className="flex items-center gap-2 py-2">
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
              <span className="min-w-0 flex-1 truncate text-[13px] text-[#1d1d1f] dark:text-[#f5f5f7]">
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
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onPrompt('帮我设一个提醒：')}
        className="mt-3 rounded-full px-3 py-1.5 text-[13px] font-medium text-[#0071e3] transition-all duration-300 hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
      >
        让阿咲设提醒
      </button>

      <div className="mt-5 rounded-2xl bg-[#f5f5f7] p-4 dark:bg-white/[0.06]">
        <p className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">主动检查</p>
        <p className="mt-1 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
          仅暂停主动检查，不影响你设的提醒。
        </p>
        {snoozedToday ? (
          <p className="mt-2 text-[12px] text-gray-500 dark:text-[#a1a1a6]">今天已静音，明天恢复</p>
        ) : (
          <button
            type="button"
            onClick={onSnoozeCheckIns}
            className="mt-3 rounded-full bg-[#0071e3] px-3 py-1.5 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            今天别再提醒我
          </button>
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
