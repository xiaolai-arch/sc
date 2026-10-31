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
  /** True when at least part of the local data could not be read. */
  contextError: boolean;
}

function emptyContext(now: Date, contextError = false): ButlerContext {
  return { now, workspaces: [], tasks: [], memory: [], contextError };
}

/**
 * Collects workspace, task, and memory context. Context is best-effort:
 * a broken vault must never prevent the butler from replying.
 */
export async function gatherContext(
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
      contextError: loaded.length < workspaces.length
    };
  } catch {
    return emptyContext(now, true);
  }
}
