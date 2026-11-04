import { isLocalDateTime } from '../shared/date';
import type { AppSettings } from '../shared/types';
import type {
  BackupResult,
  RestoreResult,
  SettingsPatch,
  StudyCoachApi
} from '../shared/ipc';
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
  DeleteNoteInput,
  DeleteReminderInput,
  DeleteTaskInput,
  SendMessageInput,
  SendMessageResult,
  SubmitReviewInput,
  UpdateReminderInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  WorkspaceOnboardingInput
} from '../shared/workspace';
import type {
  CreatePracticeSetInput,
  DeletePracticeSetInput,
  SubmitAnswerInput,
  UpdatePracticeSetInput
} from '../shared/practice';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeStatus,
  MergeKnowledgeTopicsInput,
  SaveKnowledgeNoteInput,
  UpdateKnowledgeTopicInput
} from '../shared/knowledge';
import { MAX_KNOWLEDGE_NOTE_LENGTH } from '../shared/knowledge';
import type {
  CreateMemoryInput,
  DeleteMemoryInput,
  MemoryKind,
  SynthesizeMemoryInput,
  UpdateMemoryInput
} from '../shared/memory';
import type { PlanWorkspaceInput } from '../shared/planning';
import type {
  CreateLongPlanInput,
  RecalibrateLongPlanInput,
  UpdateLongPlanInput,
  UpdateLongPlanItemInput
} from '../shared/plans';

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
  listLongPlans: 'study-coach:plans:list',
  getLongPlan: 'study-coach:plans:get',
  createLongPlan: 'study-coach:plans:create',
  setLongPlanItemDone: 'study-coach:plans:set-item-done',
  deleteLongPlan: 'study-coach:plans:delete',
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
  listKnowledgeTopics: 'study-coach:knowledge:list',
  createKnowledgeTopic: 'study-coach:knowledge:create',
  updateKnowledgeTopic: 'study-coach:knowledge:update',
  deleteKnowledgeTopic: 'study-coach:knowledge:delete',
  getKnowledgeNote: 'study-coach:knowledge:note:get',
  saveKnowledgeNote: 'study-coach:knowledge:note:save',
  getKnowledgeBacklinks: 'study-coach:knowledge:backlinks',
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
  setConversationModel: 'study-coach:conversations:set-model',
  getUsageSummary: 'study-coach:usage:summary',
  clearUsage: 'study-coach:usage:clear',
  send: 'study-coach:butler:send',
  scanLocalClis: 'study-coach:local-cli:scan',
  recalibrateLongPlan: 'study-coach:plans:recalibrate',
  searchAll: 'study-coach:search:all',
  deleteTask: 'study-coach:workspaces:delete-task',
  deleteReminder: 'study-coach:reminders:delete',
  createMemory: 'study-coach:memory:create',
  deleteWorkspace: 'study-coach:workspaces:delete',
  updateLongPlan: 'study-coach:plans:update',
  mergeKnowledgeTopics: 'study-coach:knowledge:merge',
  deleteNote: 'study-coach:workspaces:delete-note',
  updatePracticeSet: 'study-coach:practice:update-set',
  deletePracticeSet: 'study-coach:practice:delete-set'
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

/** Renderer-initiated app actions that live outside the handler table. */
export const APP_IPC_CHANNELS = {
  exportBackup: 'study-coach:app:export-backup',
  restoreBackup: 'study-coach:app:restore-backup',
  restartApp: 'study-coach:app:restart'
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

/** An empty key is meaningful: it clears the key when the endpoint changes. */
function requireApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error('API key不能为空。');
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

function requireDeleteWorkspace(value: unknown): string {
  const input = requireObject(value, '删除项目');
  return requireString(input.workspaceId, '工作区 ID');
}

function requireCreateTask(value: unknown): CreateTaskInput {
  const input = requireObject(value, '创建任务');
  requireString(input.workspaceId, '工作区 ID');
  requireString(input.title, '任务标题');
  requireString(input.subject, '任务科目');
  // 验收标准 is optional in the UI; an empty string means the user skipped it.
  if (typeof input.acceptance !== 'string') {
    throw new Error('任务验收标准无效。');
  }
  if (typeof input.durationMin !== 'number' || !Number.isFinite(input.durationMin) || input.durationMin <= 0) {
    throw new Error('任务时长无效。');
  }
  if (input.startAt !== undefined && !isLocalDateTime(input.startAt)) {
    throw new Error('任务开始时间无效。');
  }
  return input as unknown as CreateTaskInput;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function requireUpdateWorkspaceTask(value: unknown): UpdateWorkspaceTaskInput {
  const input = requireObject(value, '更新任务');
  requireString(input.taskId, '任务 ID');
  if (
    input.status === undefined &&
    input.startAt === undefined &&
    input.title === undefined &&
    input.subject === undefined &&
    input.durationMin === undefined &&
    input.acceptance === undefined &&
    input.due === undefined
  ) {
    throw new Error('没有要更新的任务字段。');
  }
  if (input.status !== undefined) requireTaskStatus(input.status);
  if (input.startAt !== undefined && input.startAt !== null && !isLocalDateTime(input.startAt)) {
    throw new Error('任务开始时间无效。');
  }
  if (input.actualMin !== undefined && (typeof input.actualMin !== 'number' || input.actualMin < 0)) {
    throw new Error('实际用时无效。');
  }
  if (input.title !== undefined) requireString(input.title, '任务标题');
  if (input.subject !== undefined && typeof input.subject !== 'string') {
    throw new Error('任务科目无效。');
  }
  if (input.acceptance !== undefined && typeof input.acceptance !== 'string') {
    throw new Error('任务验收标准无效。');
  }
  if (
    input.durationMin !== undefined &&
    (typeof input.durationMin !== 'number' || !Number.isFinite(input.durationMin) || input.durationMin < 0)
  ) {
    throw new Error('任务时长无效。');
  }
  if (
    input.due !== undefined &&
    input.due !== null &&
    (typeof input.due !== 'string' || !ISO_DATE.test(input.due) || Number.isNaN(Date.parse(input.due)))
  ) {
    throw new Error('任务截止日期无效。');
  }
  return input as unknown as UpdateWorkspaceTaskInput;
}

function requireDeleteTask(value: unknown): DeleteTaskInput {
  const input = requireObject(value, '删除任务');
  return { taskId: requireString(input.taskId, '任务 ID') };
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

function requireDeleteNote(value: unknown): DeleteNoteInput {
  const input = requireObject(value, '删除笔记');
  return { noteId: requireString(input.noteId, '笔记 ID') };
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

function requireReminderDays(value: unknown): number[] {
  if (!Array.isArray(value)) throw new Error('提醒重复日期无效。');
  const days = [...new Set(value)].sort((a, b) => a - b);
  for (const day of days) {
    if (!Number.isInteger(day) || typeof day !== 'number' || day < 0 || day > 6) {
      throw new Error('提醒重复日期必须是 0–6。');
    }
  }
  return days as number[];
}

function requireCreateReminder(value: unknown): CreateReminderInput {
  const input = requireObject(value, '创建提醒');
  return {
    time: requireReminderTime(input.time),
    label: requireString(input.label, '提醒内容'),
    ...(input.enabled !== undefined ? { enabled: requireReminderEnabled(input.enabled) } : {}),
    ...(input.days !== undefined ? { days: requireReminderDays(input.days) } : {})
  };
}

function requireUpdateReminder(value: unknown): UpdateReminderInput {
  const input = requireObject(value, '更新提醒');
  return {
    id: requireString(input.id, '提醒 ID'),
    ...(input.time !== undefined ? { time: requireReminderTime(input.time) } : {}),
    ...(input.label !== undefined ? { label: requireString(input.label, '提醒内容') } : {}),
    ...(input.enabled !== undefined ? { enabled: requireReminderEnabled(input.enabled) } : {}),
    ...(input.days !== undefined
      ? { days: input.days === null ? null : requireReminderDays(input.days) }
      : {})
  };
}

function requireDeleteReminder(value: unknown): DeleteReminderInput {
  const input = requireObject(value, '删除提醒');
  return { id: requireString(input.id, '提醒 ID') };
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

function requireSetConversationModel(value: unknown): {
  conversationId: string;
  model: string | null;
} {
  const input = requireObject(value, '设置对话模型');
  const model = input.model;
  if (model !== null && typeof model !== 'string') {
    throw new Error('对话模型无效。');
  }
  if (typeof model === 'string' && Array.from(model).length > 120) {
    throw new Error('对话模型过长。');
  }
  return {
    conversationId: requireString(input.conversationId, '对话 ID'),
    model
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
  const payload = requireObject(value, '阿咲流式请求');
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

function requireUpdatePracticeSet(value: unknown): UpdatePracticeSetInput {
  const input = requireObject(value, '更新练习');
  const setId = requireString(input.setId, '练习 ID');
  if (input.title === undefined && input.subject === undefined) {
    throw new Error('练习更新参数无效。');
  }
  if (input.title !== undefined) requireString(input.title, '练习标题');
  if (input.subject !== undefined && typeof input.subject !== 'string') {
    throw new Error('练习科目无效。');
  }
  return {
    setId,
    ...(input.title !== undefined ? { title: input.title as string } : {}),
    ...(input.subject !== undefined ? { subject: input.subject as string } : {})
  };
}

function requireDeletePracticeSet(value: unknown): DeletePracticeSetInput {
  const input = requireObject(value, '删除练习');
  return { setId: requireString(input.setId, '练习 ID') };
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

function requireCreateMemory(value: unknown): CreateMemoryInput {
  const input = requireObject(value, '新增记忆');
  return {
    workspaceId: requireString(input.workspaceId, '工作区 ID'),
    text: requireString(input.text, '记忆内容'),
    kind: requireMemoryKind(input.kind)
  };
}

function requireDeleteMemory(value: unknown): DeleteMemoryInput {
  const input = requireObject(value, '删除记忆');
  return {
    workspaceId: requireString(input.workspaceId, '工作区 ID'),
    id: requireString(input.id, '记忆 ID')
  };
}

const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = ['planned', 'learning', 'mastered', 'paused'];
const KNOWLEDGE_NAME_LIMIT = 60;
const KNOWLEDGE_ALIAS_LIMIT = 40;
const KNOWLEDGE_MAX_ALIASES = 8;

function optionalKnowledgeStatus(value: unknown): KnowledgeStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(KNOWLEDGE_STATUSES as readonly string[]).includes(value)) {
    throw new Error('知识主题状态无效。');
  }
  return value as KnowledgeStatus;
}

function knowledgeLevel(value: unknown, allowNull: boolean): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('掌握程度必须在 1 到 5 之间。');
  }
  return value;
}

function knowledgeAliases(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error('知识主题别名无效。');
  const aliases: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error('知识主题别名无效。');
    const alias = entry.trim();
    if (!alias) continue;
    if (alias.length > KNOWLEDGE_ALIAS_LIMIT) {
      throw new Error(`别名不能超过 ${KNOWLEDGE_ALIAS_LIMIT} 字。`);
    }
    aliases.push(alias);
  }
  if (aliases.length > KNOWLEDGE_MAX_ALIASES) {
    throw new Error(`别名最多 ${KNOWLEDGE_MAX_ALIASES} 个。`);
  }
  return aliases;
}

function knowledgeWorkspace(value: unknown, allowNull: boolean): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && allowNull) return null;
  if (typeof value !== 'string') throw new Error('所属工作区无效。');
  return value.trim();
}

function knowledgeSummary(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('知识主题摘要无效。');
  return value;
}

function requireKnowledgeName(value: unknown): string {
  const name = requireString(value, '知识主题名称').trim();
  if (name.length > KNOWLEDGE_NAME_LIMIT) {
    throw new Error(`知识主题名称不能超过 ${KNOWLEDGE_NAME_LIMIT} 字。`);
  }
  return name;
}

function requireMergeKnowledgeTopics(value: unknown): MergeKnowledgeTopicsInput {
  const input = requireObject(value, '合并知识主题');
  const sourceId = requireString(input.sourceId, '知识主题 ID').trim();
  const targetId = requireString(input.targetId, '知识主题 ID').trim();
  return { sourceId, targetId };
}

function requireCreateKnowledgeTopic(value: unknown): CreateKnowledgeTopicInput {
  const input = requireObject(value, '创建知识主题');
  const name = requireKnowledgeName(input.name);
  const status = optionalKnowledgeStatus(input.status);
  const level = knowledgeLevel(input.level, false);
  const aliases = knowledgeAliases(input.aliases);
  const workspaceId = knowledgeWorkspace(input.workspaceId, false);
  const summary = knowledgeSummary(input.summary);
  return {
    name,
    ...(status !== undefined ? { status } : {}),
    ...(typeof level === 'number' ? { level } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
    ...(typeof workspaceId === 'string' ? { workspaceId } : {}),
    ...(summary !== undefined ? { summary } : {})
  };
}

function requireUpdateKnowledgeTopic(value: unknown): UpdateKnowledgeTopicInput {
  const input = requireObject(value, '更新知识主题');
  const id = requireString(input.id, '知识主题 ID').trim();
  const status = optionalKnowledgeStatus(input.status);
  const level = knowledgeLevel(input.level, true);
  const aliases = knowledgeAliases(input.aliases);
  const workspaceId = knowledgeWorkspace(input.workspaceId, true);
  const summary = knowledgeSummary(input.summary);
  return {
    id,
    ...(input.name !== undefined ? { name: requireKnowledgeName(input.name) } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(level !== undefined ? { level } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(summary !== undefined ? { summary } : {})
  };
}

function requireSaveKnowledgeNote(value: unknown): SaveKnowledgeNoteInput {
  const input = requireObject(value, '保存知识笔记');
  const topicId = requireString(input.topicId, '知识主题 ID').trim();
  // An empty body is meaningful: it clears the note.
  if (typeof input.body !== 'string') throw new Error('笔记内容无效。');
  if (input.body.length > MAX_KNOWLEDGE_NOTE_LENGTH) {
    throw new Error(`笔记不能超过 ${MAX_KNOWLEDGE_NOTE_LENGTH} 字。`);
  }
  // An empty revision is meaningful: the editor started from a missing note.
  if (
    input.expectedRevision !== undefined &&
    typeof input.expectedRevision !== 'string'
  ) {
    throw new Error('笔记版本参数无效。');
  }
  if (input.force !== undefined && typeof input.force !== 'boolean') {
    throw new Error('覆盖参数无效。');
  }
  return {
    topicId,
    body: input.body,
    ...(input.expectedRevision !== undefined
      ? { expectedRevision: input.expectedRevision }
      : {}),
    ...(input.force !== undefined ? { force: input.force } : {})
  };
}

function requirePlanWorkspace(value: unknown): PlanWorkspaceInput {
  const input = requireObject(value, '生成计划');
  requireString(input.workspaceId, '工作区 ID');
  optionalString(input.date, '计划日期');
  optionalPositiveNumber(input.availableMinutes, '可用时长');
  return input as unknown as PlanWorkspaceInput;
}

function requireRecalibrateLongPlan(value: unknown): RecalibrateLongPlanInput {
  const input = requireObject(value, '重排长期计划');
  const planId = requireString(input.planId, '计划 ID').trim();
  if (
    input.weeklyHours !== undefined &&
    (typeof input.weeklyHours !== 'number' || !Number.isFinite(input.weeklyHours))
  ) {
    throw new Error('每周投入参数无效。');
  }
  if (input.notes !== undefined && typeof input.notes !== 'string') {
    throw new Error('重排说明无效。');
  }
  return {
    planId,
    ...(input.weeklyHours !== undefined ? { weeklyHours: input.weeklyHours } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {})
  };
}

function requireUpdateLongPlan(value: unknown): UpdateLongPlanInput {
  const input = requireObject(value, '更新长期计划');
  const planId = requireString(input.planId, '计划 ID').trim();
  if (input.goal !== undefined && typeof input.goal !== 'string') {
    throw new Error('计划目标无效。');
  }
  if (
    input.weeklyHours !== undefined &&
    (typeof input.weeklyHours !== 'number' || !Number.isFinite(input.weeklyHours))
  ) {
    throw new Error('每周投入参数无效。');
  }
  return {
    planId,
    ...(input.goal !== undefined ? { goal: input.goal as string } : {}),
    ...(input.weeklyHours !== undefined ? { weeklyHours: input.weeklyHours } : {})
  };
}

function requireCreateLongPlan(value: unknown): CreateLongPlanInput {
  const input = requireObject(value, '生成长期计划');
  const workspaceId = requireString(input.workspaceId, '工作区 ID');
  const goal = requireString(input.goal, '计划目标');
  if (
    typeof input.weeks !== 'number' ||
    !Number.isInteger(input.weeks) ||
    input.weeks < 1 ||
    input.weeks > 16
  ) {
    throw new Error('周数必须在 1 到 16 之间。');
  }
  const startDate =
    input.startDate === undefined ? undefined : requireString(input.startDate, '起始日期');
  const weeklyHours =
    input.weeklyHours === undefined
      ? undefined
      : optionalPositiveNumber(input.weeklyHours, '每周投入');
  const notes = input.notes === undefined ? undefined : requireString(input.notes, '补充说明');
  let references: string | undefined;
  if (input.references !== undefined) {
    if (typeof input.references !== 'string') throw new Error('参考资料无效。');
    const trimmed = input.references.trim();
    if (trimmed) references = trimmed;
  }
  let research: boolean | undefined;
  if (input.research !== undefined) {
    if (typeof input.research !== 'boolean') throw new Error('联网调研选项无效。');
    research = input.research;
  }
  return {
    workspaceId,
    goal,
    weeks: input.weeks,
    ...(startDate !== undefined ? { startDate } : {}),
    ...(weeklyHours !== undefined ? { weeklyHours } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(references !== undefined ? { references } : {}),
    ...(research !== undefined ? { research } : {})
  };
}

function requireLongPlanItemDone(value: unknown): UpdateLongPlanItemInput {
  const input = requireObject(value, '更新长期计划');
  const planId = requireString(input.planId, '计划 ID');
  const weekId = requireString(input.weekId, '周 ID');
  const itemId = requireString(input.itemId, '条目 ID');
  if (input.kind !== 'day' && input.kind !== 'check') {
    throw new Error('条目类型无效。');
  }
  if (typeof input.done !== 'boolean') {
    throw new Error('完成状态无效。');
  }
  return { planId, weekId, itemId, kind: input.kind, done: input.done };
}

function requireUsageDays(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 90) {
    throw new Error('用量天数必须在 1-90 之间。');
  }
  return value;
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

function requireSearchAll(value: unknown): { query: string; limit?: number } {
  const input = requireObject(value, '搜索');
  requireString(input.query, '搜索关键词');
  const limit = optionalPositiveNumber(input.limit, '结果数量');
  return {
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
    scanLocalClis: async () => api.scanLocalClis(),
    setApiKey: async (input) => api.setApiKey(requireApiKey(input)),
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
    listLongPlans: async (input) => api.listLongPlans(optionalString(input, '工作区 ID')),
    getLongPlan: async (input) => api.getLongPlan(requireString(input, '计划 ID')),
    createLongPlan: async (input) => api.createLongPlan(requireCreateLongPlan(input)),
    recalibrateLongPlan: async (input) =>
      api.recalibrateLongPlan(requireRecalibrateLongPlan(input)),
    setLongPlanItemDone: async (input) =>
      api.setLongPlanItemDone(requireLongPlanItemDone(input)),
    deleteLongPlan: async (input) => api.deleteLongPlan(requireString(input, '计划 ID')),
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
    createMemory: async (input) => {
      const parsed = requireCreateMemory(input);
      if (!api.createMemory) throw new Error('当前存储不支持新增记忆。');
      return api.createMemory(parsed);
    },
    updateMemory: async (input) => api.updateMemory(requireUpdateMemory(input)),
    deleteMemory: async (input) => api.deleteMemory(requireDeleteMemory(input)),
    listKnowledgeTopics: async (input) => api.listKnowledgeTopics(optionalString(input, '工作区 ID')),
    createKnowledgeTopic: async (input) =>
      api.createKnowledgeTopic(requireCreateKnowledgeTopic(input)),
    updateKnowledgeTopic: async (input) =>
      api.updateKnowledgeTopic(requireUpdateKnowledgeTopic(input)),
    deleteKnowledgeTopic: async (input) =>
      api.deleteKnowledgeTopic(requireString(input, '知识主题 ID').trim()),
    getKnowledgeNote: async (input) =>
      api.getKnowledgeNote(requireString(input, '知识主题 ID').trim()),
    saveKnowledgeNote: async (input) => api.saveKnowledgeNote(requireSaveKnowledgeNote(input)),
    getKnowledgeBacklinks: async (input) =>
      api.getKnowledgeBacklinks(requireString(input, '知识主题 ID').trim()),
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
    setConversationModel: async (input) => {
      const { conversationId, model } = requireSetConversationModel(input);
      return api.setConversationModel(conversationId, model);
    },
    getUsageSummary: async (input) => api.getUsageSummary(requireUsageDays(input)),
    clearUsage: async () => api.clearUsage(),
    send: async (input) => api.send(requireSend(input)),
    searchAll: async (input) => api.searchAll(requireSearchAll(input)),
    deleteTask: async (input) => {
      const parsed = requireDeleteTask(input);
      if (!api.deleteTask) throw new Error('当前存储不支持删除任务。');
      return api.deleteTask(parsed);
    },
    deleteReminder: async (input) => {
      const parsed = requireDeleteReminder(input);
      if (!api.deleteReminder) throw new Error('当前存储不支持删除提醒。');
      return api.deleteReminder(parsed);
    },
    deleteWorkspace: async (input) => {
      const workspaceId = requireDeleteWorkspace(input);
      if (!api.deleteWorkspace) throw new Error('当前存储不支持删除项目。');
      return api.deleteWorkspace(workspaceId);
    },
    updateLongPlan: async (input) =>
      api.updateLongPlan(requireUpdateLongPlan(input)),
    mergeKnowledgeTopics: async (input) =>
      api.mergeKnowledgeTopics(requireMergeKnowledgeTopics(input)),
    deleteNote: async (input) => {
      const parsed = requireDeleteNote(input);
      if (!api.deleteNote) throw new Error('当前存储不支持删除笔记。');
      return api.deleteNote(parsed);
    },
    updatePracticeSet: async (input) => {
      const parsed = requireUpdatePracticeSet(input);
      if (!api.updatePracticeSet) throw new Error('当前存储不支持修改练习集。');
      return api.updatePracticeSet(parsed);
    },
    deletePracticeSet: async (input) => {
      const parsed = requireDeletePracticeSet(input);
      if (!api.deletePracticeSet) throw new Error('当前存储不支持删除练习集。');
      return api.deletePracticeSet(parsed);
    }
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
    scanLocalClis: () => call(IPC_CHANNELS.scanLocalClis),
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
    listLongPlans: (workspaceId) => call(IPC_CHANNELS.listLongPlans, workspaceId),
    getLongPlan: (planId) => call(IPC_CHANNELS.getLongPlan, planId),
    createLongPlan: (input) => call(IPC_CHANNELS.createLongPlan, input),
    recalibrateLongPlan: (input) => call(IPC_CHANNELS.recalibrateLongPlan, input),
    setLongPlanItemDone: (input) => call(IPC_CHANNELS.setLongPlanItemDone, input),
    deleteLongPlan: (planId) => call(IPC_CHANNELS.deleteLongPlan, planId),
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
    listKnowledgeTopics: (workspaceId) =>
      call(IPC_CHANNELS.listKnowledgeTopics, workspaceId),
    createKnowledgeTopic: (input) => call(IPC_CHANNELS.createKnowledgeTopic, input),
    updateKnowledgeTopic: (input) => call(IPC_CHANNELS.updateKnowledgeTopic, input),
    deleteKnowledgeTopic: (id) => call(IPC_CHANNELS.deleteKnowledgeTopic, id),
    getKnowledgeNote: (topicId) => call(IPC_CHANNELS.getKnowledgeNote, topicId),
    saveKnowledgeNote: (input) => call(IPC_CHANNELS.saveKnowledgeNote, input),
    getKnowledgeBacklinks: (topicId) => call(IPC_CHANNELS.getKnowledgeBacklinks, topicId),
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
    setConversationModel: (id, model) =>
      call(IPC_CHANNELS.setConversationModel, { conversationId: id, model }),
    getUsageSummary: (days) => call(IPC_CHANNELS.getUsageSummary, days),
    clearUsage: () => call(IPC_CHANNELS.clearUsage),
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
    exportBackup: () => call<BackupResult | null>(APP_IPC_CHANNELS.exportBackup),
    restoreBackup: () => call<RestoreResult | null>(APP_IPC_CHANNELS.restoreBackup),
    restartApp: () => call<void>(APP_IPC_CHANNELS.restartApp),
    send: (input) => call(IPC_CHANNELS.send, input),
    searchAll: (input) => call(IPC_CHANNELS.searchAll, input),
    deleteTask: (input) => call(IPC_CHANNELS.deleteTask, input),
    deleteReminder: (input) => call(IPC_CHANNELS.deleteReminder, input),
    createMemory: (input) => call(IPC_CHANNELS.createMemory, input),
    deleteWorkspace: (workspaceId) =>
      call(IPC_CHANNELS.deleteWorkspace, { workspaceId }),
    updateLongPlan: (input) => call(IPC_CHANNELS.updateLongPlan, input),
    mergeKnowledgeTopics: (input) => call(IPC_CHANNELS.mergeKnowledgeTopics, input),
    deleteNote: (input) => call(IPC_CHANNELS.deleteNote, input),
    updatePracticeSet: (input) => call(IPC_CHANNELS.updatePracticeSet, input),
    deletePracticeSet: (input) => call(IPC_CHANNELS.deletePracticeSet, input),
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
