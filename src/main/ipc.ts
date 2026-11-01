import type { AppSettings } from '../shared/types';
import type { SettingsPatch, StudyCoachApi } from '../shared/ipc';
import type { ButlerStreamEvent } from '../shared/butler-stream';
import type {
  ConversationMessage,
  CreateConversationInput
} from '../shared/conversations';
import type {
  CreateNoteInput,
  CreateReminderInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  SendMessageInput,
  SendMessageResult,
  SubmitReviewInput,
  UpdateReminderInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  WorkspaceOnboardingInput
} from '../shared/workspace';
import type { CreatePracticeSetInput, SubmitAnswerInput } from '../shared/practice';
import type {
  DeleteMemoryInput,
  MemoryKind,
  SynthesizeMemoryInput,
  UpdateMemoryInput
} from '../shared/memory';
import type { PlanWorkspaceInput } from '../shared/planning';

/** Every IPC channel exposed to the preload bridge. */
export const IPC_CHANNELS = {
  getBootstrap: 'study-coach:bootstrap:get',
  completeWorkspaceOnboarding: 'study-coach:bootstrap:complete-workspace-onboarding',
  getSettings: 'study-coach:settings:get',
  updateSettings: 'study-coach:settings:update',
  setApiKey: 'study-coach:settings:set-api-key',
  listWorkspaces: 'study-coach:workspaces:list',
  createWorkspace: 'study-coach:workspaces:create',
  updateWorkspace: 'study-coach:workspaces:update',
  getWorkspaceSnapshot: 'study-coach:workspaces:snapshot',
  createTask: 'study-coach:workspaces:create-task',
  updateWorkspaceTask: 'study-coach:workspaces:update-task',
  createNote: 'study-coach:workspaces:create-note',
  updateNote: 'study-coach:workspaces:update-note',
  getMemory: 'study-coach:workspaces:memory',
  getReminders: 'study-coach:reminders:list',
  createReminder: 'study-coach:reminders:create',
  updateReminder: 'study-coach:reminders:update',
  submitReview: 'study-coach:review:submit',
  listReviews: 'study-coach:review:list',
  planWorkspace: 'study-coach:planning:plan-workspace',
  listPracticeSets: 'study-coach:practice:list-sets',
  getPracticeSet: 'study-coach:practice:get-set',
  createPracticeSet: 'study-coach:practice:create-set',
  submitPracticeAnswer: 'study-coach:practice:submit-answer',
  getPracticeMistakes: 'study-coach:practice:mistakes',
  getPracticeDue: 'study-coach:practice:due',
  listPracticeAttempts: 'study-coach:practice:attempts',
  listMemory: 'study-coach:memory:list',
  synthesizeMemory: 'study-coach:memory:synthesize',
  getMemoryProfile: 'study-coach:memory:profile',
  updateMemory: 'study-coach:memory:update',
  deleteMemory: 'study-coach:memory:delete',
  searchWorkspace: 'study-coach:search:query',
  rebuildSearchIndex: 'study-coach:search:rebuild',
  listConversations: 'study-coach:conversations:list',
  getConversation: 'study-coach:conversations:get',
  createConversation: 'study-coach:conversations:create',
  appendConversationMessage: 'study-coach:conversations:append-message',
  deleteConversation: 'study-coach:conversations:delete',
  renameConversation: 'study-coach:conversations:rename',
  setConversationPinned: 'study-coach:conversations:set-pinned',
  truncateConversationMessages: 'study-coach:conversations:truncate-messages',
  searchConversations: 'study-coach:conversations:search',
  send: 'study-coach:butler:send'
} as const;

/** Streaming uses a separate request/event pair so the request map stays stable. */
export const BUTLER_STREAM_CHANNELS = {
  stream: 'study-coach:butler:stream',
  cancel: 'study-coach:butler:cancel-stream',
  event: 'study-coach:butler:stream-event'
} as const;

/** Outbound conversation events (proactive check-ins). */
export const CONVERSATION_EVENT_CHANNELS = {
  changed: 'study-coach:conversations:changed',
  open: 'study-coach:conversations:open'
} as const;

/** Outbound app events (global shortcut, tray). */
export const APP_EVENT_CHANNELS = {
  quickCapture: 'study-coach:app:quick-capture'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
export type IpcChannelName = keyof typeof IPC_CHANNELS;

export type IpcHandler = (input?: unknown) => Promise<unknown>;
export type IpcHandlerMap = Record<IpcChannelName, IpcHandler>;
export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
export type Subscribe = (
  channel: string,
  listener: (payload: unknown) => void
) => () => void;

export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

export interface IpcEventLike {
  sender: {
    send(channel: string, payload: unknown): void;
    isDestroyed?(): boolean;
  };
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

function requireUpdateWorkspace(value: unknown): UpdateWorkspaceInput {
  const input = requireObject(value, '更新项目');
  const checkIn = input.checkIn;
  if (checkIn !== undefined && checkIn !== 'daily' && checkIn !== 'off') {
    throw new Error('检查频率无效。');
  }
  const goal = optionalString(input.goal, '工作区目标');
  const description = optionalString(input.description, '工作区描述');
  return {
    workspaceId: requireString(input.workspaceId, '工作区 ID'),
    ...(input.name !== undefined ? { name: requireString(input.name, '工作区名称') } : {}),
    ...(input.goal !== undefined ? { goal: goal ?? '' } : {}),
    ...(input.description !== undefined ? { description: description ?? '' } : {}),
    ...(checkIn !== undefined ? { checkIn: checkIn as 'daily' | 'off' } : {})
  };
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

const REMINDER_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function requireReminderTime(value: unknown): string {
  const time = requireString(value, '提醒时间');
  if (!REMINDER_TIME.test(time)) throw new Error('提醒时间格式必须是 HH:MM。');
  return time;
}

function requireReminderEnabled(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('提醒启用状态无效。');
  return value;
}

function requireCreateReminder(value: unknown): CreateReminderInput {
  const input = requireObject(value, '创建提醒');
  return {
    time: requireReminderTime(input.time),
    label: requireString(input.label, '提醒内容'),
    ...(input.enabled !== undefined ? { enabled: requireReminderEnabled(input.enabled) } : {})
  };
}

function requireUpdateReminder(value: unknown): UpdateReminderInput {
  const input = requireObject(value, '更新提醒');
  return {
    id: requireString(input.id, '提醒 ID'),
    ...(input.time !== undefined ? { time: requireReminderTime(input.time) } : {}),
    ...(input.label !== undefined ? { label: requireString(input.label, '提醒内容') } : {}),
    ...(input.enabled !== undefined ? { enabled: requireReminderEnabled(input.enabled) } : {})
  };
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

function requireCreateConversation(value: unknown): CreateConversationInput {
  if (value === undefined || value === null) return {};
  const input = requireObject(value, '创建对话');
  const title = optionalString(input.title, '对话标题');
  const kind = input.kind;
  if (kind !== undefined && kind !== 'chat' && kind !== 'check-in') {
    throw new Error('对话类型无效。');
  }
  const workspaceId = optionalString(input.workspaceId, '工作区 ID');
  return {
    ...(title !== undefined ? { title } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {})
  };
}

function requireRenameConversation(value: unknown): { conversationId: string; title: string } {
  const input = requireObject(value, '重命名对话');
  return {
    conversationId: requireString(input.conversationId, '对话 ID'),
    title: requireString(input.title, '对话标题')
  };
}

function requireSetConversationPinned(value: unknown): {
  conversationId: string;
  pinned: boolean;
} {
  const input = requireObject(value, '置顶对话');
  if (typeof input.pinned !== 'boolean') throw new Error('置顶状态无效。');
  return {
    conversationId: requireString(input.conversationId, '对话 ID'),
    pinned: input.pinned
  };
}

function requireTruncateConversation(value: unknown): {
  conversationId: string;
  keepCount: number;
} {
  const input = requireObject(value, '截断对话消息');
  if (
    typeof input.keepCount !== 'number' ||
    !Number.isInteger(input.keepCount) ||
    input.keepCount < 0
  ) {
    throw new Error('保留消息数无效。');
  }
  return {
    conversationId: requireString(input.conversationId, '对话 ID'),
    keepCount: input.keepCount
  };
}

function requireConversationSearch(value: unknown): string {
  if (typeof value !== 'string') throw new Error('搜索关键词无效。');
  return value;
}

function requireConversationMessage(value: unknown): ConversationMessage {
  const input = requireObject(value, '对话消息');
  const id = requireString(input.id, '消息 ID');
  if (input.role !== 'user' && input.role !== 'assistant') {
    throw new Error('消息角色无效。');
  }
  if (typeof input.text !== 'string') {
    throw new Error('消息内容无效。');
  }
  const createdAt = requireString(input.createdAt, '消息时间');
  const steps = Array.isArray(input.steps)
    ? (input.steps as ConversationMessage['steps'])
    : undefined;
  const source =
    input.source === 'user' || input.source === 'butler' || input.source === 'check-in'
      ? input.source
      : undefined;
  const trigger =
    input.trigger === 'morning' ||
    input.trigger === 'evening' ||
    input.trigger === 'custom'
      ? input.trigger
      : undefined;
  return {
    id,
    role: input.role,
    text: input.text,
    createdAt,
    ...(steps ? { steps } : {}),
    ...(source ? { source } : {}),
    ...(trigger ? { trigger } : {})
  };
}

interface ButlerStreamPayload {
  requestId: string;
  input: SendMessageInput;
}

function requireStreamPayload(value: unknown): ButlerStreamPayload {
  const payload = requireObject(value, '管家流式请求');
  return {
    requestId: requireString(payload.requestId, '请求 ID'),
    input: requireSend(payload.input)
  };
}

function optionalPositiveNumber(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label}参数无效。`);
  }
  return value;
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label}参数无效。`);
  }
  return value;
}

function requirePracticeDue(value: unknown): { workspaceId: string; date: string } {
  const input = requireObject(value, '错题到期');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.date, '日期');
  return input as unknown as { workspaceId: string; date: string };
}

function requireSubmitAnswer(value: unknown): SubmitAnswerInput {
  const input = requireObject(value, '提交答案');
  requireString(input.questionId, '题目 ID');
  const choice = optionalNonNegativeInteger(input.choice, '选项');
  if (choice === undefined) throw new Error('选项参数无效。');
  return { questionId: input.questionId as string, choice };
}

function requireCreatePracticeSet(value: unknown): CreatePracticeSetInput {
  const input = requireObject(value, '创建练习');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.title, '练习标题');
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error('练习题目不能为空。');
  }
  return input as unknown as CreatePracticeSetInput;
}

function requireSynthesizeMemory(value: unknown): SynthesizeMemoryInput {
  const input = requireObject(value, '生成记忆');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.date, '复盘日期');
  requireObject(input.answers, '复盘答案');
  return input as unknown as SynthesizeMemoryInput;
}

const MEMORY_KINDS = ['weakness', 'strength', 'preference', 'plan', 'fact'] as const;

function requireMemoryKind(value: unknown): MemoryKind {
  if (typeof value !== 'string' || !(MEMORY_KINDS as readonly string[]).includes(value)) {
    throw new Error('记忆类型无效。');
  }
  return value as MemoryKind;
}

function requireUpdateMemory(value: unknown): UpdateMemoryInput {
  const input = requireObject(value, '更新记忆');
  return {
    workspaceId: requireString(input.workspaceId, '工作区 ID'),
    id: requireString(input.id, '记忆 ID'),
    ...(input.text !== undefined ? { text: requireString(input.text, '记忆内容') } : {}),
    ...(input.kind !== undefined ? { kind: requireMemoryKind(input.kind) } : {})
  };
}

function requireDeleteMemory(value: unknown): DeleteMemoryInput {
  const input = requireObject(value, '删除记忆');
  return {
    workspaceId: requireString(input.workspaceId, '工作区 ID'),
    id: requireString(input.id, '记忆 ID')
  };
}

function requirePlanWorkspace(value: unknown): PlanWorkspaceInput {
  const input = requireObject(value, '生成计划');
  requireString(input.workspaceId, '工作区 ID');
  optionalString(input.date, '计划日期');
  optionalPositiveNumber(input.availableMinutes, '可用时长');
  return input as unknown as PlanWorkspaceInput;
}

function requireSearchWorkspace(value: unknown): {
  workspaceId: string;
  query: string;
  limit?: number;
} {
  const input = requireObject(value, '搜索');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.query, '搜索关键词');
  const limit = optionalPositiveNumber(input.limit, '结果数量');
  return {
    workspaceId: input.workspaceId as string,
    query: input.query as string,
    ...(limit !== undefined ? { limit } : {})
  };
}

function requireListReviews(value: unknown): { workspaceId?: string; limit?: number } {
  if (value === undefined || value === null) return {};
  const input = requireObject(value, '读取复盘');
  const workspaceId = optionalString(input.workspaceId, '工作区 ID');
  const limit = optionalPositiveNumber(input.limit, '结果数量');
  return {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
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
    getSettings: async () => api.getSettings(),
    updateSettings: async (input) =>
      api.updateSettings(requireObject(input, '更新设置') as SettingsPatch),
    setApiKey: async (input) => api.setApiKey(requireString(input, 'API key')),
    listWorkspaces: async () => api.listWorkspaces(),
    createWorkspace: async (input) => api.createWorkspace(requireCreateWorkspace(input)),
    updateWorkspace: async (input) => {
      const parsed = requireUpdateWorkspace(input);
      if (!api.updateWorkspace) throw new Error('当前存储不支持更新项目。');
      return api.updateWorkspace(parsed);
    },
    getWorkspaceSnapshot: async (input) =>
      api.getWorkspaceSnapshot(requireString(input, '工作区 ID')),
    createTask: async (input) => api.createTask(requireCreateTask(input)),
    updateWorkspaceTask: async (input) => api.updateWorkspaceTask(requireUpdateWorkspaceTask(input)),
    createNote: async (input) => api.createNote(requireCreateNote(input)),
    updateNote: async (input) => api.updateNote(requireUpdateNote(input)),
    getMemory: async (input) => api.getMemory(optionalString(input, '工作区 ID')),
    getReminders: async () => api.getReminders(),
    createReminder: async (input) => {
      const parsed = requireCreateReminder(input);
      if (!api.createReminder) throw new Error('当前存储不支持提醒。');
      return api.createReminder(parsed);
    },
    updateReminder: async (input) => {
      const parsed = requireUpdateReminder(input);
      if (!api.updateReminder) throw new Error('当前存储不支持提醒。');
      return api.updateReminder(parsed);
    },
    submitReview: async (input) => api.submitReview(requireReview(input)),
    listReviews: async (input) => api.listReviews(requireListReviews(input)),
    planWorkspace: async (input) => api.planWorkspace(requirePlanWorkspace(input)),
    listPracticeSets: async (input) => api.listPracticeSets(requireString(input, '工作区 ID')),
    getPracticeSet: async (input) => api.getPracticeSet(requireString(input, '练习 ID')),
    createPracticeSet: async (input) => api.createPracticeSet(requireCreatePracticeSet(input)),
    submitPracticeAnswer: async (input) => api.submitPracticeAnswer(requireSubmitAnswer(input)),
    getPracticeMistakes: async (input) => api.getPracticeMistakes(requireString(input, '工作区 ID')),
    getPracticeDue: async (input) => api.getPracticeDue(requirePracticeDue(input)),
    listPracticeAttempts: async (input) =>
      api.listPracticeAttempts(requireString(input, '工作区 ID')),
    listMemory: async (input) => api.listMemory(optionalString(input, '工作区 ID')),
    synthesizeMemory: async (input) => api.synthesizeMemory(requireSynthesizeMemory(input)),
    getMemoryProfile: async (input) => api.getMemoryProfile(optionalString(input, '工作区 ID')),
    updateMemory: async (input) => api.updateMemory(requireUpdateMemory(input)),
    deleteMemory: async (input) => api.deleteMemory(requireDeleteMemory(input)),
    searchWorkspace: async (input) => api.searchWorkspace(requireSearchWorkspace(input)),
    rebuildSearchIndex: async () => api.rebuildSearchIndex(),
    listConversations: async () => api.listConversations(),
    getConversation: async (input) => api.getConversation(requireString(input, '对话 ID')),
    createConversation: async (input) => api.createConversation(requireCreateConversation(input)),
    appendConversationMessage: async (input) => {
      const raw = requireObject(input, '追加对话消息');
      return api.appendConversationMessage(
        requireString(raw.conversationId, '对话 ID'),
        requireConversationMessage(raw.message)
      );
    },
    deleteConversation: async (input) => api.deleteConversation(requireString(input, '对话 ID')),
    renameConversation: async (input) => {
      const { conversationId, title } = requireRenameConversation(input);
      return api.renameConversation(conversationId, title);
    },
    setConversationPinned: async (input) => {
      const { conversationId, pinned } = requireSetConversationPinned(input);
      return api.setConversationPinned(conversationId, pinned);
    },
    truncateConversationMessages: async (input) => {
      const { conversationId, keepCount } = requireTruncateConversation(input);
      return api.truncateConversationMessages(conversationId, keepCount);
    },
    searchConversations: async (input) =>
      api.searchConversations(requireConversationSearch(input)),
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

/**
 * Streams one butler request to the requesting webContents. Events carry the
 * caller's requestId so a delayed stream cannot leak into another message.
 */
export function createButlerStreamHandler(
  api: StudyCoachApi,
  registry: Map<string, AbortController> = new Map()
) {
  return async (event: IpcEventLike, value: unknown): Promise<SendMessageResult> => {
    const { requestId, input } = requireStreamPayload(value);
    const key = input.assistantMessageId?.trim() || requestId;
    const controller = new AbortController();
    registry.set(key, controller);
    try {
      return await api.stream(
        input,
        (streamEvent: ButlerStreamEvent) => {
          if (event.sender.isDestroyed?.()) return;
          event.sender.send(BUTLER_STREAM_CHANNELS.event, {
            requestId,
            event: streamEvent
          });
        },
        { signal: controller.signal }
      );
    } catch (error) {
      if (!event.sender.isDestroyed?.()) {
        event.sender.send(BUTLER_STREAM_CHANNELS.event, {
          requestId,
          event: { type: 'error', message: serializeError(error).message }
        });
      }
      throw toSafeError(error);
    } finally {
      registry.delete(key);
    }
  };
}

export function createButlerCancelHandler(registry: Map<string, AbortController>) {
  return async (value: unknown): Promise<void> => {
    const id = requireString(value, '消息 ID');
    registry.get(id)?.abort();
  };
}

/** Registers every channel; Electron's ipcMain is injected for testability. */
export function registerIpcHandlers(api: StudyCoachApi, ipcMain: IpcMainLike): void {
  const handlers = createIpcHandlers(api);
  for (const name of Object.keys(IPC_CHANNELS) as IpcChannelName[]) {
    ipcMain.handle(IPC_CHANNELS[name], (_event, ...args) => handlers[name](args[0]));
  }
  const registry = new Map<string, AbortController>();
  const streamHandler = createButlerStreamHandler(api, registry);
  ipcMain.handle(BUTLER_STREAM_CHANNELS.stream, (event, ...args) =>
    streamHandler(event as IpcEventLike, args[0])
  );
  const cancelHandler = createButlerCancelHandler(registry);
  ipcMain.handle(BUTLER_STREAM_CHANNELS.cancel, (_event, ...args) =>
    cancelHandler(args[0])
  );
}

/**
 * Builds the exact object exposed on `window.studyCoach`. Preload only supplies
 * `ipcRenderer.invoke`, which keeps this mapping unit-testable without Electron.
 */
export function createStudyCoachBridge(
  invoke: Invoke,
  subscribe?: Subscribe
): StudyCoachApi {
  const call = <T>(channel: string, ...args: unknown[]): Promise<T> =>
    invoke(channel, ...args) as Promise<T>;

  return {
    getBootstrap: () => call(IPC_CHANNELS.getBootstrap),
    completeWorkspaceOnboarding: (input) =>
      call(IPC_CHANNELS.completeWorkspaceOnboarding, input),
    getSettings: () => call(IPC_CHANNELS.getSettings),
    updateSettings: (patch) => call(IPC_CHANNELS.updateSettings, patch),
    setApiKey: (key) => call(IPC_CHANNELS.setApiKey, key),
    listWorkspaces: () => call(IPC_CHANNELS.listWorkspaces),
    createWorkspace: (input) => call(IPC_CHANNELS.createWorkspace, input),
    updateWorkspace: (input) => call(IPC_CHANNELS.updateWorkspace, input),
    getWorkspaceSnapshot: (workspaceId) => call(IPC_CHANNELS.getWorkspaceSnapshot, workspaceId),
    createTask: (input) => call(IPC_CHANNELS.createTask, input),
    updateWorkspaceTask: (input) => call(IPC_CHANNELS.updateWorkspaceTask, input),
    createNote: (input) => call(IPC_CHANNELS.createNote, input),
    updateNote: (input) => call(IPC_CHANNELS.updateNote, input),
    getMemory: (workspaceId) => call(IPC_CHANNELS.getMemory, workspaceId),
    getReminders: () => call(IPC_CHANNELS.getReminders),
    createReminder: (input) => call(IPC_CHANNELS.createReminder, input),
    updateReminder: (input) => call(IPC_CHANNELS.updateReminder, input),
    submitReview: (input) => call(IPC_CHANNELS.submitReview, input),
    listReviews: (input) => call(IPC_CHANNELS.listReviews, input),
    planWorkspace: (input) => call(IPC_CHANNELS.planWorkspace, input),
    listPracticeSets: (workspaceId) => call(IPC_CHANNELS.listPracticeSets, workspaceId),
    getPracticeSet: (id) => call(IPC_CHANNELS.getPracticeSet, id),
    createPracticeSet: (input) => call(IPC_CHANNELS.createPracticeSet, input),
    submitPracticeAnswer: (input) => call(IPC_CHANNELS.submitPracticeAnswer, input),
    getPracticeMistakes: (workspaceId) => call(IPC_CHANNELS.getPracticeMistakes, workspaceId),
    getPracticeDue: (input) => call(IPC_CHANNELS.getPracticeDue, input),
    listPracticeAttempts: (workspaceId) => call(IPC_CHANNELS.listPracticeAttempts, workspaceId),
    listMemory: (workspaceId) => call(IPC_CHANNELS.listMemory, workspaceId),
    synthesizeMemory: (input) => call(IPC_CHANNELS.synthesizeMemory, input),
    getMemoryProfile: (workspaceId) => call(IPC_CHANNELS.getMemoryProfile, workspaceId),
    updateMemory: (input) => call(IPC_CHANNELS.updateMemory, input),
    deleteMemory: (input) => call(IPC_CHANNELS.deleteMemory, input),
    searchWorkspace: (input) => call(IPC_CHANNELS.searchWorkspace, input),
    rebuildSearchIndex: () => call(IPC_CHANNELS.rebuildSearchIndex),
    listConversations: () => call(IPC_CHANNELS.listConversations),
    getConversation: (id) => call(IPC_CHANNELS.getConversation, id),
    createConversation: (input) => call(IPC_CHANNELS.createConversation, input),
    appendConversationMessage: (id, message) =>
      call(IPC_CHANNELS.appendConversationMessage, { conversationId: id, message }),
    deleteConversation: (id) => call(IPC_CHANNELS.deleteConversation, id),
    renameConversation: (id, title) =>
      call(IPC_CHANNELS.renameConversation, { conversationId: id, title }),
    setConversationPinned: (id, pinned) =>
      call(IPC_CHANNELS.setConversationPinned, { conversationId: id, pinned }),
    truncateConversationMessages: (id, keepCount) =>
      call(IPC_CHANNELS.truncateConversationMessages, { conversationId: id, keepCount }),
    searchConversations: (query) => call(IPC_CHANNELS.searchConversations, query),
    cancelStream: (messageId) => call(BUTLER_STREAM_CHANNELS.cancel, messageId),
    onConversationOpened(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(CONVERSATION_EVENT_CHANNELS.open, (payload) => {
        if (isRecord(payload) && typeof payload['conversationId'] === 'string') {
          listener(payload['conversationId']);
        }
      });
    },
    onQuickCapture(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(APP_EVENT_CHANNELS.quickCapture, () => listener());
    },
    send: (input) => call(IPC_CHANNELS.send, input),
    async stream(input, onEvent) {
      const requestId = createRequestId();
      const unsubscribe = subscribe?.(BUTLER_STREAM_CHANNELS.event, (payload) => {
        if (!isRecord(payload) || payload['requestId'] !== requestId) return;
        const event = payload['event'];
        if (isRecord(event)) onEvent(event as ButlerStreamEvent);
      });
      try {
        return await call<SendMessageResult>(BUTLER_STREAM_CHANNELS.stream, {
          requestId,
          input
        });
      } finally {
        unsubscribe?.();
      }
    }
  };
}

function createRequestId(): string {
  const maybeCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  return (
    maybeCrypto?.randomUUID?.() ??
    `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  );
}
