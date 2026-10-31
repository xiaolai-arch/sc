import type { Bootstrap, StudyCoachApi, UpdateTaskInput } from '../src/shared/ipc';
import { formatLocalDate } from '../src/shared/date';
import { validateExamProfile } from '../src/shared/profile';
import type { AppSettings, DailyPlan, ExamProfile, ReviewAnswers, StudyTask } from '../src/shared/types';

export const MOCK_STORAGE_KEY = 'study-coach:prototype:v1';

interface MockState {
  profile: ExamProfile | null;
  settings: AppSettings;
  plan: DailyPlan | null;
  reviews: Record<string, ReviewAnswers>;
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

function defaultState(): MockState {
  return {
    profile: null,
    settings: structuredClone(defaultSettings),
    plan: null,
    reviews: {}
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
      acceptance: '过一遍框架，做 10 道选择题',
      status: 'pending'
    }
  ];
  return { date, generatedBy: 'agent', tasks };
}

function readState(storage: Storage): MockState {
  try {
    const raw = storage.getItem(MOCK_STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<MockState>;
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
      reviews: parsed.reviews ?? {}
    };
  } catch {
    return defaultState();
  }
}

export function createMockApi(storage: Storage = window.localStorage): StudyCoachApi {
  let state = readState(storage);
  let apiKey: string | null = null;

  const today = () => formatLocalDate(new Date());
  const persist = () => {
    try {
      storage.setItem(MOCK_STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Prototype data is best-effort; an unavailable storage keeps the in-memory state.
    }
  };

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

    async submitReview(input: { date: string; answers: ReviewAnswers }): Promise<void> {
      state.reviews[input.date] = input.answers;
      persist();
    }
  };
}

export function resetMockData(storage: Storage = window.localStorage): void {
  try {
    storage.removeItem(MOCK_STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

export { DEMO_PROFILE } from '../src/shared/demo';
