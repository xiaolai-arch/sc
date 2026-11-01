
import { formatLocalDate } from '../../shared/date';
import type { MemoryService } from '../../shared/memory';
import type { WorkspacePlanner } from '../../shared/planning';
import type {
  WorkspaceKind,
  WorkspaceService,
  WorkspaceTaskStatus
} from '../../shared/workspace';
import type { ModelToolCall, ModelToolDefinition } from '../agent/model-client';

export interface ButlerToolContext {
  workspace: WorkspaceService;
  /** Workspace selected in the UI, used when a tool call omits workspaceId. */
  workspaceId?: string;
  memory?: MemoryService | null;
  planner?: WorkspacePlanner | null;
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

const WORKSPACE_KINDS: readonly WorkspaceKind[] = ['exam', 'study', 'project', 'life'];

/**
 * Minimal butler tool set. Every tool delegates to the injected
 * WorkspaceService so the same tools work against the real vault and fakes.
 */
export function createButlerTools(): ButlerToolDefinition[] {
  return [
    {
      name: 'create_workspace',
      description:
        '创建一个新的项目（workspace）。当用户说想考研、想学英语或想推进一个项目时，先收集名称、类型、目标和说明，再调用这个工具。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '项目名称，例如：考研' },
          kind: {
            type: 'string',
            enum: [...WORKSPACE_KINDS],
            description: '项目类型：exam / study / project / life'
          },
          goal: { type: 'string', description: '这个项目想达成的目标' },
          description: { type: 'string', description: '补充说明，可以为空' }
        },
        required: ['name', 'kind', 'goal'],
        additionalProperties: false
      },
      async execute(input, context) {
        const name = requiredString(input, 'name');
        const kind = requiredWorkspaceKind(input);
        const goal = optionalString(input, 'goal') ?? '';
        const description = optionalString(input, 'description') ?? '';
        const workspace = await context.workspace.createWorkspace({
          name,
          kind,
          goal,
          description
        });
        return {
          workspaceId: workspace.id,
          name: workspace.name,
          kind: workspace.kind,
          goal: workspace.goal
        };
      }
    },
    {
      name: 'create_task',
      description:
        '给当前项目创建一条任务。需要标题和时长；workspaceId 省略时使用当前对话的项目。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
          title: { type: 'string', description: '任务标题' },
          subject: { type: 'string', description: '科目或主题' },
          durationMin: { type: 'number', minimum: 1, description: '预计时长（分钟）' },
          acceptance: { type: 'string', description: '验收标准' },
          due: { type: 'string', description: '可选截止日期，YYYY-MM-DD' }
        },
        required: ['title', 'durationMin'],
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
        }
        const title = requiredString(input, 'title');
        const subject = optionalString(input, 'subject') ?? '学习';
        const durationMin = requiredPositiveNumber(input, 'durationMin');
        const acceptance = optionalString(input, 'acceptance') ?? '完成并记录结果';
        const due = optionalString(input, 'due');
        return context.workspace.createTask({
          workspaceId,
          title,
          subject,
          durationMin,
          acceptance,
          ...(due ? { due } : {})
        });
      }
    },
    {
      name: 'set_reminder',
      description:
        '创建一个提醒。time 使用 HH:MM（24 小时制），label 是提醒内容。提醒是全局的，不属于某个项目。',
      parameters: {
        type: 'object',
        properties: {
          time: { type: 'string', description: '提醒时间，HH:MM' },
          label: { type: 'string', description: '提醒内容' },
          enabled: { type: 'boolean', description: '是否启用，默认 true' }
        },
        required: ['time', 'label'],
        additionalProperties: false
      },
      async execute(input, context) {
        const createReminder = context.workspace.createReminder;
        if (!createReminder) {
          throw new ToolInputError('当前工作区不支持写入提醒。');
        }
        const time = requiredString(input, 'time');
        const label = requiredString(input, 'label');
        const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
        return createReminder.call(context.workspace, { time, label, enabled });
      }
    },
    {
      name: 'save_review',
      description:
        '保存一次复盘，并在有工作区时同步更新记忆。日期省略时使用今天；workspaceId 省略时使用当前项目。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '复盘日期 YYYY-MM-DD，省略为今天' },
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
          completed: { type: 'string', description: '今天完成了什么' },
          stuck: { type: 'string', description: '卡在哪里' },
          tomorrow: { type: 'string', description: '明天想怎么调整' }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const date = optionalString(input, 'date') ?? formatLocalDate(context.now());
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          throw new ToolInputError('date 必须是 YYYY-MM-DD。');
        }
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        const answers = {
          completed: optionalString(input, 'completed') ?? '',
          stuck: optionalString(input, 'stuck') ?? '',
          tomorrow: optionalString(input, 'tomorrow') ?? ''
        };
        await context.workspace.submitReview({
          date,
          ...(workspaceId ? { workspaceId } : {}),
          answers
        });
        if (!context.memory || !workspaceId) {
          return { date, workspaceId: workspaceId ?? null, answers, memory: [], generatedBy: null };
        }
        try {
          const result = await context.memory.synthesizeFromReview({
            workspaceId,
            date,
            answers
          });
          return {
            date,
            workspaceId,
            answers,
            memory: result.items,
            generatedBy: result.generatedBy
          };
        } catch (error) {
          return {
            date,
            workspaceId,
            answers,
            memory: [],
            generatedBy: null,
            memoryError: describeError(error)
          };
        }
      }
    },
    {
      name: 'plan_workspace',
      description:
        '用工作区 planner 生成一份今日/本周计划，并把计划中的任务写入当前项目。适合用户说「帮我排计划」时使用。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
          date: { type: 'string', description: '计划日期 YYYY-MM-DD，省略为今天' },
          availableMinutes: { type: 'number', minimum: 1, description: '今天可用总分钟数' }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
        }
        if (!context.planner) {
          throw new ToolInputError('当前没有可用的计划生成器。');
        }
        const date = optionalString(input, 'date');
        const availableMinutes = optionalNumber(input, 'availableMinutes');
        const plan = await context.planner.plan({
          workspaceId,
          ...(date ? { date } : {}),
          ...(availableMinutes !== undefined ? { availableMinutes } : {})
        });
        const tasks = [];
        for (const task of plan.tasks) {
          tasks.push(
            await context.workspace.createTask({
              workspaceId,
              title: task.title,
              subject: task.subject,
              durationMin: task.durationMin,
              acceptance: task.acceptance
            })
          );
        }
        return {
          workspaceId,
          date: plan.date,
          generatedBy: plan.generatedBy,
          tasks
        };
      }
    },
    {
      name: 'update_workspace',
      description:
        '更新当前项目的名称、目标或说明。只在用户明确要求修改项目信息时使用。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
          name: { type: 'string', description: '新的项目名称' },
          goal: { type: 'string', description: '新的项目目标' },
          description: { type: 'string', description: '新的项目说明' }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
        }
        const update = context.workspace.updateWorkspace;
        if (!update) {
          throw new ToolInputError('当前工作区不支持更新项目。');
        }
        const name = optionalString(input, 'name');
        const goal = optionalString(input, 'goal');
        const description = optionalString(input, 'description');
        if (name === undefined && goal === undefined && description === undefined) {
          throw new ToolInputError('至少提供 name / goal / description 之一。');
        }
        return update.call(context.workspace, {
          workspaceId,
          ...(name !== undefined ? { name } : {}),
          ...(goal !== undefined ? { goal } : {}),
          ...(description !== undefined ? { description } : {})
        });
      }
    },
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
            subject = '阿咲记录';
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
      description: '读取阿咲关于用户的长期记忆，可以按工作区过滤。',
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

function requiredWorkspaceKind(input: Record<string, unknown>): WorkspaceKind {
  const value = requiredString(input, 'kind');
  if (!(WORKSPACE_KINDS as readonly string[]).includes(value)) {
    throw new ToolInputError(`参数 kind 必须是 ${WORKSPACE_KINDS.join(' / ')} 之一。`);
  }
  return value as WorkspaceKind;
}

function requiredPositiveNumber(input: Record<string, unknown>, key: string): number {
  const value = optionalNumber(input, key);
  if (value === undefined || value <= 0) {
    throw new ToolInputError(`参数 ${key} 必须是正数。`);
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
