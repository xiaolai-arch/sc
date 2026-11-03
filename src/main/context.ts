import { join } from 'node:path';
import { formatLocalDate } from '../shared/date';
import type { ListReviewsInput, ReviewRecord, StudyCoachApi } from '../shared/ipc';
import type { KnowledgeService } from '../shared/knowledge';
import type { MemoryService } from '../shared/memory';
import type { LongPlanService } from '../shared/plans';
import type { WorkspacePlanner } from '../shared/planning';
import type { PracticeService } from '../shared/practice';
import type { SearchService } from '../shared/search';
import type { AppSettings, ProviderConfig } from '../shared/types';
import { estimateUsageCost, summarizeUsage } from '../shared/usage';
import type { ButlerService, SendMessageInput, WorkspaceService } from '../shared/workspace';
import { scanLocalClis } from './agent/local-cli-discovery';
import { createModelClient, NoApiKeyError, type ModelClient } from './agent/model-client';
import { createButlerService } from './butler/create-butler-service';
import { ProactiveCheckInService } from './check-ins/proactive-check-in-service';
import { ConversationStore } from './conversations/conversation-store';
import { createKnowledgeService } from './knowledge/create-knowledge-service';
import { createMemoryService } from './memory/create-memory-service';
import { createLongPlanService } from './plans/long-plan-service';
import { createPracticeService } from './practice';
import { createWorkspacePlanner } from './planning';
import { createSearchService } from './search';
import { createDefaultSettings } from './settings/defaults';
import { InMemorySecretStore, SafeStorageSecretStore, type SecretStore } from './settings/secret-store';
import { SettingsService } from './settings/settings-service';
import { JsonStateStore, type AppState } from './state-store';
import { createRecordingModelClient } from './usage/recording-model-client';
import { UsageStore } from './usage/usage-store';
import { createWorkspaceService } from './workspace/create-workspace-service';
import { listDirectories, listMarkdownFiles, readFileOrNull } from './workspace/fs-utils';
import { assertSafeSegment, reviewsDir, workspacesDir } from './workspace/paths';
import { parseReviewFile } from './workspace/records/reviews';

/** Dependencies handed to an injected butler factory (tests/observability). */
export interface ButlerFactoryDependencies {
  workspaceService: WorkspaceService;
  provider: ProviderConfig;
  apiKey: string | null;
  conversationStore?: ConversationStore;
  memoryService?: MemoryService;
  knowledgeService?: KnowledgeService;
  planner?: WorkspacePlanner;
  modelClient?: ModelClient | null;
  modelClientFor?: (model: string) => ModelClient | null;
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
  knowledgeService?: KnowledgeService;
  searchService?: SearchService;
  workspacePlanner?: WorkspacePlanner;
  longPlanService?: LongPlanService;
  workspaceServiceFactory?: (vaultRoot: string) => WorkspaceService;
  longPlanServiceFactory?: (
    vaultRoot: string,
    workspaceService: WorkspaceService,
    modelClient: ModelClient | null
  ) => LongPlanService;
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
  usage: UsageStore;
  readonly workspace: WorkspaceService;
  readonly butler: ButlerService;
  readonly practice: PracticeService;
  readonly memory: MemoryService;
  readonly knowledge: KnowledgeService;
  readonly planner: WorkspacePlanner;
  readonly longPlans: LongPlanService;
  readonly checkIns: ProactiveCheckInService;
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
  knowledge: KnowledgeService;
  planner: WorkspacePlanner;
  longPlans: LongPlanService;
  checkIns: ProactiveCheckInService;
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
  const usageStore = new UsageStore(join(options.userDataPath, 'usage.json'), { now });

  let active: ActiveServices | null = null;
  let pendingRebuild: Promise<ActiveServices> | null = null;

  function createWorkspace(root: string): WorkspaceService {
    if (options.workspaceService) return options.workspaceService;
    if (options.workspaceServiceFactory) return options.workspaceServiceFactory(root);
    return createWorkspaceService(root, { seed: false });
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
      conversationStore,
      ...(dependencies.memoryService ? { memoryService: dependencies.memoryService } : {}),
      ...(dependencies.knowledgeService
        ? { knowledgeService: dependencies.knowledgeService }
        : {}),
      ...(dependencies.planner ? { planner: dependencies.planner } : {}),
      now,
      ...(dependencies.modelClient !== undefined ? { modelClient: dependencies.modelClient } : {}),
      ...(dependencies.modelClientFor ? { modelClientFor: dependencies.modelClientFor } : {})
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

  function createKnowledge(root: string): KnowledgeService {
    if (options.knowledgeService) return options.knowledgeService;
    return createKnowledgeService({ root, now });
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

  function createLongPlans(
    root: string,
    workspaceService: WorkspaceService,
    modelClient: ModelClient | null,
    knowledgeService: KnowledgeService
  ): LongPlanService {
    if (options.longPlanService) return options.longPlanService;
    if (options.longPlanServiceFactory) {
      return options.longPlanServiceFactory(root, workspaceService, modelClient);
    }
    return createLongPlanService({
      root,
      workspaceService,
      modelClient,
      knowledgeService,
      now
    });
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
    const providerLabel =
      nextSettings.provider.kind === 'local-cli'
        ? nextSettings.provider.agent
        : nextSettings.provider.kind;

    function buildClient(provider: ProviderConfig, model: string): ModelClient | null {
      const resolved =
        options.modelClient !== undefined
          ? options.modelClient
          : resolveModelClient(provider, apiKey);
      return resolved
        ? createRecordingModelClient(
            resolved,
            (entry) => usageStore.record(entry),
            { provider: providerLabel, model }
          )
        : null;
    }

    const modelClient = buildClient(
      nextSettings.provider,
      nextSettings.provider.model ?? ''
    );
    const modelClientCache = new Map<string, ModelClient | null>();
    function modelClientFor(model: string): ModelClient | null {
      const trimmed = model.trim();
      if (!trimmed) return modelClient;
      if (modelClientCache.has(trimmed)) return modelClientCache.get(trimmed) ?? null;
      const overridden = { ...nextSettings.provider, model: trimmed } as ProviderConfig;
      const client = buildClient(overridden, trimmed);
      modelClientCache.set(trimmed, client);
      return client;
    }

    const memory = createMemory(nextSettings.vaultPath, modelClient);
    const knowledge = createKnowledge(nextSettings.vaultPath);
    const planner = createPlanner(nextSettings.vaultPath, workspace, modelClient);
    const longPlans = createLongPlans(
      nextSettings.vaultPath,
      workspace,
      modelClient,
      knowledge
    );
    const dependencies: ButlerFactoryDependencies = {
      workspaceService: workspace,
      provider: nextSettings.provider,
      apiKey,
      conversationStore,
      memoryService: memory,
      knowledgeService: knowledge,
      planner,
      modelClient,
      modelClientFor
    };
    const butler = createButler(nextSettings.vaultPath, dependencies);

    const checkIns = new ProactiveCheckInService({
      conversationStore,
      workspaceService: workspace,
      modelClient,
      getSettings: () => settings.get(),
      now
    });

    let searchInstance: SearchService | null = null;
    return {
      vaultPath: nextSettings.vaultPath,
      providerSignature: JSON.stringify(nextSettings.provider),
      workspace,
      butler,
      practice: createPractice(nextSettings.vaultPath),
      memory,
      knowledge,
      planner,
      longPlans,
      checkIns,
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

    async scanLocalClis() {
      return scanLocalClis();
    },

    async listWorkspaces() {
      return (await getServices()).workspace.listWorkspaces();
    },
    async createWorkspace(input) {
      return (await getServices()).workspace.createWorkspace(input);
    },
    async updateWorkspace(input) {
      const workspace = (await getServices()).workspace;
      if (!workspace.updateWorkspace) throw new Error('当前存储不支持更新项目。');
      return workspace.updateWorkspace(input);
    },
    async getWorkspaceSnapshot(workspaceId) {
      return (await getServices()).workspace.getWorkspaceSnapshot(workspaceId);
    },
    async createTask(input) {
      return (await getServices()).workspace.createTask(input);
    },
    async updateWorkspaceTask(input) {
      const services = await getServices();
      const task = await services.workspace.updateWorkspaceTask(input);
      if (task.status === 'done') {
        // Knowledge linking is additive metadata; the task write is authoritative.
        try {
          await services.knowledge.linkTask(task);
        } catch {
          // Keep the persisted task.
        }
      }
      return task;
    },
    async deleteTask(input) {
      const workspace = (await getServices()).workspace;
      if (!workspace.deleteTask) throw new Error('当前存储不支持删除任务。');
      return workspace.deleteTask(input);
    },
    async createNote(input) {
      const services = await getServices();
      const note = await services.workspace.createNote(input);
      try {
        await services.knowledge.linkNote(note);
      } catch {
        // Keep the persisted note.
      }
      return note;
    },
    async updateNote(input) {
      const services = await getServices();
      const note = await services.workspace.updateNote(input);
      try {
        await services.knowledge.linkNote(note);
      } catch {
        // Keep the persisted note.
      }
      return note;
    },
    async getMemory(workspaceId) {
      return (await getServices()).workspace.getMemory(workspaceId);
    },
    async getReminders() {
      return (await getServices()).workspace.getReminders();
    },
    async createReminder(input) {
      const workspace = (await getServices()).workspace;
      if (!workspace.createReminder) throw new Error('当前存储不支持提醒。');
      return workspace.createReminder(input);
    },
    async updateReminder(input) {
      const workspace = (await getServices()).workspace;
      if (!workspace.updateReminder) throw new Error('当前存储不支持提醒。');
      return workspace.updateReminder(input);
    },
    async deleteReminder(input) {
      const workspace = (await getServices()).workspace;
      if (!workspace.deleteReminder) throw new Error('当前存储不支持提醒。');
      return workspace.deleteReminder(input);
    },
    async submitReview(input) {
      const services = await getServices();
      await services.workspace.submitReview(input);
      try {
        await services.knowledge.linkReview({
          ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
          date: input.date,
          answers: input.answers
        });
      } catch {
        // Keep the persisted review; knowledge evidence can be linked later.
      }
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
    async listLongPlans(workspaceId) {
      return (await getServices()).longPlans.list(workspaceId);
    },
    async getLongPlan(planId) {
      return (await getServices()).longPlans.get(planId);
    },
    async createLongPlan(input) {
      return (await getServices()).longPlans.create(input);
    },
    async recalibrateLongPlan(input) {
      return (await getServices()).longPlans.recalibrate(input);
    },
    async setLongPlanItemDone(input) {
      return (await getServices()).longPlans.setItemDone(input);
    },
    async deleteLongPlan(planId) {
      await (await getServices()).longPlans.delete(planId);
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
    async updateMemory(input) {
      const memory = (await getServices()).memory;
      if (!memory.updateRecord) throw new Error('当前存储不支持编辑记忆。');
      return memory.updateRecord(input);
    },
    async createMemory(input) {
      const memory = (await getServices()).memory;
      if (!memory.createRecord) throw new Error('当前存储不支持新增记忆。');
      return memory.createRecord(input);
    },
    async deleteMemory(input) {
      const memory = (await getServices()).memory;
      if (!memory.deleteRecord) throw new Error('当前存储不支持编辑记忆。');
      await memory.deleteRecord(input);
    },
    async listKnowledgeTopics(workspaceId) {
      return (await getServices()).knowledge.list(workspaceId);
    },
    async createKnowledgeTopic(input) {
      return (await getServices()).knowledge.create(input);
    },
    async updateKnowledgeTopic(input) {
      return (await getServices()).knowledge.update(input);
    },
    async deleteKnowledgeTopic(id) {
      await (await getServices()).knowledge.delete(id);
    },
    async getKnowledgeNote(topicId) {
      return (await getServices()).knowledge.getNote(topicId);
    },
    async saveKnowledgeNote(input) {
      return (await getServices()).knowledge.saveNote(input);
    },
    async getKnowledgeBacklinks(topicId) {
      return (await getServices()).knowledge.getBacklinks(topicId);
    },
    async searchWorkspace(input) {
      return (await getServices()).search.search(input.workspaceId, input.query, input.limit);
    },
    async searchAll(input) {
      return (await getServices()).search.searchAll(input.query, input.limit);
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
    async renameConversation(id, title) {
      return conversationStore.rename(id, title);
    },
    async setConversationPinned(id, pinned) {
      return conversationStore.setPinned(id, pinned);
    },
    async truncateConversationMessages(id, keepCount) {
      return conversationStore.truncateMessages(id, keepCount);
    },
    async searchConversations(query) {
      return conversationStore.search(query);
    },
    async setConversationModel(id, model) {
      return conversationStore.setModel(id, model);
    },
    async getUsageSummary(days) {
      const requested =
        typeof days === 'number' && Number.isFinite(days) ? Math.trunc(days) : 7;
      const windowDays = Math.min(90, Math.max(1, requested));
      const [entries, current] = await Promise.all([usageStore.list(), settings.get()]);
      const summary = summarizeUsage(entries, windowDays, today());
      return {
        ...summary,
        estimatedCost: estimateUsageCost(
          summary.totals,
          current.budget.inputPricePerMillion,
          current.budget.outputPricePerMillion
        )
      };
    },
    async clearUsage() {
      await usageStore.clear();
    },
    onConversationOpened() {
      return () => undefined;
    },
    async send(input: SendMessageInput) {
      return (await getServices()).butler.send(input);
    },
    async stream(input, onEvent, options) {
      return (await getServices()).butler.stream(input, onEvent, options);
    },
    async cancelStream() {
      // Cancellation is handled by the IPC stream registry.
    }
  };

  const context: AppContext = {
    api,
    state,
    settings,
    secrets,
    conversationStore,
    usage: usageStore,
    get workspace() {
      if (!active) throw new Error('工作区服务尚未初始化。');
      return active.workspace;
    },
    get butler() {
      if (!active) throw new Error('阿咲服务尚未初始化。');
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
    get knowledge() {
      if (!active) throw new Error('知识库服务尚未初始化。');
      return active.knowledge;
    },
    get planner() {
      if (!active) throw new Error('计划服务尚未初始化。');
      return active.planner;
    },
    get longPlans() {
      if (!active) throw new Error('长期计划服务尚未初始化。');
      return active.longPlans;
    },
    get checkIns() {
      if (!active) throw new Error('检查服务尚未初始化。');
      return active.checkIns;
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
