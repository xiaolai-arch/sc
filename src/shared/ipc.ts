import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CreateConversationInput
} from './conversations';
import type {
  DeleteMemoryInput,
  LearnerProfile,
  MemoryRecord,
  MemorySynthesisResult,
  SynthesizeMemoryInput,
  UpdateMemoryInput
} from './memory';
import type {
  CreatePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult
} from './practice';
import type { PlanWorkspaceInput, WorkspacePlan } from './planning';
import type { SearchResult } from './search';
import type {
  AppSettings,
  NotificationSettings,
  ProviderConfig,
  ReviewAnswers
} from './types';
import type {
  ButlerService,
  WorkspaceOnboardingInput,
  WorkspaceService
} from './workspace';

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

/**
 * Renderer-facing practice contract. The main process delegates straight to
 * `PracticeService`, so the result shapes are the shared vault records.
 */
export interface PracticeApi {
  listPracticeSets(workspaceId: string): Promise<PracticeSet[]>;
  getPracticeSet(id: string): Promise<PracticeSet | null>;
  createPracticeSet(input: CreatePracticeSetInput): Promise<PracticeSet>;
  submitPracticeAnswer(input: SubmitAnswerInput): Promise<SubmitAnswerResult>;
  getPracticeMistakes(workspaceId: string): Promise<PracticeMistake[]>;
  getPracticeDue(input: { workspaceId: string; date: string }): Promise<PracticeMistake[]>;
  listPracticeAttempts(workspaceId: string): Promise<PracticeAttempt[]>;
}

/** Renderer-facing memory contract (vault-backed memory + learner profile). */
export interface MemoryApi {
  listMemory(workspaceId?: string): Promise<MemoryRecord[]>;
  synthesizeMemory(input: SynthesizeMemoryInput): Promise<MemorySynthesisResult>;
  getMemoryProfile(workspaceId?: string): Promise<LearnerProfile>;
  updateMemory(input: UpdateMemoryInput): Promise<MemoryRecord>;
  deleteMemory(input: DeleteMemoryInput): Promise<void>;
}

/** Renderer-facing vault search. `rebuild` is exposed; `dispose` stays main-only. */
export interface SearchApi {
  searchWorkspace(input: SearchWorkspaceInput): Promise<SearchResult[]>;
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
  /** Abort the in-flight turn identified by the renderer's assistant message id. */
  cancelStream(messageId: string): Promise<void>;
  /** Proactive check-ins ask the renderer to open a conversation. */
  onConversationOpened(listener: (conversationId: string) => void): () => void;
  /** Global shortcut / tray asks the renderer to open the quick capture dialog. */
  onQuickCapture?(listener: () => void): () => void;
}

/** Partial settings update; nested notifications/budget accept partials. */
export interface SettingsPatch {
  vaultPath?: string;
  provider?: ProviderConfig;
  notifications?: Partial<NotificationSettings>;
  budget?: Partial<AppSettings['budget']>;
  launchAtLogin?: boolean;
}

export interface StudyCoachApi
  extends WorkspaceService,
    ButlerService,
    PracticeApi,
    MemoryApi,
    SearchApi,
    PlannerApi,
    ConversationApi {
  getBootstrap(): Promise<Bootstrap>;
  completeWorkspaceOnboarding(input: WorkspaceOnboardingInput): Promise<void>;
  getSettings(): Promise<AppSettings>;
  updateSettings(patch: SettingsPatch): Promise<AppSettings>;
  setApiKey(key: string): Promise<void>;
  /** Reads persisted review entries (newest first). */
  listReviews(input?: ListReviewsInput): Promise<ReviewRecord[]>;
}
