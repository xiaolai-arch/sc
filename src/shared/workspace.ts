import type { ReviewAnswers, TaskStatus } from './types';

export type WorkspaceKind = 'exam' | 'study' | 'project' | 'life';
export type WorkspaceTaskStatus = TaskStatus;

export interface Workspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  color: string;
  goal: string;
  description: string;
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
}

export interface UpdateWorkspaceTaskInput {
  taskId: string;
  status: WorkspaceTaskStatus;
  actualMin?: number;
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

export interface SendMessageInput {
  workspaceId?: string;
  taskId?: string;
  message: string;
}

export interface SendMessageResult {
  text: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

/** Main-process contract: vault-backed or test implementation. */
export interface WorkspaceService {
  listWorkspaces(): Promise<Workspace[]>;
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot>;
  createTask(input: CreateTaskInput): Promise<WorkspaceTask>;
  updateWorkspaceTask(input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask>;
  createNote(input: CreateNoteInput): Promise<WorkspaceNote>;
  updateNote(input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote>;
  getMemory(workspaceId?: string): Promise<MemoryItem[]>;
  getReminders(): Promise<Reminder[]>;
  submitReview(input: SubmitReviewInput): Promise<void>;
}

/** Main-process contract for the butler/teaching agent. */
export interface ButlerService {
  send(input: SendMessageInput): Promise<SendMessageResult>;
}
