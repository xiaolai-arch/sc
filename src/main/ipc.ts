import { isAbsolute } from 'node:path';
import { isLocalDateTime } from '../shared/date';
import { isTaskRepeat } from '../shared/recurrence';
import type { AppSettings } from '../shared/types';
import { MAX_TASK_CUE_LENGTH, REMINDER_STATES, isExamPhase, isTargetDate, taskCueLength, type ExamPhase, type ReminderState } from '../shared/workspace';
import type {
  BackupDirectoryStatus,
  BackupResult,
  FocusSnapshotInput,
  FocusSnapshotRecord,
  ListCommitmentsInput,
  ResolveCommitmentEntryInput,
  RestoreResult,
  SettingsPatch,
  StudyCoachApi
} from '../shared/ipc';
import type { ButlerStreamEvent } from '../shared/butler-stream';
import type { ConversationRunSnapshot } from '../shared/butler-run';
import {
  isAgentPermissions,
  normalizePermissions,
  type AgentPermissions,
  type AttachmentKind,
  type ChatAttachment
} from '../shared/attachments';
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
  ArchiveResolvedMistakesInput,
  CreatePracticeQuestionInput,
  CreatePracticeSetInput,
  DeletePracticeSetInput,
  ExportMistakeSheetInput,
  PracticeConfidence,
  RestoreArchivedMistakeInput,
  ReviewMistakeInput,
  SetMistakeCauseInput,
  SetMistakeResolvedInput,
  SubmitAnswerInput,
  SubmitShortAnswerInput,
  UpdatePracticeSetInput
} from '../shared/practice';
import type {
  CreateProfileEntryInput,
  DeleteProfileEntryInput,
  ProfileCategory,
  ProfileConfidence,
  ProfileSource,
  ProfileStatus,
  UpdateProfileEntryInput
} from '../shared/profile';
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
import type {
  VideoJob,
  VideoNotesEnqueueInput,
  VideoNotesEstimate,
  VideoNotesInput,
  VideoNotesProgress,
  VideoNotesResult
} from '../shared/video-notes';
import { ConversationRunStore } from './butler/conversation-runs';
import { isSupportedMedia } from '../shared/video-notes';

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
  deletePracticeSet: 'study-coach:practice:delete-set',
  reviewPracticeMistake: 'study-coach:practice:review-mistake',
  setPracticeMistakeResolved: 'study-coach:practice:set-mistake-resolved',
  exportMistakeSheet: 'study-coach:practice:export-mistake-sheet',
  // Profile channels are appended so existing channel order stays stable.
  listProfile: 'study-coach:profile:list',
  createProfileEntry: 'study-coach:profile:create',
  updateProfileEntry: 'study-coach:profile:update',
  deleteProfileEntry: 'study-coach:profile:delete',
  // Appended after the profile batch for the same stability reason.
  setConversationPermissions: 'study-coach:conversations:set-permissions',
  // Free recall: appended last so every existing channel keeps its position.
  submitPracticeShortAnswer: 'study-coach:practice:submit-short-answer',
  // Read-only promises; appended last so every existing channel keeps its position.
  listPendingCommitments: 'study-coach:commitments:pending',
  // iter30: act on promises, and read/clear week availability. Appended last
  // for the same stability reason; no second channel constant set.
  listCommitments: 'study-coach:commitments:list',
  resolveCommitmentEntry: 'study-coach:commitments:resolve',
  listWeekAvailability: 'study-coach:week-availability:list',
  clearWeekAvailability: 'study-coach:week-availability:clear',
  // iter33 P2b①: the single focus-snapshot slot (get for the restore prompt,
  // set at state transitions; null clears). Appended last, same reason.
  getFocusSnapshot: 'study-coach:focus-snapshot:get',
  setFocusSnapshot: 'study-coach:focus-snapshot:set',
  // iter34 P0: 错因一行 + 可逆归档. Appended last so every existing channel
  // keeps its position (the bridge round-trip test pins the order).
  setPracticeMistakeCause: 'study-coach:practice:set-mistake-cause',
  archiveResolvedPracticeMistakes: 'study-coach:practice:archive-resolved-mistakes',
  listArchivedPracticeMistakes: 'study-coach:practice:list-archived-mistakes',
  restorePracticeMistake: 'study-coach:practice:restore-mistake'
} as const;

/** Streaming uses a separate request/event pair so the request map stays stable. */
export const BUTLER_STREAM_CHANNELS = {
  stream: 'study-coach:butler:stream',
  cancel: 'study-coach:butler:cancel-stream',
  event: 'study-coach:butler:stream-event'
} as const;

/** Main-process conversation runs: snapshots for rehydration and targeted cancel. */
export const BUTLER_RUN_CHANNELS = {
  list: 'study-coach:butler-runs:list',
  cancel: 'study-coach:butler-runs:cancel'
} as const;

/** Outbound conversation events (proactive check-ins). */
export const CONVERSATION_EVENT_CHANNELS = {
  changed: 'study-coach:conversations:changed',
  open: 'study-coach:conversations:open'
} as const;

/** Outbound app events (global shortcut, tray). */
export const APP_EVENT_CHANNELS = {
  quickCapture: 'study-coach:app:quick-capture',
  navigate: 'study-coach:app:navigate'
} as const;

/** Renderer-initiated app actions that live outside the handler table. */
export const APP_IPC_CHANNELS = {
  exportBackup: 'study-coach:app:export-backup',
  restoreBackup: 'study-coach:app:restore-backup',
  restartApp: 'study-coach:app:restart',
  pickVideoFiles: 'study-coach:app:pick-video-files',
  pickOutputDirectory: 'study-coach:app:pick-output-directory',
  openPath: 'study-coach:app:open-path',
  // iter31 P1: the auto-backup directory picker. Appended last so every
  // existing channel keeps its position.
  chooseBackupDirectory: 'study-coach:app:choose-backup-directory',
  // item 66 P2-2: the settings card's in-app directory-validity stat.
  statBackupDirectory: 'study-coach:app:stat-backup-directory'
} as const;

/** Video-note generation streams progress on its own event channel. */
export const VIDEO_NOTES_CHANNELS = {
  generate: 'study-coach:video-notes:generate',
  progress: 'study-coach:video-notes:progress',
  enqueue: 'study-coach:video-notes:enqueue',
  estimate: 'study-coach:video-notes:estimate',
  listJobs: 'study-coach:video-notes:list-jobs',
  cancelJob: 'study-coach:video-notes:cancel-job',
  resumeJob: 'study-coach:video-notes:resume-job',
  retryLesson: 'study-coach:video-notes:retry-lesson',
  removeJob: 'study-coach:video-notes:remove-job',
  pickVideoFolder: 'study-coach:video-notes:pick-video-folder',
  jobsChanged: 'study-coach:video-notes:jobs-changed'
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

/**
 * Validates a task's implementation-intention cue. Create accepts an optional
 * string (empty means none); update also accepts null to clear it.
 */
function requireTaskCue(
  value: unknown,
  allowNull: boolean
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) {
    if (allowNull) return null;
    throw new Error('触发时机无效。');
  }
  if (typeof value !== 'string') throw new Error('触发时机无效。');
  if (/[\r\n]/.test(value)) throw new Error('触发时机不能包含换行。');
  const trimmed = value.trim();
  if (trimmed.length === 0) return allowNull ? null : undefined;
  if (taskCueLength(trimmed) > MAX_TASK_CUE_LENGTH) {
    throw new Error(`触发时机不能超过 ${MAX_TASK_CUE_LENGTH} 个字符。`);
  }
  return trimmed;
}

function requireCreateWorkspace(value: unknown): CreateWorkspaceInput {
  const input = requireObject(value, '创建项目');
  requireString(input.name, '项目名称');
  requireString(input.kind, '项目类型');
  requireString(input.goal, '项目目标');
  requireString(input.description, '项目描述');
  return input as unknown as CreateWorkspaceInput;
}

function requireUpdateWorkspace(value: unknown): UpdateWorkspaceInput {
  const input = requireObject(value, '更新项目');
  const checkIn = input.checkIn;
  if (checkIn !== undefined && checkIn !== 'daily' && checkIn !== 'off') {
    throw new Error('检查频率无效。');
  }
  const goal = optionalString(input.goal, '项目目标');
  const description = optionalString(input.description, '项目描述');
  let availableMinutes: number | undefined;
  if (input.availableMinutes !== undefined) {
    if (
      typeof input.availableMinutes !== 'number' ||
      !Number.isInteger(input.availableMinutes) ||
      input.availableMinutes < 5 ||
      input.availableMinutes > 24 * 60
    ) {
      throw new Error('每天可用时间需在 5 到 1440 分钟之间。');
    }
    availableMinutes = input.availableMinutes;
  }
  // null clears the target date; a string must be a real YYYY-MM-DD date.
  let targetDate: string | null | undefined;
  if (input.targetDate !== undefined) {
    if (input.targetDate === null) targetDate = null;
    else if (isTargetDate(input.targetDate)) targetDate = input.targetDate;
    else throw new Error('目标日期需为 YYYY-MM-DD 格式的日期。');
  }
  // The exam stage (iter34 P3); null clears it, and only the three labels are
  // accepted here. Whether the project is an exam is the service's call.
  let phase: ExamPhase | null | undefined;
  if (input.phase !== undefined) {
    if (input.phase === null) phase = null;
    else if (isExamPhase(input.phase)) phase = input.phase;
    else throw new Error('考研阶段需为 基础 / 强化 / 冲刺 之一。');
  }
  return {
    workspaceId: requireString(input.workspaceId, '项目 ID'),
    ...(input.name !== undefined ? { name: requireString(input.name, '项目名称') } : {}),
    ...(input.goal !== undefined ? { goal: goal ?? '' } : {}),
    ...(input.description !== undefined ? { description: description ?? '' } : {}),
    ...(checkIn !== undefined ? { checkIn: checkIn as 'daily' | 'off' } : {}),
    ...(availableMinutes !== undefined ? { availableMinutes } : {}),
    ...(targetDate !== undefined ? { targetDate } : {}),
    ...(phase !== undefined ? { phase } : {})
  };
}

function requireDeleteWorkspace(value: unknown): string {
  const input = requireObject(value, '删除项目');
  return requireString(input.workspaceId, '项目 ID');
}

function requireCreateTask(value: unknown): CreateTaskInput {
  const input = requireObject(value, '创建任务');
  requireString(input.workspaceId, '项目 ID');
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
  // A fake date the Date parser would roll over must never reach the service.
  // Same guard and wording as the update path just below.
  if (
    input.due !== undefined &&
    input.due !== null &&
    !isTargetDate(input.due)
  ) {
    throw new Error('任务截止日期无效。');
  }
  if (input.repeat !== undefined && !isTaskRepeat(input.repeat)) {
    throw new Error('任务重复规则无效。');
  }
  if (input.goalId !== undefined && (typeof input.goalId !== 'string' || input.goalId.trim() === '')) {
    throw new Error('任务目标无效。');
  }
  const cue = requireTaskCue(input.cue, false);
  // Same shape guard as the update path; trimming/truncation happens in the
  // service's normalizer, which also drops an empty value.
  if (
    input.nextStep !== undefined &&
    input.nextStep !== null &&
    typeof input.nextStep !== 'string'
  ) {
    throw new Error('任务下一步无效。');
  }
  return { ...input, ...(cue !== undefined ? { cue } : {}) } as unknown as CreateTaskInput;
}

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
    input.due === undefined &&
    input.cue === undefined &&
    input.nextStep === undefined &&
    input.repeat === undefined
  ) {
    throw new Error('没有要更新的任务字段。');
  }
  if (input.status !== undefined) requireTaskStatus(input.status);
  if (
    input.repeat !== undefined &&
    input.repeat !== null &&
    !isTaskRepeat(input.repeat)
  ) {
    throw new Error('任务重复规则无效。');
  }
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
    !isTargetDate(input.due)
  ) {
    throw new Error('任务截止日期无效。');
  }
  const cue = requireTaskCue(input.cue, true);
  // The next-step anchor truncates instead of rejecting; trimming, the single
  // line fold and the 80-code-point cut happen in the service's normalizer,
  // which also turns '' into a key deletion.
  if (
    input.nextStep !== undefined &&
    input.nextStep !== null &&
    typeof input.nextStep !== 'string'
  ) {
    throw new Error('任务下一步无效。');
  }
  return { ...input, ...(cue !== undefined ? { cue } : {}) } as unknown as UpdateWorkspaceTaskInput;
}

/**
 * Validates the focus snapshot the renderer writes at a state transition
 * (iter33 P2b①). Every session field is type-checked so a buggy caller can
 * never put a snapshot the restore rules cannot trust into state.json.
 */
function requireFocusSnapshotSet(value: unknown): FocusSnapshotInput | null {
  if (value === null) return null;
  const input = requireObject(value, '专注快照');
  const workspaceId = requireString(input.workspaceId, '项目 ID');
  const rawSession = input.session;
  if (rawSession === null || typeof rawSession !== 'object' || Array.isArray(rawSession)) {
    throw new Error('专注会话无效。');
  }
  const session = rawSession as Record<string, unknown>;
  if (typeof session.sessionId !== 'number' || !Number.isFinite(session.sessionId)) {
    throw new Error('专注会话无效。');
  }
  if (typeof session.taskId !== 'string' || session.taskId.trim() === '') {
    throw new Error('专注会话无效。');
  }
  if (typeof session.taskTitle !== 'string') throw new Error('专注会话无效。');
  if (typeof session.remainingMs !== 'number' || !Number.isFinite(session.remainingMs)) {
    throw new Error('专注会话无效。');
  }
  if (typeof session.running !== 'boolean' || typeof session.recorded !== 'boolean') {
    throw new Error('专注会话无效。');
  }
  if (typeof session.lastTickAt !== 'number' || !Number.isFinite(session.lastTickAt)) {
    throw new Error('专注会话无效。');
  }
  return {
    workspaceId,
    session: {
      sessionId: session.sessionId,
      taskId: session.taskId,
      taskTitle: session.taskTitle,
      remainingMs: session.remainingMs,
      running: session.running,
      recorded: session.recorded,
      lastTickAt: session.lastTickAt
    }
  };
}

function requireDeleteTask(value: unknown): DeleteTaskInput {
  const input = requireObject(value, '删除任务');
  return { taskId: requireString(input.taskId, '任务 ID') };
}

function requireCreateNote(value: unknown): CreateNoteInput {
  const input = requireObject(value, '创建笔记');
  requireString(input.workspaceId, '项目 ID');
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

function requireReminderState(value: unknown): ReminderState {
  if (typeof value === 'string' && (REMINDER_STATES as readonly string[]).includes(value)) {
    return value as ReminderState;
  }
  throw new Error('提醒状态无效。');
}

function requirePostponeMinutes(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 1440) {
    throw new Error('延后时长必须是 1–1440 分钟。');
  }
  return value;
}

function requireUpdateReminder(value: unknown): UpdateReminderInput {
  const input = requireObject(value, '更新提醒');
  if (input.state !== undefined && input.postponeMinutes !== undefined) {
    throw new Error('延后与状态修改不能同时提交。');
  }
  return {
    id: requireString(input.id, '提醒 ID'),
    ...(input.time !== undefined ? { time: requireReminderTime(input.time) } : {}),
    ...(input.label !== undefined ? { label: requireString(input.label, '提醒内容') } : {}),
    ...(input.enabled !== undefined ? { enabled: requireReminderEnabled(input.enabled) } : {}),
    ...(input.days !== undefined
      ? { days: input.days === null ? null : requireReminderDays(input.days) }
      : {}),
    ...(input.state !== undefined ? { state: requireReminderState(input.state) } : {}),
    ...(input.postponeMinutes !== undefined
      ? { postponeMinutes: requirePostponeMinutes(input.postponeMinutes) }
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
  optionalString(input.workspaceId, '项目 ID');
  optionalString(input.taskId, '任务 ID');
  const permissions =
    input.permissions === undefined ? undefined : requirePermissions(input.permissions);
  const attachments: ChatAttachment[] = Array.isArray(input.attachments)
    ? input.attachments
        .slice(0, 60)
        .filter((entry): entry is Record<string, unknown> => isRecord(entry))
        .flatMap((entry): ChatAttachment[] => {
          const rawKind = entry['kind'];
          const kind: AttachmentKind | null =
            rawKind === 'image' || rawKind === 'text' ? rawKind : null;
          const name = typeof entry['name'] === 'string' ? entry['name'].slice(0, 160) : '';
          const data = typeof entry['data'] === 'string' ? entry['data'] : '';
          if (kind === null || name.length === 0) return [];
          if (data.length === 0 || data.length > 16_000_000) return [];
          return [
            {
              name,
              mediaType: typeof entry['mediaType'] === 'string' ? entry['mediaType'] : '',
              size: typeof entry['size'] === 'number' ? entry['size'] : 0,
              kind,
              data
            }
          ];
        })
        .slice(0, 6)
    : [];
  // Never let the raw payload through: only the sanitized list may be sent.
  const { attachments: _rawAttachments, ...rest } = input as unknown as SendMessageInput;
  return {
    ...rest,
    ...(permissions ? { permissions } : {}),
    ...(attachments.length > 0 ? { attachments } : {})
  };
}

function requireCreateConversation(value: unknown): CreateConversationInput {
  if (value === undefined || value === null) return {};
  const input = requireObject(value, '创建对话');
  const title = optionalString(input.title, '对话标题');
  const kind = input.kind;
  if (kind !== undefined && kind !== 'chat' && kind !== 'check-in') {
    throw new Error('对话类型无效。');
  }
  const workspaceId = optionalString(input.workspaceId, '项目 ID');
  const permissions =
    input.permissions === undefined ? undefined : requirePermissions(input.permissions);
  return {
    ...(title !== undefined ? { title } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(permissions !== undefined ? { permissions } : {})
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

function requireSetConversationPermissions(value: unknown) {
  const input = requireObject(value, '设置对话权限');
  return {
    conversationId: requireString(input.conversationId, '对话 ID'),
    permissions: requirePermissions(input.permissions)
  };
}

function requirePermissions(value: unknown): AgentPermissions {
  if (!isAgentPermissions(value)) {
    throw new Error('权限设置无效。');
  }
  return normalizePermissions(value);
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
    input.trigger === 'weekly' ||
    input.trigger === 'behind' ||
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
  requireString(input.workspaceId, '项目 ID');
  requireString(input.date, '日期');
  return input as unknown as { workspaceId: string; date: string };
}

/**
 * The optional confidence enum crossing IPC. Absent is fine (the learner did
 * not pick one); anything other than `sure`/`unsure` is rejected so a typo
 * cannot silently reach the scheduler.
 */
function optionalConfidence(value: unknown): PracticeConfidence | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'sure' && value !== 'unsure') throw new Error('把握度参数无效。');
  return value;
}

function requireSubmitAnswer(value: unknown): SubmitAnswerInput {
  const input = requireObject(value, '提交答案');
  requireString(input.questionId, '题目 ID');
  const choice = optionalNonNegativeInteger(input.choice, '选项');
  if (choice === undefined) throw new Error('选项参数无效。');
  const confidence = optionalConfidence(input.confidence);
  return {
    questionId: input.questionId as string,
    choice,
    ...(confidence !== undefined ? { confidence } : {})
  };
}

function requireSubmitShortAnswer(value: unknown): SubmitShortAnswerInput {
  const input = requireObject(value, '提交简答');
  const questionId = requireString(input.questionId, '题目 ID');
  const response = requireString(input.response, '回答内容');
  if (typeof input.selfCorrect !== 'boolean') throw new Error('自评参数无效。');
  const confidence = optionalConfidence(input.confidence);
  // 对照检查点自查的勾选；非数组一律视为没有，交给服务端对齐题目检查点。
  const checkpointHits = Array.isArray(input.checkpointHits) ? input.checkpointHits : undefined;
  return {
    questionId,
    response,
    selfCorrect: input.selfCorrect,
    ...(checkpointHits !== undefined
      ? { checkpointHits: checkpointHits as boolean[] }
      : {}),
    ...(confidence !== undefined ? { confidence } : {})
  };
}

/** Local date the notification center asks about; a bad shape must not reach the vault. */
function requirePendingCommitments(value: unknown): { byDate: string } {
  const input = requireObject(value, '读取承诺');
  const byDate = requireString(input.byDate, '日期');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(byDate)) throw new Error('日期格式必须为 YYYY-MM-DD。');
  return { byDate };
}

/** Optional `{ includeResolved }`; a non-boolean flag is rejected, not coerced. */
function requireListCommitments(value: unknown): ListCommitmentsInput {
  if (value === undefined || value === null) return {};
  const input = requireObject(value, '读取承诺');
  if (input.includeResolved !== undefined && typeof input.includeResolved !== 'boolean') {
    throw new Error('includeResolved 必须是布尔值。');
  }
  return input.includeResolved === undefined
    ? {}
    : { includeResolved: input.includeResolved };
}

const COMMITMENT_ACTIONS = ['reschedule', 'drop', 'done'] as const;

/** 改期 needs a real date no earlier than today; the other actions take none. */
function requireResolveCommitmentEntry(value: unknown): ResolveCommitmentEntryInput {
  const input = requireObject(value, '处理承诺');
  const id = requireString(input.id, '承诺 ID');
  if (
    typeof input.action !== 'string' ||
    !(COMMITMENT_ACTIONS as readonly string[]).includes(input.action)
  ) {
    throw new Error('承诺操作无效。');
  }
  if (input.action === 'reschedule') {
    const due = requireString(input.due, '新日期');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      throw new Error('新日期格式必须为 YYYY-MM-DD。');
    }
    return { id, action: 'reschedule', due };
  }
  return { id, action: input.action as 'drop' | 'done' };
}

/** The Monday starting the week to clear; a bad shape is rejected early. */
function requireClearWeekAvailability(value: unknown): { weekStart: string } {
  const input = requireObject(value, '清除一周安排');
  const weekStart = requireString(input.weekStart, '周起始日');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new Error('周起始日格式必须为 YYYY-MM-DD。');
  }
  return { weekStart };
}

/**
 * Provenance crossing IPC. Absent (and `user`) means a hand-made set; only * `model` is meaningful, and a stray value is rejected so a typo cannot make a
 * set silently claim to be hand-made.
 */
function optionalPracticeSource(value: unknown): 'user' | 'model' | undefined {
  if (value === undefined || value === null) return undefined;
  if (value !== 'user' && value !== 'model') throw new Error('练习来源无效。');
  return value;
}

/** The 我看过了 timestamp; the renderer sends an ISO date string. */
function requireReviewTimestamp(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(new Date(value).getTime())) {
    throw new Error('复习确认时间无效。');
  }
  return value;
}

function requireCreatePracticeSet(value: unknown): CreatePracticeSetInput {
  const input = requireObject(value, '创建练习');
  requireString(input.workspaceId, '项目 ID');
  requireString(input.title, '练习标题');
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error('练习题目不能为空。');
  }
  const source = optionalPracticeSource(input.source);
  return {
    ...(input as unknown as CreatePracticeSetInput),
    ...(source !== undefined ? { source } : {})
  };
}

function requireUpdatePracticeSet(value: unknown): UpdatePracticeSetInput {
  const input = requireObject(value, '更新练习');
  const setId = requireString(input.setId, '练习 ID');
  const hasQuestions = input.questions !== undefined;
  const hasReviewedAt = input.reviewedAt !== undefined;
  if (input.title === undefined && input.subject === undefined && !hasQuestions && !hasReviewedAt) {
    throw new Error('练习更新参数无效。');
  }
  if (input.title !== undefined) requireString(input.title, '练习标题');
  if (input.subject !== undefined && typeof input.subject !== 'string') {
    throw new Error('练习科目无效。');
  }
  if (hasQuestions && (!Array.isArray(input.questions) || input.questions.length === 0)) {
    throw new Error('练习题目不能为空。');
  }
  const reviewedAt = hasReviewedAt ? requireReviewTimestamp(input.reviewedAt) : undefined;
  return {
    setId,
    ...(input.title !== undefined ? { title: input.title as string } : {}),
    ...(input.subject !== undefined ? { subject: input.subject as string } : {}),
    ...(reviewedAt !== undefined ? { reviewedAt } : {}),
    ...(hasQuestions
      ? { questions: input.questions as CreatePracticeQuestionInput[] }
      : {})
  };
}

function requireDeletePracticeSet(value: unknown): DeletePracticeSetInput {
  const input = requireObject(value, '删除练习');
  return { setId: requireString(input.setId, '练习 ID') };
}

function requireReviewMistake(value: unknown): ReviewMistakeInput {
  const input = requireObject(value, '复习错题');
  const mistakeId = requireString(input.mistakeId, '错题 ID');
  const confidence = optionalConfidence(input.confidence);
  // A choice review sends `choice`; a short review sends its typed answer and
  // self-assessment. The service decides which shape the stored mistake needs.
  if (input.response !== undefined || input.selfCorrect !== undefined) {
    const response = requireString(input.response, '回答内容');
    if (typeof input.selfCorrect !== 'boolean') throw new Error('自评参数无效。');
    return {
      mistakeId,
      response,
      selfCorrect: input.selfCorrect,
      ...(confidence !== undefined ? { confidence } : {})
    };
  }
  const choice = input.choice;
  if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0) {
    throw new Error('选项无效。');
  }
  return { mistakeId, choice, ...(confidence !== undefined ? { confidence } : {}) };
}

function requireSetMistakeResolved(value: unknown): SetMistakeResolvedInput {
  const input = requireObject(value, '更新错题');
  if (typeof input.resolved !== 'boolean') throw new Error('错题状态无效。');
  return {
    mistakeId: requireString(input.mistakeId, '错题 ID'),
    resolved: input.resolved
  };
}

function requireExportMistakeSheet(value: unknown): ExportMistakeSheetInput {
  const input = requireObject(value, '导出复习单');
  const workspaceId = requireString(input.workspaceId, '项目 ID');
  if (input.dueOnly !== undefined && typeof input.dueOnly !== 'boolean') {
    throw new Error('导出范围参数无效。');
  }
  return {
    workspaceId,
    ...(input.dueOnly !== undefined ? { dueOnly: input.dueOnly } : {})
  };
}

function requireSetMistakeCause(value: unknown): SetMistakeCauseInput {
  const input = requireObject(value, '保存错因');
  // An empty / whitespace-only cause is a legitimate "clear it" request, so the
  // value must be a string but is not required to be non-empty; the service
  // trims and drops a blank one.
  if (typeof input.cause !== 'string') throw new Error('错因必须是文字。');
  return { mistakeId: requireString(input.mistakeId, '错题 ID'), cause: input.cause };
}

function requireArchiveResolvedMistakes(value: unknown): ArchiveResolvedMistakesInput {
  const input = requireObject(value, '清空已掌握');
  return { workspaceId: requireString(input.workspaceId, '项目 ID') };
}

function requireRestoreArchivedMistake(value: unknown): RestoreArchivedMistakeInput {
  const input = requireObject(value, '恢复归档错题');
  return { mistakeId: requireString(input.mistakeId, '错题 ID') };
}

function requireSynthesizeMemory(value: unknown): SynthesizeMemoryInput {
  const input = requireObject(value, '生成记忆');
  requireString(input.workspaceId, '项目 ID');
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
    workspaceId: requireString(input.workspaceId, '项目 ID'),
    id: requireString(input.id, '记忆 ID'),
    ...(input.text !== undefined ? { text: requireString(input.text, '记忆内容') } : {}),
    ...(input.kind !== undefined ? { kind: requireMemoryKind(input.kind) } : {})
  };
}

function requireCreateMemory(value: unknown): CreateMemoryInput {
  const input = requireObject(value, '新增记忆');
  return {
    workspaceId: requireString(input.workspaceId, '项目 ID'),
    text: requireString(input.text, '记忆内容'),
    kind: requireMemoryKind(input.kind)
  };
}

function requireDeleteMemory(value: unknown): DeleteMemoryInput {
  const input = requireObject(value, '删除记忆');
  return {
    workspaceId: requireString(input.workspaceId, '项目 ID'),
    id: requireString(input.id, '记忆 ID')
  };
}

const PROFILE_CATEGORIES = ['identity', 'constraints', 'abilities', 'recent'] as const;
const PROFILE_SOURCES = ['user', 'model'] as const;
const PROFILE_CONFIDENCES = ['confirmed', 'candidate'] as const;
const PROFILE_STATUSES = ['active', 'expired'] as const;

function requireProfileCategory(value: unknown): ProfileCategory {
  if (typeof value !== 'string' || !(PROFILE_CATEGORIES as readonly string[]).includes(value)) {
    throw new Error('档案分类无效。');
  }
  return value as ProfileCategory;
}

function optionalProfileSource(value: unknown): ProfileSource | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(PROFILE_SOURCES as readonly string[]).includes(value)) {
    throw new Error('档案来源无效。');
  }
  return value as ProfileSource;
}

function optionalProfileConfidence(value: unknown): ProfileConfidence | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    !(PROFILE_CONFIDENCES as readonly string[]).includes(value)
  ) {
    throw new Error('档案可信度无效。');
  }
  return value as ProfileConfidence;
}

function optionalProfileStatus(value: unknown): ProfileStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(PROFILE_STATUSES as readonly string[]).includes(value)) {
    throw new Error('档案状态无效。');
  }
  return value as ProfileStatus;
}

function requireCreateProfileEntry(value: unknown): CreateProfileEntryInput {
  const input = requireObject(value, '新增个人档案');
  const source = optionalProfileSource(input.source);
  const confidence = optionalProfileConfidence(input.confidence);
  const origin = optionalString(input.origin, '档案来源说明');
  return {
    category: requireProfileCategory(input.category),
    text: requireString(input.text, '档案内容'),
    ...(source ? { source } : {}),
    ...(confidence ? { confidence } : {}),
    ...(origin ? { origin } : {})
  };
}

function requireUpdateProfileEntry(value: unknown): UpdateProfileEntryInput {
  const input = requireObject(value, '更新个人档案');
  const category = input.category === undefined ? undefined : requireProfileCategory(input.category);
  const confidence = optionalProfileConfidence(input.confidence);
  const status = optionalProfileStatus(input.status);
  return {
    id: requireString(input.id, '档案 ID'),
    ...(input.text !== undefined ? { text: requireString(input.text, '档案内容') } : {}),
    ...(category ? { category } : {}),
    ...(confidence ? { confidence } : {}),
    ...(status ? { status } : {})
  };
}

function requireDeleteProfileEntry(value: unknown): DeleteProfileEntryInput {
  const input = requireObject(value, '删除个人档案');
  return { id: requireString(input.id, '档案 ID') };
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
  if (typeof value !== 'string') throw new Error('所属项目无效。');
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
  requireString(input.workspaceId, '项目 ID');
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
  const workspaceId = requireString(input.workspaceId, '项目 ID');
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

const MAX_VIDEO_FILES = 200;

function absolutePath(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}无效。`);
  }
  const trimmed = value.trim();
  if (!isAbsolute(trimmed)) throw new Error(`${label}必须是绝对路径。`);
  return trimmed;
}

function requireVideoNotesInput(value: unknown): VideoNotesInput {
  const input = requireObject(value, '生成视频笔记');
  if (!Array.isArray(input.videoPaths) || input.videoPaths.length === 0) {
    throw new Error('请先选择视频文件。');
  }
  if (input.videoPaths.length > MAX_VIDEO_FILES) {
    throw new Error(`一次最多处理 ${MAX_VIDEO_FILES} 个文件。`);
  }
  const videoPaths: string[] = [];
  for (const entry of input.videoPaths) {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      throw new Error('视频路径无效。');
    }
    videoPaths.push(entry);
  }
  let outputDir: string | undefined;
  if (input.outputDir !== undefined) {
    if (typeof input.outputDir !== 'string') throw new Error('输出文件夹无效。');
    const trimmed = input.outputDir.trim();
    if (trimmed.length > 0) outputDir = trimmed;
  }
  return {
    videoPaths,
    ...(outputDir !== undefined ? { outputDir } : {})
  };
}

function requireVideoNotesEnqueueInput(value: unknown): VideoNotesEnqueueInput {
  const input = requireObject(value, '提交视频任务');
  const videoPaths: string[] = [];
  if (input.videoPaths !== undefined) {
    if (!Array.isArray(input.videoPaths)) throw new Error('视频路径无效。');
    if (input.videoPaths.length > MAX_VIDEO_FILES) {
      throw new Error(`一次最多处理 ${MAX_VIDEO_FILES} 个文件。`);
    }
    for (const entry of input.videoPaths) {
      const path = absolutePath(entry, '视频路径');
      if (!isSupportedMedia(path)) {
        throw new Error('不支持的媒体格式。');
      }
      videoPaths.push(path);
    }
  }
  let folder: string | undefined;
  if (input.folder !== undefined) {
    folder = absolutePath(input.folder, '文件夹路径');
  }
  if (videoPaths.length === 0 && folder === undefined) {
    throw new Error('请先选择视频文件或文件夹。');
  }
  let outputDir: string | undefined;
  if (input.outputDir !== undefined) {
    if (typeof input.outputDir !== 'string') throw new Error('输出文件夹无效。');
    const trimmed = input.outputDir.trim();
    if (trimmed.length > 0) outputDir = absolutePath(trimmed, '输出文件夹');
  }
  return {
    ...(videoPaths.length > 0 ? { videoPaths } : {}),
    ...(folder !== undefined ? { folder } : {}),
    ...(outputDir !== undefined ? { outputDir } : {})
  };
}

function requireRetryLesson(value: unknown): { jobId: string; videoPath: string } {
  const input = requireObject(value, '重试视频任务');
  const jobId = requireString(input.jobId, '任务 ID').trim();
  const videoPath = requireString(input.videoPath, '视频路径').trim();
  if (jobId.length === 0) throw new Error('任务 ID 无效。');
  if (videoPath.length === 0) throw new Error('视频路径无效。');
  return { jobId, videoPath };
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
  requireString(input.workspaceId, '项目 ID');
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
  const workspaceId = optionalString(input.workspaceId, '项目 ID');
  const limit = optionalPositiveNumber(input.limit, '结果数量');
  return {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

/**
 * Settings crossing IPC. The nested objects keep their existing shapes; the
 * opt-in `strictMastery` flag is the one optional top-level switch added here,
 * and it must be a real boolean so a renderer typo cannot quietly flip the
 * learner's mastery rule.
 */
function requireSettingsPatch(value: unknown): SettingsPatch {
  const input = requireObject(value, '更新设置');
  if (input.strictMastery !== undefined && typeof input.strictMastery !== 'boolean') {
    throw new Error('严格掌握设置必须是布尔值。');
  }
  // The service owns trimming, the length bound and the line check; the
  // channel only rejects the wrong shape early.
  if (input.accountabilityName !== undefined && typeof input.accountabilityName !== 'string') {
    throw new Error('问责对象必须是文本。');
  }
  return input as SettingsPatch;
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
    updateSettings: async (input) => api.updateSettings(requireSettingsPatch(input)),
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
      api.getWorkspaceSnapshot(requireString(input, '项目 ID')),
    createTask: async (input) => api.createTask(requireCreateTask(input)),
    updateWorkspaceTask: async (input) => api.updateWorkspaceTask(requireUpdateWorkspaceTask(input)),
    createNote: async (input) => api.createNote(requireCreateNote(input)),
    updateNote: async (input) => api.updateNote(requireUpdateNote(input)),
    getMemory: async (input) => api.getMemory(optionalString(input, '项目 ID')),
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
    listLongPlans: async (input) => api.listLongPlans(optionalString(input, '项目 ID')),
    getLongPlan: async (input) => api.getLongPlan(requireString(input, '计划 ID')),
    createLongPlan: async (input) => api.createLongPlan(requireCreateLongPlan(input)),
    recalibrateLongPlan: async (input) =>
      api.recalibrateLongPlan(requireRecalibrateLongPlan(input)),
    setLongPlanItemDone: async (input) =>
      api.setLongPlanItemDone(requireLongPlanItemDone(input)),
    deleteLongPlan: async (input) => api.deleteLongPlan(requireString(input, '计划 ID')),
    listPracticeSets: async (input) => api.listPracticeSets(requireString(input, '项目 ID')),
    getPracticeSet: async (input) => api.getPracticeSet(requireString(input, '练习 ID')),
    createPracticeSet: async (input) => api.createPracticeSet(requireCreatePracticeSet(input)),
    submitPracticeAnswer: async (input) => api.submitPracticeAnswer(requireSubmitAnswer(input)),
    submitPracticeShortAnswer: async (input) =>
      api.submitPracticeShortAnswer(requireSubmitShortAnswer(input)),
    listPendingCommitments: async (input) =>
      api.listPendingCommitments(requirePendingCommitments(input)),
    listCommitments: async (input) => api.listCommitments(requireListCommitments(input)),
    resolveCommitmentEntry: async (input) =>
      api.resolveCommitmentEntry(requireResolveCommitmentEntry(input)),
    listWeekAvailability: async () => api.listWeekAvailability(),
    clearWeekAvailability: async (input) =>
      api.clearWeekAvailability(requireClearWeekAvailability(input)),
    getPracticeMistakes: async (input) => api.getPracticeMistakes(requireString(input, '项目 ID')),
    getPracticeDue: async (input) => api.getPracticeDue(requirePracticeDue(input)),
    listPracticeAttempts: async (input) =>
      api.listPracticeAttempts(requireString(input, '项目 ID')),
    listMemory: async (input) => api.listMemory(optionalString(input, '项目 ID')),
    synthesizeMemory: async (input) => api.synthesizeMemory(requireSynthesizeMemory(input)),
    getMemoryProfile: async (input) => api.getMemoryProfile(optionalString(input, '项目 ID')),
    createMemory: async (input) => {
      const parsed = requireCreateMemory(input);
      if (!api.createMemory) throw new Error('当前存储不支持新增记忆。');
      return api.createMemory(parsed);
    },
    updateMemory: async (input) => api.updateMemory(requireUpdateMemory(input)),
    deleteMemory: async (input) => api.deleteMemory(requireDeleteMemory(input)),
    listProfile: async () => api.listProfile(),
    createProfileEntry: async (input) =>
      api.createProfileEntry(requireCreateProfileEntry(input)),
    updateProfileEntry: async (input) =>
      api.updateProfileEntry(requireUpdateProfileEntry(input)),
    deleteProfileEntry: async (input) =>
      api.deleteProfileEntry(requireDeleteProfileEntry(input)),
    listKnowledgeTopics: async (input) => api.listKnowledgeTopics(optionalString(input, '项目 ID')),
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
    setConversationPermissions: async (input) => {
      const { conversationId, permissions } = requireSetConversationPermissions(input);
      return api.setConversationPermissions(conversationId, permissions);
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
    },
    reviewPracticeMistake: async (input) => {
      const parsed = requireReviewMistake(input);
      if (!api.reviewPracticeMistake) throw new Error('当前存储不支持复习错题。');
      return api.reviewPracticeMistake(parsed);
    },
    setPracticeMistakeResolved: async (input) => {
      const parsed = requireSetMistakeResolved(input);
      if (!api.setPracticeMistakeResolved) throw new Error('当前存储不支持更新错题。');
      return api.setPracticeMistakeResolved(parsed);
    },
    exportMistakeSheet: async (input) => {
      const parsed = requireExportMistakeSheet(input);
      if (!api.exportMistakeSheet) throw new Error('当前存储不支持导出复习单。');
      return api.exportMistakeSheet(parsed);
    },
    setPracticeMistakeCause: async (input) => {
      const parsed = requireSetMistakeCause(input);
      if (!api.setPracticeMistakeCause) throw new Error('当前存储不支持保存错因。');
      return api.setPracticeMistakeCause(parsed);
    },
    archiveResolvedPracticeMistakes: async (input) => {
      const parsed = requireArchiveResolvedMistakes(input);
      if (!api.archiveResolvedPracticeMistakes) throw new Error('当前存储不支持清空已掌握。');
      return api.archiveResolvedPracticeMistakes(parsed);
    },
    listArchivedPracticeMistakes: async (input) => {
      const workspaceId = requireString(input, '项目 ID');
      if (!api.listArchivedPracticeMistakes) throw new Error('当前存储不支持读取归档。');
      return api.listArchivedPracticeMistakes(workspaceId);
    },
    restorePracticeMistake: async (input) => {
      const parsed = requireRestoreArchivedMistake(input);
      if (!api.restorePracticeMistake) throw new Error('当前存储不支持恢复归档错题。');
      return api.restorePracticeMistake(parsed);
    },
    getFocusSnapshot: async () => api.getFocusSnapshot(),
    setFocusSnapshot: async (input) => api.setFocusSnapshot(requireFocusSnapshotSet(input))
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
 * When a run store is provided, the run itself lives in the main process and
 * survives renderer navigation; the renderer only mirrors its events.
 */
export function createButlerStreamHandler(
  api: StudyCoachApi,
  registry: Map<string, AbortController> = new Map(),
  runs?: ConversationRunStore
) {
  return async (event: IpcEventLike, value: unknown): Promise<SendMessageResult> => {
    const { requestId, input } = requireStreamPayload(value);
    const key = input.assistantMessageId?.trim() || requestId;
    const assistantMessageId = input.assistantMessageId?.trim() || key;
    const conversationId = input.conversationId?.trim() ?? '';
    const controller = runs
      ? await runs.begin({ runId: key, conversationId, assistantMessageId })
      : new AbortController();
    registry.set(key, controller);
    try {
      return await api.stream(
        input,
        (streamEvent: ButlerStreamEvent) => {
          runs?.update(key, streamEvent);
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
      await runs?.fail(key, serializeError(error).message);
      throw toSafeError(error);
    } finally {
      registry.delete(key);
      await runs?.finish(key);
    }
  };
}

export function createButlerCancelHandler(registry: Map<string, AbortController>) {
  return async (value: unknown): Promise<void> => {
    const id = requireString(value, '消息 ID');
    registry.get(id)?.abort();
  };
}

export function createButlerRunHandlers(runs: ConversationRunStore) {
  return {
    list: async (): Promise<ConversationRunSnapshot[]> => runs.list(),
    cancel: async (value: unknown): Promise<void> => {
      const runId = requireString(value, '运行 ID');
      await runs.cancel(runId);
    }
  };
}

/**
 * Runs one video-notes batch and forwards progress to the requesting renderer.
 * The requestId keeps a delayed run from posting into a closed dialog.
 */
export function createVideoNotesHandler(api: StudyCoachApi) {
  return async (event: IpcEventLike, value: unknown): Promise<VideoNotesResult> => {
    const payload = requireObject(value, '生成视频笔记');
    const requestId = requireString(payload.requestId, '请求 ID');
    const input = requireVideoNotesInput(payload.input);
    try {
      return await api.generateVideoNotes(input, (progress: VideoNotesProgress) => {
        if (event.sender.isDestroyed?.()) return;
        event.sender.send(VIDEO_NOTES_CHANNELS.progress, {
          requestId,
          progress: {
            ...progress,
            message: redactSecrets(progress.message).slice(0, 500)
          }
        });
      });
    } catch (error) {
      throw toSafeError(error);
    }
  };
}

/**
 * Job-queue channels. Every argument is validated here, and errors are
 * sanitized so a provider message can never leak into the renderer verbatim.
 */
export function createVideoJobHandlers(api: StudyCoachApi) {
  const run = async <T>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (error) {
      throw toSafeError(error);
    }
  };

  return {
    enqueue: (value: unknown): Promise<VideoJob> =>
      run(() => api.enqueueVideoNotes!(requireVideoNotesEnqueueInput(value))),
    estimate: (value: unknown): Promise<VideoNotesEstimate> =>
      run(() => api.estimateVideoNotes!(requireVideoNotesEnqueueInput(value))),
    listJobs: (): Promise<VideoJob[]> => run(() => api.listVideoJobs!()),
    cancelJob: (value: unknown): Promise<VideoJob> =>
      run(() => api.cancelVideoJob!(requireString(value, '任务 ID'))),
    resumeJob: (value: unknown): Promise<VideoJob> =>
      run(() => api.resumeVideoJob!(requireString(value, '任务 ID'))),
    retryLesson: (value: unknown): Promise<VideoJob> =>
      run(async () => {
        const input = requireRetryLesson(value);
        return api.retryVideoLesson!(input);
      }),
    removeJob: (value: unknown): Promise<void> =>
      run(() => api.removeVideoJob!(requireString(value, '任务 ID')))
  };
}

/** Registers every channel; Electron's ipcMain is injected for testability. */
export function registerIpcHandlers(
  api: StudyCoachApi,
  ipcMain: IpcMainLike,
  options: { runs?: ConversationRunStore } = {}
): void {
  const handlers = createIpcHandlers(api);
  const runs = options.runs ?? new ConversationRunStore();
  // Deleting a conversation must also drop any interrupted run it left behind,
  // otherwise the next hydrate would draw a live-looking bubble for a thread
  // that no longer exists.
  const deleteConversation = handlers.deleteConversation;
  handlers.deleteConversation = async (input) => {
    const result = await deleteConversation(input);
    if (typeof input === 'string') await runs.dismissConversation(input);
    return result;
  };
  for (const name of Object.keys(IPC_CHANNELS) as IpcChannelName[]) {
    ipcMain.handle(IPC_CHANNELS[name], (_event, ...args) => handlers[name](args[0]));
  }
  const registry = new Map<string, AbortController>();
  const streamHandler = createButlerStreamHandler(api, registry, runs);
  ipcMain.handle(BUTLER_STREAM_CHANNELS.stream, (event, ...args) =>
    streamHandler(event as IpcEventLike, args[0])
  );
  const cancelHandler = createButlerCancelHandler(registry);
  ipcMain.handle(BUTLER_STREAM_CHANNELS.cancel, (_event, ...args) =>
    cancelHandler(args[0])
  );
  const runHandlers = createButlerRunHandlers(runs);
  ipcMain.handle(BUTLER_RUN_CHANNELS.list, () => runHandlers.list());
  ipcMain.handle(BUTLER_RUN_CHANNELS.cancel, (_event, ...args) =>
    runHandlers.cancel(args[0])
  );
  const videoNotesHandler = createVideoNotesHandler(api);
  ipcMain.handle(VIDEO_NOTES_CHANNELS.generate, (event, ...args) =>
    videoNotesHandler(event as IpcEventLike, args[0])
  );
  const jobHandlers = createVideoJobHandlers(api);
  ipcMain.handle(VIDEO_NOTES_CHANNELS.enqueue, (_event, ...args) =>
    jobHandlers.enqueue(args[0])
  );
  ipcMain.handle(VIDEO_NOTES_CHANNELS.estimate, (_event, ...args) =>
    jobHandlers.estimate(args[0])
  );
  ipcMain.handle(VIDEO_NOTES_CHANNELS.listJobs, () => jobHandlers.listJobs());
  ipcMain.handle(VIDEO_NOTES_CHANNELS.cancelJob, (_event, ...args) =>
    jobHandlers.cancelJob(args[0])
  );
  ipcMain.handle(VIDEO_NOTES_CHANNELS.resumeJob, (_event, ...args) =>
    jobHandlers.resumeJob(args[0])
  );
  ipcMain.handle(VIDEO_NOTES_CHANNELS.retryLesson, (_event, ...args) =>
    jobHandlers.retryLesson(args[0])
  );
  ipcMain.handle(VIDEO_NOTES_CHANNELS.removeJob, (_event, ...args) =>
    jobHandlers.removeJob(args[0])
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
    listProfile: () => call(IPC_CHANNELS.listProfile),
    createProfileEntry: (input) => call(IPC_CHANNELS.createProfileEntry, input),
    updateProfileEntry: (input) => call(IPC_CHANNELS.updateProfileEntry, input),
    deleteProfileEntry: (input) => call(IPC_CHANNELS.deleteProfileEntry, input),
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
    setConversationPermissions: (id, permissions) =>
      call(IPC_CHANNELS.setConversationPermissions, { conversationId: id, permissions }),
    getUsageSummary: (days) => call(IPC_CHANNELS.getUsageSummary, days),
    clearUsage: () => call(IPC_CHANNELS.clearUsage),
    getFocusSnapshot: () => call<FocusSnapshotRecord | null>(IPC_CHANNELS.getFocusSnapshot),
    setFocusSnapshot: (input) => call<void>(IPC_CHANNELS.setFocusSnapshot, input),
    cancelStream: (messageId) => call(BUTLER_STREAM_CHANNELS.cancel, messageId),
    listConversationRuns: () => call(BUTLER_RUN_CHANNELS.list),
    cancelRun: (runId) => call(BUTLER_RUN_CHANNELS.cancel, runId),
    onConversationOpened(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(CONVERSATION_EVENT_CHANNELS.open, (payload) => {
        if (isRecord(payload) && typeof payload['conversationId'] === 'string') {
          listener(payload['conversationId']);
        }
      });
    },
    onConversationChanged(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(CONVERSATION_EVENT_CHANNELS.changed, (payload) => {
        if (isRecord(payload) && typeof payload['conversationId'] === 'string') {
          listener(payload['conversationId']);
        }
      });
    },
    onQuickCapture(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(APP_EVENT_CHANNELS.quickCapture, () => listener());
    },
    onNavigate(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(APP_EVENT_CHANNELS.navigate, (payload) => {
        if (!isRecord(payload)) return;
        const target = payload['target'];
        if (target === 'review' || target === 'settings') listener(target);
      });
    },
    exportBackup: () => call<BackupResult | null>(APP_IPC_CHANNELS.exportBackup),
    restoreBackup: () => call<RestoreResult | null>(APP_IPC_CHANNELS.restoreBackup),
    restartApp: () => call<void>(APP_IPC_CHANNELS.restartApp),
    chooseBackupDirectory: () =>
      call<string | null>(APP_IPC_CHANNELS.chooseBackupDirectory),
    statBackupDirectory: (path) =>
      call<BackupDirectoryStatus>(APP_IPC_CHANNELS.statBackupDirectory, path),
    pickVideoFiles: () => call<string[] | null>(APP_IPC_CHANNELS.pickVideoFiles),
    pickVideoFolder: () => call<string | null>(VIDEO_NOTES_CHANNELS.pickVideoFolder),
    pickOutputDirectory: () =>
      call<string | null>(APP_IPC_CHANNELS.pickOutputDirectory),
    openPath: (path) => call<string>(APP_IPC_CHANNELS.openPath, path),
    async generateVideoNotes(input, onProgress) {
      const requestId = createRequestId();
      const unsubscribe = subscribe?.(VIDEO_NOTES_CHANNELS.progress, (payload) => {
        if (!isRecord(payload) || payload['requestId'] !== requestId) return;
        const progress = payload['progress'];
        if (isRecord(progress) && typeof progress['message'] === 'string') {
          onProgress(progress as unknown as VideoNotesProgress);
        }
      });
      try {
        return await call<VideoNotesResult>(VIDEO_NOTES_CHANNELS.generate, {
          requestId,
          input
        });
      } finally {
        unsubscribe?.();
      }
    },
    enqueueVideoNotes: (input) => call<VideoJob>(VIDEO_NOTES_CHANNELS.enqueue, input),
    estimateVideoNotes: (input) =>
      call<VideoNotesEstimate>(VIDEO_NOTES_CHANNELS.estimate, input),
    listVideoJobs: () => call<VideoJob[]>(VIDEO_NOTES_CHANNELS.listJobs),
    cancelVideoJob: (id) => call<VideoJob>(VIDEO_NOTES_CHANNELS.cancelJob, id),
    resumeVideoJob: (id) => call<VideoJob>(VIDEO_NOTES_CHANNELS.resumeJob, id),
    retryVideoLesson: (input) =>
      call<VideoJob>(VIDEO_NOTES_CHANNELS.retryLesson, input),
    removeVideoJob: (id) => call<void>(VIDEO_NOTES_CHANNELS.removeJob, id),
    onVideoJobsChanged(listener) {
      if (!subscribe) return () => undefined;
      return subscribe(VIDEO_NOTES_CHANNELS.jobsChanged, (payload) => {
        if (Array.isArray(payload)) listener(payload as VideoJob[]);
      });
    },
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
    reviewPracticeMistake: (input) => call(IPC_CHANNELS.reviewPracticeMistake, input),
    setPracticeMistakeResolved: (input) => call(IPC_CHANNELS.setPracticeMistakeResolved, input),
    exportMistakeSheet: (input) => call(IPC_CHANNELS.exportMistakeSheet, input),
    setPracticeMistakeCause: (input) => call(IPC_CHANNELS.setPracticeMistakeCause, input),
    archiveResolvedPracticeMistakes: (input) =>
      call(IPC_CHANNELS.archiveResolvedPracticeMistakes, input),
    listArchivedPracticeMistakes: (workspaceId) =>
      call(IPC_CHANNELS.listArchivedPracticeMistakes, workspaceId),
    restorePracticeMistake: (input) => call(IPC_CHANNELS.restorePracticeMistake, input),
    submitPracticeShortAnswer: (input) =>
      call(IPC_CHANNELS.submitPracticeShortAnswer, input),
    listPendingCommitments: (input) => call(IPC_CHANNELS.listPendingCommitments, input),
    listCommitments: (input) => call(IPC_CHANNELS.listCommitments, input),
    resolveCommitmentEntry: (input) =>
      call(IPC_CHANNELS.resolveCommitmentEntry, input),
    listWeekAvailability: () => call(IPC_CHANNELS.listWeekAvailability),
    clearWeekAvailability: (input) => call(IPC_CHANNELS.clearWeekAvailability, input),
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
