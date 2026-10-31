import { formatLocalDate } from '../../shared/date';
import type {
  WorkspaceService,
  WorkspaceTaskStatus
} from '../../shared/workspace';
import type { ModelToolCall, ModelToolDefinition } from '../agent/model-client';

export interface ButlerToolContext {
  workspace: WorkspaceService;
  /** Workspace selected in the UI, used when a tool call omits workspaceId. */
  workspaceId?: string;
  now: () => Date;
}

export interface ButlerToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool input. */
  parameters: Record<string, unknown>;
  execute(input: Record<string, unknown>, context: ButlerToolContext): Promise<unknown>;
}

export interface ButlerToolResult {
  ok: boolean;
  /** JSON text sent back to the model as the tool result. */
  content: string;
}

export class ToolInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolInputError';
  }
}

const TASK_STATUSES: readonly WorkspaceTaskStatus[] = [
  'pending',
  'in-progress',
  'done',
  'skipped'
];

/**
 * Minimal butler tool set. Every tool delegates to the injected
 * WorkspaceService so the same tools work against the real vault and fakes.
 */
export function createButlerTools(): ButlerToolDefinition[] {
  return [
    {
      name: 'get_today_plan',
      description:
        '读取今天的计划与任务。可以指定工作区；省略 workspaceId 时汇总所有工作区的任务。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: {
            type: 'string',
            description: '工作区 ID；省略时汇总所有工作区'
          }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const requested = optionalString(input, 'workspaceId') ?? context.workspaceId;
        const now = context.now();

        if (requested) {
          const snapshot = await context.workspace.getWorkspaceSnapshot(requested);
          return summarizePlan([snapshot], now, [snapshot.workspace.id]);
        }

        const workspaces = await context.workspace.listWorkspaces();
        const results = await Promise.allSettled(
          workspaces.map((workspace) => context.workspace.getWorkspaceSnapshot(workspace.id))
        );
        const snapshots = results.flatMap((result) =>
          result.status === 'fulfilled' ? [result.value] : []
        );
        if (workspaces.length > 0 && snapshots.length === 0) {
          throw new Error('读取工作区失败，暂时无法获取今日计划。');
        }
        return summarizePlan(
          snapshots,
          now,
          snapshots.map((snapshot) => snapshot.workspace.id)
        );
      }
    },
    {
      name: 'write_note',
      description:
        '把一条内容写入本地笔记。需要 title 和 body；workspaceId 省略时写入当前工作区。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: '工作区 ID；省略时使用当前工作区' },
          title: { type: 'string', description: '笔记标题' },
          body: { type: 'string', description: '笔记正文（markdown）' },
          subject: { type: 'string', description: '科目或主题；省略时使用工作区名称' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: '标签列表'
          },
          summary: { type: 'string', description: '一句话摘要' }
        },
        required: ['title', 'body'],
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先选择工作区，或说明要写到哪个工作区。');
        }
        const title = requiredString(input, 'title');
        const body = requiredString(input, 'body');
        const tags = optionalStringArray(input, 'tags');
        const summary = optionalString(input, 'summary');
        let subject = optionalString(input, 'subject');

        if (!subject) {
          try {
            const snapshot = await context.workspace.getWorkspaceSnapshot(workspaceId);
            subject = snapshot.workspace.name;
          } catch {
            subject = '管家记录';
          }
        }

        const note = await context.workspace.createNote({
          workspaceId,
          title,
          body,
          subject,
          ...(tags ? { tags } : {}),
          ...(summary ? { summary } : {})
        });

        return {
          noteId: note.id,
          workspaceId,
          title: note.title,
          path: note.path ?? null
        };
      }
    },
    {
      name: 'update_task',
      description:
        '更新任务状态（pending / in-progress / done / skipped），可以同时记录实际用时（分钟）。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 ID' },
          status: {
            type: 'string',
            enum: [...TASK_STATUSES],
            description: '新的任务状态'
          },
          actualMin: { type: 'number', minimum: 0, description: '实际用时（分钟）' }
        },
        required: ['taskId', 'status'],
        additionalProperties: false
      },
      async execute(input, context) {
        const taskId = requiredString(input, 'taskId');
        const status = requiredTaskStatus(input);
        const actualMin = optionalNumber(input, 'actualMin');

        return context.workspace.updateWorkspaceTask({
          taskId,
          status,
          ...(actualMin !== undefined ? { actualMin } : {})
        });
      }
    },
    {
      name: 'get_memory',
      description: '读取管家关于用户的长期记忆，可以按工作区过滤。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: {
            type: 'string',
            description: '工作区 ID；省略时读取全部记忆'
          }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        const items = await context.workspace.getMemory(workspaceId);
        return {
          workspaceId: workspaceId ?? null,
          count: items.length,
          items
        };
      }
    }
  ];
}

export function toModelToolDefinitions(tools: ButlerToolDefinition[]): ModelToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

/**
 * Executes one model-requested tool call. Failures are converted into a
 * tool result so the butler can explain the problem instead of throwing.
 */
export async function executeButlerTool(
  call: ModelToolCall,
  tools: ButlerToolDefinition[],
  context: ButlerToolContext
): Promise<ButlerToolResult> {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return {
      ok: false,
      content: toJson({ ok: false, tool: call.name, error: `未知工具：${call.name}` })
    };
  }

  try {
    const input = normalizeArguments(call.arguments);
    const result = await tool.execute(input, context);
    return { ok: true, content: toJson({ ok: true, result }) };
  } catch (error) {
    return {
      ok: false,
      content: toJson({ ok: false, tool: call.name, error: describeError(error) })
    };
  }
}

function summarizePlan(
  snapshots: Array<{
    workspace: { id: string; name: string; kind: string; goal: string };
    tasks: Array<{
      id: string;
      workspaceId: string;
      title: string;
      subject: string;
      durationMin: number;
      acceptance: string;
      status: WorkspaceTaskStatus;
      due?: string;
    }>;
  }>,
  now: Date,
  workspaceIds: string[]
) {
  const tasks = snapshots.flatMap((snapshot) => snapshot.tasks);
  const counts = {
    total: tasks.length,
    pending: tasks.filter((task) => task.status === 'pending').length,
    inProgress: tasks.filter((task) => task.status === 'in-progress').length,
    done: tasks.filter((task) => task.status === 'done').length,
    skipped: tasks.filter((task) => task.status === 'skipped').length
  };

  return {
    date: formatLocalDate(now),
    workspaceIds: Array.from(new Set(workspaceIds)),
    workspaces: snapshots.map((snapshot) => ({
      id: snapshot.workspace.id,
      name: snapshot.workspace.name,
      kind: snapshot.workspace.kind,
      goal: snapshot.workspace.goal
    })),
    counts,
    tasks: tasks.map((task) => ({
      id: task.id,
      workspaceId: task.workspaceId,
      title: task.title,
      subject: task.subject,
      durationMin: task.durationMin,
      acceptance: task.acceptance,
      status: task.status,
      due: task.due ?? null
    }))
  };
}

function normalizeArguments(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return normalizeArguments(parsed);
    } catch {
      throw new ToolInputError('工具参数不是合法的 JSON。');
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ToolInputError('工具参数必须是一个对象。');
  }
  return value as Record<string, unknown>;
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolInputError(`参数 ${key} 必须是字符串。`);
  }
  return value;
}

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (value === undefined || value.trim() === '') {
    throw new ToolInputError(`缺少参数 ${key}。`);
  }
  return value;
}

function optionalStringArray(
  input: Record<string, unknown>,
  key: string
): string[] | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new ToolInputError(`参数 ${key} 必须是字符串数组。`);
  }
  return value as string[];
}

function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ToolInputError(`参数 ${key} 必须是非负数字。`);
  }
  return value;
}

function requiredTaskStatus(input: Record<string, unknown>): WorkspaceTaskStatus {
  const value = requiredString(input, 'status');
  if (!(TASK_STATUSES as readonly string[]).includes(value)) {
    throw new ToolInputError(
      `参数 status 必须是 ${TASK_STATUSES.join(' / ')} 之一。`
    );
  }
  return value as WorkspaceTaskStatus;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: '工具结果无法序列化。' });
  }
}
