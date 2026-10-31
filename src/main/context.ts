import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { formatLocalDate } from '../shared/date';
import type { StudyCoachApi } from '../shared/ipc';
import { validateExamProfile } from '../shared/profile';
import type { AppSettings, DailyPlan, StudyTask, TaskStatus } from '../shared/types';
import type { ButlerService, SendMessageInput, WorkspaceService } from '../shared/workspace';
import { createButlerService } from './butler/create-butler-service';
import { createDefaultSettings } from './settings/defaults';
import { InMemorySecretStore, SafeStorageSecretStore, type SecretStore } from './settings/secret-store';
import { SettingsService } from './settings/settings-service';
import { JsonStateStore, type AppState } from './state-store';
import { createWorkspaceService } from './workspace/create-workspace-service';

export interface CreateAppContextOptions {
  /** Electron `app.getPath('userData')` in production. */
  userDataPath: string;
  /** Default vault location before the user overrides it in settings. */
  defaultVaultPath?: string;
  /** Test seams; production uses the committed factory placeholders. */
  workspaceService?: WorkspaceService;
  butlerService?: ButlerService;
  secretStore?: SecretStore;
  now?: () => Date;
}

export interface AppContext {
  api: StudyCoachApi;
  state: JsonStateStore;
  settings: SettingsService;
  secrets: SecretStore;
  workspace: WorkspaceService;
  butler: ButlerService;
}

export function createDefaultAppState(vaultPath: string): AppState {
  return {
    profile: null,
    plan: null,
    reviews: {},
    settings: createDefaultSettings(vaultPath)
  };
}

function buildTemplatePlan(state: AppState, date: string): DailyPlan {
  const profile = state.profile;
  const subjects = profile && profile.subjects.length > 0 ? profile.subjects : [{ name: '学习' }];
  const totalMinutes = profile?.dailyMinutes ?? 120;
  const perSubject = Math.max(15, Math.floor(totalMinutes / subjects.length));
  const tasks: StudyTask[] = subjects.map((subject, index) => ({
    id: randomUUID(),
    title: `${subject.name}专项练习 ${index + 1}`,
    subject: subject.name,
    durationMin: perSubject,
    materialRefs: [],
    acceptance: '完成练习并整理错题',
    status: 'pending'
  }));
  return { date, tasks, generatedBy: 'template' };
}

function isTaskStatus(value: string): value is TaskStatus {
  return value === 'pending' || value === 'in-progress' || value === 'done' || value === 'skipped';
}

/**
 * Composes the persisted state, settings, secrets and the two contract-level
 * services into the object the IPC layer exposes.
 */
export async function createAppContext(options: CreateAppContextOptions): Promise<AppContext> {
  const defaultVaultPath = options.defaultVaultPath ?? join(options.userDataPath, 'vault');
  const state = new JsonStateStore({
    filePath: join(options.userDataPath, 'state.json'),
    createDefault: () => createDefaultAppState(defaultVaultPath)
  });
  const stored = await state.read();
  const settings = new SettingsService(state);
  const secrets =
    options.secretStore ??
    new SafeStorageSecretStore(join(options.userDataPath, 'secrets', 'api-key.bin'));
  const vaultRoot = stored.settings.vaultPath;
  const workspace = options.workspaceService ?? createWorkspaceService(vaultRoot);
  const butler = options.butlerService ?? createButlerService(vaultRoot);
  const now = options.now ?? (() => new Date());
  const today = () => formatLocalDate(now());

  const api: StudyCoachApi = {
    async getBootstrap() {
      const snapshot = await state.read();
      return {
        needsOnboarding: snapshot.profile === null,
        today: today(),
        hasApiKey: await secrets.hasApiKey()
      };
    },

    async completeOnboarding(profile) {
      const validated = validateExamProfile(profile);
      await state.update((current) => ({ ...current, profile: validated }));
    },

    async getSettings() {
      return settings.get();
    },

    async updateSettings(patch: Partial<AppSettings>) {
      return settings.update(patch);
    },

    async setApiKey(key: string) {
      await secrets.setApiKey(key);
    },

    async getTodayPlan() {
      const snapshot = await state.read();
      if (!snapshot.plan || snapshot.plan.date !== today()) return null;
      return structuredClone(snapshot.plan);
    },

    async generateTodayPlan() {
      const date = today();
      const next = await state.update((current) => ({
        ...current,
        plan: buildTemplatePlan(current, date)
      }));
      return structuredClone(next.plan as DailyPlan);
    },

    async updateTask(input) {
      if (!isTaskStatus(input.status)) throw new Error('任务状态无效。');
      const date = today();
      const next = await state.update((current) => {
        if (!current.plan || current.plan.date !== date) {
          throw new Error('今天还没有计划。');
        }
        const task = current.plan.tasks.find((entry) => entry.id === input.taskId);
        if (!task) throw new Error('任务不存在。');
        const updated: StudyTask = { ...task, status: input.status };
        if (input.actualMin !== undefined) updated.actualMin = input.actualMin;
        return {
          ...current,
          plan: {
            ...current.plan,
            tasks: current.plan.tasks.map((entry) => (entry.id === task.id ? updated : entry))
          }
        };
      });
      return structuredClone(next.plan as DailyPlan);
    },

    listWorkspaces: () => workspace.listWorkspaces(),
    createWorkspace: (input) => workspace.createWorkspace(input),
    getWorkspaceSnapshot: (workspaceId) => workspace.getWorkspaceSnapshot(workspaceId),
    createTask: (input) => workspace.createTask(input),
    updateWorkspaceTask: (input) => workspace.updateWorkspaceTask(input),
    createNote: (input) => workspace.createNote(input),
    updateNote: (input) => workspace.updateNote(input),
    getMemory: (workspaceId) => workspace.getMemory(workspaceId),
    getReminders: () => workspace.getReminders(),
    submitReview: (input) => workspace.submitReview(input),
    send: (input: SendMessageInput) => butler.send(input)
  };

  return { api, state, settings, secrets, workspace, butler };
}
