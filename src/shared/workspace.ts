import type { ReviewAnswers, TaskStatus } from './types';
import type { ButlerStreamEvent } from './butler-stream';
import type { TaskRepeat } from './recurrence';
import type { AgentPermissions, ChatAttachment } from './attachments';
import { parseLocalDate } from './date';

export type WorkspaceKind = 'exam' | 'study' | 'project' | 'life';
export type WorkspaceTaskStatus = TaskStatus;
/** Whether proactive check-ins include this project; undefined means daily. */
export type WorkspaceCheckIn = 'daily' | 'off';

/** Range the UI and vault accept for the daily minute budget. */
export const MIN_DAILY_AVAILABLE_MINUTES = 5;
export const MAX_DAILY_AVAILABLE_MINUTES = 24 * 60;

/**
 * Upper bound for a task's implementation-intention cue ("if situation X,
 * then I will do Y"): a short trigger such as 晚饭后 or 到自习室.
 */
export const MAX_TASK_CUE_LENGTH = 40;

/** Counts user-perceived characters, so an emoji trigger costs one. */
export function taskCueLength(value: string): number {
  return [...value].length;
}

/** Trims a cue and folds line breaks into spaces; undefined when empty. */
export function normalizeTaskCue(value: string): string | undefined {
  const text = value.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 0 ? text : undefined;
}

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  color: string;
  /**
   * Stable identity of the project's goal (目标), minted once when the project
   * first names a goal. The goal *text* stays `goal`; this is only the handle a
   * task points at, so renaming or rewording the goal never orphans the tasks
   * that serve it. Absent on legacy files and on projects without a goal.
   */
  goalId?: string;
  goal: string;
  description: string;
  checkIn?: WorkspaceCheckIn;
  /** Default minutes the user can study per day; planning starts from it. */
  availableMinutes?: number;
  /**
   * The deadline the project counts down to (目标日期 / 截止日期), as a local
   * `YYYY-MM-DD` date. Absent means no target date has been set.
   */
  targetDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a readable local calendar date such as `2027-12-19`. */
export function isTargetDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = parseLocalDate(value);
  if (Number.isNaN(date.getTime())) return false;
  // Reject dates the calendar rolls over, such as 2027-02-31.
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}` === value;
}

/**
 * Whole local days from `today` to `targetDate`. Negative once the target has
 * passed, null when either date is unreadable. Computed from the calendar
 * dates, so a daylight-saving change never shifts the count by a day.
 */
export function daysUntilTarget(targetDate: string, today: string): number | null {
  if (!isTargetDate(targetDate) || !isTargetDate(today)) return null;
  const target = parseLocalDate(targetDate);
  const start = parseLocalDate(today);
  const utc = (date: Date): number =>
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((utc(target) - utc(start)) / 86_400_000);
}

/**
 * The quiet one-line countdown for a project's target date:
 * `距离目标 2027-12-19 还有 343 天`, or `目标日已过` once the deadline passed.
 * Undefined when no usable target date is set, so the UI renders nothing.
 */
export function targetCountdownLabel(
  targetDate: string | undefined,
  today: string
): string | undefined {
  if (!targetDate) return undefined;
  const days = daysUntilTarget(targetDate, today);
  if (days === null) return undefined;
  return days >= 0 ? `距离目标 ${targetDate} 还有 ${days} 天` : '目标日已过';
}

export interface WorkspaceTask {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  durationMin: number;
  acceptance: string;
  status: WorkspaceTaskStatus;
  actualMin?: number;
  due?: string;
  /**
   * Implementation intention ("if situation X, then I will do Y"): a short
   * trigger such as 晚饭后 or 到自习室. Displayed as an if-then plan.
   */
  cue?: string;
  /** Completing the task schedules its next occurrence from the due date. */
  repeat?: TaskRepeat;
  /** Id of the completed occurrence that spawned this copy; internal. */
  recurredFrom?: string;
  /** Local start time (YYYY-MM-DDTHH:mm) pinned on the daily schedule. */
  startAt?: string;
  /** Long-plan provenance: the plan and day item this task came from. */
  planId?: string;
  planWeekId?: string;
  planItemId?: string;
  /**
   * The goal this task serves (`Workspace.goalId`). Filled automatically for a
   * task derived from a long-plan item, whose plan belongs to the same project.
   * Absent means the task serves no recorded goal — never invented on read.
   */
  goalId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface WorkspaceNote {
  id: string;
  workspaceId: string;
  title: string;
  subject: string;
  tags: string[];
  updated: string;
  summary: string;
  body: string;
  related: string[];
  path?: string;
}

export interface MemoryItem {
  id: string;
  workspaceId: string;
  text: string;
  source: string;
  createdAt?: string;
}

/**
 * Lifecycle of the latest occurrence of a reminder. This is deliberately
 * separate from `enabled`: `enabled` is the user's schedule switch, `state`
 * records what happened the last time the reminder came due.
 */
export type ReminderState = 'pending' | 'fired' | 'done' | 'postponed' | 'failed';

export const REMINDER_STATES: readonly ReminderState[] = [
  'pending',
  'fired',
  'done',
  'postponed',
  'failed'
];

export interface Reminder {
  id: string;
  time: string;
  label: string;
  enabled: boolean;
  /**
   * Local weekdays the reminder repeats on (0 = Sunday … 6 = Saturday).
   * Omitted or empty means every day.
   */
  days?: number[];
  /**
   * Persisted lifecycle state. Absent (legacy files) reads as `pending`.
   * `fired` records the last delivery only; the daily/weekly schedule still
   * decides when it fires again. `done` suppresses firing until re-enabled.
   */
  state?: ReminderState;
  /** ISO timestamp of the last successful delivery. */
  firedAt?: string;
  /** Local `YYYY-MM-DDTHH:mm` the reminder was postponed to. */
  postponedTo?: string;
  /**
   * Local `YYYY-MM-DD` the reminder was marked 完成. `done` only holds for that
   * one day: `effectiveReminderState` reads it as `pending` from the next day.
   * Absent on legacy records, whose `done` stays permanent (no migration).
   */
  doneAt?: string;
  /** Human-readable cause of the last delivery failure. */
  lastError?: string;
}

/** Fields a scheduler or the UI may write to advance a reminder's lifecycle. */
export interface ReminderStatePatch {
  state?: ReminderState;
  /** null clears the recorded delivery time. */
  firedAt?: string | null;
  /** null clears the postponement. */
  postponedTo?: string | null;
  /** null clears the day the reminder was marked 完成. */
  doneAt?: string | null;
  /** null clears the recorded failure. */
  lastError?: string | null;
}

/** Reads the lifecycle state, treating a legacy record without one as pending. */
export function reminderState(reminder: Pick<Reminder, 'state'>): ReminderState {
  return reminder.state ?? 'pending';
}

/**
 * The state that governs whether a reminder still warrants attention *today*.
 * A `done` reminder only stays done on the day it was marked; from the next
 * day it is pending again, so a daily reminder resumes without the user having
 * to click 重新启用. A legacy `done` without `doneAt` keeps its old, permanent
 * behaviour. This is the single place the next-day rule lives — the scheduler
 * and every renderer surface call it instead of comparing dates themselves.
 */
export function effectiveReminderState(
  reminder: Pick<Reminder, 'state' | 'doneAt'>,
  today: string
): ReminderState {
  const state = reminderState(reminder);
  if (state !== 'done') return state;
  // No recorded day (legacy) or an unreadable today: keep `done`.
  if (!isTargetDate(reminder.doneAt) || !ISO_DATE.test(today)) return 'done';
  return reminder.doneAt < today ? 'pending' : 'done';
}

/**
 * Applies a lifecycle patch. `null` clears an optional field; leaving it
 * undefined keeps the current value. `enabled` is never touched here.
 */
export function applyReminderStatePatch(
  reminder: Reminder,
  patch: ReminderStatePatch
): Reminder {
  const next: Reminder = { ...reminder };
  if (patch.state !== undefined) next.state = patch.state;
  for (const field of ['firedAt', 'postponedTo', 'doneAt', 'lastError'] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    if (value === null) delete next[field];
    else next[field] = value;
  }
  return next;
}

export interface WorkspaceSnapshot {
  workspace: Workspace;
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  memory: MemoryItem[];
  reminders: Reminder[];
}

export interface CreateWorkspaceInput {
  name: string;
  kind: WorkspaceKind;
  goal: string;
  description: string;
  color?: string;
}

export interface UpdateWorkspaceInput {
  workspaceId: string;
  name?: string;
  goal?: string;
  description?: string;
  checkIn?: WorkspaceCheckIn;
  /** Daily minutes the planner should assume; omit to keep the current value. */
  availableMinutes?: number;
  /** Local `YYYY-MM-DD` target date; null clears it, omit to keep it. */
  targetDate?: string | null;
}

export interface WorkspaceOnboardingInput {
  name: string;
  kind: WorkspaceKind;
  goal: string;
  description: string;
  useDemo?: boolean;
}

export interface CreateTaskInput {
  workspaceId: string;
  title: string;
  subject: string;
  durationMin: number;
  acceptance: string;
  due?: string;
  /** Optional implementation-intention trigger, at most 40 characters. */
  cue?: string;
  /** Local start time (YYYY-MM-DDTHH:mm) to pin on the daily schedule. */
  startAt?: string;
  repeat?: TaskRepeat;
  /** Long-plan provenance; the same plan item never creates two tasks. */
  planId?: string;
  planWeekId?: string;
  planItemId?: string;
  /**
   * Goal the task serves. Omitted by the caller when the task comes from a
   * plan: the service resolves the plan's project and fills its `goalId`.
   */
  goalId?: string;
}

export interface UpdateWorkspaceTaskInput {
  taskId: string;
  title?: string;
  subject?: string;
  durationMin?: number;
  acceptance?: string;
  /** Local ISO date (YYYY-MM-DD); null clears the due date. */
  due?: string | null;
  /** Implementation-intention trigger; null (or an empty string) clears it. */
  cue?: string | null;
  status?: WorkspaceTaskStatus;
  actualMin?: number;
  /** Local start time to pin; null clears the pin. */
  startAt?: string | null;
  /** Repeat rule; null turns repetition off. */
  repeat?: TaskRepeat | null;
}

export interface DeleteTaskInput {
  taskId: string;
}

export interface CreateNoteInput {
  workspaceId: string;
  title: string;
  subject: string;
  tags?: string[];
  summary?: string;
  body: string;
  related?: string[];
}

export interface UpdateWorkspaceNoteInput {
  noteId: string;
  title?: string;
  tags?: string[];
  summary?: string;
  body?: string;
  related?: string[];
}

export interface DeleteNoteInput {
  noteId: string;
}

export interface SubmitReviewInput {
  date: string;
  workspaceId?: string;
  answers: ReviewAnswers;
}

export interface CreateReminderInput {
  time: string;
  label: string;
  enabled?: boolean;
  /** 0 = Sunday … 6 = Saturday; omitted means every day. */
  days?: number[];
}

export interface UpdateReminderInput {
  id: string;
  time?: string;
  label?: string;
  enabled?: boolean;
  /** null clears the repeat and returns the reminder to every day. */
  days?: number[] | null;
  /**
   * Lifecycle transition requested by the user: 标为完成 (`done`) or
   * 重新启用 (`pending`). Never written together with `postponeMinutes`.
   */
  state?: ReminderState;
  /** 延后: minutes from now until the reminder is due again. */
  postponeMinutes?: number;
}

export interface DeleteReminderInput {
  id: string;
}

export interface SendMessageInput {
  workspaceId?: string;
  taskId?: string;
  message: string;
  /** Conversation to append to. When omitted, the call is stateless. */
  conversationId?: string;
  /** Renderer-provided id so live reasoning can be reattached after reload. */
  assistantMessageId?: string;
  /** Files to give the model for this turn (images are sent inline). */
  attachments?: ChatAttachment[];
  /** Capabilities for this turn; omitted keeps the native-agent defaults. */
  permissions?: AgentPermissions;
}

export interface SendMessageResult {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  conversationId?: string;
}

/** Main-process contract: vault-backed or test implementation. */
export interface WorkspaceService {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace?(input: UpdateWorkspaceInput): Promise<Workspace>;
  deleteWorkspace?(workspaceId: string): Promise<void>;
  getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot>;
  createTask(input: CreateTaskInput): Promise<WorkspaceTask>;
  updateWorkspaceTask(input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask>;
  deleteTask?(input: DeleteTaskInput): Promise<void>;
  createNote(input: CreateNoteInput): Promise<WorkspaceNote>;
  updateNote(input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote>;
  deleteNote?(input: DeleteNoteInput): Promise<void>;
  getMemory(workspaceId?: string): Promise<MemoryItem[]>;
  getReminders(): Promise<Reminder[]>;
  /** Open tasks pinned to a start time, used by the scheduler. */
  getScheduledTasks?(): Promise<WorkspaceTask[]>;
  createReminder?(input: CreateReminderInput): Promise<Reminder>;
  updateReminder?(input: UpdateReminderInput): Promise<Reminder>;
  deleteReminder?(input: DeleteReminderInput): Promise<void>;
  /**
   * Main-process-only lifecycle write used by the scheduler. Deliberately not
   * exposed on the renderer IPC bridge; the UI uses `updateReminder`.
   */
  setReminderState?(id: string, patch: ReminderStatePatch): Promise<Reminder>;
  submitReview(input: SubmitReviewInput): Promise<void>;
}

/** Main-process contract for the butler/teaching agent. */
export interface ButlerService {
  send(input: SendMessageInput): Promise<SendMessageResult>;
  stream(
    input: SendMessageInput,
    onEvent: (event: ButlerStreamEvent) => void,
    options?: { signal?: AbortSignal }
  ): Promise<SendMessageResult>;
}
