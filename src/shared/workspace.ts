import type { ReviewAnswers, TaskStatus } from './types';
import type { ButlerStreamEvent } from './butler-stream';

export type WorkspaceKind = 'exam' | 'study' | 'project' | 'life';
export type WorkspaceTaskStatus = TaskStatus;
/** Whether proactive check-ins include this project; undefined means daily. */
export type WorkspaceCheckIn = 'daily' | 'off';

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  color: string;
  goal: string;
  description: string;
  checkIn?: WorkspaceCheckIn;
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
  /** Local start time (YYYY-MM-DDTHH:mm) pinned on the daily schedule. */
  startAt?: string;
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
  getMemory(workspaceId?: string): Promise<MemoryItem[]>;
  getReminders(): Promise<Reminder[]>;
  /** Open tasks pinned to a start time, used by the scheduler. */
  getScheduledTasks?(): Promise<WorkspaceTask[]>;
  createReminder?(input: CreateReminderInput): Promise<Reminder>;
  updateReminder?(input: UpdateReminderInput): Promise<Reminder>;
  deleteReminder?(input: DeleteReminderInput): Promise<void>;
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
