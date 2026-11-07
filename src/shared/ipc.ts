import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CreateConversationInput
} from './conversations';
import type { KnowledgeApi } from './knowledge';
import type {
  CreateMemoryInput,
  DeleteMemoryInput,
  LearnerProfile,
  MemoryRecord,
  MemorySynthesisResult,
  SynthesizeMemoryInput,
  UpdateMemoryInput
} from './memory';
import type {
  CreatePracticeSetInput,
  DeletePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  ReviewMistakeInput,
  SetMistakeResolvedInput,
  SubmitAnswerInput,
  SubmitAnswerResult,
  UpdatePracticeSetInput
} from './practice';
import type { LongPlanApi } from './plans';
import type { PlanWorkspaceInput, WorkspacePlan } from './planning';
import type { SearchResult } from './search';
import type {
  AppSettings,
  NotificationSettings,
  ProviderConfig,
  ReviewAnswers
} from './types';
import type { LocalCliScanResult } from './local-cli';
import type { UsageSummary } from './usage';
import type {
  ButlerService,
  WorkspaceOnboardingInput,
  WorkspaceService
} from './workspace';

/** Pages the tray can open directly. */
export type AppNavigationTarget = 'review' | 'settings';

export interface Bootstrap {
  needsOnboarding: boolean;
  today: string;
  hasApiKey: boolean;
}

/** One persisted review entry, as written by `submitReview`. */
export interface ReviewRecord extends ReviewAnswers {
  /** Local calendar date (`YYYY-MM-DD`) of the review file. */
  date: string;
  submittedAt: string;
  workspaceId?: string;
}

export interface ListReviewsInput {
  /** When omitted, every workspace's reviews plus vault-wide reviews are read. */
  workspaceId?: string;
  /** Newest first; defaults to 30. */
  limit?: number;
}

export interface SearchWorkspaceInput {
  workspaceId: string;
  query: string;
  /** Defaults to the main-process search limit. */
  limit?: number;
}

export interface SearchAllInput {
  query: string;
  /** Defaults to the main-process search limit. */
  limit?: number;
}

/**
 * Renderer-facing practice contract. The main process delegates straight to
 * `PracticeService`, so the result shapes are the shared vault records.
 */
export interface PracticeApi {
  listPracticeSets(workspaceId: string): Promise<PracticeSet[]>;
  getPracticeSet(id: string): Promise<PracticeSet | null>;
  createPracticeSet(input: CreatePracticeSetInput): Promise<PracticeSet>;
  updatePracticeSet?(input: UpdatePracticeSetInput): Promise<PracticeSet>;
  deletePracticeSet?(input: DeletePracticeSetInput): Promise<void>;
  submitPracticeAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult>;
  reviewPracticeMistake?(input: ReviewMistakeInput): Promise<SubmitAnswerResult>;
  setPracticeMistakeResolved?(input: SetMistakeResolvedInput): Promise<PracticeMistake>;
  getPracticeMistakes(workspaceId: string): Promise<PracticeMistake[]>;
  getPracticeDue(input: { workspaceId: string; date: string }): Promise<PracticeMistake[]>;
  listPracticeAttempts(workspaceId: string): Promise<PracticeAttempt[]>;
}

/** Renderer-facing memory contract (vault-backed memory + learner profile). */
export interface MemoryApi {
  listMemory(workspaceId?: string): Promise<MemoryRecord[]>;
  synthesizeMemory(input: SynthesizeMemoryInput): Promise<MemorySynthesisResult>;
  getMemoryProfile(workspaceId?: string): Promise<LearnerProfile>;
  /** Adds a memory the user wrote by hand. */
  createMemory?(input: CreateMemoryInput): Promise<MemoryRecord>;
  updateMemory(input: UpdateMemoryInput): Promise<MemoryRecord>;
  deleteMemory(input: DeleteMemoryInput): Promise<void>;
}

/** Renderer-facing vault search. `rebuild` is exposed; `dispose` stays main-only. */
export interface SearchApi {
  searchWorkspace(input: SearchWorkspaceInput): Promise<SearchResult[]>;
  searchAll(input: SearchAllInput): Promise<SearchResult[]>;
  rebuildSearchIndex(): Promise<void>;
}

/** Planner over IPC: turns a workspace goal into validated tasks. */
export interface PlannerApi {
  planWorkspace(input: PlanWorkspaceInput): Promise<WorkspacePlan>;
}

/** Conversation persistence exposed to the renderer. */
export interface ConversationApi {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation | null>;
  createConversation(input?: CreateConversationInput): Promise<Conversation>;
  appendConversationMessage(
    id: string,
    message: ConversationMessage
  ): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  renameConversation(id: string, title: string): Promise<Conversation>;
  setConversationPinned(id: string, pinned: boolean): Promise<Conversation>;
  /** Keeps the first `keepCount` messages; used by regenerate and edit. */
  truncateConversationMessages(id: string, keepCount: number): Promise<Conversation>;
  searchConversations(query: string): Promise<ConversationSummary[]>;
  /** Per-conversation model override; null clears it (follow the global provider). */
  setConversationModel(id: string, model: string | null): Promise<Conversation>;
  /** Abort the in-flight turn identified by the renderer's assistant message id. */
  cancelStream(messageId: string): Promise<void>;
  /** Proactive check-ins ask the renderer to open a conversation. */
  onConversationOpened(listener: (conversationId: string) => void): () => void;
  /** Global shortcut / tray asks the renderer to open the quick capture dialog. */
  onQuickCapture?(listener: () => void): () => void;
  /** Tray menu asks the renderer to open a specific page. */
  onNavigate?(listener: (target: AppNavigationTarget) => void): () => void;
  /** Opens a native directory picker and writes a local backup. */
  exportBackup?(): Promise<BackupResult | null>;
  /** Opens a picker, snapshots current data, then restores a backup. */
  restoreBackup?(): Promise<RestoreResult | null>;
  /** Relaunches the app so a restore takes effect. */
  restartApp?(): Promise<void>;
}

/** Partial settings update; nested notifications/budget accept partials. */
export interface SettingsPatch {
  displayName?: string;
  vaultPath?: string;
  provider?: ProviderConfig;
  notifications?: Partial<NotificationSettings>;
  budget?: Partial<AppSettings['budget']>;
  launchAtLogin?: boolean;
}

/** Local-only usage accounting; nothing leaves this machine. */
export interface UsageApi {
  getUsageSummary(days?: number): Promise<UsageSummary>;
  clearUsage(): Promise<void>;
}

export interface BackupCopied {
  vault: boolean;
  conversations: boolean;
  state: boolean;
  usage: boolean;
}

/** Result of a local backup; the backup never contains secrets. */
export interface BackupResult {
  path: string;
  copied: BackupCopied;
}

/** Result of restoring a backup; settings and secrets are not overwritten. */
export interface RestoreResult {
  path: string;
  /** Snapshot of the data that was replaced. */
  safetyPath: string;
  restored: {
    vault: boolean;
    conversations: boolean;
    usage: boolean;
  };
}

export interface StudyCoachApi
  extends WorkspaceService,
    ButlerService,
    PracticeApi,
    MemoryApi,
    KnowledgeApi,
    SearchApi,
    PlannerApi,
    LongPlanApi,
    ConversationApi,
    UsageApi {
  getBootstrap(): Promise<Bootstrap>;
  completeWorkspaceOnboarding(input: WorkspaceOnboardingInput): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: SettingsPatch): Promise<AppSettings>;
  setApiKey(key: string): Promise<void>;
  /** Reads persisted review entries (newest first). */
  listReviews(input?: ListReviewsInput): Promise<ReviewRecord[]>;
  /** Discovers installed local CLI agents, their login state and capabilities. */
  scanLocalClis(): Promise<LocalCliScanResult>;
}
