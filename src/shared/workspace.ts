import type { ReviewAnswers, TaskStatus } from './types';
import type { ButlerStreamEvent } from './butler-stream';
import type { TaskRepeat } from './recurrence';
import type { AgentPermissions, ChatAttachment } from './attachments';

export type WorkspaceKind = 'exam' | 'study' | 'project' | 'life';
export type WorkspaceTaskStatus = TaskStatus;
/** Whether proactive check-ins include this project; undefined means daily. */
export type WorkspaceCheckIn = 'daily' | 'off';

/** Range the UI and vault accept for the daily minute budget. */
export const MIN_DAILY_AVAILABLE_MINUTES = 5;
export const MAX_DAILY_AVAILABLE_MINUTES = 24 * 60;

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  color: string;
  goal: string;
  description: string;
  checkIn?: WorkspaceCheckIn;
  /** Default minutes the user can study per day; planning starts from it. */
  availableMinutes?: number;
  createdAt?: string;
  updatedAt?: string;
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
  /** null clears the recorded failure. */
  lastError?: string | null;
}

/** Reads the lifecycle state, treating a legacy record without one as pending. */
export function reminderState(reminder: Pick<Reminder, 'state'>): ReminderState {
  return reminder.state ?? 'pending';
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
  for (const field of ['firedAt', 'postponedTo', 'lastError'] as const) {
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
  /** Local start time (YYYY-MM-DDTHH:mm) to pin on the daily schedule. */
  startAt?: string;
  repeat?: TaskRepeat;
  /** Long-plan provenance; the same plan item never creates two tasks. */
  planId?: string;
  planWeekId?: string;
  planItemId?: string;
}

export interface UpdateWorkspaceTaskInput {
  taskId: string;
  title?: string;
  subject?: string;
  durationMin?: number;
  acceptance?: string;
  /** Local ISO date (YYYY-MM-DD); null clears the due date. */
  due?: string | null;
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
