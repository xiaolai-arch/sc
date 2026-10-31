import type { AppSettings, ExamProfile } from '../shared/types';
import type { StudyCoachApi } from '../shared/ipc';
import type {
  CreateNoteInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  SendMessageInput,
  SubmitReviewInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  WorkspaceOnboardingInput
} from '../shared/workspace';

/** Every IPC channel exposed to the preload bridge. */
export const IPC_CHANNELS = {
  getBootstrap: 'study-coach:bootstrap:get',
  completeWorkspaceOnboarding: 'study-coach:bootstrap:complete-workspace-onboarding',
  completeOnboarding: 'study-coach:bootstrap:complete-onboarding',
  getSettings: 'study-coach:settings:get',
  updateSettings: 'study-coach:settings:update',
  setApiKey: 'study-coach:settings:set-api-key',
  getTodayPlan: 'study-coach:today-plan:get',
  generateTodayPlan: 'study-coach:today-plan:generate',
  updateTask: 'study-coach:today-plan:update-task',
  listWorkspaces: 'study-coach:workspaces:list',
  createWorkspace: 'study-coach:workspaces:create',
  getWorkspaceSnapshot: 'study-coach:workspaces:snapshot',
  createTask: 'study-coach:workspaces:create-task',
  updateWorkspaceTask: 'study-coach:workspaces:update-task',
  createNote: 'study-coach:workspaces:create-note',
  updateNote: 'study-coach:workspaces:update-note',
  getMemory: 'study-coach:workspaces:memory',
  getReminders: 'study-coach:reminders:list',
  submitReview: 'study-coach:review:submit',
  send: 'study-coach:butler:send'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
export type IpcChannelName = keyof typeof IPC_CHANNELS;

export type IpcHandler = (input?: unknown) => Promise<unknown>;
export type IpcHandlerMap = Record<IpcChannelName, IpcHandler>;
export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

const TASK_STATUSES = ['pending', 'in-progress', 'done', 'skipped'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label}参数无效。`);
  return value;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}不能为空。`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error(`${label}参数无效。`);
  return value.trim().length > 0 ? value : undefined;
}

function requireTaskStatus(value: unknown): (typeof TASK_STATUSES)[number] {
  if (typeof value !== 'string' || !(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new Error('任务状态无效。');
  }
  return value as (typeof TASK_STATUSES)[number];
}

function requireCreateWorkspace(value: unknown): CreateWorkspaceInput {
  const input = requireObject(value, '创建工作区');
  requireString(input.name, '工作区名称');
  requireString(input.kind, '工作区类型');
  requireString(input.goal, '工作区目标');
  requireString(input.description, '工作区描述');
  return input as unknown as CreateWorkspaceInput;
}

function requireCreateTask(value: unknown): CreateTaskInput {
  const input = requireObject(value, '创建任务');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.title, '任务标题');
  requireString(input.subject, '任务科目');
  requireString(input.acceptance, '任务验收标准');
  if (typeof input.durationMin !== 'number' || !Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error('任务时长无效。');
  }
  return input as unknown as CreateTaskInput;
}

function requireUpdateWorkspaceTask(value: unknown): UpdateWorkspaceTaskInput {
  const input = requireObject(value, '更新任务');
  requireString(input.taskId, '任务 ID');
  requireTaskStatus(input.status);
  if (input.actualMin !== undefined && (typeof input.actualMin !== 'number' || input.actualMin < 0)) {
    throw new Error('实际用时无效。');
  }
  return input as unknown as UpdateWorkspaceTaskInput;
}

function requireCreateNote(value: unknown): CreateNoteInput {
  const input = requireObject(value, '创建笔记');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.title, '笔记标题');
  requireString(input.body, '笔记正文');
  return input as unknown as CreateNoteInput;
}

function requireUpdateNote(value: unknown): UpdateWorkspaceNoteInput {
  const input = requireObject(value, '更新笔记');
  requireString(input.noteId, '笔记 ID');
  return input as unknown as UpdateWorkspaceNoteInput;
}

function requireReview(value: unknown): SubmitReviewInput {
  const input = requireObject(value, '提交复盘');
  requireString(input.date, '复盘日期');
  requireObject(input.answers, '复盘答案');
  return input as unknown as SubmitReviewInput;
}

function requireSend(value: unknown): SendMessageInput {
  const input = requireObject(value, '发送消息');
  requireString(input.message, '消息内容');
  optionalString(input.workspaceId, '工作区 ID');
  optionalString(input.taskId, '任务 ID');
  return input as unknown as SendMessageInput;
}

/**
 * Builds the channel handlers around a StudyCoachApi. Kept separate from
 * Electron so the same table can be exercised in unit tests.
 */
export function createIpcHandlers(api: StudyCoachApi): IpcHandlerMap {
  const raw: IpcHandlerMap = {
    getBootstrap: async () => api.getBootstrap(),
    completeWorkspaceOnboarding: async (input) =>
      api.completeWorkspaceOnboarding(
        requireObject(input, '完成 workspace 引导') as unknown as WorkspaceOnboardingInput
      ),
    completeOnboarding: async (input) =>
      api.completeOnboarding(requireObject(input, '完成引导') as unknown as ExamProfile),
    getSettings: async () => api.getSettings(),
    updateSettings: async (input) =>
      api.updateSettings(requireObject(input, '更新设置') as Partial<AppSettings>),
    setApiKey: async (input) => api.setApiKey(requireString(input, 'API key')),
    getTodayPlan: async () => api.getTodayPlan(),
    generateTodayPlan: async () => api.generateTodayPlan(),
    updateTask: async (input) => {
      const raw = requireObject(input, '更新今日任务');
      requireString(raw.taskId, '任务 ID');
      return api.updateTask({
        taskId: raw.taskId as string,
        status: requireTaskStatus(raw.status),
        actualMin: typeof raw.actualMin === 'number' ? raw.actualMin : undefined
      });
    },
    listWorkspaces: async () => api.listWorkspaces(),
    createWorkspace: async (input) => api.createWorkspace(requireCreateWorkspace(input)),
    getWorkspaceSnapshot: async (input) =>
      api.getWorkspaceSnapshot(requireString(input, '工作区 ID')),
    createTask: async (input) => api.createTask(requireCreateTask(input)),
    updateWorkspaceTask: async (input) => api.updateWorkspaceTask(requireUpdateWorkspaceTask(input)),
    createNote: async (input) => api.createNote(requireCreateNote(input)),
    updateNote: async (input) => api.updateNote(requireUpdateNote(input)),
    getMemory: async (input) => api.getMemory(optionalString(input, '工作区 ID')),
    getReminders: async () => api.getReminders(),
    submitReview: async (input) => api.submitReview(requireReview(input)),
    send: async (input) => api.send(requireSend(input))
  };

  // Every path through the bridge gets the same sanitized error envelope,
  // including direct handler-map callers in tests.
  const wrapped = {} as IpcHandlerMap;
  for (const name of Object.keys(raw) as IpcChannelName[]) {
    const handler = raw[name];
    wrapped[name] = (input?: unknown) => invokeSafely(handler, [input]);
  }
  return wrapped;
}

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi
];

export function redactSecrets(message: string): string {
  return SECRET_PATTERNS.reduce((text, pattern) => text.replace(pattern, '[redacted]'), message);
}

export interface SerializedError {
  name: string;
  message: string;
}

/** Converts any thrown value into a transport-safe error without secrets. */
export function serializeError(error: unknown): SerializedError {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const message = redactSecrets(rawMessage).slice(0, 500);
  return {
    name: error instanceof Error && error.name ? error.name : 'Error',
    message: message.length > 0 ? message : '未知错误。'
  };
}

function toSafeError(error: unknown): Error {
  return new Error(serializeError(error).message);
}

async function invokeSafely(handler: IpcHandler, args: unknown[]): Promise<unknown> {
  try {
    return await handler(args[0]);
  } catch (error) {
    throw toSafeError(error);
  }
}

/** Registers every channel; Electron's ipcMain is injected for testability. */
export function registerIpcHandlers(api: StudyCoachApi, ipcMain: IpcMainLike): void {
  const handlers = createIpcHandlers(api);
  for (const name of Object.keys(IPC_CHANNELS) as IpcChannelName[]) {
    ipcMain.handle(IPC_CHANNELS[name], (_event, ...args) => handlers[name](args[0]));
  }
}

/**
 * Builds the exact object exposed on `window.studyCoach`. Preload only supplies
 * `ipcRenderer.invoke`, which keeps this mapping unit-testable without Electron.
 */
export function createStudyCoachBridge(invoke: Invoke): StudyCoachApi {
  const call = <T>(channel: IpcChannel, ...args: unknown[]): Promise<T> =>
    invoke(channel, ...args) as Promise<T>;

  return {
    getBootstrap: () => call(IPC_CHANNELS.getBootstrap),
    completeWorkspaceOnboarding: (input) =>
      call(IPC_CHANNELS.completeWorkspaceOnboarding, input),
    completeOnboarding: (profile) => call(IPC_CHANNELS.completeOnboarding, profile),
    getSettings: () => call(IPC_CHANNELS.getSettings),
    updateSettings: (patch) => call(IPC_CHANNELS.updateSettings, patch),
    setApiKey: (key) => call(IPC_CHANNELS.setApiKey, key),
    getTodayPlan: () => call(IPC_CHANNELS.getTodayPlan),
    generateTodayPlan: () => call(IPC_CHANNELS.generateTodayPlan),
    updateTask: (input) => call(IPC_CHANNELS.updateTask, input),
    listWorkspaces: () => call(IPC_CHANNELS.listWorkspaces),
    createWorkspace: (input) => call(IPC_CHANNELS.createWorkspace, input),
    getWorkspaceSnapshot: (workspaceId) => call(IPC_CHANNELS.getWorkspaceSnapshot, workspaceId),
    createTask: (input) => call(IPC_CHANNELS.createTask, input),
    updateWorkspaceTask: (input) => call(IPC_CHANNELS.updateWorkspaceTask, input),
    createNote: (input) => call(IPC_CHANNELS.createNote, input),
    updateNote: (input) => call(IPC_CHANNELS.updateNote, input),
    getMemory: (workspaceId) => call(IPC_CHANNELS.getMemory, workspaceId),
    getReminders: () => call(IPC_CHANNELS.getReminders),
    submitReview: (input) => call(IPC_CHANNELS.submitReview, input),
    send: (input) => call(IPC_CHANNELS.send, input)
  };
}
