import { isLocalDateTime } from '../../../shared/date';
import type { NoteMeta, StudyTask, TaskStatus } from '../../../shared/types';
import type { WorkspaceTask } from '../../../shared/workspace';
import { parseNote, serializeNote } from '../../vault/note';
import { asFiniteNumber, asRecord, asString, asStringArray } from './coerce';

/**
 * A task as stored in the vault. Extends the shared StudyTask shape (with
 * `materialRefs`) so the butler module can read the same files through
 * NoteMeta.tasks, plus the workspace-service-only timestamps.
 */
export type TaskRecord = StudyTask & {
  due?: string;
  startAt?: string;
  created?: string;
  updated?: string;
};

const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'in-progress', 'done', 'skipped'];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

function coerceTask(value: unknown): TaskRecord | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const title = asString(record.title);
  if (!id || !title) return null;
  const status = isTaskStatus(record.status) ? record.status : 'pending';
  const startAt = record.startAt;
  return {
    id,
    title,
    subject: asString(record.subject) ?? '',
    durationMin: asFiniteNumber(record.durationMin) ?? 0,
    materialRefs: asStringArray(record.materialRefs),
    acceptance: asString(record.acceptance) ?? '',
    status,
    actualMin: asFiniteNumber(record.actualMin),
    due: asString(record.due),
    ...(isLocalDateTime(startAt) ? { startAt } : {}),
    created: asString(record.created),
    updated: asString(record.updated)
  };
}

export function parseTaskFile(raw: string): TaskRecord[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.tasks)) return [];
  return meta.tasks
    .map(coerceTask)
    .filter((task): task is TaskRecord => task !== null);
}

export function serializeTaskFile(date: string, tasks: readonly TaskRecord[]): string {
  const meta: NoteMeta = { type: 'plan', source: 'user', date, tasks: [...tasks] };
  const lines = tasks.map((task) => {
    const checked = task.status === 'done' ? 'x' : ' ';
    const start = task.startAt ? `${task.startAt.slice(11, 16)} 开始` : '';
    const context = [
      task.subject,
      task.durationMin > 0 ? `${task.durationMin} 分钟` : '',
      start
    ]
      .filter(Boolean)
      .join(' · ');
    const statusLabel =
      task.status === 'in-progress' ? '（进行中）' : task.status === 'skipped' ? '（已跳过）' : '';
    const acceptance = task.acceptance ? ` — ${task.acceptance}` : '';
    return `- [${checked}] ${task.title}${context ? `（${context}）` : ''}${statusLabel}${acceptance}`;
  });
  const body = [`# ${date} 任务`, '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}

export function toWorkspaceTask(record: TaskRecord, workspaceId: string): WorkspaceTask {
  return {
    id: record.id,
    workspaceId,
    title: record.title,
    subject: record.subject,
    durationMin: record.durationMin,
    acceptance: record.acceptance,
    status: record.status,
    actualMin: record.actualMin,
    due: record.due,
    ...(record.startAt ? { startAt: record.startAt } : {}),
    createdAt: record.created,
    updatedAt: record.updated
  };
}
