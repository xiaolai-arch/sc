import { promises as fs } from 'node:fs';
import { posix, resolve } from 'node:path';
import { formatLocalDate } from '../../shared/date';
import { isTaskRepeat, nextRepeatDate } from '../../shared/recurrence';
import type {
  CreateNoteInput,
  CreateReminderInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  DeleteNoteInput,
  DeleteReminderInput,
  DeleteTaskInput,
  MemoryItem,
  Reminder,
  SubmitReviewInput,
  UpdateReminderInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceService,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../../shared/workspace';
import { createMutex, listDirectories, listMarkdownFiles, pathExists, readFileOrNull, writeFileAtomic } from './fs-utils';
import { newId, slugify, uniqueFileName } from './ids';
import {
  assertIsoDate,
  assertLocalDateTime,
  assertSafeSegment,
  memoryFile,
  notesDir,
  remindersFile,
  reviewFile,
  taskFile,
  tasksDir,
  workspaceDir,
  workspaceFile,
  workspacesDir
} from './paths';
import { parseMemoryFile, serializeMemoryFile, toMemoryItem } from './records/memory';
import {
  parseNoteFile,
  serializeNoteFile,
  toWorkspaceNote,
  type NoteRecord
} from './records/notes';
import { parseRemindersFile, serializeRemindersFile } from './records/reminders';
import {
  isTaskStatus,
  parseTaskFile,
  serializeTaskFile,
  toWorkspaceTask,
  type TaskRecord
} from './records/tasks';
import {
  DEFAULT_COLORS,
  isWorkspaceKind,
  parseWorkspaceFile,
  serializeWorkspaceFile
} from './records/workspace';
import {
  parseReviewFile,
  serializeReviewFile,
  type ReviewEntry
} from './records/reviews';
import { ensureSeeded } from './seed';
import { parseNote } from '../vault/note';

/**
 * Append-only files must never be rewritten when the existing file is
 * unreadable: doing so would erase every prior record. A canonical empty list
 * (`items: []`, `tasks: []`, `entries: []`) is safe to extend.
 */
function assertAppendable(raw: string, key: 'items' | 'tasks' | 'entries', label: string): void {
  if (raw.trim() === '') return;
  const value = parseNote(raw).meta[key];
  if (!Array.isArray(value) || value.length > 0) {
    throw new Error(`${label}格式无法识别，已停止写入以保护现有记录。`);
  }
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  return value;
}

function normalizeReminderTime(value: unknown): string {
  const time = requireString(value, 'Reminder time');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    throw new Error('Reminder time must be HH:MM');
  }
  return time;
}

/**
 * Normalizes a weekly repeat. `undefined`/`null`/`[]` mean every day; otherwise
 * de-duplicates and sorts local weekdays (0 = Sunday … 6 = Saturday).
 */
function normalizeReminderDays(value: unknown): number[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new Error('Reminder days must be an array');
  const days = [...new Set(value)].sort((a, b) => a - b);
  for (const day of days) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error('Reminder days must be integers from 0 to 6');
    }
  }
  return days.length > 0 ? days : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * Vault-backed WorkspaceService. The vault (markdown + YAML frontmatter) is the
 * only source of truth — every call re-reads from disk, so a fresh service
 * instance (or an edit made in Obsidian) is picked up immediately. Writes are
 * serialized in-process and land via temp-file + rename.
 */
export interface CreateWorkspaceServiceOptions {
  /** Seed the demo vault on first access. Tests default to true; the app opts out. */
  seed?: boolean;
}

export function createWorkspaceService(
  root: string,
  options: CreateWorkspaceServiceOptions = {}
): WorkspaceService {
  const vaultRoot = resolve(root);
  const runExclusively = createMutex();
  const shouldSeed = options.seed ?? true;
  let seedChecked = false;

  async function ensureVault(): Promise<void> {
    if (seedChecked) return;
    await runExclusively(async () => {
      if (shouldSeed) {
        await ensureSeeded(vaultRoot);
      } else {
        await fs.mkdir(vaultRoot, { recursive: true });
      }
    });
    seedChecked = true;
  }

  async function readWorkspaceOrThrow(workspaceId: string): Promise<Workspace> {
    assertSafeSegment(workspaceId, 'workspace id');
    const raw = await readFileOrNull(workspaceFile(vaultRoot, workspaceId));
    if (raw === null) throw new Error(`Workspace not found: ${workspaceId}`);
    const workspace = parseWorkspaceFile(raw, workspaceId);
    if (workspace === null) throw new Error(`Workspace not found: ${workspaceId}`);
    return workspace;
  }

  async function listWorkspaceRecords(): Promise<Workspace[]> {
    const workspaces: Workspace[] = [];
    for (const dirName of await listDirectories(workspacesDir(vaultRoot))) {
      const raw = await readFileOrNull(workspaceFile(vaultRoot, dirName));
      if (raw === null) continue;
      const workspace = parseWorkspaceFile(raw, dirName);
      if (workspace !== null) workspaces.push(workspace);
    }
    workspaces.sort(
      (a, b) =>
        (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.name.localeCompare(b.name)
    );
    return workspaces;
  }

  async function readWorkspaceTasks(workspaceId: string): Promise<WorkspaceTask[]> {
    const tasks: WorkspaceTask[] = [];
    for (const fileName of await listMarkdownFiles(tasksDir(vaultRoot, workspaceId))) {
      const raw = await readFileOrNull(`${tasksDir(vaultRoot, workspaceId)}/${fileName}`);
      if (raw === null) continue;
      for (const record of parseTaskFile(raw)) {
        tasks.push(toWorkspaceTask(record, workspaceId));
      }
    }
    return tasks;
  }

  async function readWorkspaceNotes(workspaceId: string): Promise<WorkspaceNote[]> {
    const dir = notesDir(vaultRoot, workspaceId);
    const notes: WorkspaceNote[] = [];
    for (const fileName of await listMarkdownFiles(dir)) {
      const absPath = `${dir}/${fileName}`;
      const [raw, stat] = await Promise.all([
        readFileOrNull(absPath),
        fs.stat(absPath).catch(() => null)
      ]);
      if (raw === null) continue;
      const fallbackId = fileName.replace(/\.md$/, '');
      const fallbackDate = stat ? stat.mtime.toISOString() : new Date().toISOString();
      const record = parseNoteFile(raw, fallbackId, fallbackDate);
      if (record === null) continue;
      const vaultPath = posix.join('workspaces', workspaceId, 'notes', fileName);
      notes.push(toWorkspaceNote(record, workspaceId, vaultPath));
    }
    notes.sort((a, b) => b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title));
    return notes;
  }

  async function readMemoryEntries(workspaceId: string): Promise<MemoryItem[]> {
    const raw = await readFileOrNull(memoryFile(vaultRoot, workspaceId));
    if (raw === null) return [];
    return parseMemoryFile(raw).map((entry) => toMemoryItem(entry, workspaceId));
  }

  async function readReminders(): Promise<Reminder[]> {
    const raw = await readFileOrNull(remindersFile(vaultRoot));
    return raw === null ? [] : parseRemindersFile(raw);
  }

  /** Finds the task file holding `taskId`; returns its parsed records and path. */
  async function findTaskFile(
    taskId: string
  ): Promise<{ path: string; date: string; workspaceId: string; records: TaskRecord[]; index: number } | null> {
    for (const dirName of await listDirectories(workspacesDir(vaultRoot))) {
      const dir = tasksDir(vaultRoot, dirName);
      for (const fileName of await listMarkdownFiles(dir)) {
        const raw = await readFileOrNull(`${dir}/${fileName}`);
        if (raw === null) continue;
        const records = parseTaskFile(raw);
        const index = records.findIndex((record) => record.id === taskId);
        if (index >= 0) {
          return { path: `${dir}/${fileName}`, date: fileName.replace(/\.md$/, ''), workspaceId: dirName, records, index };
        }
      }
    }
    return null;
  }

  /** Finds the note file holding `noteId`. */
  async function findNoteFile(
    noteId: string
  ): Promise<{ path: string; workspaceId: string; fileName: string; record: NoteRecord } | null> {
    for (const dirName of await listDirectories(workspacesDir(vaultRoot))) {
      const dir = notesDir(vaultRoot, dirName);
      for (const fileName of await listMarkdownFiles(dir)) {
        const absPath = `${dir}/${fileName}`;
        const raw = await readFileOrNull(absPath);
        if (raw === null) continue;
        const fallbackId = fileName.replace(/\.md$/, '');
        const record = parseNoteFile(raw, fallbackId, new Date().toISOString());
        if (record !== null && record.id === noteId) {
          return { path: absPath, workspaceId: dirName, fileName, record };
        }
      }
    }
    return null;
  }

  return {
    async listWorkspaces(): Promise<Workspace[]> {
      await ensureVault();
      return listWorkspaceRecords();
    },

    async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
      await ensureVault();
      const name = requireString(input?.name, 'Workspace name');
      const kind = input?.kind;
      if (!isWorkspaceKind(kind)) throw new Error('Invalid workspace kind');
      const workspace: Workspace = {
        id: '',
        name,
        kind,
        color: optionalString(input?.color) ?? DEFAULT_COLORS[kind],
        goal: optionalString(input.goal) ?? '',
        description: optionalString(input.description) ?? '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      await runExclusively(async () => {
        const taken = new Set(await listDirectories(workspacesDir(vaultRoot)));
        const base = slugify(name, 'workspace');
        let candidate = base;
        for (let index = 2; taken.has(candidate); index += 1) candidate = `${base}-${index}`;
        workspace.id = candidate;
        await writeFileAtomic(workspaceFile(vaultRoot, workspace.id), serializeWorkspaceFile(workspace));
      });
      return workspace;
    },

    async updateWorkspace(input: UpdateWorkspaceInput): Promise<Workspace> {
      await ensureVault();
      const workspaceId = requireString(input?.workspaceId, 'Workspace id');
      const name =
        input?.name !== undefined ? requireString(input.name, 'Workspace name') : undefined;
      const goal =
        input?.goal !== undefined ? optionalString(input.goal) : undefined;
      const description =
        input?.description !== undefined ? optionalString(input.description) : undefined;
      const rawCheckIn = (input as { checkIn?: unknown } | undefined)?.checkIn;
      const checkIn =
        rawCheckIn === undefined
          ? undefined
          : rawCheckIn === 'daily' || rawCheckIn === 'off'
            ? rawCheckIn
            : (() => {
                throw new Error('Invalid check-in preference');
              })();
      if (
        name === undefined &&
        goal === undefined &&
        description === undefined &&
        checkIn === undefined
      ) {
        throw new Error('No workspace fields to update');
      }
      return runExclusively(async () => {
        const current = await readWorkspaceOrThrow(workspaceId);
        const next: Workspace = {
          ...current,
          ...(name !== undefined ? { name } : {}),
          ...(goal !== undefined ? { goal } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(checkIn !== undefined ? { checkIn } : {}),
          updatedAt: new Date().toISOString()
        };
        await writeFileAtomic(
          workspaceFile(vaultRoot, workspaceId),
          serializeWorkspaceFile(next)
        );
        return next;
      });
    },

    async deleteWorkspace(workspaceId: string): Promise<void> {
      await ensureVault();
      const id = requireString(workspaceId, 'Workspace id');
      assertSafeSegment(id, 'workspace id');
      await runExclusively(async () => {
        await readWorkspaceOrThrow(id);
        const trashDir = posix.join(workspacesDir(vaultRoot), '.trash');
        await fs.mkdir(trashDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        let target = posix.join(trashDir, `${id}-${stamp}`);
        for (let index = 2; await pathExists(target); index += 1) {
          target = posix.join(trashDir, `${id}-${stamp}-${index}`);
        }
        await fs.rename(workspaceDir(vaultRoot, id), target);
      });
    },

    async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
      await ensureVault();
      const workspace = await readWorkspaceOrThrow(workspaceId);
      const [tasks, notes, memory, reminders] = await Promise.all([
        readWorkspaceTasks(workspace.id),
        readWorkspaceNotes(workspace.id),
        readMemoryEntries(workspace.id),
        readReminders()
      ]);
      return { workspace, tasks, notes, memory, reminders };
    },

    async createTask(input: CreateTaskInput): Promise<WorkspaceTask> {
      await ensureVault();
      const workspaceId = requireString(input?.workspaceId, 'Workspace id');
      await readWorkspaceOrThrow(workspaceId);
      const title = requireString(input?.title, 'Task title');
      const due = input?.due === undefined ? undefined : assertIsoDate(input.due, 'task due date');
      const startAt =
        input?.startAt === undefined
          ? undefined
          : assertLocalDateTime(input.startAt, 'task start time');
      if (input?.repeat !== undefined && !isTaskRepeat(input.repeat)) {
        throw new Error('Invalid task repeat rule');
      }
      const record: TaskRecord = {
        id: newId('t'),
        title,
        subject: optionalString(input?.subject) ?? '',
        durationMin:
          typeof input?.durationMin === 'number' && Number.isFinite(input.durationMin) && input.durationMin >= 0
            ? Math.round(input.durationMin)
            : 0,
        materialRefs: [],
        acceptance: optionalString(input?.acceptance) ?? '',
        status: 'pending',
        due,
        ...(startAt ? { startAt } : {}),
        ...(input?.repeat ? { repeat: input.repeat } : {}),
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      };
      const date = startAt?.slice(0, 10) ?? due ?? formatLocalDate(new Date());
      await runExclusively(async () => {
        const existingRaw = await readFileOrNull(taskFile(vaultRoot, workspaceId, date));
        const records = existingRaw === null ? [] : parseTaskFile(existingRaw);
        if (existingRaw !== null && records.length === 0) {
          assertAppendable(existingRaw, 'tasks', '任务文件');
        }
        await writeFileAtomic(
          taskFile(vaultRoot, workspaceId, date),
          serializeTaskFile(date, [...records, record])
        );
      });
      return toWorkspaceTask(record, workspaceId);
    },

    async updateWorkspaceTask(input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask> {
      await ensureVault();
      const taskId = requireString(input?.taskId, 'Task id');
      assertSafeSegment(taskId, 'task id');
      const hasStatus = input?.status !== undefined;
      const hasStartAt = input?.startAt !== undefined;
      const hasTitle = input?.title !== undefined;
      const hasSubject = input?.subject !== undefined;
      const hasDuration = input?.durationMin !== undefined;
      const hasAcceptance = input?.acceptance !== undefined;
      const hasDue = input?.due !== undefined;
      const hasRepeat = input?.repeat !== undefined;
      if (
        !hasStatus &&
        !hasStartAt &&
        !hasTitle &&
        !hasSubject &&
        !hasDuration &&
        !hasAcceptance &&
        !hasDue &&
        !hasRepeat
      ) {
        throw new Error('No task fields to update');
      }
      if (hasRepeat && input.repeat !== null && !isTaskRepeat(input.repeat)) {
        throw new Error('Invalid task repeat rule');
      }
      const status = input?.status;
      if (hasStatus && !isTaskStatus(status)) throw new Error('Invalid task status');
      const startAt =
        input?.startAt === undefined || input.startAt === null
          ? input?.startAt
          : assertLocalDateTime(input.startAt, 'task start time');
      const actualMin =
        input?.actualMin === undefined
          ? undefined
          : typeof input.actualMin === 'number' && Number.isFinite(input.actualMin) && input.actualMin >= 0
            ? Math.round(input.actualMin)
            : undefined;
      const title = hasTitle ? requireString(input.title, 'Task title') : undefined;
      const subject = hasSubject ? optionalString(input.subject) ?? '' : undefined;
      const acceptance = hasAcceptance ? optionalString(input.acceptance) ?? '' : undefined;
      const durationMin =
        input?.durationMin === undefined
          ? undefined
          : typeof input.durationMin === 'number' &&
              Number.isFinite(input.durationMin) &&
              input.durationMin >= 0
            ? Math.round(input.durationMin)
            : undefined;
      if (hasDuration && durationMin === undefined) {
        throw new Error('Task duration must be a non-negative number');
      }
      const due =
        input?.due === undefined || input.due === null
          ? input?.due
          : assertIsoDate(input.due, 'task due date');
      return runExclusively(async () => {
        const found = await findTaskFile(taskId);
        if (found === null) throw new Error(`Task not found: ${taskId}`);
        const record = found.records[found.index];
        if (record === undefined) throw new Error(`Task not found: ${taskId}`);
        const wasDone = record.status === 'done';
        if (hasStatus) record.status = status as TaskRecord['status'];
        if (startAt === null) delete record.startAt;
        else if (startAt !== undefined) record.startAt = startAt;
        if (title !== undefined) record.title = title;
        if (subject !== undefined) record.subject = subject;
        if (acceptance !== undefined) record.acceptance = acceptance;
        if (durationMin !== undefined) record.durationMin = durationMin;
        if (due === null) delete record.due;
        else if (due !== undefined) record.due = due;
        if (input?.repeat === null) delete record.repeat;
        else if (input?.repeat !== undefined && isTaskRepeat(input.repeat)) {
          record.repeat = input.repeat;
        }
        record.actualMin = actualMin ?? record.actualMin;
        record.updated = new Date().toISOString();

        const repeatRule = record.repeat;
        if (!wasDone && record.status === 'done' && repeatRule) {
          const base = record.due ?? formatLocalDate(new Date());
          const nextDue = nextRepeatDate(base, repeatRule);
          const nextPath = taskFile(vaultRoot, found.workspaceId, nextDue);
          const nextRaw = await readFileOrNull(nextPath);
          const nextRecords = nextRaw === null ? [] : parseTaskFile(nextRaw);
          if (nextRaw !== null && nextRecords.length === 0) {
            assertAppendable(nextRaw, 'tasks', '任务文件');
          }
          // Re-completing after an undo must not create duplicates.
          if (!nextRecords.some((entry) => entry.recurredFrom === record.id)) {
            const next: TaskRecord = {
              ...record,
              id: newId('t'),
              status: 'pending',
              due: nextDue,
              recurredFrom: record.id,
              created: new Date().toISOString(),
              updated: new Date().toISOString()
            };
            delete next.actualMin;
            delete next.startAt;
            await writeFileAtomic(nextPath, serializeTaskFile(nextDue, [...nextRecords, next]));
          }
        }

        await writeFileAtomic(found.path, serializeTaskFile(found.date, found.records));
        return toWorkspaceTask(record, found.workspaceId);
      });
    },

    async deleteTask(input: DeleteTaskInput): Promise<void> {
      await ensureVault();
      const taskId = requireString(input?.taskId, 'Task id');
      assertSafeSegment(taskId, 'task id');
      await runExclusively(async () => {
        const found = await findTaskFile(taskId);
        if (found === null) throw new Error(`Task not found: ${taskId}`);
        const remaining = found.records.filter((record) => record.id !== taskId);
        if (remaining.length === 0) {
          await fs.unlink(found.path).catch(() => undefined);
          return;
        }
        await writeFileAtomic(found.path, serializeTaskFile(found.date, remaining));
      });
    },

    async createNote(input: CreateNoteInput): Promise<WorkspaceNote> {
      await ensureVault();
      const workspaceId = requireString(input?.workspaceId, 'Workspace id');
      await readWorkspaceOrThrow(workspaceId);
      const title = requireString(input?.title, 'Note title');
      const record: NoteRecord = {
        id: newId('n'),
        title,
        subject: optionalString(input?.subject) ?? '',
        tags: optionalStringArray(input?.tags) ?? [],
        summary: optionalString(input?.summary) ?? '',
        body: typeof input?.body === 'string' ? input.body : '',
        related: optionalStringArray(input?.related) ?? [],
        source: 'user',
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      };
      return runExclusively(async () => {
        const dir = notesDir(vaultRoot, workspaceId);
        const existing = await listMarkdownFiles(dir);
        const fileName = uniqueFileName(slugify(title, 'note'), existing);
        await writeFileAtomic(`${dir}/${fileName}`, serializeNoteFile(record));
        const vaultPath = posix.join('workspaces', workspaceId, 'notes', fileName);
        return toWorkspaceNote(record, workspaceId, vaultPath);
      });
    },

    async updateNote(input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote> {
      await ensureVault();
      const noteId = requireString(input?.noteId, 'Note id');
      assertSafeSegment(noteId, 'note id');
      const patch = {
        title: optionalString(input?.title),
        tags: optionalStringArray(input?.tags),
        summary: optionalString(input?.summary),
        body: typeof input?.body === 'string' ? input.body : undefined,
        related: optionalStringArray(input?.related)
      };
      return runExclusively(async () => {
        const found = await findNoteFile(noteId);
        if (found === null) throw new Error(`Note not found: ${noteId}`);
        const record = found.record;
        if (patch.title !== undefined && patch.title.trim() !== '') record.title = patch.title;
        if (patch.tags !== undefined) record.tags = patch.tags;
        if (patch.summary !== undefined) record.summary = patch.summary;
        if (patch.body !== undefined) record.body = patch.body;
        if (patch.related !== undefined) record.related = patch.related;
        record.updated = new Date().toISOString();
        // The file keeps its original name; the new title lives in frontmatter.
        await writeFileAtomic(found.path, serializeNoteFile(record));
        const vaultPath = posix.join('workspaces', found.workspaceId, 'notes', found.fileName);
        return toWorkspaceNote(record, found.workspaceId, vaultPath);
      });
    },

    async deleteNote(input: DeleteNoteInput): Promise<void> {
      await ensureVault();
      const noteId = requireString(input?.noteId, 'Note id');
      assertSafeSegment(noteId, 'note id');
      await runExclusively(async () => {
        const found = await findNoteFile(noteId);
        if (found === null) throw new Error(`Note not found: ${noteId}`);
        await fs.rm(found.path, { force: true });
      });
    },

    async getMemory(workspaceId?: string): Promise<MemoryItem[]> {
      await ensureVault();
      if (workspaceId === undefined) {
        const items: MemoryItem[] = [];
        for (const workspace of await listWorkspaceRecords()) {
          items.push(...(await readMemoryEntries(workspace.id)));
        }
        return items;
      }
      assertSafeSegment(workspaceId, 'workspace id');
      return readMemoryEntries(workspaceId);
    },

    async getReminders(): Promise<Reminder[]> {
      await ensureVault();
      return readReminders();
    },

    /**
     * Lightweight task read for the scheduler: only open, pinned tasks, and
     * only from task files, so a 30-second tick never loads notes or memory.
     */
    async getScheduledTasks(): Promise<WorkspaceTask[]> {
      await ensureVault();
      const tasks: WorkspaceTask[] = [];
      for (const workspace of await listWorkspaceRecords()) {
        for (const task of await readWorkspaceTasks(workspace.id)) {
          if (
            task.startAt !== undefined &&
            (task.status === 'pending' || task.status === 'in-progress')
          ) {
            tasks.push(task);
          }
        }
      }
      return tasks;
    },

    async createReminder(input: CreateReminderInput): Promise<Reminder> {
      await ensureVault();
      const time = normalizeReminderTime(input?.time);
      const label = requireString(input?.label, 'Reminder label');
      const days = normalizeReminderDays(input?.days);
      return runExclusively(async () => {
        const raw = await readFileOrNull(remindersFile(vaultRoot));
        const reminders = raw === null ? [] : parseRemindersFile(raw);
        if (raw !== null && reminders.length === 0) {
          assertAppendable(raw, 'items', '提醒文件');
        }
        const reminder: Reminder = {
          id: newId('rem'),
          time,
          label,
          enabled: input?.enabled ?? true,
          ...(days ? { days } : {})
        };
        await writeFileAtomic(
          remindersFile(vaultRoot),
          serializeRemindersFile([...reminders, reminder])
        );
        return reminder;
      });
    },

    async updateReminder(input: UpdateReminderInput): Promise<Reminder> {
      await ensureVault();
      const id = requireString(input?.id, 'Reminder id');
      return runExclusively(async () => {
        const reminders = await readReminders();
        const index = reminders.findIndex((reminder) => reminder.id === id);
        if (index < 0) throw new Error('Reminder not found');
        const current = reminders[index]!;
        const days =
          input.days !== undefined ? normalizeReminderDays(input.days) : current.days;
        const next: Reminder = {
          ...current,
          ...(input.time !== undefined ? { time: normalizeReminderTime(input.time) } : {}),
          ...(input.label !== undefined
            ? { label: requireString(input.label, 'Reminder label') }
            : {}),
          ...(input.enabled !== undefined ? { enabled: input.enabled } : {})
        };
        if (days === undefined) delete next.days;
        else next.days = days;
        const updated = [...reminders];
        updated[index] = next;
        await writeFileAtomic(remindersFile(vaultRoot), serializeRemindersFile(updated));
        return next;
      });
    },

    async deleteReminder(input: DeleteReminderInput): Promise<void> {
      await ensureVault();
      const id = requireString(input?.id, 'Reminder id');
      await runExclusively(async () => {
        const reminders = await readReminders();
        const remaining = reminders.filter((reminder) => reminder.id !== id);
        if (remaining.length === reminders.length) throw new Error('Reminder not found');
        await writeFileAtomic(remindersFile(vaultRoot), serializeRemindersFile(remaining));
      });
    },

    async submitReview(input: SubmitReviewInput): Promise<void> {
      await ensureVault();
      const date = assertIsoDate(input?.date, 'review date');
      const answers = input?.answers ?? {};
      const entry: ReviewEntry = {
        submittedAt: new Date().toISOString(),
        workspaceId: undefined,
        completed: optionalString(answers.completed) ?? '',
        stuck: optionalString(answers.stuck) ?? '',
        tomorrow: optionalString(answers.tomorrow) ?? '',
        skipped: answers.skipped === true
      };
      if (input?.workspaceId !== undefined) {
        const workspaceId = requireString(input.workspaceId, 'Workspace id');
        await readWorkspaceOrThrow(workspaceId);
        entry.workspaceId = workspaceId;
      }
      await runExclusively(async () => {
        const target = reviewFile(vaultRoot, entry.workspaceId, date);
        const existingRaw = await readFileOrNull(target);
        const entries = existingRaw === null ? [] : parseReviewFile(existingRaw);
        if (existingRaw !== null && entries.length === 0) {
          assertAppendable(existingRaw, 'entries', '复盘文件');
        }
        await writeFileAtomic(target, serializeReviewFile(date, [...entries, entry]));
      });
    }
  };
}
