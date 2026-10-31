import type { Bootstrap, StudyCoachApi, UpdateTaskInput } from '../src/shared/ipc';
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
import { formatLocalDate } from '../src/shared/date';
import { validateExamProfile } from '../src/shared/profile';
import type { AppSettings, DailyPlan, ExamProfile, ReviewAnswers, StudyTask } from '../src/shared/types';
import {
  demoMemory,
  demoNotes,
  demoReminders,
  demoTasks,
  workspaces as demoWorkspaces
} from '../src/renderer/shell/demoData';
import type { NoteBlock } from '../src/renderer/shell/demoData';

export const MOCK_STORAGE_KEY = 'study-coach:prototype:v1';

interface MockState {
  profile: ExamProfile | null;
  settings: AppSettings;
  plan: DailyPlan | null;
  reviews: Record<string, ReviewAnswers>;
  workspaces: Workspace[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  memory: MemoryItem[];
  reminders: Reminder[];
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
    memory: structuredClone(demoMemory),
    reminders: demoReminders.map((reminder): Reminder => ({ ...reminder, enabled: true }))
  };
}

function defaultState(): MockState {
  return {
    profile: null,
    settings: structuredClone(defaultSettings),
    plan: null,
    reviews: {},
    ...seedWorkspaceData()
  };
}

function createDemoPlan(date: string): DailyPlan {
  const tasks: StudyTask[] = [
    {
      id: 't1',
      title: '极限与连续',
      subject: '数学',
      durationMin: 45,
      materialRefs: [],
      acceptance: '完成 10 题，并整理错题',
      status: 'pending'
    },
    {
      id: 't2',
      title: '阅读理解',
      subject: '英语',
      durationMin: 30,
      materialRefs: [],
      acceptance: '精读 1 篇，标出长难句',
      status: 'pending'
    },
    {
      id: 't3',
      title: '马原第一章',
      subject: '政治',
      durationMin: 30,
      materialRefs: [],
      acceptance: '过一遍框架，做 10 道题',
      status: 'pending'
    }
  ];
  return { date, generatedBy: 'agent', tasks };
}

export function DEMO_PLAN(): DailyPlan {
  return createDemoPlan(formatLocalDate(new Date()));
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
      profile: parsed.profile ?? null,
      settings: {
        ...structuredClone(defaultSettings),
        ...parsed.settings,
        provider: parsed.settings?.provider ?? defaultSettings.provider,
        notifications: { ...defaultSettings.notifications, ...parsed.settings?.notifications },
        budget: { ...defaultSettings.budget, ...parsed.settings?.budget }
      },
      plan: parsed.plan ?? null,
      reviews: parsed.reviews ?? {},
      workspaces: Array.isArray(parsed.workspaces) ? parsed.workspaces : seeded.workspaces,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : seeded.tasks,
      notes: Array.isArray(parsed.notes) ? parsed.notes : seeded.notes,
      memory: Array.isArray(parsed.memory) ? parsed.memory : seeded.memory,
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : seeded.reminders
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

export function createMockApi(storage?: Storage): StudyCoachApi {
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

  return {
    async getBootstrap(): Promise<Bootstrap> {
      return {
        needsOnboarding: state.profile === null,
        today: today(),
        hasApiKey: apiKey !== null
      };
    },

    async completeOnboarding(profile: ExamProfile): Promise<void> {
      state.profile = validateExamProfile(profile);
      if (!state.plan || state.plan.date !== today()) {
        state.plan = createDemoPlan(today());
      }
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

    async getTodayPlan(): Promise<DailyPlan | null> {
      if (!state.plan || state.plan.date !== today()) return null;
      return structuredClone(state.plan);
    },

    async generateTodayPlan(): Promise<DailyPlan> {
      state.plan = createDemoPlan(today());
      persist();
      return structuredClone(state.plan);
    },

    async updateTask(input: UpdateTaskInput): Promise<DailyPlan> {
      if (!state.plan) throw new Error('今天还没有计划');
      const task = state.plan.tasks.find((entry) => entry.id === input.taskId);
      if (!task) throw new Error('任务不存在');
      task.status = input.status;
      if (input.actualMin !== undefined) task.actualMin = input.actualMin;
      persist();
      return structuredClone(state.plan);
    },

    async submitReview(input: SubmitReviewInput): Promise<void> {
      state.reviews[input.date] = input.answers;
      persist();
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

    async send(input: SendMessageInput): Promise<SendMessageResult> {
      if (/记一下|记录/.test(input.message)) {
        const workspace = input.workspaceId
          ? state.workspaces.find((entry) => entry.id === input.workspaceId)
          : state.workspaces[0];
        if (workspace) {
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
        }
      }
      return {
        text: butlerReply(input.message)
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

export { DEMO_PROFILE } from '../src/shared/demo';
