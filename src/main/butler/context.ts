import type { KnowledgeService, KnowledgeTopic } from '../../shared/knowledge';
import { isActiveKnowledgeTopic } from '../../shared/knowledge';
import type {
  MemoryItem,
  SendMessageInput,
  Workspace,
  WorkspaceService,
  WorkspaceTask
} from '../../shared/workspace';

/** Read-only snapshot of the local data the butler may mention in a reply. */
export interface ButlerContext {
  now: Date;
  workspaces: Workspace[];
  workspace?: Workspace;
  workspaceId?: string;
  focusTask?: WorkspaceTask;
  tasks: WorkspaceTask[];
  memory: MemoryItem[];
  /** Active topics (usually mastered + learning) the butler should remember. */
  knowledge: KnowledgeTopic[];
  /** True when at least part of the local data could not be read. */
  contextError: boolean;
}

const MAX_CONTEXT_KNOWLEDGE = 15;

function emptyContext(now: Date, contextError = false): ButlerContext {
  return { now, workspaces: [], tasks: [], memory: [], knowledge: [], contextError };
}

/** Mastered first, then most recently touched; a broken vault means no topics. */
async function selectKnowledge(
  knowledgeService: KnowledgeService | null,
  workspaceId: string | undefined
): Promise<KnowledgeTopic[]> {
  if (knowledgeService === null) return [];
  try {
    const topics = await knowledgeService.list(workspaceId);
    return topics
      .filter(isActiveKnowledgeTopic)
      .sort((a, b) => {
        const aMastered = a.status === 'mastered' ? 0 : 1;
        const bMastered = b.status === 'mastered' ? 0 : 1;
        return aMastered - bMastered || b.updatedAt.localeCompare(a.updatedAt);
      })
      .slice(0, MAX_CONTEXT_KNOWLEDGE);
  } catch {
    return [];
  }
}

/**
 * Collects workspace, task, memory, and knowledge context. Context is
 * best-effort: a broken vault must never prevent the butler from replying.
 */
export async function gatherContext(
  workspaceService: WorkspaceService | null,
  input: SendMessageInput,
  now: Date,
  knowledgeService: KnowledgeService | null = null
): Promise<ButlerContext> {
  const context = await collectContext(workspaceService, input, now);
  context.knowledge = await selectKnowledge(knowledgeService, input.workspaceId);
  return context;
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
      knowledge: [],
      contextError: loaded.length < workspaces.length
    };
  } catch {
    return emptyContext(now, true);
  }
}
