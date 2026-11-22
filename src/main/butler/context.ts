import { isActiveKnowledgeTopic } from '../../shared/knowledge';
import type { KnowledgeService } from '../../shared/knowledge';
import type { CommitmentSummary } from '../../shared/notifications';
import type { CommitmentService } from '../commitments/service';
import { activeProfileEntries, type ProfileEntry, type ProfileService } from '../../shared/profile';
import type {
  MemoryItem,
  SendMessageInput,
  Workspace,
  WorkspaceService,
  WorkspaceTask
} from '../../shared/workspace';
import {
  attachKnowledgeNotes,
  type KnowledgeTopicContext
} from '../knowledge/context';

/** Read-only snapshot of the local data the butler may mention in a reply. */
export interface ButlerContext {
  now: Date;
  workspaces: Workspace[];
  workspace?: Workspace;
  workspaceId?: string;
  focusTask?: WorkspaceTask;
  tasks: WorkspaceTask[];
  memory: MemoryItem[];
  /** Active profile entries; confirmed first, model guesses marked. */
  profile: ProfileEntry[];
  /** Active topics (usually mastered + learning) the butler should remember. */
  knowledge: KnowledgeTopicContext[];
  /**
   * Open promises, oldest due first. Rendered as the bounded 未结案承诺 section;
   * absent/empty leaves the prompt byte-identical to the pre-commitments one.
   */
  commitments?: CommitmentSummary[];
  /** True when at least part of the local data could not be read. */
  contextError: boolean;
}

const MAX_CONTEXT_KNOWLEDGE = 15;
const MAX_CONTEXT_KNOWLEDGE_NOTES = 8;
const MAX_CONTEXT_NOTE_CHARS = 240;

function emptyContext(now: Date, contextError = false): ButlerContext {
  return {
    now,
    workspaces: [],
    tasks: [],
    memory: [],
    profile: [],
    knowledge: [],
    commitments: [],
    contextError
  };
}

/** Mastered first, then most recently touched; a broken vault means no topics. */
async function selectKnowledge(
  knowledgeService: KnowledgeService | null,
  workspaceId: string | undefined
): Promise<KnowledgeTopicContext[]> {
  if (knowledgeService === null) return [];
  try {
    const topics = await knowledgeService.list(workspaceId);
    const selected = topics
      .filter(isActiveKnowledgeTopic)
      .sort((a, b) => {
        const aMastered = a.status === 'mastered' ? 0 : 1;
        const bMastered = b.status === 'mastered' ? 0 : 1;
        return aMastered - bMastered || b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, MAX_CONTEXT_KNOWLEDGE);
    return attachKnowledgeNotes(selected, knowledgeService, {
      maxNotes: MAX_CONTEXT_KNOWLEDGE_NOTES,
      maxChars: MAX_CONTEXT_NOTE_CHARS
    });
  } catch {
    return [];
  }
}

/**
 * Collects workspace, task, memory, knowledge, and profile context. Context is
 * best-effort: a broken vault must never prevent the butler from replying.
 */
export async function gatherContext(
  workspaceService: WorkspaceService | null,
  input: SendMessageInput,
  now: Date,
  knowledgeService: KnowledgeService | null = null,
  profileService: ProfileService | null = null,
  commitmentService: CommitmentService | null = null
): Promise<ButlerContext> {
  const context = await collectContext(workspaceService, input, now);
  context.knowledge = await selectKnowledge(knowledgeService, input.workspaceId);
  context.profile = await selectProfile(profileService);
  context.commitments = await selectCommitments(commitmentService);
  return context;
}

/**
 * Open promises for the 未结案承诺 section. Best-effort: a broken commitments
 * file means no section, never a failed turn.
 */
async function selectCommitments(
  commitmentService: CommitmentService | null
): Promise<CommitmentSummary[]> {
  if (commitmentService === null) return [];
  try {
    return await commitmentService.listSummaries();
  } catch {
    return [];
  }
}

/** Stable profile facts; a model guess is included but marked as a candidate. */
async function selectProfile(profileService: ProfileService | null): Promise<ProfileEntry[]> {
  if (profileService === null) return [];
  try {
    return activeProfileEntries(await profileService.list());
  } catch {
    return [];
  }
}

async function collectContext(
  workspaceService: WorkspaceService | null,
  input: SendMessageInput,
  now: Date
): Promise<ButlerContext> {
  if (!workspaceService) {
    return emptyContext(now);
  }

  try {
    if (input.workspaceId) {
      const snapshot = await workspaceService.getWorkspaceSnapshot(input.workspaceId);
      return {
        now,
        workspaces: [snapshot.workspace],
        workspace: snapshot.workspace,
        workspaceId: snapshot.workspace.id,
        focusTask: input.taskId ? snapshot.tasks.find((task) => task.id === input.taskId) : undefined,
        tasks: snapshot.tasks,
        memory: snapshot.memory,
        profile: [],
        knowledge: [],
        contextError: false
      };
    }

    const workspaces = await workspaceService.listWorkspaces();
    const snapshots = await Promise.allSettled(
      workspaces.map((workspace) => workspaceService.getWorkspaceSnapshot(workspace.id))
    );
    const loaded = snapshots.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
    const tasks = loaded.flatMap((snapshot) => snapshot.tasks);
    const focusTask = input.taskId
      ? tasks.find((task) => task.id === input.taskId)
      : undefined;
    const focusWorkspace = focusTask
      ? loaded.find((snapshot) => snapshot.tasks.some((task) => task.id === focusTask.id))
          ?.workspace
      : undefined;

    return {
      now,
      workspaces,
      workspace: focusWorkspace,
      workspaceId: focusWorkspace?.id,
      focusTask,
      tasks,
      memory: loaded.flatMap((snapshot) => snapshot.memory),
      profile: [],
      knowledge: [],
      contextError: loaded.length < workspaces.length
    };
  } catch {
    return emptyContext(now, true);
  }
}
