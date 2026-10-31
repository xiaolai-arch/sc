import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { formatLocalDate } from '../shared/date';
import type { StudyCoachApi } from '../shared/ipc';
import { validateExamProfile } from '../shared/profile';
import type {
  AppSettings,
  DailyPlan,
  ProviderConfig,
  StudyTask,
  TaskStatus
} from '../shared/types';
import type { ButlerService, SendMessageInput, WorkspaceService } from '../shared/workspace';
import type { ModelClient } from './agent/model-client';
import { createButlerService } from './butler/create-butler-service';
import { createTodayPlanPlanner } from './scheduler/planner';
import { createDefaultSettings } from './settings/defaults';
import { InMemorySecretStore, SafeStorageSecretStore, type SecretStore } from './settings/secret-store';
import { SettingsService } from './settings/settings-service';
import { JsonStateStore, type AppState } from './state-store';
import { createWorkspaceService } from './workspace/create-workspace-service';

/** Dependencies handed to an injected butler factory (tests/observability). */
export interface ButlerFactoryDependencies {
  workspaceService: WorkspaceService;
  provider: ProviderConfig;
  apiKey: string | null;
  modelClient?: ModelClient | null;
}

export interface CreateAppContextOptions {
  /** Electron `app.getPath('userData')` in production. */
  userDataPath: string;
  /** Default vault location before the user overrides it in settings. */
  defaultVaultPath?: string;
  /** Test seams; production uses the real factories below. */
  workspaceService?: WorkspaceService;
  butlerService?: ButlerService;
  workspaceServiceFactory?: (vaultRoot: string) => WorkspaceService;
  butlerServiceFactory?: (
    vaultRoot: string,
    dependencies: ButlerFactoryDependencies
  ) => ButlerService;
  /** Offline model seam used by integration tests. Never used for network here. */
  modelClient?: ModelClient | null;
  secretStore?: SecretStore;
  now?: () => Date;
}

export interface AppContext {
  api: StudyCoachApi;
  state: JsonStateStore;
  settings: SettingsService;
  secrets: SecretStore;
  readonly workspace: WorkspaceService;
  readonly butler: ButlerService;
  /** Rebuilds workspace/butler from the persisted settings and secret store. */
  refreshServices(): Promise<void>;
}

interface ActiveServices {
  vaultPath: string;
  providerSignature: string;
  workspace: WorkspaceService;
  butler: ButlerService;
}

export function createDefaultAppState(vaultPath: string): AppState {
  return {
    profile: null,
    onboarded: false,
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
 *
 * Workspace/butler instances are rebuilt whenever the vault path or provider
 * changes (and after an API-key write). This keeps the vault as the single
 * source of truth without requiring an app restart. Secrets stay in memory and
 * are never logged or written back into settings.
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
  const now = options.now ?? (() => new Date());
  const today = () => formatLocalDate(now());

  let active: ActiveServices | null = null;
  let pendingRebuild: Promise<ActiveServices> | null = null;

  function createWorkspace(root: string): WorkspaceService {
    if (options.workspaceService) return options.workspaceService;
    if (options.workspaceServiceFactory) return options.workspaceServiceFactory(root);
    return createWorkspaceService(root);
  }

  function createButler(root: string, dependencies: ButlerFactoryDependencies): ButlerService {
    if (options.butlerService) return options.butlerService;
    if (options.butlerServiceFactory) {
      return options.butlerServiceFactory(root, dependencies);
    }
    return createButlerService(root, {
      workspaceService: dependencies.workspaceService,
      provider: dependencies.provider,
      apiKey: dependencies.apiKey,
      now,
      ...(dependencies.modelClient !== undefined ? { modelClient: dependencies.modelClient } : {})
    });
  }

  async function buildServices(nextSettings: AppSettings): Promise<ActiveServices> {
    const apiKey = await secrets.getApiKey();
    const workspace = createWorkspace(nextSettings.vaultPath);
    const dependencies: ButlerFactoryDependencies = {
      workspaceService: workspace,
      provider: nextSettings.provider,
      apiKey
    };
    if (options.modelClient !== undefined) dependencies.modelClient = options.modelClient;
    const butler = createButler(nextSettings.vaultPath, dependencies);
    return {
      vaultPath: nextSettings.vaultPath,
      providerSignature: JSON.stringify(nextSettings.provider),
      workspace,
      butler
    };
  }

  async function rebuildServices(nextSettings: AppSettings): Promise<ActiveServices> {
    if (!pendingRebuild) {
      pendingRebuild = buildServices(nextSettings)
        .then((services) => {
          active = services;
          return services;
        })
        .finally(() => {
          pendingRebuild = null;
        });
    }
    return pendingRebuild;
  }

  async function getServices(): Promise<ActiveServices> {
    if (pendingRebuild) return pendingRebuild;
    if (active) return active;
    const snapshot = await state.read();
    return rebuildServices(snapshot.settings);
  }

  /**
   * Rebuilds only when the vault or provider actually changed. The API key is
   * handled separately by `setApiKey`, so routine settings writes are cheap.
   */
  async function syncServices(nextSettings: AppSettings): Promise<void> {
    if (!active) {
      await getServices();
      return;
    }
    if (
      active.vaultPath !== nextSettings.vaultPath ||
      active.providerSignature !== JSON.stringify(nextSettings.provider)
    ) {
      await rebuildServices(nextSettings);
    }
  }

  await rebuildServices(stored.settings);

  const api: StudyCoachApi = {
    async getBootstrap() {
      const snapshot = await state.read();
      const hasApiKey =
        snapshot.settings.provider.kind === 'local-cli'
          ? true
          : await secrets.hasApiKey();
      return {
        needsOnboarding: !snapshot.onboarded,
        today: today(),
        hasApiKey
      };
    },

    async completeWorkspaceOnboarding(input) {
      const services = await getServices();
      if (input.useDemo) {
        // Ensure the seed exists; the user can keep or edit the example workspaces.
        await services.workspace.listWorkspaces();
      } else {
        await services.workspace.createWorkspace({
          name: input.name,
          kind: input.kind,
          goal: input.goal,
          description: input.description
        });
      }

      const currentSettings = await settings.get();
      if (currentSettings.provider.kind !== 'local-cli') {
        await settings.update({
          provider: { kind: 'local-cli', agent: 'codex', command: 'codex' }
        });
        await syncServices(await settings.get());
      }

      await state.update((current) => ({ ...current, onboarded: true }));
    },

    async completeOnboarding(profile) {
      const validated = validateExamProfile(profile);
      await state.update((current) => ({ ...current, profile: validated, onboarded: true }));
    },

    async getSettings() {
      return settings.get();
    },

    async updateSettings(patch: Partial<AppSettings>) {
      const updated = await settings.update(patch);
      await syncServices(updated);
      return updated;
    },

    async setApiKey(key: string) {
      await secrets.setApiKey(key);
      // The butler holds the resolved model client, so a key write must rebuild.
      await rebuildServices(await settings.get());
    },

    async getTodayPlan() {
      const snapshot = await state.read();
      if (!snapshot.plan || snapshot.plan.date !== today()) return null;
      return structuredClone(snapshot.plan);
    },

    async generateTodayPlan() {
      const date = today();
      const snapshot = await state.read();
      const services = await getServices();
      // Primary path: the butler/planner. Offline/no-key replies that are not
      // structured JSON fall back to the deterministic template so the UI keeps
      // working without a network connection.
      const planned = await createTodayPlanPlanner({ butler: services.butler }).plan(
        date,
        snapshot.profile
      );
      const plan = planned ?? buildTemplatePlan(snapshot, date);
      const next = await state.update((current) => ({ ...current, plan }));
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

    async listWorkspaces() {
      return (await getServices()).workspace.listWorkspaces();
    },
    async createWorkspace(input) {
      return (await getServices()).workspace.createWorkspace(input);
    },
    async getWorkspaceSnapshot(workspaceId) {
      return (await getServices()).workspace.getWorkspaceSnapshot(workspaceId);
    },
    async createTask(input) {
      return (await getServices()).workspace.createTask(input);
    },
    async updateWorkspaceTask(input) {
      return (await getServices()).workspace.updateWorkspaceTask(input);
    },
    async createNote(input) {
      return (await getServices()).workspace.createNote(input);
    },
    async updateNote(input) {
      return (await getServices()).workspace.updateNote(input);
    },
    async getMemory(workspaceId) {
      return (await getServices()).workspace.getMemory(workspaceId);
    },
    async getReminders() {
      return (await getServices()).workspace.getReminders();
    },
    async submitReview(input) {
      return (await getServices()).workspace.submitReview(input);
    },
    async send(input: SendMessageInput) {
      return (await getServices()).butler.send(input);
    }
  };

  const context: AppContext = {
    api,
    state,
    settings,
    secrets,
    get workspace() {
      if (!active) throw new Error('工作区服务尚未初始化。');
      return active.workspace;
    },
    get butler() {
      if (!active) throw new Error('管家服务尚未初始化。');
      return active.butler;
    },
    async refreshServices() {
      await rebuildServices(await settings.get());
    }
  };

  return context;
}
