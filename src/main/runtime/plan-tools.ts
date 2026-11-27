import { formatLocalDate, isLocalDate } from '../../shared/date';
import { busyDayMinutes } from '../planning';
import { ToolInputError, type ButlerToolContext } from '../butler/tools';
import type { GatewayToolEntry } from './tool-gateway';

/**
 * `plan_workspace` 拆分（spec P0 / 默认决定 3）：只读预览（零写盘）与写入提交
 * 两个新工具。旧 `plan_workspace` 本体不动（那归 item 66），这里不复用其执行
 * 体——预览的读取半段按当前实现重写，提交按预览结果建任务，并且必须把
 * `plan.date` 作为 `due` 传给 createTask（QA item 66 P1-1 的根因不复制）。
 */

/** Mirrors the un-exported helpers in butler/tools.ts (kept byte-identical there). */
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

function requiredString(input: Record<string, unknown>, key: string): string {
  const value = optionalString(input, key);
  if (value === undefined || value.trim() === '') {
    throw new ToolInputError(`缺少参数 ${key}。`);
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  throw error;
}

/** One task row a commit may write; matches `WorkspacePlanTask`. */
interface CommitTaskInput {
  title: string;
  subject: string;
  durationMin: number;
  acceptance: string;
}

export function buildPlanPreviewTool(): GatewayToolEntry {
  return {
    name: 'plan_preview',
    level: 'query',
    description:
      '用项目 planner 生成一份今日/本周计划预览（只读，不写入任何任务）。适合用户说「帮我排计划」时先给用户看；用户确认后再用 commit_plan 写入。',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
        date: { type: 'string', description: '计划日期 YYYY-MM-DD，省略为今天' },
        availableMinutes: { type: 'number', minimum: 1, description: '今天可用总分钟数' }
      },
      additionalProperties: false
    },
    async execute(input: Record<string, unknown>, context: ButlerToolContext): Promise<unknown> {
      // Read-only by contract: everything below only reads (planner reads the
      // workspace snapshot; availability read is best-effort). No createTask.
      const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
      if (!workspaceId) {
        throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
      }
      if (!context.planner) {
        throw new ToolInputError('当前没有可用的计划生成器。');
      }
      const date = optionalString(input, 'date');
      const availableMinutes = optionalNumber(input, 'availableMinutes');
      // The plan's day is resolved once and handed to both the busy-day read
      // and the planner, so the two can never disagree across a midnight
      // millisecond boundary when the caller omitted the date (same shape as
      // the legacy tool; the day comes from the run's unified `now`).
      const planDate = date ?? formatLocalDate(context.now());
      const weekAvailabilityMinutes =
        availableMinutes === undefined && context.weekAvailability
          ? await busyDayMinutes(context.weekAvailability, planDate)
          : undefined;
      const plan = await context.planner.plan({
        workspaceId,
        date: planDate,
        ...(availableMinutes !== undefined ? { availableMinutes } : {}),
        ...(weekAvailabilityMinutes !== undefined ? { weekAvailabilityMinutes } : {}),
        ...(context.signal ? { signal: context.signal } : {})
      });
      throwIfAborted(context.signal);
      return {
        workspaceId,
        date: plan.date,
        generatedBy: plan.generatedBy,
        availableMinutes: plan.availableMinutes,
        availableMinutesSource: plan.availableMinutesSource,
        tasks: plan.tasks
      };
    }
  };
}

export function buildCommitPlanTool(): GatewayToolEntry {
  return {
    name: 'commit_plan',
    level: 'confirm',
    description:
      '把 plan_preview 生成的计划写入项目（按预览的任务清单逐条创建任务，任务的到期日即计划日期）。仅在用户看过预览并确认后调用。',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
        date: { type: 'string', description: '计划日期 YYYY-MM-DD（与 plan_preview 返回的 date 一致）' },
        tasks: {
          type: 'array',
          description: 'plan_preview 返回的 tasks，逐条原样传入',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              subject: { type: 'string' },
              durationMin: { type: 'number' },
              acceptance: { type: 'string' }
            },
            required: ['title', 'subject', 'durationMin', 'acceptance'],
            additionalProperties: false
          }
        }
      },
      required: ['date', 'tasks'],
      additionalProperties: false
    },
    async execute(input: Record<string, unknown>, context: ButlerToolContext): Promise<unknown> {
      const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
      if (!workspaceId) {
        throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
      }
      // QA item 66 P1-1 的根因不复制：计划的日期必须原样成为任务的 due。
      const due = requiredString(input, 'date');
      if (!isLocalDate(due)) {
        throw new ToolInputError('参数 date 必须是 YYYY-MM-DD。');
      }
      const rawTasks = input['tasks'];
      if (!Array.isArray(rawTasks) || rawTasks.length === 0) {
        throw new ToolInputError('参数 tasks 必须是非空数组。');
      }
      const tasks: CommitTaskInput[] = rawTasks.map((entry, index) => {
        if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
          throw new ToolInputError(`参数 tasks[${index}] 必须是对象。`);
        }
        const row = entry as Record<string, unknown>;
        const title = requiredString(row, 'title');
        const subject = requiredString(row, 'subject');
        const durationMin = optionalNumber(row, 'durationMin');
        if (durationMin === undefined || durationMin < 1) {
          throw new ToolInputError(`参数 tasks[${index}].durationMin 必须是正数。`);
        }
        const acceptance = requiredString(row, 'acceptance');
        return { title, subject, durationMin, acceptance };
      });
      const created: unknown[] = [];
      for (const task of tasks) {
        throwIfAborted(context.signal);
        created.push(
          await context.workspace.createTask({
            workspaceId,
            title: task.title,
            subject: task.subject,
            durationMin: task.durationMin,
            acceptance: task.acceptance,
            due
          })
        );
      }
      throwIfAborted(context.signal);
      return { workspaceId, date: due, created: created.length, tasks: created };
    }
  };
}
