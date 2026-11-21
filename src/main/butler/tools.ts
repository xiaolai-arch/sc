import { formatLocalDate } from '../../shared/date';
import type { AgentPermissions } from '../../shared/attachments';
import type { AvailabilityService } from '../availability/service';
import { isMonday, weekdayWord, type WeekAvailability } from '../availability/records';
import {
  resolveKnowledgeLink,
  type KnowledgeService,
  type KnowledgeStatus
} from '../../shared/knowledge';
import type { MemoryService } from '../../shared/memory';
import { isProfileCategory, type ProfileService } from '../../shared/profile';
import type { CommitmentService } from '../commitments/service';
import type { Commitment } from '../commitments/records';
import {
  MAX_COMMITMENT_TEXT,
  resolveCommitmentDue
} from '../commitments/records';
import type {
  CreatePracticeQuestionInput,
  PracticeService
} from '../../shared/practice';
import type { WorkspacePlanner } from '../../shared/planning';
import type { LongPlanService } from '../../shared/plans';
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
  profile?: ProfileService | null;
  planner?: WorkspacePlanner | null;
  /** Long-plan service; absent in tests without plan persistence. */
  longPlans?: LongPlanService | null;
  knowledge?: KnowledgeService | null;
  /** Practice sets/attempts/mistakes; absent in tests without a practice vault. */
  practice?: PracticeService | null;
  /** Promises the user made in their own words; absent disables both tools. */
  commitments?: CommitmentService | null;
  /** Days of a week the user said are packed; absent disables the tool. */
  weekAvailability?: AvailabilityService | null;
  /**
   * The turn's permission level. When present, write tools are refused without
   * `write`; tools marked `requiresWeb` also need `web`. Absent means the caller
   * (tests, internal jobs) already decided the tool may run.
   */
  permissions?: AgentPermissions;
  now: () => Date;
  /** Stop generation must prevent starting or continuing tool work. */
  signal?: AbortSignal;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  throw error;
}

export interface ButlerToolDefinition {
  name: string;
  description: string;
  /** JSON Schema object describing the tool input. */
  parameters: Record<string, unknown>;
  /** True (the default) when the tool changes the vault. */
  requiresWrite?: boolean;
  /** True when the tool may reach the network. */
  requiresWeb?: boolean;
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

const KNOWLEDGE_STATUSES: readonly KnowledgeStatus[] = [
  'planned',
  'learning',
  'mastered',
  'paused'
];

const KNOWLEDGE_STATUS_LABELS: Record<KnowledgeStatus, string> = {
  planned: '计划中',
  learning: '在学',
  mastered: '已掌握',
  paused: '暂停'
};

/** Practice overview window: the current Monday week plus the seven before it. */
const PRACTICE_OVERVIEW_WEEKS = 8;
const UNKNOWN_PRACTICE_SUBJECT = '未分类';

/** Running per-subject totals while the overview is assembled. */
interface PracticeOverviewRow {
  subject: string;
  setCount: number;
  attemptCount: number;
  recentAnswered: number;
  recentCorrect: number;
  activeMistakes: number;
}

/** Same Monday-based week the renderer's accuracy trend uses. */
function startOfPracticeWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  // getDay(): 0 = Sunday; shift so Monday starts the week.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function practiceSubject(subject: string | undefined): string {
  const trimmed = (subject ?? '').trim();
  return trimmed === '' ? UNKNOWN_PRACTICE_SUBJECT : trimmed;
}

/** Evidence linking is additive; a broken knowledge file must not fail the tool. */
async function linkKnowledge(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch {
    // Keep the source write.
  }
}

/** Revisit windows are bounded so a stray model number cannot hide a topic for months. */
function clampRevisitDays(value: number | undefined): number {
  return Math.min(30, Math.max(1, Math.round(value ?? 1)));
}

/** Local calendar arithmetic; crossing month and year boundaries stays exact. */
function addLocalDays(date: Date, days: number): string {
  const due = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return formatLocalDate(due);
}

/** One knowledge topic the butler should offer to retrieve today. */
interface DueRevisit {
  topicId: string;
  name: string;
  /** The (possibly overdue) revisit date, so the butler can say "过期 N 天". */
  revisitDue: string;
}

/** Due-revisit cap: a real butler day never has more; bounds the tool output. */
const MAX_DUE_REVISITS = 5;

/**
 * Topics whose `revisitDue` is today or earlier. Best-effort: a broken
 * knowledge service must never hide today's plan, so any failure is empty.
 */
async function dueRevisits(
  context: ButlerToolContext,
  now: Date
): Promise<DueRevisit[]> {
  const knowledge = context.knowledge;
  if (!knowledge) return [];
  try {
    const today = formatLocalDate(now);
    const topics = await knowledge.list();
    return topics
      .filter((topic) => topic.revisitDue !== undefined && topic.revisitDue <= today)
      .sort((a, b) => (a.revisitDue ?? '').localeCompare(b.revisitDue ?? ''))
      .slice(0, MAX_DUE_REVISITS)
      .map((topic) => ({
        topicId: topic.id,
        name: topic.name,
        revisitDue: topic.revisitDue as string
      }));
  } catch {
    return [];
  }
}

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
          due: { type: 'string', description: '可选截止日期，YYYY-MM-DD' },
          cue: {
            type: 'string',
            description:
              '可选：这件事在什么情境下做，例如「晚饭后」「到自习室」；会作为 if-then 计划显示在今日页'
          },
          startAt: {
            type: 'string',
            description: '可选开始时间，YYYY-MM-DDTHH:mm（本地时间），用于固定到今日时间表'
          }
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
        const cue = optionalString(input, 'cue');
        const startAt = optionalString(input, 'startAt');
        return context.workspace.createTask({
          workspaceId,
          title,
          subject,
          durationMin,
          acceptance,
          ...(due ? { due } : {}),
          ...(cue ? { cue } : {}),
          ...(startAt ? { startAt } : {})
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
        if (context.knowledge) {
          const knowledge = context.knowledge;
          await linkKnowledge(() =>
            knowledge.linkReview({
              ...(workspaceId ? { workspaceId } : {}),
              date,
              answers
            })
          );
        }
        if (!context.memory || !workspaceId) {
          return { date, workspaceId: workspaceId ?? null, answers, memory: [], generatedBy: null };
        }
        try {
          const result = await context.memory.synthesizeFromReview({
            workspaceId,
            date,
            answers,
            ...(context.signal ? { signal: context.signal } : {})
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
          ...(availableMinutes !== undefined ? { availableMinutes } : {}),
          ...(context.signal ? { signal: context.signal } : {})
        });
        throwIfAborted(context.signal);
        const tasks = [];
        for (const task of plan.tasks) {
          throwIfAborted(context.signal);
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
          availableMinutes: plan.availableMinutes,
          availableMinutesSource: plan.availableMinutesSource,
          tasks
        };
      }
    },
    {
      name: 'create_long_plan',
      description:
        '为项目生成一份跨周的长期计划（写入长期计划页）。用户要「未来几周 / 到某个日期 / 阶段性」计划时使用；需要先有项目（workspace）。',
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' },
          goal: { type: 'string', description: '计划目标；省略时使用项目目标' },
          weeks: { type: 'number', minimum: 1, maximum: 16, description: '计划周数（1-16）' },
          weeklyHours: { type: 'number', minimum: 1, description: '每周可投入小时数' },
          startDate: { type: 'string', description: '开始日期 YYYY-MM-DD；省略为今天' },
          notes: { type: 'string', description: '背景信息：当前水平、约束、可用时间等' },
          research: {
            type: 'boolean',
            description: '生成前是否联网调研；用户要求核实信息时设为 true'
          }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
        }
        if (!context.longPlans) {
          throw new ToolInputError('当前没有可用的长期计划服务。');
        }
        throwIfAborted(context.signal);
        const workspace = await context.workspace.getWorkspaceSnapshot(workspaceId);
        const goal = optionalString(input, 'goal') ?? workspace.workspace.goal;
        if (!goal) {
          throw new ToolInputError('缺少 goal：请提供计划目标，或先在项目中设置目标。');
        }
        const weeks = Math.min(16, Math.max(1, Math.round(optionalNumber(input, 'weeks') ?? 4)));
        const rawWeeklyHours = optionalNumber(input, 'weeklyHours');
        const weeklyHours =
          rawWeeklyHours !== undefined && rawWeeklyHours > 0
            ? rawWeeklyHours
            : undefined;
        const rawStartDate = optionalString(input, 'startDate');
        if (rawStartDate !== undefined && !isIsoDate(rawStartDate)) {
          throw new ToolInputError('参数 startDate 必须是 YYYY-MM-DD。');
        }
        const notes = optionalString(input, 'notes');
        const research = input['research'] === true;
        if (research && context.permissions?.web === false) {
          throw new ToolInputError('当前权限不允许联网调研，请去掉 research 或让用户开启联网。');
        }
        const plan = await context.longPlans.create({
          workspaceId,
          goal,
          weeks,
          ...(weeklyHours !== undefined ? { weeklyHours } : {}),
          ...(rawStartDate !== undefined ? { startDate: rawStartDate } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(research ? { research: true } : {})
        });
        return {
          planId: plan.id,
          workspaceId: plan.workspaceId,
          goal: plan.goal,
          startDate: plan.startDate,
          weeks: plan.weeks,
          weeklyHours: plan.weeklyHours,
          phases: plan.phases.map((phase) => ({
            id: phase.id,
            title: phase.title,
            weeks: phase.weeks.map((week) => ({
              id: week.id,
              number: week.number,
              title: week.title,
              startDate: week.startDate,
              endDate: week.endDate
            }))
          }))
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
          description: { type: 'string', description: '新的项目说明' },
          availableMinutes: {
            type: 'number',
            minimum: 5,
            maximum: 1440,
            description: '用户每天可用的分钟数；用户说「每天只有一小时」时传 60'
          }
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
        const availableMinutes = optionalNumber(input, 'availableMinutes');
        if (
          name === undefined &&
          goal === undefined &&
          description === undefined &&
          availableMinutes === undefined
        ) {
          throw new ToolInputError('至少提供 name / goal / description / availableMinutes 之一。');
        }
        return update.call(context.workspace, {
          workspaceId,
          ...(name !== undefined ? { name } : {}),
          ...(goal !== undefined ? { goal } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(availableMinutes !== undefined
            ? { availableMinutes: Math.round(availableMinutes) }
            : {})
        });
      }
    },
    {
      name: 'get_today_plan',
      description:
        '读取今天的计划与任务，以及到了回访日的知识主题（revisits：今天该让学习者自测的主题，主动提议抽几道题）。可以指定工作区；省略 workspaceId 时汇总所有工作区的任务。',
      requiresWrite: false,
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
          return summarizePlan(
            [snapshot],
            now,
            [snapshot.workspace.id],
            await dueRevisits(context, now)
          );
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
          snapshots.map((snapshot) => snapshot.workspace.id),
          await dueRevisits(context, now)
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
        if (context.knowledge) {
          const knowledge = context.knowledge;
          await linkKnowledge(() => knowledge.linkNote(note));
        }

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
        '更新任务状态（pending / in-progress / done / skipped）、记录实际用时，或把任务固定到某个开始时间（startAt）。',
      parameters: {
        type: 'object',
        properties: {
          taskId: { type: 'string', description: '任务 ID' },
          status: {
            type: 'string',
            enum: [...TASK_STATUSES],
            description: '新的任务状态'
          },
          actualMin: { type: 'number', minimum: 0, description: '实际用时（分钟）' },
          cue: {
            type: 'string',
            description:
              '可选：这件事在什么情境下做，例如「晚饭后」「到自习室」；会作为 if-then 计划显示在今日页。省略保持不变，传 null 清除'
          },
          startAt: {
            type: 'string',
            description: '开始时间，YYYY-MM-DDTHH:mm（本地时间）；传 null 清除固定时间'
          }
        },
        required: ['taskId'],
        additionalProperties: false
      },
      async execute(input, context) {
        const taskId = requiredString(input, 'taskId');
        const status = input.status === undefined ? undefined : requiredTaskStatus(input);
        const actualMin = optionalNumber(input, 'actualMin');
        const cue = input.cue === null ? null : optionalString(input, 'cue');
        const startAt =
          input.startAt === null ? null : optionalString(input, 'startAt');
        if (
          status === undefined &&
          startAt === undefined &&
          actualMin === undefined &&
          cue === undefined
        ) {
          throw new ToolInputError('请提供 status、startAt、actualMin 或 cue 中的至少一项。');
        }

        const task = await context.workspace.updateWorkspaceTask({
          taskId,
          ...(status !== undefined ? { status } : {}),
          ...(startAt !== undefined ? { startAt } : {}),
          ...(actualMin !== undefined ? { actualMin } : {}),
          ...(cue !== undefined ? { cue } : {})
        });
        if (task.status === 'done' && context.knowledge) {
          const knowledge = context.knowledge;
          await linkKnowledge(() => knowledge.linkTask(task));
        }
        return task;
      }
    },
    {
      name: 'get_memory',
      description: '读取阿咲关于用户的长期记忆，可以按工作区过滤。',
      requiresWrite: false,
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
    },
    {
      name: 'record_knowledge',
      description: '记录用户已经学过或正在学的主题，供长期规划和回答参考。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '知识主题名称，例如：LangChain' },
          status: {
            type: 'string',
            enum: [...KNOWLEDGE_STATUSES],
            description: '掌握状态；新建主题时默认 learning'
          },
          level: { type: 'number', minimum: 1, maximum: 5, description: '掌握程度 1-5' },
          note: { type: 'string', description: '这次提到它的上下文，例如今天学了什么' },
          workspaceId: {
            type: 'string',
            description: '工作区 ID；省略时使用当前工作区，也没有则为全局主题'
          }
        },
        required: ['name'],
        additionalProperties: false
      },
      async execute(input, context) {
        const name = requiredString(input, 'name');
        if (!context.knowledge) {
          throw new ToolInputError('知识库未连接。');
        }
        let status: KnowledgeStatus | undefined;
        if (input.status !== undefined) {
          if (
            typeof input.status !== 'string' ||
            !(KNOWLEDGE_STATUSES as readonly string[]).includes(input.status)
          ) {
            throw new ToolInputError(
              `status 必须是 ${KNOWLEDGE_STATUSES.join(' / ')} 之一。`
            );
          }
          status = input.status as KnowledgeStatus;
        }
        const level = optionalNumber(input, 'level');
        if (
          level !== undefined &&
          (!Number.isInteger(level) || level < 1 || level > 5)
        ) {
          throw new ToolInputError('level 必须是 1-5 的整数。');
        }
        const note = optionalString(input, 'note');
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        const topic = await context.knowledge.record({
          name,
          ...(status ? { status } : {}),
          ...(level !== undefined ? { level } : {}),
          ...(note ? { note } : {}),
          ...(workspaceId ? { workspaceId } : {})
        });
        throwIfAborted(context.signal);
        return {
          ok: true,
          topic,
          message: `已记录：${topic.name}（${KNOWLEDGE_STATUS_LABELS[topic.status]}）`
        };
      }
    },
    {
      name: 'schedule_revisit',
      description:
        '给一个已记录的知识主题安排一次回访自测：把该主题标记为几天后需要回忆练习，到期后会出现在今日页。刚讲完并确认学习者真正学会了一个主题时调用；name 必须是知识库里已有的主题。',
      requiresWrite: true,
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '知识主题名称，必须与知识库中的主题一致，例如：LangChain' },
          days: {
            type: 'number',
            minimum: 1,
            maximum: 30,
            description: '几天后回访（1-30）；省略为明天'
          }
        },
        required: ['name'],
        additionalProperties: false
      },
      async execute(input, context) {
        const name = requiredString(input, 'name');
        if (!context.knowledge) {
          throw new ToolInputError('知识库未连接。');
        }
        const knowledge = context.knowledge;
        const days = clampRevisitDays(optionalNumber(input, 'days'));
        const dueDate = addLocalDays(context.now(), days);
        throwIfAborted(context.signal);
        const topics = await knowledge.list();
        throwIfAborted(context.signal);
        const topic = resolveKnowledgeLink(topics, name);
        if (!topic) {
          throw new ToolInputError(
            `知识库里没有「${name}」这个主题；先用 record_knowledge 记录，再安排回访。`
          );
        }
        const updated = await knowledge.update({ id: topic.id, revisitDue: dueDate });
        throwIfAborted(context.signal);
        const when = days === 1 ? '明天' : `${days} 天后（${dueDate}）`;
        return {
          ok: true,
          topicId: updated.id,
          name: updated.name,
          revisitDue: dueDate,
          message: `已安排：${when}抽 5 分钟自测「${updated.name}」。`
        };
      }
    },
    {
      name: 'record_commitment',
      description:
        '记录用户亲口说出的一条承诺（例如「我明天做 X」「这周内写完 Y」），到期后晨检只问一次。只有用户用自己话说出具体要做的事时才调用；不要替用户承诺，也不要安排用户没有说过的事。',
      requiresWrite: true,
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '承诺内容，用用户的原话，最多 200 字' },
          due: {
            type: 'string',
            description:
              '承诺的日期；可传 YYYY-MM-DD，也可传「明天」「这周内」等说法；省略为明天'
          },
          workspaceId: { type: 'string', description: '可选：承诺属于哪个项目' }
        },
        required: ['text'],
        additionalProperties: false
      },
      async execute(input, context) {
        const commitments = context.commitments;
        if (!commitments) {
          throw new ToolInputError('当前版本不支持记录承诺。');
        }
        const text = requiredString(input, 'text');
        if (text.length > MAX_COMMITMENT_TEXT) {
          throw new ToolInputError(`承诺内容不能超过 ${MAX_COMMITMENT_TEXT} 字。`);
        }
        const now = context.now();
        const rawDue = optionalString(input, 'due');
        let due: string | undefined;
        if (rawDue !== undefined) {
          due = resolveCommitmentDue(rawDue, now);
          if (due === undefined) {
            throw new ToolInputError('due 必须是 YYYY-MM-DD 或「明天」「这周内」这类日期。');
          }
        }
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        const commitment = await commitments.create({
          text,
          ...(due !== undefined ? { due } : {}),
          ...(workspaceId ? { workspaceId } : {})
        });
        throwIfAborted(context.signal);
        return {
          ok: true,
          commitment,
          message: `已记下「${commitment.text}」（${commitmentDueLabel(commitment.due, now)}），到那天只问一次。`
        };
      }
    },
    {
      name: 'resolve_commitment',
      description:
        '结掉一条承诺：用户说「做了」用 outcome=done，说「不做了 / 先放一放」用 outcome=dropped；用户说「挪到明天」时用 newDue 改期。用 id 精确匹配，或传用户提到的那句承诺原文。',
      requiresWrite: true,
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '承诺 ID；优先使用' },
          text: { type: 'string', description: '承诺原文（或其中一小段），用于匹配' },
          outcome: {
            type: 'string',
            enum: ['done', 'dropped'],
            description: 'done 表示做到了；dropped 表示先放下'
          },
          newDue: {
            type: 'string',
            description: '改期到哪天；可传 YYYY-MM-DD 或「明天」等说法'
          }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const commitments = context.commitments;
        if (!commitments) {
          throw new ToolInputError('当前版本不支持记录承诺。');
        }
        const id = optionalString(input, 'id');
        const text = optionalString(input, 'text');
        if (id === undefined && text === undefined) {
          throw new ToolInputError('请提供 id 或 text 以定位承诺。');
        }
        const outcome = input.outcome;
        if (outcome !== undefined && outcome !== 'done' && outcome !== 'dropped') {
          throw new ToolInputError('outcome 只能是 done 或 dropped。');
        }
        const now = context.now();
        const rawNewDue = optionalString(input, 'newDue');
        let newDue: string | undefined;
        if (rawNewDue !== undefined) {
          newDue = resolveCommitmentDue(rawNewDue, now);
          if (newDue === undefined) {
            throw new ToolInputError('newDue 必须是 YYYY-MM-DD 或「明天」这类日期。');
          }
        }
        if (outcome === undefined && newDue === undefined) {
          throw new ToolInputError('请提供 outcome（done / dropped）或 newDue。');
        }
        const updated = await commitments.resolve({
          ...(id !== undefined ? { id } : {}),
          ...(text !== undefined ? { text } : {}),
          ...(outcome !== undefined ? { outcome } : {}),
          ...(newDue !== undefined ? { newDue } : {})
        });
        throwIfAborted(context.signal);
        return {
          ok: true,
          commitment: updated,
          message: commitmentResolveMessage(updated, now)
        };
      }
    },
    {
      name: 'set_week_availability',
      description:
        '记录用户亲口说出的「下周哪几天会特别满」，那几天每天的计划只排一件小事。weekStart 传那一周的周一（YYYY-MM-DD，接下来两周内），busyDays 传 ISO 星期数（1=周一…7=周日），只传用户点名的日子；用户没回答时不要调用，也不要问第二遍。',
      requiresWrite: true,
      parameters: {
        type: 'object',
        properties: {
          weekStart: { type: 'string', description: '那一周的周一，YYYY-MM-DD' },
          busyDays: {
            type: 'array',
            items: { type: 'number', minimum: 1, maximum: 7 },
            description: '特别满的日子，ISO 星期数：1=周一 … 7=周日'
          },
          note: { type: 'string', description: '可选备注，最多 100 字' }
        },
        required: ['weekStart', 'busyDays'],
        additionalProperties: false
      },
      async execute(input, context) {
        const availability = context.weekAvailability;
        if (!availability) {
          throw new ToolInputError('当前版本不支持记录一周安排。');
        }
        const now = context.now();
        const today = formatLocalDate(now);
        const weekStart = requiredString(input, 'weekStart');
        if (
          !isMonday(weekStart) ||
          weekStart < today ||
          weekStart > addLocalDays(now, 14)
        ) {
          throw new ToolInputError('日期必须是接下来两周内的周一（YYYY-MM-DD）。');
        }
        const busyDays = normalizeBusyDays(input['busyDays']);
        const note = optionalString(input, 'note');
        const busyDates = busyDays.map((day) =>
          addLocalDays(new Date(`${weekStart}T00:00:00`), day - 1)
        );
        const record = await availability.set({
          weekStart,
          busyDates,
          ...(note !== undefined ? { note } : {})
        });
        throwIfAborted(context.signal);
        return {
          ok: true,
          weekStart: record.weekStart,
          busyDates: record.busyDates,
          message: weekAvailabilityMessage(record, now)
        };
      }
    },
    {
      name: 'save_profile',
      description:
        '记录一条跨项目长期有效的个人信息（身份、偏好与约束、能力经验、近期变化）。只有用户明确说过或明确要求记住时才调用；从对话里推断的信息会保存为待确认，不会当成事实。',
      parameters: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['identity', 'constraints', 'abilities', 'recent'],
            description: 'identity 身份现状 / constraints 偏好与约束 / abilities 能力经验 / recent 近期变化'
          },
          text: { type: 'string', description: '一句话事实，例如：工作日每天可用 1 小时' }
        },
        required: ['category', 'text'],
        additionalProperties: false
      },
      async execute(input, context) {
        const profile = context.profile;
        if (!profile) throw new ToolInputError('当前版本不支持记录个人档案。');
        const category = input.category;
        if (!isProfileCategory(category)) {
          throw new ToolInputError('category 必须是 identity / constraints / abilities / recent。');
        }
        const text = requiredString(input, 'text');
        // Tool-created entries are always candidates: the model cannot prove the
        // user said it, and attachment or web text must not look user-verified.
        const entry = await profile.create({
          category,
          text,
          source: 'model',
          confidence: 'candidate',
          origin: '对话'
        });
        return {
          ok: true,
          id: entry.id,
          category: entry.category,
          confidence: entry.confidence,
          message: '已记到个人档案，等你确认。'
        };
      }
    },
    {
      name: 'create_practice_set',
      description:
        '出 3-10 道题组成一份练习集，写入学习页的练习模块。用户说「考考我 / 出几道题 / 测测我 / 帮我复习」时，从用户学过的内容出题。选择题设 kind 为 choice（或省略 kind），answer 是正确选项的下标（从 0 开始）；短答题请把 kind 设为 short 并给 referenceAnswer（参考答案），让用户用自己的话作答。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '练习标题，例如：极限概念小测' },
          subject: { type: 'string', description: '科目或主题；省略时使用工作区名称' },
          questions: {
            type: 'array',
            minItems: 3,
            maxItems: 10,
            description: '3-10 道题，可以混合选择与短答',
            items: {
              type: 'object',
              properties: {
                kind: {
                  type: 'string',
                  enum: ['choice', 'short'],
                  description: '题型：choice 选择题（默认）或 short 短答题'
                },
                prompt: { type: 'string', description: '题干' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: '选择题的 2-6 个选项；短答题省略'
                },
                answer: {
                  type: 'number',
                  description: '选择题正确选项的下标，从 0 开始的整数；短答题省略'
                },
                referenceAnswer: {
                  type: 'string',
                  description: '短答题的参考答案；短答题必填'
                },
                explanation: { type: 'string', description: '解析，可选' }
              },
              required: ['prompt'],
              additionalProperties: false
            }
          },
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' }
        },
        required: ['title', 'questions'],
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
        }
        if (!context.practice) {
          throw new ToolInputError('练习服务未连接，暂时无法出题。');
        }
        const title = requiredString(input, 'title');
        const subject = optionalString(input, 'subject');
        const questions = requiredPracticeQuestions(input);
        throwIfAborted(context.signal);
        const set = await context.practice.createSet({
          workspaceId,
          title,
          ...(subject ? { subject } : {}),
          // Model-written questions are marked so the learning page shows
          // 待核对 until the learner confirms they read them.
          source: 'model',
          questions
        });
        let workspaceName = workspaceId;
        try {
          const snapshot = await context.workspace.getWorkspaceSnapshot(workspaceId);
          workspaceName = snapshot.workspace.name;
        } catch {
          // Keep the raw id as the label when the workspace cannot be read.
        }
        return {
          ok: true,
          setId: set.id,
          workspaceId,
          title: set.title,
          questionCount: set.questions.length,
          message: `已出题：${set.title}（${set.questions.length} 题，${workspaceName}）· 去学习页作答，错题会自动进错题本`
        };
      }
    },
    {
      name: 'get_practice_overview',
      description:
        '只读：读取各科目的练习掌握情况——练习集数、答题次数、最近 8 周正确率（百分比，没答过为 null）和待复习错题数。讲解前先调用它判断掌握度：几乎没有答题或没有错题的主题用「示例先行」，先给完整 worked example 再让学习者自己做；已有大量答题或错题的主题反过来「先练后讲」，先让学习者做，做错再给示例对照。workspaceId 省略时使用当前项目。',
      requiresWrite: false,
      parameters: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string', description: '项目 ID；省略时使用当前项目' }
        },
        additionalProperties: false
      },
      async execute(input, context) {
        const workspaceId = optionalString(input, 'workspaceId') ?? context.workspaceId;
        if (!workspaceId) {
          throw new ToolInputError('缺少 workspaceId：请先创建或选择项目。');
        }
        const practice = context.practice;
        if (!practice) {
          return {
            available: false,
            workspaceId,
            message:
              '练习数据不可用：当前没有连接练习服务，无法读取练习集、答题和错题；先按学习者的自述判断掌握度。'
          };
        }

        const [sets, attempts, mistakes] = await Promise.all([
          practice.listSets(workspaceId),
          practice.listAttempts(workspaceId),
          practice.getMistakes(workspaceId)
        ]);
        throwIfAborted(context.signal);

        const subjectBySet = new Map<string, string>();
        const rows = new Map<string, PracticeOverviewRow>();
        const ensureRow = (subject: string): PracticeOverviewRow => {
          const existing = rows.get(subject);
          if (existing) return existing;
          const row: PracticeOverviewRow = {
            subject,
            setCount: 0,
            attemptCount: 0,
            recentAnswered: 0,
            recentCorrect: 0,
            activeMistakes: 0
          };
          rows.set(subject, row);
          return row;
        };

        for (const set of sets) {
          const subject = practiceSubject(set.subject);
          subjectBySet.set(set.id, subject);
          ensureRow(subject).setCount += 1;
        }

        // Accuracy shares the renderer trend's Monday window, so the butler and
        // the 学习页 chart quote the same slice of attempts.
        const currentMonday = startOfPracticeWeek(context.now());
        const weekMs = 7 * 24 * 60 * 60 * 1000;
        for (const attempt of attempts) {
          const subject = subjectBySet.get(attempt.setId) ?? UNKNOWN_PRACTICE_SUBJECT;
          const row = ensureRow(subject);
          row.attemptCount += 1;
          const date = new Date(attempt.answeredAt);
          if (Number.isNaN(date.getTime())) continue;
          const offset = Math.round(
            (currentMonday.getTime() - startOfPracticeWeek(date).getTime()) / weekMs
          );
          if (offset < 0 || offset >= PRACTICE_OVERVIEW_WEEKS) continue;
          row.recentAnswered += 1;
          if (attempt.correct) row.recentCorrect += 1;
        }

        // `getMistakes` returns active records only, so this is the review load.
        for (const mistake of mistakes) {
          const subject = subjectBySet.get(mistake.setId) ?? UNKNOWN_PRACTICE_SUBJECT;
          ensureRow(subject).activeMistakes += 1;
        }

        const subjects = Array.from(rows.values())
          .sort((a, b) => a.subject.localeCompare(b.subject))
          .map((row) => ({
            subject: row.subject,
            setCount: row.setCount,
            attemptCount: row.attemptCount,
            recentAnswered: row.recentAnswered,
            recentCorrect: row.recentCorrect,
            accuracy:
              row.recentAnswered === 0
                ? null
                : Math.round((row.recentCorrect / row.recentAnswered) * 100),
            activeMistakes: row.activeMistakes
          }));

        return {
          available: true,
          workspaceId,
          windowWeeks: PRACTICE_OVERVIEW_WEEKS,
          subjects,
          ...(subjects.length === 0 ? { message: '这个项目还没有练习记录。' } : {})
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
  if (context.signal?.aborted) {
    throw new Error('已停止生成');
  }
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return {
      ok: false,
      content: toJson({ ok: false, tool: call.name, error: `未知工具：${call.name}` })
    };
  }
  if (context.permissions?.write === false && tool.requiresWrite !== false) {
    return {
      ok: false,
      content: toJson({
        ok: false,
        tool: call.name,
        error: '当前是「仅可查看」权限，不能修改学习库。请让用户切到「工作区内修改」后再试。'
      })
    };
  }
  if (context.permissions?.web === false && tool.requiresWeb === true) {
    return {
      ok: false,
      content: toJson({
        ok: false,
        tool: call.name,
        error: '当前权限不允许联网。'
      })
    };
  }

  let result: unknown;
  try {
    const input = normalizeArguments(call.arguments);
    result = await tool.execute(input, context);
  } catch (error) {
    return {
      ok: false,
      content: toJson({ ok: false, tool: call.name, error: describeError(error) })
    };
  }
  if (context.signal?.aborted) {
    throw new Error('已停止生成');
  }
  return { ok: true, content: toJson({ ok: true, result }) };
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
  workspaceIds: string[],
  revisits: DueRevisit[] = []
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
    // Omitted entirely when nothing is due, so today's output stays identical.
    ...(revisits.length > 0
      ? {
          revisits,
          revisitHint:
            '以上主题到了回访日：主动提议让学习者抽几分钟自测（create_practice_set），不要只列出来。'
        }
      : {}),
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

/** True for a real calendar date written as YYYY-MM-DD. */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return !Number.isNaN(date.getTime()) && formatLocalDate(date) === value;
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

/**
 * Validates a chat-provided question list into `CreatePracticeQuestionInput`
 * shapes; every failure is a Chinese ToolInputError the model can correct.
 */
function requiredPracticeQuestions(
  input: Record<string, unknown>
): CreatePracticeQuestionInput[] {
  const value = input['questions'];
  if (!Array.isArray(value)) {
    throw new ToolInputError('参数 questions 必须是题目数组。');
  }
  if (value.length < 3 || value.length > 10) {
    throw new ToolInputError('questions 必须包含 3-10 道题。');
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolInputError(`第 ${index + 1} 题必须是对象。`);
    }
    const question = entry as Record<string, unknown>;
    const prompt = question['prompt'];
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new ToolInputError(`第 ${index + 1} 题缺少题干 prompt。`);
    }
    const kindValue = question['kind'];
    if (kindValue !== undefined && kindValue !== 'choice' && kindValue !== 'short') {
      throw new ToolInputError(`第 ${index + 1} 题的 kind 只能是 choice 或 short。`);
    }
    const explanationValue = question['explanation'];
    if (explanationValue !== undefined && explanationValue !== null) {
      if (typeof explanationValue !== 'string') {
        throw new ToolInputError(`第 ${index + 1} 题的 explanation 必须是字符串。`);
      }
    }
    const explanation =
      typeof explanationValue === 'string' && explanationValue.trim() !== ''
        ? explanationValue
        : undefined;

    if (kindValue === 'short') {
      const referenceAnswerValue = question['referenceAnswer'];
      if (typeof referenceAnswerValue !== 'string' || referenceAnswerValue.trim() === '') {
        throw new ToolInputError(`第 ${index + 1} 题是短答题，必须提供参考答案 referenceAnswer。`);
      }
      return {
        kind: 'short',
        prompt,
        referenceAnswer: referenceAnswerValue,
        ...(explanation ? { explanation } : {})
      };
    }

    const optionsValue = question['options'];
    if (!Array.isArray(optionsValue) || optionsValue.length < 2 || optionsValue.length > 6) {
      throw new ToolInputError(`第 ${index + 1} 题的 options 必须是 2-6 个选项。`);
    }
    const options: string[] = [];
    for (const option of optionsValue) {
      if (typeof option !== 'string' || option.trim() === '') {
        throw new ToolInputError(`第 ${index + 1} 题的选项不能为空。`);
      }
      options.push(option);
    }
    if (new Set(options).size !== options.length) {
      throw new ToolInputError(`第 ${index + 1} 题的选项不能重复。`);
    }
    const answer = question['answer'];
    if (
      typeof answer !== 'number' ||
      !Number.isInteger(answer) ||
      answer < 0 ||
      answer >= options.length
    ) {
      throw new ToolInputError(
        `第 ${index + 1} 题的 answer 必须是 0-${options.length - 1} 的整数下标。`
      );
    }
    return {
      prompt,
      options,
      answer,
      ...(explanation ? { explanation } : {})
    };
  });
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `今天` / `明天` / the ISO day, for a confirmation the model can quote. */
function commitmentDueLabel(due: string, now: Date): string {
  const today = formatLocalDate(now);
  if (due === today) return '今天';
  if (due === addLocalDays(now, 1)) return '明天';
  return due;
}

/** Short honest confirmation of a resolve, never a judgment. */
function commitmentResolveMessage(commitment: Commitment, now: Date): string {
  if (commitment.status === 'done') return `已结案：做到了「${commitment.text}」。`;
  if (commitment.status === 'dropped') return `已放下：「${commitment.text}」，不追问了。`;
  return `已改到${commitmentDueLabel(commitment.due, now)}：「${commitment.text}」。`;
}

/** ISO weekdays 1-7 (Mon=1..Sun=7), deduplicated, at least one, ascending. */
function normalizeBusyDays(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new ToolInputError('请说出下周特别满的是哪几天（周一至周日）。');
  }
  const days = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 1 || entry > 7) {
      throw new ToolInputError('请说出下周特别满的是哪几天（周一至周日）。');
    }
    days.add(entry);
  }
  if (days.size === 0) {
    throw new ToolInputError('请说出下周特别满的是哪几天（周一至周日）。');
  }
  return [...days].sort((a, b) => a - b);
}

/** The Monday starting the week that contains `date`, on the local calendar. */
function mondayOf(date: Date): string {
  return addLocalDays(date, -((date.getDay() + 6) % 7));
}

/** Deterministic confirmation naming the actual weekdays the user named. */
function weekAvailabilityMessage(record: WeekAvailability, now: Date): string {
  const days = record.busyDates.map((date) => weekdayWord(date) ?? date).join('、');
  const week = record.weekStart === mondayOf(now) ? '本周' : '下周';
  return `已记下：${week} ${days} 会特别满，那几天我只给你排一件小事。`;
}

function toJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ ok: false, error: '工具结果无法序列化。' });
  }
}
