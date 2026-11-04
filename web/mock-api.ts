import type {
  Bootstrap,
  ListReviewsInput,
  ReviewRecord,
  SearchAllInput,
  SearchWorkspaceInput,
  SettingsPatch,
  StudyCoachApi
} from '../src/shared/ipc';
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
  SendMessageInput,
  SendMessageResult,
  SubmitReviewInput,
  UpdateReminderInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../src/shared/workspace';
import type { StreamingButlerApi } from '../src/shared/butler-stream';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeBacklink,
  KnowledgeNote,
  KnowledgeTopic,
  MergeKnowledgeTopicsInput,
  SaveKnowledgeNoteInput,
  UpdateKnowledgeTopicInput
} from '../src/shared/knowledge';
import {
  KNOWLEDGE_NOTE_CONFLICT_MESSAGE,
  MAX_KNOWLEDGE_NOTE_LENGTH,
  resolveKnowledgeLink,
  wikiLinkTargets
} from '../src/shared/knowledge';
import type { UsageSummary } from '../src/shared/usage';
import type { LocalCliScanResult } from '../src/shared/local-cli';
import { BUTLER_TOOL_LABELS } from '../src/shared/butler-stream';
import type {
  Conversation,
  ConversationMessage,
  ConversationStep,
  ConversationSummary,
  CreateConversationInput
} from '../src/shared/conversations';
import type {
  CreatePracticeSetInput,
  DeletePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult,
  UpdatePracticeSetInput
} from '../src/shared/practice';
import { PRACTICE_INTERVALS } from '../src/shared/practice';
import type {
  CreateMemoryInput,
  LearnerProfile,
  DeleteMemoryInput,
  MemoryKind,
  MemoryRecord,
  MemorySynthesisResult,
  SynthesizeMemoryInput,
  UpdateMemoryInput
} from '../src/shared/memory';
import type { PlanWorkspaceInput, WorkspacePlan } from '../src/shared/planning';
import type {
  CreateLongPlanInput,
  LongPlan,
  RecalibrateLongPlanInput,
  UpdateLongPlanInput,
  UpdateLongPlanItemInput
} from '../src/shared/plans';
import { buildTemplatePlan } from '../src/shared/plan-template';
import type { SearchResult, SearchResultKind } from '../src/shared/search';
import { formatLocalDate, parseLocalDate } from '../src/shared/date';
import type { AppSettings } from '../src/shared/types';
import {
  demoMemory,
  demoNotes,
  demoPracticeSets,
  demoReminders,
  demoTasks,
  workspaces as demoWorkspaces
} from '../src/renderer/shell/demoData';
import type { NoteBlock } from '../src/renderer/shell/demoData';

export const MOCK_STORAGE_KEY = 'study-coach:prototype:v1';

interface MockState {
  onboarded: boolean;
  settings: AppSettings;
  reviews: ReviewRecord[];
  workspaces: Workspace[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  memory: MemoryRecord[];
  reminders: Reminder[];
  practiceSets: PracticeSet[];
  practiceAttempts: PracticeAttempt[];
  practiceMistakes: PracticeMistake[];
  plans: LongPlan[];
  knowledgeTopics: KnowledgeTopic[];
  knowledgeNotes: Record<string, KnowledgeNote>;
  conversations: Conversation[];
}

const MOCK_MEMORY_KINDS = new Set<MemoryKind>([
  'weakness',
  'strength',
  'preference',
  'plan',
  'fact'
]);

function inferMemoryKind(text: string): MemoryKind {
  if (/不稳|偏慢|卡|错|薄弱|不会/.test(text)) return 'weakness';
  if (/有效|保持|进步|不错|坚持/.test(text)) return 'strength';
  if (/先|明天|计划|建议|下一步/.test(text)) return 'plan';
  if (/喜欢|偏好|习惯/.test(text)) return 'preference';
  return 'fact';
}

function addDays(date: string, days: number): string {
  const next = parseLocalDate(date);
  next.setDate(next.getDate() + days);
  return formatLocalDate(next);
}

const defaultSettings: AppSettings = {
  vaultPath: '浏览器原型（内存）',
  provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' },
  notifications: {
    enabled: true,
    morning: '08:00',
    evening: '21:30',
    weekly: '20:00',
    weeklyEnabled: true,
    dndStart: '23:00',
    dndEnd: '07:30'
  },
  budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
  launchAtLogin: false
};

let idCounter = 0;

function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function bodyFromBlocks(blocks: NoteBlock[]) {
  return blocks
    .map((block) => {
      if (block.kind === 'h2') return `## ${block.text}`;
      if (block.kind === 'ul') return block.items.map((item) => `- ${item}`).join('\n');
      return block.text;
    })
    .join('\n\n');
}

function seedWorkspaceData() {
  const now = new Date().toISOString();
  return {
    workspaces: structuredClone(demoWorkspaces),
    tasks: structuredClone(demoTasks),
    notes: demoNotes.map((note): WorkspaceNote => ({
      id: note.id,
      workspaceId: note.workspaceId,
      title: note.title,
      subject: note.subject,
      tags: note.tags,
      updated: note.updated,
      summary: note.summary,
      body: bodyFromBlocks(note.blocks),
      related: note.related
    })),
    memory: demoMemory.map((item): MemoryRecord => ({
      ...structuredClone(item),
      kind: inferMemoryKind(item.text)
    })),
    reminders: demoReminders.map((reminder): Reminder => ({ ...reminder, enabled: true })),
    practiceSets: demoPracticeSets.map(
      (set): PracticeSet => ({ ...structuredClone(set), createdAt: now, updatedAt: now })
    ),
    practiceAttempts: [] as PracticeAttempt[],
    practiceMistakes: [] as PracticeMistake[]
  };
}

function normalizeMemory(items: unknown): MemoryRecord[] | null {
  if (!Array.isArray(items)) return null;
  const records: MemoryRecord[] = [];
  for (const value of items) {
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Partial<MemoryRecord>;
    if (typeof record.id !== 'string' || typeof record.text !== 'string') continue;
    records.push({
      id: record.id,
      workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : '',
      text: record.text,
      source: typeof record.source === 'string' ? record.source : '',
      ...(typeof record.createdAt === 'string' ? { createdAt: record.createdAt } : {}),
      kind: record.kind ?? inferMemoryKind(record.text)
    });
  }
  return records;
}

function defaultState(): MockState {
  return {
    onboarded: false,
    settings: structuredClone(defaultSettings),
    reviews: [],
    conversations: [],
    plans: [],
    knowledgeTopics: [],
    knowledgeNotes: {},
    ...seedWorkspaceData()
  };
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readState(storage: Storage | null): MockState {
  if (!storage) return defaultState();
  try {
    const raw = storage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<MockState>;
    const seeded = seedWorkspaceData();
    return {
      onboarded: typeof parsed.onboarded === 'boolean' ? parsed.onboarded : false,
      settings: {
        ...structuredClone(defaultSettings),
        ...parsed.settings,
        provider: parsed.settings?.provider ?? defaultSettings.provider,
        notifications: { ...defaultSettings.notifications, ...parsed.settings?.notifications },
        budget: { ...defaultSettings.budget, ...parsed.settings?.budget }
      },
      reviews: Array.isArray(parsed.reviews) ? (parsed.reviews as ReviewRecord[]) : [],
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : seeded.workspaces,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : seeded.tasks,
      notes: Array.isArray(parsed.notes) ? parsed.notes : seeded.notes,
      memory: normalizeMemory(parsed.memory) ?? seeded.memory,
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : seeded.reminders,
      practiceSets: Array.isArray(parsed.practiceSets) ? parsed.practiceSets : seeded.practiceSets,
      practiceAttempts: Array.isArray(parsed.practiceAttempts)
        ? parsed.practiceAttempts
        : seeded.practiceAttempts,
      practiceMistakes: Array.isArray(parsed.practiceMistakes)
        ? parsed.practiceMistakes
        : seeded.practiceMistakes,
      plans: Array.isArray(parsed.plans) ? (parsed.plans as LongPlan[]) : [],
      knowledgeTopics: Array.isArray(parsed.knowledgeTopics)
        ? (parsed.knowledgeTopics as KnowledgeTopic[])
        : [],
      knowledgeNotes:
        parsed.knowledgeNotes !== null && typeof parsed.knowledgeNotes === 'object'
          ? (parsed.knowledgeNotes as Record<string, KnowledgeNote>)
          : {},
      conversations: Array.isArray(parsed.conversations)
        ? (parsed.conversations as Conversation[])
        : []
    };
  } catch {
    return defaultState();
  }
}

function displayDate(date = new Date()) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function butlerReply(text: string) {
  if (/记一下|记录/.test(text)) return '记下了。可以去「记录」里查看这条随手记。';
  if (/提醒/.test(text)) return '好，我会在 21:30 提醒你复盘（原型）。';
  if (/优先级|安排|排/.test(text)) {
    return '我先按截止时间和精力排：数学 45 分钟 → 英语 30 分钟 → 政治 30 分钟。';
  }
  if (/洛必达/.test(text)) {
    return '洛必达法则要先确认 0/0 或 ∞/∞，且导函数比值极限存在。你「错题：洛必达法则的适用条件」里正好记了这一点。';
  }
  return '收到。目前是原型模式；接入模型后，我会结合你的计划、记录和复盘回答。';
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function chunkText(text: string, size: number): string[] {
  const chars = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += size) {
    chunks.push(chars.slice(index, index + size).join(''));
  }
  return chunks;
}

function truncateConversationText(value: string, limit: number): string {
  return Array.from(value.trim()).slice(0, limit).join('');
}

const MOCK_GREETINGS = new Set(['你好', 'hi', 'hello', '在吗', '嗨', '嗯', 'ok']);
const MOCK_REMINDER_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeMockReminderTime(time: string): string {
  if (!MOCK_REMINDER_TIME.test(time)) throw new Error('提醒时间格式必须是 HH:MM。');
  return time;
}

function normalizeMockDays(days: number[] | null | undefined): number[] | undefined {
  if (days === undefined || days === null) return undefined;
  if (!Array.isArray(days)) throw new Error('提醒重复日期无效。');
  const normalized = [...new Set(days)].sort((a, b) => a - b);
  for (const day of normalized) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      throw new Error('提醒重复日期必须是 0–6。');
    }
  }
  return normalized.length > 0 ? normalized : undefined;
}

function conversationTitleFromText(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '');
  if (normalized.length === 0 || MOCK_GREETINGS.has(normalized)) return '';
  return truncateConversationText(text, 24);
}

function compareConversationSummaries(
  a: ConversationSummary,
  b: ConversationSummary
): number {
  const pinned = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  if (pinned !== 0) return pinned;
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Stable, dependency-free body identifier for the browser demo's conflict check. */
function noteRevision(body: string): string {
  let hash = 2166136261;
  for (let index = 0; index < body.length; index += 1) {
    hash ^= body.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${body.length}`;
}

function summarizeConversation(conversation: Conversation): ConversationSummary {
  const last = conversation.messages[conversation.messages.length - 1];
  return {
    id: conversation.id,
    title: conversation.title,
    kind: conversation.kind,
    ...(conversation.workspaceId ? { workspaceId: conversation.workspaceId } : {}),
    ...(conversation.pinned ? { pinned: true } : {}),
    updatedAt: conversation.updatedAt,
    preview: last ? truncateConversationText(last.text, 80) : ''
  };
}

export type MockApiOptions = {
  /** Multiplier for stream pacing. Tests use the fast default; the web demo passes 1. */
  streamPace?: number;
};

export function createMockApi(
  storage?: Storage,
  options: MockApiOptions = {}
): StudyCoachApi & StreamingButlerApi {
  const pace = Math.max(0.01, options.streamPace ?? 0.05);
  const cancelledStreams = new Set<string>();
  const resolved = resolveStorage(storage);
  let state = readState(resolved);
  let apiKey: string | null = null;

  const today = () => formatLocalDate(new Date());
  const persist = () => {
    if (!resolved) return;
    try {
      resolved.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Prototype data is best-effort; an unavailable storage keeps the in-memory state.
    }
  };

  function requireWorkspace(workspaceId: string) {
    const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) throw new Error('工作区不存在');
    return workspace;
  }

  function createNoteInternal(input: CreateNoteInput): WorkspaceNote {
    const workspace = requireWorkspace(input.workspaceId);
    const note: WorkspaceNote = {
      id: nextId('note'),
      workspaceId: workspace.id,
      title: input.title,
      subject: input.subject,
      tags: input.tags ?? [],
      updated: displayDate(),
      summary: input.summary ?? input.body.slice(0, 80),
      body: input.body,
      related: input.related ?? []
    };
    state.notes = [note, ...state.notes];
    return note;
  }

  function createWorkspaceInternal(input: CreateWorkspaceInput): Workspace {
    const workspace: Workspace = {
      id: nextId('workspace'),
      name: input.name,
      kind: input.kind,
      color: input.color ?? '#8e8e93',
      goal: input.goal,
      description: input.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.workspaces = [...state.workspaces, workspace];
    persist();
    return workspace;
  }

  function recordNoteIfNeeded(input: SendMessageInput): { title: string } | null {
    if (!/记一下|记录/.test(input.message)) return null;
    const workspace = input.workspaceId
      ? state.workspaces.find((entry) => entry.id === input.workspaceId)
      : state.workspaces[0];
    if (!workspace) return null;
    const title =
      input.message.replace(/^(记一下|记录)[：:\s]*/, '').slice(0, 28) || '随手记';
    createNoteInternal({
      workspaceId: workspace.id,
      title,
      subject: workspace.name,
      tags: ['随手记'],
      summary: input.message,
      body: input.message
    });
    persist();
    return { title };
  }

  function synthesize(input: SynthesizeMemoryInput): MemorySynthesisResult {
    const workspace = requireWorkspace(input.workspaceId);
    if (input.answers.skipped === true) return { items: [], generatedBy: 'rules' };
    const createdAt = new Date().toISOString();
    const source = `review:${input.date}`;
    const candidates: Array<{ text: string; kind: MemoryKind }> = [];
    if (input.answers.completed?.trim()) {
      candidates.push({ kind: 'strength', text: `${workspace.name} 完成：${input.answers.completed.trim()}` });
    }
    if (input.answers.stuck?.trim()) {
      candidates.push({ kind: 'weakness', text: `卡点：${input.answers.stuck.trim()}` });
    }
    if (input.answers.tomorrow?.trim()) {
      candidates.push({ kind: 'plan', text: `下一步：${input.answers.tomorrow.trim()}` });
    }
    const seen = new Set(state.memory.map((entry) => `${entry.source}\n${entry.text}`));
    const items = candidates
      .filter((candidate) => !seen.has(`${source}\n${candidate.text}`))
      .slice(0, 3)
      .map(
        (candidate): MemoryRecord => ({
          id: nextId('m'),
          workspaceId: workspace.id,
          text: candidate.text,
          kind: candidate.kind,
          source,
          createdAt
        })
      );
    state.memory = [...items, ...state.memory];
    return { items, generatedBy: 'rules' };
  }

  function profileFor(workspaceId?: string): LearnerProfile {
    const scoped = workspaceId
      ? state.memory.filter((entry) => entry.workspaceId === workspaceId)
      : state.memory;
    const textsOf = (kind: MemoryKind) =>
      scoped.filter((entry) => entry.kind === kind).map((entry) => entry.text);
    const sorted = [...scoped].sort((a, b) =>
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id)
    );
    const strengths = textsOf('strength');
    const weaknesses = textsOf('weakness');
    const preferences = textsOf('preference');
    const plans = textsOf('plan');
    const oldest = [...scoped].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? ''))[0];
    const newest = sorted[0];
    const summary =
      scoped.length === 0
        ? '还没有记忆，完成一次复盘后会开始积累。'
        : `共 ${scoped.length} 条记忆：薄弱点 ${weaknesses.length} 条，偏好 ${preferences.length} 条，计划 ${plans.length} 条。`;
    return {
      ...(workspaceId !== undefined ? { workspaceId } : {}),
      memoryCount: scoped.length,
      ...(oldest?.createdAt ? { firstAt: oldest.createdAt } : {}),
      ...(newest?.createdAt ? { lastAt: newest.createdAt } : {}),
      strengths,
      weaknesses,
      preferences,
      plans,
      recent: sorted.slice(0, 5).map((entry) => entry.text),
      summary,
      generatedAt: new Date().toISOString()
    };
  }

  function findPracticeQuestion(questionId: string) {
    for (const set of state.practiceSets) {
      const question = set.questions.find((entry) => entry.id === questionId);
      if (question !== undefined) return { set, question };
    }
    return null;
  }

  function searchDocs(workspaceId: string) {
    const docs: Array<{
      docId: string;
      kind: SearchResultKind;
      title: string;
      content: string;
      path: string;
    }> = [];
    for (const note of state.notes.filter((entry) => entry.workspaceId === workspaceId)) {
      docs.push({
        docId: note.id,
        kind: 'note',
        title: note.title,
        content: `${note.summary}\n${note.body}\n${note.tags.join(' ')}`,
        path: `workspaces/${workspaceId}/notes/${note.id}.md`
      });
    }
    for (const task of state.tasks.filter((entry) => entry.workspaceId === workspaceId)) {
      docs.push({
        docId: task.id,
        kind: 'task',
        title: task.title,
        content: `${task.subject}\n${task.acceptance}`,
        path: `workspaces/${workspaceId}/tasks/${task.id}.md`
      });
    }
    for (const memory of state.memory.filter((entry) => entry.workspaceId === workspaceId)) {
      docs.push({
        docId: memory.id,
        kind: 'memory',
        title: `记忆：${memory.text.slice(0, 24)}`,
        content: `${memory.text}\n${memory.source}`,
        path: `workspaces/${workspaceId}/memory.md`
      });
    }
    for (const review of state.reviews.filter((entry) => entry.workspaceId === workspaceId)) {
      docs.push({
        docId: `${review.date}-${review.submittedAt}`,
        kind: 'review',
        title: `${review.date} 复盘`,
        content: `${review.completed}\n${review.stuck}\n${review.tomorrow}`,
        path: `workspaces/${workspaceId}/reviews/${review.date}.md`
      });
    }
    for (const plan of state.plans.filter((entry) => entry.workspaceId === workspaceId)) {
      const parts = [plan.goal, plan.references ?? ''];
      for (const topic of plan.knowledge ?? []) parts.push(topic.name);
      for (const phase of plan.phases) {
        parts.push(phase.title, phase.subtitle, phase.goal);
        for (const week of phase.weeks) {
          parts.push(week.title, week.goal);
          for (const check of week.checks) parts.push(check.text);
          for (const day of week.days) parts.push(...day.tasks, day.output);
        }
      }
      docs.push({
        docId: plan.id,
        kind: 'plan',
        title: plan.goal,
        content: parts.join('\n'),
        path: `workspaces/${workspaceId}/plans/${plan.id}.md`
      });
    }
    for (const set of state.practiceSets.filter((entry) => entry.workspaceId === workspaceId)) {
      docs.push({
        docId: set.id,
        kind: 'practice-set',
        title: set.title,
        content: set.subject,
        path: `workspaces/${workspaceId}/practice/sets/${set.id}.md`
      });
      for (const question of set.questions) {
        docs.push({
          docId: question.id,
          kind: 'practice-question',
          title: question.prompt.slice(0, 24),
          content: `${question.prompt}\n${question.options.join(' ')}\n${question.explanation}`,
          path: `workspaces/${workspaceId}/practice/sets/${set.id}.md`
        });
      }
    }
    return docs;
  }

  /** Each knowledge topic and its note are one search result. */
  function knowledgeSearchDocs() {
    return state.knowledgeTopics.map((topic) => {
      const note = state.knowledgeNotes[topic.id];
      return {
        docId: topic.id,
        kind: 'knowledge-topic' as const,
        title: topic.name,
        content: [
          topic.name,
          topic.aliases.join(' '),
          topic.summary,
          ...topic.evidence.map((entry) => `${entry.title} ${entry.note ?? ''}`),
          note?.body ?? ''
        ].join('\n'),
        path: `knowledge/topics/${topic.id}.md`,
        workspaceId: topic.workspaceId ?? null
      };
    });
  }

  function searchResultFromDoc(
    doc: {
      docId: string;
      kind: SearchResultKind;
      title: string;
      content: string;
      path: string;
    },
    workspaceId: string | null,
    query: string,
    needle: string
  ): SearchResult {
    return {
      workspaceId,
      docId: doc.docId,
      kind: doc.kind,
      title: doc.title,
      snippet: snippetOf(`${doc.title} ${doc.content}`, query),
      score: doc.title.toLowerCase().includes(needle) ? 3 : 1,
      path: doc.path
    };
  }

  function snippetOf(text: string, query: string): string {
    const index = text.toLowerCase().indexOf(query.toLowerCase());
    if (index < 0) return text.slice(0, 120);
    const start = Math.max(0, index - 30);
    return text.slice(start, start + 120);
  }

  return {
    async getBootstrap(): Promise<Bootstrap> {
      return {
        needsOnboarding: !state.onboarded,
        today: today(),
        hasApiKey:
          state.settings.provider.kind === 'local-cli' ? true : apiKey !== null
      };
    },

    async completeWorkspaceOnboarding(input): Promise<void> {
      if (!input.useDemo) {
        const workspace: Workspace = {
          id: nextId('workspace'),
          name: input.name,
          kind: input.kind,
          color: '#0071e3',
          goal: input.goal,
          description: input.description,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.workspaces = [...state.workspaces, workspace];
      }
      state.onboarded = true;
      persist();
    },

    async getSettings(): Promise<AppSettings> {
      return structuredClone(state.settings);
    },

    async updateSettings(patch: SettingsPatch): Promise<AppSettings> {
      state.settings = {
        ...state.settings,
        ...patch,
        provider: patch.provider ?? state.settings.provider,
        notifications: { ...state.settings.notifications, ...patch.notifications },
        budget: { ...state.settings.budget, ...patch.budget }
      };
      persist();
      return structuredClone(state.settings);
    },

    async setApiKey(key: string): Promise<void> {
      apiKey = key.trim() ? key : null;
    },

    async scanLocalClis(): Promise<LocalCliScanResult> {
      return {
        scannedAt: new Date().toISOString(),
        entries: [
          {
            agent: 'codex',
            label: 'Codex',
            command: 'codex',
            installed: true,
            path: '/usr/local/bin/codex',
            version: '0.166.0',
            auth: 'ready',
            authDetail: '原型演示：已登录',
            features: ['streaming', 'reasoning', 'native-tools', 'web', 'sessions', 'sandbox']
          },
          {
            agent: 'claude',
            label: 'Claude Code',
            command: 'claude',
            installed: true,
            path: '/usr/local/bin/claude',
            version: '2.1.0',
            auth: 'ready',
            authDetail: '原型演示：已登录',
            features: ['streaming', 'reasoning', 'native-tools', 'web', 'sessions', 'mcp', 'skills']
          },
          {
            agent: 'zcode',
            label: 'ZCode',
            command: 'zcode',
            installed: false,
            auth: 'unknown',
            features: [],
            installHint: '安装 zcode 后运行 zcode login'
          },
          {
            agent: 'opencode',
            label: 'OpenCode',
            command: 'opencode',
            installed: true,
            path: '/opt/homebrew/bin/opencode',
            version: '2.0.32',
            auth: 'ready',
            authDetail: '原型演示：已登录',
            features: ['streaming', 'native-tools', 'sessions', 'mcp', 'models'],
            models: ['anthropic/claude-sonnet-5-5', 'openai/gpt-5.6']
          }
        ]
      };
    },

    async submitReview(input: SubmitReviewInput): Promise<void> {
      state.reviews = [
        {
          date: input.date,
          submittedAt: new Date().toISOString(),
          ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
          completed: input.answers.completed ?? '',
          stuck: input.answers.stuck ?? '',
          tomorrow: input.answers.tomorrow ?? '',
          skipped: input.answers.skipped === true
        },
        ...state.reviews
      ];
      if (input.workspaceId !== undefined && input.answers.skipped !== true) {
        synthesize({ workspaceId: input.workspaceId, date: input.date, answers: input.answers });
      }
      persist();
    },

    async listReviews(input: ListReviewsInput = {}): Promise<ReviewRecord[]> {
      const scoped =
        input.workspaceId === undefined
          ? state.reviews
          : state.reviews.filter(
              (entry) =>
                entry.workspaceId === undefined || entry.workspaceId === input.workspaceId
            );
      const limit = input.limit ?? 30;
      return structuredClone(
        [...scoped]
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt) || b.date.localeCompare(a.date))
          .slice(0, limit)
      );
    },

    async planWorkspace(input: PlanWorkspaceInput): Promise<WorkspacePlan> {
      const workspace = requireWorkspace(input.workspaceId);
      const available = input.availableMinutes ?? 120;
      const perTask = Math.max(15, Math.round(available / 3));
      return {
        workspaceId: workspace.id,
        date: input.date ?? today(),
        generatedBy: 'template',
        tasks: [
          {
            title: `推进「${workspace.goal || workspace.name}」`,
            subject: workspace.name,
            durationMin: perTask,
            acceptance: '完成一段可验收的推进，并记下结果'
          },
          {
            title: '整理今天的记录与错题',
            subject: '复盘',
            durationMin: Math.max(15, available - perTask),
            acceptance: '留下至少一条记录或一个错题'
          }
        ]
      };
    },

    async listLongPlans(workspaceId?: string): Promise<LongPlan[]> {
      const plans =
        workspaceId === undefined
          ? state.plans
          : state.plans.filter((plan) => plan.workspaceId === workspaceId);
      return structuredClone(
        [...plans].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.goal.localeCompare(b.goal)
        )
      );
    },

    async getLongPlan(planId: string): Promise<LongPlan | null> {
      const plan = state.plans.find((entry) => entry.id === planId);
      return plan === undefined ? null : structuredClone(plan);
    },

    async createLongPlan(input: CreateLongPlanInput): Promise<LongPlan> {
      const workspace = requireWorkspace(input.workspaceId);
      const goal = input.goal.trim();
      if (!goal) throw new Error('计划目标不能为空。');
      if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > 16) {
        throw new Error('周数必须在 1 到 16 之间。');
      }
      const weeklyHours = input.weeklyHours ?? 10;
      const generated = buildTemplatePlan({
        workspace,
        goal,
        startDate: input.startDate ?? today(),
        weeks: input.weeks,
        weeklyHours
      });
      const timestamp = new Date().toISOString();
      const references = input.references?.trim();
      const plan: LongPlan = {
        id: nextId('lp'),
        workspaceId: workspace.id,
        goal,
        startDate: input.startDate ?? today(),
        weeks: input.weeks,
        weeklyHours,
        generatedBy: generated.generatedBy,
        ...(references ? { references } : {}),
        // The prototype never calls a model, so it can't verify web sources.
        sources: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        phases: generated.phases
      };
      state.plans = [plan, ...state.plans];
      persist();
      return structuredClone(plan);
    },

    async updateLongPlan(input: UpdateLongPlanInput): Promise<LongPlan> {
      const plan = state.plans.find((entry) => entry.id === input.planId);
      if (!plan) throw new Error('计划不存在。');
      if (input.goal !== undefined) {
        const goal = input.goal.trim();
        if (!goal) throw new Error('计划目标不能为空。');
        plan.goal = goal;
      }
      if (input.weeklyHours !== undefined) {
        if (
          !Number.isFinite(input.weeklyHours) ||
          input.weeklyHours < 1 ||
          input.weeklyHours > 80
        ) {
          throw new Error('每周投入必须在 1 到 80 小时之间。');
        }
        plan.weeklyHours = input.weeklyHours;
      }
      plan.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(plan);
    },

    async recalibrateLongPlan(
      input: RecalibrateLongPlanInput
    ): Promise<LongPlan> {
      const plan = state.plans.find((entry) => entry.id === input.planId);
      if (!plan) throw new Error('计划不存在。');
      const weeklyHours = input.weeklyHours ?? plan.weeklyHours;
      if (!Number.isFinite(weeklyHours) || weeklyHours < 1 || weeklyHours > 80) {
        throw new Error('每周投入必须在 1 到 80 小时之间。');
      }
      const weeks = plan.phases.flatMap((phase) => phase.weeks);
      const todayValue = today();
      const currentIndex = weeks.findIndex((week) => week.endDate >= todayValue);
      if (currentIndex === -1) throw new Error('计划已经结束，没有可重排的周次。');
      let fromIndex = currentIndex;
      while (
        fromIndex < weeks.length &&
        (weeks[fromIndex]!.days.some((day) => day.done) ||
          weeks[fromIndex]!.checks.some((check) => check.done))
      ) {
        fromIndex += 1;
      }
      if (fromIndex >= weeks.length) {
        throw new Error('剩余周次都已有进度，暂时没有可重排的内容。');
      }
      const fromWeek = weeks[fromIndex]!;
      const remaining = weeks.length - fromIndex;
      const workspace = requireWorkspace(plan.workspaceId);
      const generated = buildTemplatePlan({
        workspace,
        goal: plan.goal,
        startDate: fromWeek.startDate,
        weeks: remaining,
        weeklyHours
      });
      const preservedPhases = plan.phases
        .map((phase) => ({
          ...phase,
          weeks: phase.weeks.filter((week) => week.number < fromWeek.number)
        }))
        .filter((phase) => phase.weeks.length > 0);
      let weekOffset = 0;
      const regeneratedPhases = generated.phases.map((phase) => ({
        ...phase,
        id: nextId('ph'),
        weeks: phase.weeks.map((week) => {
          const number = fromWeek.number + weekOffset;
          weekOffset += 1;
          const weekId = `w${number}`;
          return {
            ...week,
            id: weekId,
            number,
            title: week.title.replace(/^第\s*\d+\s*周/, `第 ${number} 周`),
            days: week.days.map((day, index) => ({
              ...day,
              id: `${weekId}d${index + 1}`
            })),
            checks: week.checks.map((check, index) => ({
              ...check,
              id: `${weekId}c${index + 1}`
            }))
          };
        })
      }));
      const timestamp = new Date().toISOString();
      plan.weeklyHours = weeklyHours;
      plan.generatedBy = 'template';
      plan.recalibratedAt = timestamp;
      plan.recalibratedFrom = fromWeek.number;
      plan.updatedAt = timestamp;
      plan.phases = [...preservedPhases, ...regeneratedPhases];
      persist();
      return structuredClone(plan);
    },

    async setLongPlanItemDone(input: UpdateLongPlanItemInput): Promise<LongPlan> {
      const plan = state.plans.find((entry) => entry.id === input.planId);
      if (!plan) throw new Error('计划不存在。');
      const week = plan.phases
        .flatMap((phase) => phase.weeks)
        .find((entry) => entry.id === input.weekId);
      if (!week) throw new Error('周不存在。');
      const item =
        input.kind === 'day'
          ? week.days.find((entry) => entry.id === input.itemId)
          : week.checks.find((entry) => entry.id === input.itemId);
      if (!item) throw new Error('计划条目不存在。');
      item.done = input.done;
      plan.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(plan);
    },

    async deleteLongPlan(planId: string): Promise<void> {
      state.plans = state.plans.filter((plan) => plan.id !== planId);
      persist();
    },

    async listPracticeSets(workspaceId: string): Promise<PracticeSet[]> {
      requireWorkspace(workspaceId);
      return structuredClone(
        state.practiceSets.filter((set) => set.workspaceId === workspaceId)
      );
    },

    async getPracticeSet(id: string): Promise<PracticeSet | null> {
      const set = state.practiceSets.find((entry) => entry.id === id);
      return set === undefined ? null : structuredClone(set);
    },

    async createPracticeSet(input: CreatePracticeSetInput): Promise<PracticeSet> {
      const workspace = requireWorkspace(input.workspaceId);
      if (input.questions.length === 0) throw new Error('练习至少需要一道题');
      const timestamp = new Date().toISOString();
      const set: PracticeSet = {
        id: nextId('ps'),
        workspaceId: workspace.id,
        title: input.title,
        subject: input.subject ?? '',
        questions: input.questions.map((question) => ({
          id: question.id ?? nextId('q'),
          prompt: question.prompt,
          options: [...question.options],
          answer: question.answer,
          explanation: question.explanation ?? ''
        })),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.practiceSets = [...state.practiceSets, set];
      persist();
      return structuredClone(set);
    },

    async updatePracticeSet(input: UpdatePracticeSetInput): Promise<PracticeSet> {
      const set = state.practiceSets.find((entry) => entry.id === input.setId);
      if (!set) throw new Error('练习集不存在');
      if (input.title === undefined && input.subject === undefined) {
        throw new Error('没有要修改的内容');
      }
      if (input.title !== undefined) set.title = input.title;
      if (input.subject !== undefined) set.subject = input.subject;
      set.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(set);
    },

    async deletePracticeSet(input: DeletePracticeSetInput): Promise<void> {
      if (!state.practiceSets.some((entry) => entry.id === input.setId)) {
        throw new Error('练习集不存在');
      }
      state.practiceSets = state.practiceSets.filter((entry) => entry.id !== input.setId);
      persist();
    },

    async submitPracticeAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult> {
      const found = findPracticeQuestion(input.questionId);
      if (found === null) throw new Error('题目不存在');
      const { set, question } = found;
      if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice >= question.options.length) {
        throw new Error('选项无效');
      }
      const answeredAtDate = new Date();
      const answeredAt = answeredAtDate.toISOString();
      const date = formatLocalDate(answeredAtDate);
      const correct = input.choice === question.answer;
      const attempt: PracticeAttempt = {
        id: nextId('pa'),
        workspaceId: set.workspaceId,
        setId: set.id,
        questionId: question.id,
        choice: input.choice,
        correct,
        answeredAt
      };
      state.practiceAttempts = [...state.practiceAttempts, attempt];

      const mistakes = [...state.practiceMistakes];
      const index = mistakes.findIndex((entry) => entry.questionId === question.id);
      const existing = index >= 0 ? mistakes[index] : undefined;
      let mistake: PracticeMistake | null = existing ?? null;
      if (!correct) {
        const wrongCount = (existing?.wrongCount ?? 0) + 1;
        const intervalDays =
          PRACTICE_INTERVALS[Math.min(wrongCount - 1, PRACTICE_INTERVALS.length - 1)];
        const updated: PracticeMistake = {
          id: existing?.id ?? nextId('pm'),
          workspaceId: set.workspaceId,
          setId: set.id,
          questionId: question.id,
          prompt: question.prompt,
          options: [...question.options],
          answer: question.answer,
          explanation: question.explanation,
          wrongCount,
          correctStreak: 0,
          priority: Math.min(3, (existing?.priority ?? 0) + 1),
          intervalDays,
          due: addDays(date, intervalDays),
          status: 'active',
          createdAt: existing?.createdAt ?? answeredAt,
          updatedAt: answeredAt,
          lastAnsweredAt: answeredAt
        };
        if (index >= 0) mistakes[index] = updated;
        else mistakes.push(updated);
        mistake = updated;
      } else if (existing !== undefined) {
        const correctStreak = existing.correctStreak + 1;
        const updated: PracticeMistake = {
          ...existing,
          correctStreak,
          priority: Math.max(0, existing.priority - 1),
          status: correctStreak >= 2 ? 'resolved' : 'active',
          updatedAt: answeredAt,
          lastAnsweredAt: answeredAt
        };
        mistakes[index] = updated;
        mistake = updated;
      }
      state.practiceMistakes = mistakes;
      persist();

      return {
        questionId: question.id,
        setId: set.id,
        workspaceId: set.workspaceId,
        choice: input.choice,
        correct,
        answer: question.answer,
        explanation: question.explanation,
        attempt,
        mistake,
        ...(mistake?.status === 'active' ? { due: mistake.due } : {})
      };
    },

    async getPracticeMistakes(workspaceId: string): Promise<PracticeMistake[]> {
      requireWorkspace(workspaceId);
      return structuredClone(
        state.practiceMistakes
          .filter((entry) => entry.workspaceId === workspaceId && entry.status === 'active')
          .sort(
            (a, b) =>
              b.priority - a.priority || a.due.localeCompare(b.due) || a.questionId.localeCompare(b.questionId)
          )
      );
    },

    async getPracticeDue(input: {
      workspaceId: string;
      date: string;
    }): Promise<PracticeMistake[]> {
      requireWorkspace(input.workspaceId);
      return structuredClone(
        state.practiceMistakes
          .filter(
            (entry) =>
              entry.workspaceId === input.workspaceId &&
              entry.status === 'active' &&
              entry.due <= input.date
          )
          .sort(
            (a, b) =>
              a.due.localeCompare(b.due) || b.priority - a.priority || a.questionId.localeCompare(b.questionId)
          )
      );
    },

    async listPracticeAttempts(workspaceId: string): Promise<PracticeAttempt[]> {
      requireWorkspace(workspaceId);
      return structuredClone(
        state.practiceAttempts
          .filter((entry) => entry.workspaceId === workspaceId)
          .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt) || a.id.localeCompare(b.id))
      );
    },

    async listMemory(workspaceId?: string): Promise<MemoryRecord[]> {
      const scoped = workspaceId
        ? state.memory.filter((entry) => entry.workspaceId === workspaceId)
        : state.memory;
      return structuredClone(
        [...scoped].sort(
          (a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id)
        )
      );
    },

    async synthesizeMemory(input: SynthesizeMemoryInput): Promise<MemorySynthesisResult> {
      const result = synthesize(input);
      persist();
      return structuredClone(result);
    },

    async getMemoryProfile(workspaceId?: string): Promise<LearnerProfile> {
      return structuredClone(profileFor(workspaceId));
    },

    async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
      const workspace = state.workspaces.find((entry) => entry.id === input.workspaceId);
      if (!workspace) throw new Error('工作区不存在');
      const text = input.text.trim();
      if (!text) throw new Error('记忆内容不能为空。');
      if (!MOCK_MEMORY_KINDS.has(input.kind)) throw new Error('记忆类型无效。');
      const record: MemoryRecord = {
        id: nextId('mem'),
        workspaceId: input.workspaceId,
        text,
        kind: input.kind,
        source: 'manual',
        createdAt: new Date().toISOString()
      };
      state.memory = [record, ...state.memory];
      persist();
      return structuredClone(record);
    },

    async updateMemory(input: UpdateMemoryInput): Promise<MemoryRecord> {
      const record = state.memory.find(
        (entry) => entry.workspaceId === input.workspaceId && entry.id === input.id
      );
      if (!record) throw new Error('记忆不存在');
      if (input.text !== undefined) {
        const text = input.text.trim();
        if (!text) throw new Error('记忆内容不能为空。');
        record.text = text;
      }
      if (input.kind !== undefined) {
        if (!MOCK_MEMORY_KINDS.has(input.kind)) throw new Error('记忆类型无效。');
        record.kind = input.kind;
      }
      persist();
      return structuredClone(record);
    },

    async deleteMemory(input: DeleteMemoryInput): Promise<void> {
      const before = state.memory.length;
      state.memory = state.memory.filter(
        (entry) => !(entry.workspaceId === input.workspaceId && entry.id === input.id)
      );
      if (state.memory.length === before) throw new Error('记忆不存在');
      persist();
    },

    async listKnowledgeTopics(workspaceId?: string): Promise<KnowledgeTopic[]> {
      const topics =
        workspaceId === undefined
          ? state.knowledgeTopics
          : state.knowledgeTopics.filter(
              (topic) => topic.workspaceId === undefined || topic.workspaceId === workspaceId
            );
      return structuredClone(
        [...topics].sort(
          (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'zh')
        )
      );
    },

    async createKnowledgeTopic(input: CreateKnowledgeTopicInput): Promise<KnowledgeTopic> {
      const name = input.name.trim();
      if (!name) throw new Error('知识主题名称不能为空。');
      if (name.length > 60) throw new Error('知识主题名称不能超过 60 字。');
      if (
        input.level !== undefined &&
        (!Number.isInteger(input.level) || input.level < 1 || input.level > 5)
      ) {
        throw new Error('掌握程度必须在 1 到 5 之间。');
      }
      const timestamp = new Date().toISOString();
      const topic: KnowledgeTopic = {
        id: nextId('kt'),
        name,
        aliases: input.aliases ?? [],
        status: input.status ?? 'learning',
        ...(input.level !== undefined ? { level: input.level } : {}),
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        summary: input.summary?.trim() ?? '',
        evidence: [],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      state.knowledgeTopics = [topic, ...state.knowledgeTopics];
      persist();
      return structuredClone(topic);
    },

    async updateKnowledgeTopic(input: UpdateKnowledgeTopicInput): Promise<KnowledgeTopic> {
      const topic = state.knowledgeTopics.find((entry) => entry.id === input.id);
      if (!topic) throw new Error('知识主题不存在。');
      if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name) throw new Error('知识主题名称不能为空。');
        if (name.length > 60) throw new Error('知识主题名称不能超过 60 字。');
        topic.name = name;
      }
      if (input.aliases !== undefined) topic.aliases = [...input.aliases];
      if (input.status !== undefined) topic.status = input.status;
      if (input.level === null) delete topic.level;
      else if (input.level !== undefined) topic.level = input.level;
      if (input.workspaceId === null) delete topic.workspaceId;
      else if (input.workspaceId !== undefined) topic.workspaceId = input.workspaceId;
      if (input.summary !== undefined) topic.summary = input.summary.trim();
      topic.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(topic);
    },

    async deleteKnowledgeTopic(id: string): Promise<void> {
      const before = state.knowledgeTopics.length;
      state.knowledgeTopics = state.knowledgeTopics.filter((topic) => topic.id !== id);
      if (state.knowledgeTopics.length === before) throw new Error('知识主题不存在。');
      delete state.knowledgeNotes[id];
      persist();
    },

    async mergeKnowledgeTopics(input: MergeKnowledgeTopicsInput): Promise<KnowledgeTopic> {
      if (input.sourceId === input.targetId) throw new Error('不能把主题合并到自身。');
      const source = state.knowledgeTopics.find((topic) => topic.id === input.sourceId);
      const target = state.knowledgeTopics.find((topic) => topic.id === input.targetId);
      if (!source) throw new Error('要合并的知识主题不存在。');
      if (!target) throw new Error('目标知识主题不存在。');
      const aliases = [...target.aliases];
      for (const alias of [source.name, ...source.aliases]) {
        if (
          alias === target.name ||
          aliases.some((entry) => entry.toLowerCase() === alias.toLowerCase())
        ) {
          continue;
        }
        aliases.push(alias);
      }
      target.aliases = aliases.slice(0, 8);
      for (const entry of source.evidence) {
        const duplicate = entry.refId
          ? target.evidence.some(
              (existing) =>
                existing.kind === entry.kind && existing.refId === entry.refId
            )
          : target.evidence.some((existing) => existing.id === entry.id);
        if (!duplicate) target.evidence.push(entry);
      }
      if (!target.summary) target.summary = source.summary;
      const sourceNote = state.knowledgeNotes[source.id];
      if (sourceNote?.body.trim()) {
        const targetNote = state.knowledgeNotes[target.id];
        const body = targetNote?.body.trim()
          ? `${targetNote.body.trimEnd()}\n\n## 合并自「${source.name}」\n\n${sourceNote.body.trim()}`
          : sourceNote.body;
        state.knowledgeNotes[target.id] = {
          topicId: target.id,
          body,
          updatedAt: new Date().toISOString()
        };
      }
      state.knowledgeTopics = state.knowledgeTopics.filter(
        (topic) => topic.id !== source.id
      );
      delete state.knowledgeNotes[source.id];
      target.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(target);
    },

    async getKnowledgeNote(topicId: string): Promise<KnowledgeNote> {
      const note = state.knowledgeNotes[topicId];
      if (!note) return { topicId, body: '', updatedAt: '', revision: '' };
      return structuredClone({ ...note, revision: noteRevision(note.body) });
    },

    async saveKnowledgeNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote> {
      if (!state.knowledgeTopics.some((topic) => topic.id === input.topicId)) {
        throw new Error('知识主题不存在。');
      }
      if (typeof input.body !== 'string') throw new Error('笔记内容无效。');
      if (input.body.length > MAX_KNOWLEDGE_NOTE_LENGTH) {
        throw new Error(`笔记不能超过 ${MAX_KNOWLEDGE_NOTE_LENGTH} 字。`);
      }
      const existing = state.knowledgeNotes[input.topicId];
      const currentRevision = existing ? noteRevision(existing.body) : '';
      if (
        input.expectedRevision !== undefined &&
        !input.force &&
        input.expectedRevision !== currentRevision
      ) {
        throw new Error(KNOWLEDGE_NOTE_CONFLICT_MESSAGE);
      }
      const note: KnowledgeNote = {
        topicId: input.topicId,
        body: input.body,
        updatedAt: new Date().toISOString(),
        revision: noteRevision(input.body)
      };
      state.knowledgeNotes[input.topicId] = note;
      persist();
      return structuredClone(note);
    },

    async getKnowledgeBacklinks(topicId: string): Promise<KnowledgeBacklink[]> {
      if (!state.knowledgeTopics.some((topic) => topic.id === topicId)) return [];
      const backlinks: KnowledgeBacklink[] = [];
      for (const source of state.knowledgeTopics) {
        if (source.id === topicId) continue;
        const note = state.knowledgeNotes[source.id];
        if (!note) continue;
        if (
          wikiLinkTargets(note.body).some(
            (target) => resolveKnowledgeLink(state.knowledgeTopics, target)?.id === topicId
          )
        ) {
          backlinks.push({ topicId: source.id, name: source.name });
        }
      }
      return backlinks.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    },

    async searchWorkspace(input: SearchWorkspaceInput): Promise<SearchResult[]> {
      const query = input.query.trim();
      if (query.length === 0) return [];
      const limit = input.limit ?? 20;
      const needle = query.toLowerCase();
      return searchDocs(input.workspaceId)
        .filter((doc) => `${doc.title}\n${doc.content}`.toLowerCase().includes(needle))
        .slice(0, limit)
        .map(
          (doc): SearchResult => ({
            workspaceId: input.workspaceId,
            docId: doc.docId,
            kind: doc.kind,
            title: doc.title,
            snippet: snippetOf(`${doc.title} ${doc.content}`, query),
            score: doc.title.toLowerCase().includes(needle) ? 3 : 1,
            path: doc.path
          })
        );
    },

    async searchAll(input: SearchAllInput): Promise<SearchResult[]> {
      const query = input.query.trim();
      if (query.length === 0) return [];
      const limit = input.limit ?? 20;
      const needle = query.toLowerCase();
      const docs = [
        ...state.workspaces.flatMap((workspace) =>
          searchDocs(workspace.id).map((doc) => ({
            doc,
            workspaceId: workspace.id as string | null
          }))
        ),
        ...knowledgeSearchDocs().map((doc) => ({
          doc,
          workspaceId: doc.workspaceId
        }))
      ];
      return docs
        .filter(({ doc }) => `${doc.title}\n${doc.content}`.toLowerCase().includes(needle))
        .map(({ doc, workspaceId }) =>
          searchResultFromDoc(doc, workspaceId, query, needle)
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    },

    async rebuildSearchIndex(): Promise<void> {
      // The browser prototype searches live state; nothing to rebuild.
    },

    async listWorkspaces(): Promise<Workspace[]> {
      return structuredClone(state.workspaces);
    },

    async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
      return structuredClone(createWorkspaceInternal(input));
    },

    async updateWorkspace(input: UpdateWorkspaceInput): Promise<Workspace> {
      const workspace = state.workspaces.find((entry) => entry.id === input.workspaceId);
      if (!workspace) throw new Error('项目不存在');
      if (input.name !== undefined) workspace.name = input.name;
      if (input.goal !== undefined) workspace.goal = input.goal;
      if (input.description !== undefined) workspace.description = input.description;
      if (input.checkIn !== undefined) workspace.checkIn = input.checkIn;
      workspace.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(workspace);
    },

    async deleteWorkspace(workspaceId: string): Promise<void> {
      const index = state.workspaces.findIndex((entry) => entry.id === workspaceId);
      if (index < 0) throw new Error('项目不存在');
      state.workspaces.splice(index, 1);
      state.tasks = state.tasks.filter((entry) => entry.workspaceId !== workspaceId);
      state.notes = state.notes.filter((entry) => entry.workspaceId !== workspaceId);
      state.memory = state.memory.filter((entry) => entry.workspaceId !== workspaceId);
      state.practiceSets = state.practiceSets.filter(
        (entry) => entry.workspaceId !== workspaceId
      );
      state.practiceAttempts = state.practiceAttempts.filter(
        (entry) => entry.workspaceId !== workspaceId
      );
      state.practiceMistakes = state.practiceMistakes.filter(
        (entry) => entry.workspaceId !== workspaceId
      );
      state.plans = state.plans.filter((entry) => entry.workspaceId !== workspaceId);
      state.knowledgeTopics = state.knowledgeTopics.filter(
        (entry) => entry.workspaceId !== workspaceId
      );
      persist();
    },

    async getWorkspaceSnapshot(workspaceId: string): Promise<WorkspaceSnapshot> {
      const workspace = requireWorkspace(workspaceId);
      return structuredClone({
        workspace,
        tasks: state.tasks.filter((task) => task.workspaceId === workspaceId),
        notes: state.notes.filter((note) => note.workspaceId === workspaceId),
        memory: state.memory.filter((item) => item.workspaceId === workspaceId),
        reminders: state.reminders
      });
    },

    async createTask(input: CreateTaskInput): Promise<WorkspaceTask> {
      requireWorkspace(input.workspaceId);
      const task: WorkspaceTask = {
        id: nextId('task'),
        workspaceId: input.workspaceId,
        title: input.title,
        subject: input.subject,
        durationMin: input.durationMin,
        acceptance: input.acceptance,
        status: 'pending',
        due: input.due,
        ...(input.startAt ? { startAt: input.startAt } : {}),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.tasks = [task, ...state.tasks];
      persist();
      return structuredClone(task);
    },

    async updateWorkspaceTask(input: UpdateWorkspaceTaskInput): Promise<WorkspaceTask> {
      const task = state.tasks.find((entry) => entry.id === input.taskId);
      if (!task) throw new Error('任务不存在');
      if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) throw new Error('任务标题不能为空');
        task.title = title;
      }
      if (input.subject !== undefined) task.subject = input.subject;
      if (input.acceptance !== undefined) task.acceptance = input.acceptance;
      if (input.durationMin !== undefined) {
        if (!Number.isFinite(input.durationMin) || input.durationMin < 0) {
          throw new Error('任务时长无效');
        }
        task.durationMin = Math.round(input.durationMin);
      }
      if (input.due === null) delete task.due;
      else if (input.due !== undefined) task.due = input.due;
      if (input.status !== undefined) task.status = input.status;
      if (input.startAt === null) delete task.startAt;
      else if (input.startAt !== undefined) task.startAt = input.startAt;
      if (input.actualMin !== undefined) task.actualMin = input.actualMin;
      task.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(task);
    },

    async deleteTask(input: DeleteTaskInput): Promise<void> {
      const index = state.tasks.findIndex((entry) => entry.id === input.taskId);
      if (index < 0) throw new Error('任务不存在');
      state.tasks.splice(index, 1);
      persist();
    },

    async createNote(input: CreateNoteInput): Promise<WorkspaceNote> {
      const note = createNoteInternal(input);
      persist();
      return structuredClone(note);
    },

    async updateNote(input: UpdateWorkspaceNoteInput): Promise<WorkspaceNote> {
      const note = state.notes.find((entry) => entry.id === input.noteId);
      if (!note) throw new Error('记录不存在');
      if (input.title !== undefined) note.title = input.title;
      if (input.tags !== undefined) note.tags = input.tags;
      if (input.summary !== undefined) note.summary = input.summary;
      if (input.body !== undefined) note.body = input.body;
      if (input.related !== undefined) note.related = input.related;
      note.updated = displayDate();
      persist();
      return structuredClone(note);
    },

    async deleteNote(input: DeleteNoteInput): Promise<void> {
      const index = state.notes.findIndex((entry) => entry.id === input.noteId);
      if (index < 0) throw new Error('记录不存在');
      state.notes.splice(index, 1);
      persist();
    },

    async getMemory(workspaceId?: string): Promise<MemoryItem[]> {
      const items = workspaceId
        ? state.memory.filter((item) => item.workspaceId === workspaceId)
        : state.memory;
      return structuredClone(items);
    },

    async getReminders(): Promise<Reminder[]> {
      return structuredClone(state.reminders);
    },

    async createReminder(input: CreateReminderInput): Promise<Reminder> {
      const time = normalizeMockReminderTime(input.time);
      const label = input.label.trim();
      if (!label) throw new Error('提醒内容不能为空。');
      const days = normalizeMockDays(input.days);
      const reminder: Reminder = {
        id: nextId('rem'),
        time,
        label,
        enabled: input.enabled ?? true,
        ...(days ? { days } : {})
      };
      state.reminders.push(reminder);
      persist();
      return structuredClone(reminder);
    },

    async updateReminder(input: UpdateReminderInput): Promise<Reminder> {
      const reminder = state.reminders.find((entry) => entry.id === input.id);
      if (!reminder) throw new Error('提醒不存在');
      if (input.time !== undefined) reminder.time = normalizeMockReminderTime(input.time);
      if (input.label !== undefined) {
        const label = input.label.trim();
        if (!label) throw new Error('提醒内容不能为空。');
        reminder.label = label;
      }
      if (input.enabled !== undefined) reminder.enabled = input.enabled;
      if (input.days !== undefined) {
        const days = normalizeMockDays(input.days);
        if (days) reminder.days = days;
        else delete reminder.days;
      }
      persist();
      return structuredClone(reminder);
    },

    async deleteReminder(input: DeleteReminderInput): Promise<void> {
      const index = state.reminders.findIndex((entry) => entry.id === input.id);
      if (index < 0) throw new Error('提醒不存在');
      state.reminders.splice(index, 1);
      persist();
    },

    async listConversations(): Promise<ConversationSummary[]> {
      return state.conversations
        .filter((conversation) => conversation.messages.length > 0)
        .map(summarizeConversation)
        .sort(compareConversationSummaries);
    },

    async searchConversations(query: string): Promise<ConversationSummary[]> {
      const needle = query.trim().toLowerCase();
      return state.conversations
        .filter((conversation) => conversation.messages.length > 0)
        .filter(
          (conversation) =>
            needle.length === 0 ||
            conversation.title.toLowerCase().includes(needle) ||
            conversation.messages.some((message) =>
              message.text.toLowerCase().includes(needle)
            )
        )
        .map(summarizeConversation)
        .sort(compareConversationSummaries);
    },

    async getConversation(id: string): Promise<Conversation | null> {
      const conversation = state.conversations.find((entry) => entry.id === id);
      return conversation ? structuredClone(conversation) : null;
    },

    async createConversation(input: CreateConversationInput = {}): Promise<Conversation> {
      const timestamp = new Date().toISOString();
      const conversation: Conversation = {
        id: nextId('conv'),
        title: input.title?.trim() ? truncateConversationText(input.title, 24) : '新对话',
        kind: input.kind ?? 'chat',
        ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        messages: []
      };
      state.conversations.push(conversation);
      persist();
      return structuredClone(conversation);
    },

    async appendConversationMessage(
      id: string,
      message: ConversationMessage
    ): Promise<Conversation> {
      const conversation = state.conversations.find((entry) => entry.id === id);
      if (!conversation) throw new Error('对话不存在');
      conversation.messages.push(structuredClone(message));
      conversation.updatedAt = new Date().toISOString();
      if (conversation.title === '新对话' && message.role === 'user') {
        const title = conversationTitleFromText(message.text);
        if (title) conversation.title = title;
      }
      persist();
      return structuredClone(conversation);
    },

    async deleteConversation(id: string): Promise<void> {
      state.conversations = state.conversations.filter((entry) => entry.id !== id);
      persist();
    },

    async setConversationModel(id: string, model: string | null): Promise<Conversation> {
      const conversation = state.conversations.find((entry) => entry.id === id);
      if (!conversation) throw new Error('对话不存在');
      const trimmed = model?.trim() ?? '';
      if (trimmed) {
        conversation.model = Array.from(trimmed).slice(0, 120).join('');
      } else {
        delete conversation.model;
      }
      persist();
      return structuredClone(conversation);
    },

    async renameConversation(id: string, title: string): Promise<Conversation> {
      const conversation = state.conversations.find((entry) => entry.id === id);
      if (!conversation) throw new Error('对话不存在');
      const trimmed = title.trim();
      if (!trimmed) throw new Error('对话标题不能为空。');
      conversation.title = truncateConversationText(trimmed, 24);
      conversation.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(conversation);
    },

    async setConversationPinned(id: string, pinned: boolean): Promise<Conversation> {
      const conversation = state.conversations.find((entry) => entry.id === id);
      if (!conversation) throw new Error('对话不存在');
      if (pinned) conversation.pinned = true;
      else delete conversation.pinned;
      persist();
      return structuredClone(conversation);
    },

    async truncateConversationMessages(id: string, keepCount: number): Promise<Conversation> {
      if (!Number.isInteger(keepCount) || keepCount < 0) {
        throw new Error('保留消息数无效。');
      }
      const conversation = state.conversations.find((entry) => entry.id === id);
      if (!conversation) throw new Error('对话不存在');
      if (keepCount < conversation.messages.length) {
        conversation.messages = conversation.messages.slice(0, keepCount);
        conversation.updatedAt = new Date().toISOString();
      }
      persist();
      return structuredClone(conversation);
    },

    async cancelStream(messageId: string): Promise<void> {
      cancelledStreams.add(messageId);
    },

    onConversationOpened() {
      return () => undefined;
    },

    onQuickCapture() {
      return () => undefined;
    },

    async getUsageSummary(): Promise<UsageSummary> {
      return {
        days: [],
        totals: { inputTokens: 0, outputTokens: 0, calls: 0 },
        estimatedCost: null
      };
    },

    async clearUsage(): Promise<void> {
      // The browser prototype keeps no usage history.
    },

    async exportBackup() {
      // The browser prototype has no native directory picker.
      return null;
    },

    async restoreBackup() {
      // Restoring needs the native file picker and an app restart.
      return null;
    },

    async restartApp() {
      window.location.reload();
    },

    async send(input: SendMessageInput): Promise<SendMessageResult> {
      recordNoteIfNeeded(input);
      return {
        text: butlerReply(input.message)
      };
    },

    async stream(input, onEvent): Promise<SendMessageResult> {
      const steps: ConversationStep[] = [];
      const streamId = input.assistantMessageId ?? '';
      const isCancelled = () => streamId !== '' && cancelledStreams.has(streamId);
      const finishCanceled = (partial: string): SendMessageResult => {
        const text = partial.trim() || '（已停止生成）';
        if (streamId) cancelledStreams.delete(streamId);
        if (conversation) {
          conversation.messages.push({
            id: input.assistantMessageId ?? nextId('assistant'),
            role: 'assistant',
            text,
            createdAt: new Date().toISOString(),
            ...(steps.length > 0 ? { steps: steps.map((step) => ({ ...step })) } : {}),
            source: 'butler'
          });
          conversation.updatedAt = new Date().toISOString();
          persist();
        }
        onEvent({ type: 'done', text, canceled: true });
        return {
          text,
          ...(conversation ? { conversationId: conversation.id } : {})
        };
      };
      const conversation = input.conversationId
        ? state.conversations.find((entry) => entry.id === input.conversationId)
        : undefined;
      const wantsNote = /记一下|记录/.test(input.message);
      const wantsExamProject = /我想考研/.test(input.message);
      const reasoning = wantsExamProject
        ? '先确认目标、科目和每天可用时间，再创建项目并排第一批任务。'
        : wantsNote
          ? '先确认要记录的内容，然后写入当前工作区。'
          : '先看今天的任务和最近的记忆，再给出 1-3 个可执行的下一步。';

      for (const chunk of chunkText(reasoning, 4)) {
        if (isCancelled()) return finishCanceled('');
        onEvent({ type: 'reasoning', text: chunk });
        await sleep(80 * pace);
      }
      if (isCancelled()) return finishCanceled('');

      let reply = butlerReply(input.message);

      if (wantsExamProject) {
        const label = '创建项目';
        const id = `tool-workspace-${Date.now()}`;
        const step: ConversationStep = {
          id,
          name: 'create_workspace',
          label,
          status: 'running'
        };
        steps.push(step);
        onEvent({ type: 'tool-start', id, name: 'create_workspace', label });
        await sleep(300 * pace);
        const existing = state.workspaces.find((workspace) => workspace.name === '考研');
        const workspace =
          existing ??
          createWorkspaceInternal({
            name: '考研',
            kind: 'exam',
            goal: '2027 考研上岸',
            description: '由阿咲在对话里创建'
          });
        if (conversation) {
          conversation.workspaceId = workspace.id;
        }
        if (!existing) {
          state.tasks = [
            ...state.tasks,
            {
              id: nextId('task'),
              workspaceId: workspace.id,
              title: '极限基础',
              subject: '数学',
              durationMin: 45,
              acceptance: '完成 10 题并整理错题',
              status: 'pending'
            },
            {
              id: nextId('task'),
              workspaceId: workspace.id,
              title: '阅读理解',
              subject: '英语',
              durationMin: 30,
              acceptance: '精读 1 篇',
              status: 'pending'
            },
            {
              id: nextId('task'),
              workspaceId: workspace.id,
              title: '408 数据结构',
              subject: '专业课',
              durationMin: 60,
              acceptance: '完成第一章框架',
              status: 'pending'
            }
          ];
        }
        persist();
        step.status = 'done';
        onEvent({
          type: 'tool-result',
          id,
          name: 'create_workspace',
          ok: true,
          label
        });
        reply = existing
          ? '已找到项目「考研」，右侧项目面板可以看现有计划和记录。'
          : '已创建项目「考研」，并放进第一批任务。右侧项目面板可以直接看计划和记录。';
        await sleep(120 * pace);
      }

      if (wantsNote && !wantsExamProject) {
        const label = BUTLER_TOOL_LABELS['write_note'] ?? '写入笔记';
        const id = `tool-${Date.now()}`;
        const step: ConversationStep = {
          id,
          name: 'write_note',
          label,
          status: 'running'
        };
        steps.push(step);
        onEvent({ type: 'narration', text: '我先把这条记下来。' });
        await sleep(120 * pace);
        onEvent({ type: 'tool-start', id, name: 'write_note', label });
        await sleep(400 * pace);
        const recorded = recordNoteIfNeeded(input);
        step.status = recorded === null ? 'failed' : 'done';
        if (recorded === null) step.detail = '没有可写入的工作区';
        onEvent({
          type: 'tool-result',
          id,
          name: 'write_note',
          ok: recorded !== null,
          label,
          ...(recorded === null ? { detail: '没有可写入的工作区' } : {})
        });
        await sleep(120 * pace);
      }

      let emitted = '';
      for (const chunk of chunkText(reply, 6)) {
        if (isCancelled()) return finishCanceled(emitted);
        emitted += chunk;
        onEvent({ type: 'text', text: chunk });
        await sleep(40 * pace);
      }
      if (isCancelled()) return finishCanceled(emitted);
      onEvent({ type: 'done', text: reply });

      if (conversation) {
        conversation.messages.push({
          id: input.assistantMessageId ?? nextId('assistant'),
          role: 'assistant',
          text: reply,
          createdAt: new Date().toISOString(),
          ...(steps.length > 0 ? { steps: steps.map((step) => ({ ...step })) } : {}),
          source: 'butler'
        });
        conversation.updatedAt = new Date().toISOString();
        persist();
      }

      return {
        text: reply,
        ...(conversation ? { conversationId: conversation.id } : {})
      };
    }
  };
}

export function resetMockData(storage?: Storage): void {
  const resolved = resolveStorage(storage);
  if (!resolved) return;
  try {
    resolved.removeItem(MOCK_STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}
