import { join } from 'node:path';
import { formatLocalDate } from '../shared/date';
import type { ListReviewsInput, ReviewRecord, StudyCoachApi } from '../shared/ipc';
import type { MemoryService } from '../shared/memory';
import type { WorkspacePlanner } from '../shared/planning';
import type { PracticeService } from '../shared/practice';
import type { SearchService } from '../shared/search';
import type { AppSettings, ProviderConfig } from '../shared/types';
import type { ButlerService, SendMessageInput, WorkspaceService } from '../shared/workspace';
import { createModelClient, NoApiKeyError, type ModelClient } from './agent/model-client';
import { createButlerService } from './butler/create-butler-service';
import { ConversationStore } from './conversations/conversation-store';
import { createMemoryService } from './memory/create-memory-service';
import { createPracticeService } from './practice';
import { createWorkspacePlanner } from './planning';
import { createSearchService } from './search';
import { createDefaultSettings } from './settings/defaults';
import { InMemorySecretStore, SafeStorageSecretStore, type SecretStore } from './settings/secret-store';
import { SettingsService } from './settings/settings-service';
import { JsonStateStore, type AppState } from './state-store';
import { createWorkspaceService } from './workspace/create-workspace-service';
import { listDirectories, listMarkdownFiles, readFileOrNull } from './workspace/fs-utils';
import { assertSafeSegment, reviewsDir, workspacesDir } from './workspace/paths';
import { parseReviewFile } from './workspace/records/reviews';

/** Dependencies handed to an injected butler factory (tests/observability). */
export interface ButlerFactoryDependencies {
  workspaceService: WorkspaceService;
  provider: ProviderConfig;
  apiKey: string | null;
  modelClient?: ModelClient | null;
}

/** Dependencies handed to an injected memory factory. */
export interface MemoryFactoryDependencies {
  modelClient: ModelClient | null;
}

export interface CreateAppContextOptions {
  /** Electron `app.getPath('userData')` in production. */
  userDataPath: string;
  /** Default vault location before the user overrides it in settings. */
  defaultVaultPath?: string;
  /** Test seams; production uses the real factories below. */
  workspaceService?: WorkspaceService;
  butlerService?: ButlerService;
  practiceService?: PracticeService;
  memoryService?: MemoryService;
  searchService?: SearchService;
  workspacePlanner?: WorkspacePlanner;
  workspaceServiceFactory?: (vaultRoot: string) => WorkspaceService;
  butlerServiceFactory?: (
    vaultRoot: string,
    dependencies: ButlerFactoryDependencies
  ) => ButlerService;
  practiceServiceFactory?: (vaultRoot: string) => PracticeService;
  memoryServiceFactory?: (
    vaultRoot: string,
    dependencies: MemoryFactoryDependencies
  ) => MemoryService;
  searchServiceFactory?: (vaultRoot: string, workspaceService: WorkspaceService) => SearchService;
  plannerFactory?: (vaultRoot: string, workspaceService: WorkspaceService) => WorkspacePlanner;
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
  conversationStore: ConversationStore;
  readonly workspace: WorkspaceService;
  readonly butler: ButlerService;
  readonly practice: PracticeService;
  readonly memory: MemoryService;
  readonly planner: WorkspacePlanner;
  /** Created lazily so headless/test contexts never start a vault watcher. */
  readonly search: SearchService;
  /** Rebuilds workspace/butler from the persisted settings and secret store. */
  refreshServices(): Promise<void>;
  /** Stops the search watcher and releases background resources (app quit). */
  dispose(): Promise<void>;
}

interface ActiveServices {
  vaultPath: string;
  providerSignature: string;
  workspace: WorkspaceService;
  butler: ButlerService;
  practice: PracticeService;
  memory: MemoryService;
  planner: WorkspacePlanner;
  /** Lazily constructed; only a search call starts the chokidar watcher. */
  readonly search: SearchService;
  dispose(): Promise<void>;
}

export function createDefaultAppState(vaultPath: string): AppState {
  return {
    onboarded: false,
    settings: createDefaultSettings(vaultPath)
  };
}

/**
 * Mirrors the butler's credential handling: a missing key (or an unusable
 * provider) simply means "offline", and planner/memory fall back to their
 * deterministic templates. Never logs the provider config or the key.
 */
function resolveModelClient(
  provider: ProviderConfig,
  apiKey: string | null
): ModelClient | null {
  try {
    return createModelClient(provider, apiKey);
  } catch (error) {
    if (error instanceof NoApiKeyError) return null;
    return null;
  }
}

function reviewDateFromFile(fileName: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})\.md$/.exec(fileName);
  return match === null ? null : (match[1] as string);
}

/**
 * Composes the persisted state, settings, secrets and the contract-level
 * services into the object the IPC layer exposes.
 *
 * Workspace/butler/practice/memory/planner instances are rebuilt whenever the
 * vault path or provider changes (and after an API-key write). This keeps the
 * vault as the single source of truth without requiring an app restart. Secrets
 * stay in memory and are never logged or written back into settings.
 */
export async function createAppContext(options: CreateAppContextOptions): Promise<AppContext> {
  const defaultVaultPath = options.defaultVaultPath ?? join(options.userDataPath, 'vault');
  const state = new JsonStateStore({
    filePath: join(options.userDataPath, 'state.json'),
    createDefault: () => createDefaultAppState(defaultVaultPath)
  });
  const stored = await state.read();
  const settings = new SettingsService(state);
  const conversationStore = new ConversationStore(join(options.userDataPath, 'conversations'));
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

  function createPractice(root: string): PracticeService {
    if (options.practiceService) return options.practiceService;
    if (options.practiceServiceFactory) return options.practiceServiceFactory(root);
    return createPracticeService(root, { now });
  }

  function createMemory(root: string, modelClient: ModelClient | null): MemoryService {
    if (options.memoryService) return options.memoryService;
    if (options.memoryServiceFactory) {
      return options.memoryServiceFactory(root, { modelClient });
    }
    return createMemoryService({ root, modelClient, now });
  }

  function createPlanner(
    root: string,
    workspaceService: WorkspaceService,
    modelClient: ModelClient | null
  ): WorkspacePlanner {
    if (options.workspacePlanner) return options.workspacePlanner;
    if (options.plannerFactory) return options.plannerFactory(root, workspaceService);
    return createWorkspacePlanner({ modelClient, workspaceService, now });
  }

  /** The default search factory is only called when a search IPC arrives. */
  function createSearch(root: string, workspaceService: WorkspaceService): SearchService {
    if (options.searchService) return options.searchService;
    if (options.searchServiceFactory) {
      return options.searchServiceFactory(root, workspaceService);
    }
    return createSearchService({ vaultRoot: root, workspaceService });
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

    const modelClient =
      options.modelClient !== undefined
        ? options.modelClient
        : resolveModelClient(nextSettings.provider, apiKey);

    let searchInstance: SearchService | null = null;
    return {
      vaultPath: nextSettings.vaultPath,
      providerSignature: JSON.stringify(nextSettings.provider),
      workspace,
      butler,
      practice: createPractice(nextSettings.vaultPath),
      memory: createMemory(nextSettings.vaultPath, modelClient),
      planner: createPlanner(nextSettings.vaultPath, workspace, modelClient),
      get search() {
        if (searchInstance === null) {
          searchInstance = createSearch(nextSettings.vaultPath, workspace);
        }
        return searchInstance;
      },
      async dispose() {
        if (searchInstance === null) return;
        const current = searchInstance;
        searchInstance = null;
        await current.dispose();
      }
    };
  }

  async function rebuildServices(nextSettings: AppSettings): Promise<ActiveServices> {
    if (!pendingRebuild) {
      pendingRebuild = buildServices(nextSettings)
        .then(async (services) => {
          const previous = active;
          active = services;
          // Dispose the old watcher only after the new instance is usable, so a
          // failed rebuild keeps the current services alive.
          if (previous !== null && previous !== services) await previous.dispose();
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

  async function readReviews(input: ListReviewsInput = {}): Promise<ReviewRecord[]> {
    const services = await getServices();
    const root = services.vaultPath;
    const workspaceIds =
      input.workspaceId !== undefined
        ? [assertSafeSegment(input.workspaceId, 'workspace id')]
        : await listDirectories(workspacesDir(root));
    const dirs = [reviewsDir(root), ...workspaceIds.map((id) => reviewsDir(root, id))];
    const records: ReviewRecord[] = [];
    for (const dir of dirs) {
      for (const fileName of await listMarkdownFiles(dir)) {
        const date = reviewDateFromFile(fileName);
        if (date === null) continue;
        const raw = await readFileOrNull(join(dir, fileName));
        if (raw === null) continue;
        for (const entry of parseReviewFile(raw)) {
          records.push({
            date,
            submittedAt: entry.submittedAt,
            ...(entry.workspaceId !== undefined ? { workspaceId: entry.workspaceId } : {}),
            completed: entry.completed,
            stuck: entry.stuck,
            tomorrow: entry.tomorrow,
            skipped: entry.skipped === true
          });
        }
      }
    }
    const limit =
      typeof input.limit === 'number' && Number.isFinite(input.limit) && input.limit > 0
        ? Math.min(200, Math.floor(input.limit))
        : 30;
    records.sort(
      (a, b) =>
        b.submittedAt.localeCompare(a.submittedAt) ||
        b.date.localeCompare(a.date) ||
        (a.workspaceId ?? '').localeCompare(b.workspaceId ?? '')
    );
    return records.slice(0, limit);
  }

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
      const services = await getServices();
      await services.workspace.submitReview(input);
      // Memory synthesis is best-effort: the review record is authoritative and
      // must not be lost if the model (or memory file) fails.
      if (input.workspaceId !== undefined && input.answers?.skipped !== true) {
        try {
          await services.memory.synthesizeFromReview({
            workspaceId: input.workspaceId,
            date: input.date,
            answers: input.answers
          });
        } catch {
          // Keep the persisted review; a later synthesis can retry.
        }
      }
    },
    async listReviews(input) {
      return readReviews(input);
    },
    async planWorkspace(input) {
      return (await getServices()).planner.plan(input);
    },
    async listPracticeSets(workspaceId) {
      return (await getServices()).practice.listSets(workspaceId);
    },
    async getPracticeSet(id) {
      return (await getServices()).practice.getSet(id);
    },
    async createPracticeSet(input) {
      return (await getServices()).practice.createSet(input);
    },
    async submitPracticeAnswer(input) {
      return (await getServices()).practice.submitAnswer(input);
    },
    async getPracticeMistakes(workspaceId) {
      return (await getServices()).practice.getMistakes(workspaceId);
    },
    async getPracticeDue(input) {
      return (await getServices()).practice.getDue(input.workspaceId, input.date);
    },
    async listPracticeAttempts(workspaceId) {
      return (await getServices()).practice.listAttempts(workspaceId);
    },
    async listMemory(workspaceId) {
      return (await getServices()).memory.list(workspaceId);
    },
    async synthesizeMemory(input) {
      return (await getServices()).memory.synthesizeFromReview(input);
    },
    async getMemoryProfile(workspaceId) {
      return (await getServices()).memory.getProfile(workspaceId);
    },
    async searchWorkspace(input) {
      return (await getServices()).search.search(input.workspaceId, input.query, input.limit);
    },
    async rebuildSearchIndex() {
      await (await getServices()).search.rebuild();
    },
    async listConversations() {
      return conversationStore.list();
    },
    async getConversation(id) {
      return conversationStore.get(id);
    },
    async createConversation(input) {
      return conversationStore.create(input);
    },
    async appendConversationMessage(id, message) {
      return conversationStore.appendMessage(id, message);
    },
    async deleteConversation(id) {
      await conversationStore.delete(id);
    },
    async send(input: SendMessageInput) {
      return (await getServices()).butler.send(input);
    },
    async stream(input, onEvent) {
      return (await getServices()).butler.stream(input, onEvent);
    }
  };

  const context: AppContext = {
    api,
    state,
    settings,
    secrets,
    conversationStore,
    get workspace() {
      if (!active) throw new Error('工作区服务尚未初始化。');
      return active.workspace;
    },
    get butler() {
      if (!active) throw new Error('管家服务尚未初始化。');
      return active.butler;
    },
    get practice() {
      if (!active) throw new Error('练习服务尚未初始化。');
      return active.practice;
    },
    get memory() {
      if (!active) throw new Error('记忆服务尚未初始化。');
      return active.memory;
    },
    get planner() {
      if (!active) throw new Error('计划服务尚未初始化。');
      return active.planner;
    },
    get search() {
      if (!active) throw new Error('搜索服务尚未初始化。');
      return active.search;
    },
    async refreshServices() {
      await rebuildServices(await settings.get());
    },
    async dispose() {
      if (!active) return;
      const current = active;
      active = null;
      await current.dispose();
    }
  };

  return context;
}
