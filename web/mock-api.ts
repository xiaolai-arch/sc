import type {
  Bootstrap,
  ListReviewsInput,
  ReviewRecord,
  SearchWorkspaceInput,
  StudyCoachApi
} from '../src/shared/ipc';
import type {
  CreateNoteInput,
  CreateTaskInput,
  CreateWorkspaceInput,
  MemoryItem,
  Reminder,
  SendMessageInput,
  SendMessageResult,
  SubmitReviewInput,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceSnapshot,
  WorkspaceTask
} from '../src/shared/workspace';
import type { StreamingButlerApi } from '../src/shared/butler-stream';
import { BUTLER_TOOL_LABELS } from '../src/shared/butler-stream';
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CreateConversationInput
} from '../src/shared/conversations';
import type {
  CreatePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult
} from '../src/shared/practice';
import { PRACTICE_INTERVALS } from '../src/shared/practice';
import type {
  LearnerProfile,
  MemoryKind,
  MemoryRecord,
  MemorySynthesisResult,
  SynthesizeMemoryInput
} from '../src/shared/memory';
import type { PlanWorkspaceInput, WorkspacePlan } from '../src/shared/planning';
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
  conversations: Conversation[];
}

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

export type MockApiOptions = {
  /** Multiplier for stream pacing. Tests use the fast default; the web demo passes 1. */
  streamPace?: number;
};

export function createMockApi(
  storage?: Storage,
  options: MockApiOptions = {}
): StudyCoachApi & StreamingButlerApi {
  const pace = Math.max(0.01, options.streamPace ?? 0.05);
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

    async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
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

    async rebuildSearchIndex(): Promise<void> {
      // The browser prototype searches live state; nothing to rebuild.
    },

    async listWorkspaces(): Promise<Workspace[]> {
      return structuredClone(state.workspaces);
    },

    async createWorkspace(input: CreateWorkspaceInput): Promise<Workspace> {
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
      return structuredClone(workspace);
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
      task.status = input.status;
      if (input.actualMin !== undefined) task.actualMin = input.actualMin;
      task.updatedAt = new Date().toISOString();
      persist();
      return structuredClone(task);
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

    async getMemory(workspaceId?: string): Promise<MemoryItem[]> {
      const items = workspaceId
        ? state.memory.filter((item) => item.workspaceId === workspaceId)
        : state.memory;
      return structuredClone(items);
    },

    async getReminders(): Promise<Reminder[]> {
      return structuredClone(state.reminders);
    },

    async listConversations(): Promise<ConversationSummary[]> {
      return state.conversations
        .filter((conversation) => conversation.messages.length > 0)
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((conversation) => {
          const last = conversation.messages[conversation.messages.length - 1];
          return {
            id: conversation.id,
            title: conversation.title,
            kind: conversation.kind,
            ...(conversation.workspaceId ? { workspaceId: conversation.workspaceId } : {}),
            updatedAt: conversation.updatedAt,
            preview: last ? truncateConversationText(last.text, 80) : ''
          };
        });
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
        const title = truncateConversationText(message.text, 24);
        if (title) conversation.title = title;
      }
      persist();
      return structuredClone(conversation);
    },

    async deleteConversation(id: string): Promise<void> {
      state.conversations = state.conversations.filter((entry) => entry.id !== id);
      persist();
    },

    async send(input: SendMessageInput): Promise<SendMessageResult> {
      recordNoteIfNeeded(input);
      return {
        text: butlerReply(input.message)
      };
    },

    async stream(input, onEvent): Promise<SendMessageResult> {
      const wantsNote = /记一下|记录/.test(input.message);
      const reasoning = wantsNote
        ? '先确认要记录的内容，然后写入当前工作区。'
        : '先看今天的任务和最近的记忆，再给出 1-3 个可执行的下一步。';

      for (const chunk of chunkText(reasoning, 4)) {
        onEvent({ type: 'reasoning', text: chunk });
        await sleep(80 * pace);
      }

      if (wantsNote) {
        const label = BUTLER_TOOL_LABELS['write_note'] ?? '写入笔记';
        const id = `tool-${Date.now()}`;
        onEvent({ type: 'narration', text: '我先把这条记下来。' });
        await sleep(120 * pace);
        onEvent({ type: 'tool-start', id, name: 'write_note', label });
        await sleep(400 * pace);
        const recorded = recordNoteIfNeeded(input);
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

      const reply = butlerReply(input.message);
      for (const chunk of chunkText(reply, 6)) {
        onEvent({ type: 'text', text: chunk });
        await sleep(40 * pace);
      }
      onEvent({ type: 'done', text: reply });
      return { text: reply };
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
