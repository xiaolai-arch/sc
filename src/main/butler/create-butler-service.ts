import type { ProviderConfig } from '../../shared/types';
import type { ButlerService, WorkspaceService } from '../../shared/workspace';
import {
  createModelClient,
  NoApiKeyError,
  type ModelClient
} from '../agent/model-client';
import { ButlerServiceImpl, type ButlerServiceOptions } from './butler-service';
import type { ConversationStore } from '../conversations/conversation-store';
import type { KnowledgeService } from '../../shared/knowledge';
import type { MemoryService } from '../../shared/memory';
import type { ProfileService } from '../../shared/profile';
import type { PracticeService } from '../../shared/practice';
import type { SearchService } from '../../shared/search';
import type { WorkspacePlanner } from '../../shared/planning';
import type { LongPlanService } from '../../shared/plans';

export interface CreateButlerServiceOptions {
  /**
   * Injected vault-backed workspace service. The workspace module owns the
   * implementation; the butler only depends on the interface.
   */
  workspaceService?: WorkspaceService | null;
  /** Pre-built model client. Takes precedence over provider/apiKey. */
  modelClient?: ModelClient | null;
  /** Builds a client for a conversation-level model override. */
  modelClientFor?: (model: string) => ModelClient | null;
  /** Optional conversation store used to load history and persist replies. */
  conversationStore?: ConversationStore | null;
  memoryService?: MemoryService | null;
  planner?: WorkspacePlanner | null;
  longPlanService?: LongPlanService | null;
  knowledgeService?: KnowledgeService | null;
  profileService?: ProfileService | null;
  practiceService?: PracticeService | null;
  getSearchService?: (() => SearchService | null) | null;
  provider?: ProviderConfig;
  /** Kept in memory only; never logged, stored, or echoed in replies. */
  apiKey?: string | null;
  now?: () => Date;
  maxToolSteps?: number;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Creates the butler service. The workspace root is accepted for parity with
 * the IPC module's factory call; the actual vault service is injected.
 */
export function createButlerService(
  workspaceRoot: string,
  options: CreateButlerServiceOptions = {}
): ButlerService {
  const modelClient =
    options.modelClient !== undefined
      ? options.modelClient
      : options.provider
        ? resolveModelClient(options.provider, options.apiKey ?? null)
        : null;

  const serviceOptions: ButlerServiceOptions = {
    workspaceService: options.workspaceService ?? null,
    workspaceRoot,
    modelClient,
    ...(options.modelClientFor ? { modelClientFor: options.modelClientFor } : {}),
    ...(options.conversationStore !== undefined
      ? { conversationStore: options.conversationStore }
      : {}),
    ...(options.memoryService !== undefined ? { memoryService: options.memoryService } : {}),
    ...(options.planner !== undefined ? { planner: options.planner } : {}),
    ...(options.longPlanService !== undefined
      ? { longPlanService: options.longPlanService }
      : {}),
    ...(options.knowledgeService !== undefined
      ? { knowledgeService: options.knowledgeService }
      : {}),
    ...(options.profileService !== undefined
      ? { profileService: options.profileService }
      : {}),
    ...(options.practiceService !== undefined
      ? { practiceService: options.practiceService }
      : {}),
    ...(options.getSearchService !== undefined
      ? { getSearchService: options.getSearchService }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.maxToolSteps !== undefined ? { maxToolSteps: options.maxToolSteps } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {})
  };

  return new ButlerServiceImpl(serviceOptions);
}

function resolveModelClient(
  provider: ProviderConfig,
  apiKey: string | null
): ModelClient | null {
  try {
    return createModelClient(provider, apiKey);
  } catch (error) {
    // Missing credentials are an expected state: fall back to template replies.
    if (error instanceof NoApiKeyError) {
      return null;
    }
    throw error;
  }
}
