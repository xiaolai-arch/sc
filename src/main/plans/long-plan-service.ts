import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { formatLocalDate } from '../../shared/date';
import type { KnowledgeService } from '../../shared/knowledge';
import { isActiveKnowledgeTopic } from '../../shared/knowledge';
import type {
  CreateLongPlanInput,
  LongPlan,
  LongPlanKnowledge,
  LongPlanPhase,
  LongPlanService,
  LongPlanWeek,
  RecalibrateLongPlanInput,
  UpdateLongPlanItemInput
} from '../../shared/plans';
import { planProgress, weekHasProgress, weekProgress } from '../../shared/plans';
import type { LongPlanGenerationInput } from '../../shared/plan-template';
import type { Workspace, WorkspaceService } from '../../shared/workspace';
import type { ModelClient } from '../agent/model-client';
import { attachKnowledgeNotes } from '../knowledge/context';
import { createMutex, listDirectories, listMarkdownFiles, readFileOrNull, writeFileAtomic } from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import { assertSafeSegment, planFile, plansDir, workspacesDir } from '../workspace/paths';
import { generateLongPlan } from './generate';
import { parseLongPlanFile, serializeLongPlanFile } from './records';
import { researchPlanTopic } from './research';

const MIN_WEEKS = 1;
const MAX_WEEKS = 16;
const MIN_WEEKLY_HOURS = 1;
const MAX_WEEKLY_HOURS = 80;
const MAX_GOAL_LENGTH = 300;
const MAX_REFERENCES_LENGTH = 4_000;
const MAX_KNOWN_TOPICS = 20;
const MAX_KNOWN_NOTE_EXCERPTS = 6;
const MAX_KNOWN_NOTE_CHARS = 280;
const MAX_RECALIBRATION_NOTES = 800;
const MAX_PROGRESS_WEEKS = 4;
const MAX_WEEK_SUMMARY_CHARS = 240;
const MAX_OUTLINE_WEEKS = 6;
const MAX_OUTLINE_WEEK_CHARS = 220;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface LongPlanServiceOptions {
  /** Vault root (the directory holding `workspaces/`). */
  root: string;
  workspaceService: WorkspaceService;
  /** When null/omitted, plans use the deterministic phase framework. */
  modelClient?: ModelClient | null;
  /** Supplying active topics keeps the model from re-planning what is learned. */
  knowledgeService?: KnowledgeService | null;
  now?: () => Date;
}

function requireGoal(value: unknown): string {
  const goal = typeof value === 'string' ? value.trim() : '';
  if (!goal) throw new Error('计划目标不能为空。');
  return goal.length > MAX_GOAL_LENGTH ? goal.slice(0, MAX_GOAL_LENGTH) : goal;
}

function requireWeeks(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < MIN_WEEKS ||
    value > MAX_WEEKS
  ) {
    throw new Error(`周数必须在 ${MIN_WEEKS} 到 ${MAX_WEEKS} 之间。`);
  }
  return value;
}

function normalizeWeeklyHours(value: unknown): number {
  if (value === undefined) return 10;
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < MIN_WEEKLY_HOURS ||
    value > MAX_WEEKLY_HOURS
  ) {
    throw new Error(
      `每周投入必须在 ${MIN_WEEKLY_HOURS} 到 ${MAX_WEEKLY_HOURS} 小时之间。`
    );
  }
  return Math.round(value);
}

function normalizeReferences(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error('参考资料无效。');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > MAX_REFERENCES_LENGTH
    ? trimmed.slice(0, MAX_REFERENCES_LENGTH)
    : trimmed;
}

function normalizeResearch(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error('联网调研选项无效。');
  return value;
}

function requireStartDate(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !ISO_DATE.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  ) {
    throw new Error('起始日期无效。');
  }
  return value;
}

function isSafePlanId(value: string): boolean {
  try {
    assertSafeSegment(value, 'plan id');
    return true;
  } catch {
    return false;
  }
}

function clipText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

/** Keeps a model-written "第 1 周" title aligned with its real week number. */
function renumberWeekTitle(title: string, number: number): string {
  if (!title.trim()) return `第 ${number} 周`;
  return /^第\s*\d+\s*周/.test(title)
    ? title.replace(/^第\s*\d+\s*周/, `第 ${number} 周`)
    : title;
}

function buildProgressSummary(
  plan: LongPlan,
  today: string,
  pastWeeks: LongPlanWeek[]
): string {
  const progress = planProgress(plan);
  const totalDays = plan.weeks * 7;
  const elapsed = Math.max(
    0,
    Math.min(totalDays, dayNumber(today) - dayNumber(plan.startDate))
  );
  const lines = [
    `计划共 ${plan.weeks} 周（${plan.startDate} 起，每周约 ${plan.weeklyHours} 小时），今天 ${today}，已过去 ${elapsed}/${totalDays} 天。`,
    `整体完成 ${progress.done}/${progress.total} 项（${progress.percent}%）。`
  ];
  const recent = pastWeeks.slice(-MAX_PROGRESS_WEEKS);
  if (recent.length === 0) lines.push('还没有已完成的周次。');
  for (const week of recent) {
    const weekDone = weekProgress(week);
    const done = [
      ...week.days.filter((day) => day.done).flatMap((day) => day.tasks),
      ...week.checks.filter((check) => check.done).map((check) => check.text)
    ]
      .map((text) => clipText(text, 40))
      .slice(0, 4);
    lines.push(
      `第 ${week.number} 周（${week.startDate}—${week.endDate}）：完成 ${weekDone.done}/${weekDone.total}${
        done.length ? `；已完成：${done.join('；')}` : '；尚未勾选完成项'
      }`
    );
  }
  return lines.join('\n');
}

function buildRemainingOutline(weeks: LongPlanWeek[]): string {
  const lines = weeks.slice(0, MAX_OUTLINE_WEEKS).map((week) => {
    const tasks = week.days
      .flatMap((day) => day.tasks)
      .slice(0, 4)
      .map((task) => clipText(task, 30))
      .join(' / ');
    const checks = week.checks
      .slice(0, 3)
      .map((check) => clipText(check.text, 30))
      .join(' / ');
    return clipText(
      `第 ${week.number} 周（${week.startDate}—${week.endDate}）${week.title}：${week.goal}${
        tasks ? `；任务示例：${tasks}` : ''
      }${checks ? `；验收：${checks}` : ''}`,
      MAX_OUTLINE_WEEK_CHARS
    );
  });
  if (weeks.length > MAX_OUTLINE_WEEKS) {
    lines.push(`…（后面 ${weeks.length - MAX_OUTLINE_WEEKS} 周略）`);
  }
  return lines.join('\n');
}

/**
 * Vault-backed long-term plans. Each plan lives in
 * `workspaces/<id>/plans/<plan-id>.md`; the YAML frontmatter is authoritative
 * and the body is an Obsidian-friendly outline. Generation degrades to a
 * deterministic framework when no model is configured.
 */
export function createLongPlanService(options: LongPlanServiceOptions): LongPlanService {
  const vaultRoot = resolve(options.root);
  const modelClient = options.modelClient ?? null;
  const knowledgeService = options.knowledgeService ?? null;
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();

  /** Mastered first, then most recently touched; a broken vault means no context. */
  async function selectKnownTopics(workspaceId: string): Promise<LongPlanKnowledge[]> {
    if (knowledgeService === null) return [];
    try {
      const topics = await knowledgeService.list(workspaceId);
      const active = topics
        .filter(isActiveKnowledgeTopic)
        .sort((a, b) => {
          const aMastered = a.status === 'mastered' ? 0 : 1;
          const bMastered = b.status === 'mastered' ? 0 : 1;
          return aMastered - bMastered || b.updatedAt.localeCompare(a.updatedAt);
        })
        .slice(0, MAX_KNOWN_TOPICS);
      const enriched = await attachKnowledgeNotes(active, knowledgeService, {
        maxNotes: MAX_KNOWN_NOTE_EXCERPTS,
        maxChars: MAX_KNOWN_NOTE_CHARS
      });
      return enriched.map((topic) => ({
        name: topic.name,
        status: topic.status,
        ...(typeof topic.level === 'number' ? { level: topic.level } : {}),
        ...(topic.summary.trim() ? { summary: topic.summary.trim() } : {}),
        ...(topic.noteExcerpt ? { noteExcerpt: topic.noteExcerpt } : {})
      }));
    } catch {
      return [];
    }
  }

  async function findPlanFile(
    planId: string
  ): Promise<{ path: string; plan: LongPlan } | null> {
    if (!isSafePlanId(planId)) return null;
    for (const workspaceId of await listDirectories(workspacesDir(vaultRoot))) {
      const path = planFile(vaultRoot, workspaceId, planId);
      const raw = await readFileOrNull(path);
      if (raw === null) continue;
      const plan = parseLongPlanFile(raw, planId);
      if (plan !== null) return { path, plan };
    }
    return null;
  }

  async function readWorkspace(workspaceId: string): Promise<Workspace> {
    const workspaces = await options.workspaceService.listWorkspaces();
    const workspace = workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) throw new Error('工作区不存在。');
    return workspace;
  }

  return {
    async list(workspaceId?: string): Promise<LongPlan[]> {
      const ids =
        workspaceId === undefined
          ? await listDirectories(workspacesDir(vaultRoot))
          : [assertSafeSegment(workspaceId, 'workspace id')];
      const plans: LongPlan[] = [];
      for (const id of ids) {
        for (const fileName of await listMarkdownFiles(plansDir(vaultRoot, id))) {
          const raw = await readFileOrNull(`${plansDir(vaultRoot, id)}/${fileName}`);
          if (raw === null) continue;
          const plan = parseLongPlanFile(raw, fileName.replace(/\.md$/, ''));
          if (plan !== null) plans.push(plan);
        }
      }
      plans.sort(
        (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.goal.localeCompare(b.goal)
      );
      return plans;
    },

    async get(planId: string): Promise<LongPlan | null> {
      return (await findPlanFile(planId))?.plan ?? null;
    },

    async create(input: CreateLongPlanInput): Promise<LongPlan> {
      const goal = requireGoal(input?.goal);
      const weeks = requireWeeks(input?.weeks);
      const weeklyHours = normalizeWeeklyHours(input?.weeklyHours);
      const startDate = requireStartDate(input?.startDate, formatLocalDate(now()));
      const workspaceId =
        typeof input?.workspaceId === 'string' ? input.workspaceId : '';
      const workspace = await readWorkspace(workspaceId);
      const notes =
        typeof input?.notes === 'string' && input.notes.trim() !== ''
          ? input.notes.trim()
          : undefined;
      const references = normalizeReferences(input?.references);
      const research = normalizeResearch(input?.research);
      const knownTopics = await selectKnownTopics(workspace.id);

      const findings = research
        ? await researchPlanTopic(
            {
              goal,
              weeks,
              weeklyHours,
              ...(notes ? { notes } : {}),
              ...(references ? { references } : {})
            },
            modelClient
          )
        : { sources: [], facts: [] };

      const generation: LongPlanGenerationInput = {
        workspace,
        goal,
        startDate,
        weeks,
        weeklyHours,
        ...(notes ? { notes } : {}),
        ...(references ? { references } : {}),
        ...(findings.facts.length ? { researchFacts: findings.facts } : {}),
        ...(knownTopics.length ? { knownTopics } : {})
      };
      const generated = await generateLongPlan(generation, modelClient);
      const timestamp = now().toISOString();
      const plan: LongPlan = {
        id: newId('lp'),
        workspaceId: workspace.id,
        goal,
        startDate,
        weeks,
        weeklyHours,
        generatedBy: generated.generatedBy,
        ...(references ? { references } : {}),
        sources: findings.sources,
        // The template cannot use knowledge; claiming a snapshot would be false.
        // Prompt-only detail (summary/level/note) is deliberately not persisted.
        ...(generated.generatedBy === 'agent' && knownTopics.length
          ? {
              knowledge: knownTopics.map(({ name, status }) => ({ name, status }))
            }
          : {}),
        createdAt: timestamp,
        updatedAt: timestamp,
        phases: generated.phases
      };
      await writeFileAtomic(
        planFile(vaultRoot, workspace.id, plan.id),
        serializeLongPlanFile(plan)
      );
      return plan;
    },

    async recalibrate(input: RecalibrateLongPlanInput): Promise<LongPlan> {
      const planId =
        typeof input?.planId === 'string' ? input.planId.trim() : '';
      if (!isSafePlanId(planId)) throw new Error('计划 ID 无效。');
      if (input.notes !== undefined && typeof input.notes !== 'string') {
        throw new Error('重排说明无效。');
      }
      const weeklyHours =
        input.weeklyHours === undefined
          ? undefined
          : normalizeWeeklyHours(input.weeklyHours);
      const notes = typeof input.notes === 'string' ? input.notes.trim() : '';
      const found = await findPlanFile(planId);
      if (found === null) throw new Error('计划不存在。');
      if (modelClient === null) {
        throw new Error('重排剩余计划需要先配置模型。');
      }

      const plan = found.plan;
      const today = formatLocalDate(now());
      const weeks = plan.phases.flatMap((phase) => phase.weeks);
      const currentIndex = weeks.findIndex((week) => week.endDate >= today);
      if (currentIndex === -1) {
        throw new Error('计划已经结束，没有可重排的周次。');
      }
      // Never rewrite a week with checked work; start at the first untouched
      // week in the current-or-future range.
      let fromIndex = currentIndex;
      while (fromIndex < weeks.length && weekHasProgress(weeks[fromIndex]!)) {
        fromIndex += 1;
      }
      if (fromIndex >= weeks.length) {
        throw new Error('剩余周次都已有进度，暂时没有可重排的内容。');
      }
      const fromWeek = weeks[fromIndex]!;
      const remainingWeeks = weeks.slice(fromIndex);
      const workspace = await readWorkspace(plan.workspaceId);
      const knownTopics = await selectKnownTopics(workspace.id);
      const nextWeeklyHours = weeklyHours ?? plan.weeklyHours;

      const generation: LongPlanGenerationInput = {
        workspace,
        goal: plan.goal,
        startDate: fromWeek.startDate,
        weeks: remainingWeeks.length,
        weeklyHours: nextWeeklyHours,
        ...(notes ? { notes: clipText(notes, MAX_RECALIBRATION_NOTES) } : {}),
        ...(plan.references ? { references: plan.references } : {}),
        ...(knownTopics.length ? { knownTopics } : {}),
        recalibration: {
          fromWeekNumber: fromWeek.number,
          totalWeeks: plan.weeks,
          today,
          progressSummary: buildProgressSummary(
            plan,
            today,
            weeks.slice(0, fromIndex)
          ),
          previousOutline: buildRemainingOutline(remainingWeeks)
        }
      };
      const generated = await generateLongPlan(generation, modelClient);
      if (generated.generatedBy !== 'agent') {
        throw new Error('模型没有返回可用的重排结果，计划未修改。');
      }

      const preservedPhases: LongPlanPhase[] = plan.phases
        .map((phase) => ({
          ...phase,
          weeks: phase.weeks.filter((week) => week.number < fromWeek.number)
        }))
        .filter((phase) => phase.weeks.length > 0);
      const usedTitles = new Set(preservedPhases.map((phase) => phase.title));
      let weekOffset = 0;
      const regeneratedPhases: LongPlanPhase[] = generated.phases.map((phase) => {
        const phaseWeeks = phase.weeks.map((week) => {
          const number = fromWeek.number + weekOffset;
          weekOffset += 1;
          const weekId = `w${number}`;
          return {
            ...week,
            id: weekId,
            number,
            title: renumberWeekTitle(week.title, number),
            days: week.days.map((day, index) => ({
              ...day,
              id: `${weekId}d${index + 1}`
            })),
            checks: week.checks.map((check, index) => ({
              ...check,
              id: `${weekId}c${index + 1}`
            }))
          };
        });
        return {
          ...phase,
          id: newId('ph'),
          title: usedTitles.has(phase.title) ? `${phase.title}（重排）` : phase.title,
          weeks: phaseWeeks
        };
      });
      if (weekOffset !== remainingWeeks.length) {
        throw new Error('模型没有返回可用的重排结果，计划未修改。');
      }

      const timestamp = now().toISOString();
      const { knowledge: _previousKnowledge, ...rest } = plan;
      const next: LongPlan = {
        ...rest,
        weeklyHours: nextWeeklyHours,
        generatedBy: 'agent',
        ...(knownTopics.length
          ? {
              knowledge: knownTopics.map(({ name, status }) => ({ name, status }))
            }
          : {}),
        recalibratedAt: timestamp,
        recalibratedFrom: fromWeek.number,
        updatedAt: timestamp,
        phases: [...preservedPhases, ...regeneratedPhases]
      };

      return runExclusively(async () => {
        const current = await findPlanFile(planId);
        if (current === null) throw new Error('计划不存在。');
        // A checkbox toggled during the (long) model call means the progress
        // used for this replan is stale; never overwrite that work.
        if (current.plan.updatedAt !== plan.updatedAt) {
          throw new Error('计划在重排期间发生了变化，请重试。');
        }
        await writeFileAtomic(current.path, serializeLongPlanFile(next));
        return next;
      });
    },

    async setItemDone(input: UpdateLongPlanItemInput): Promise<LongPlan> {
      if (typeof input?.planId !== 'string' || input.planId.trim() === '') {
        throw new Error('计划 ID 无效。');
      }
      if (typeof input.weekId !== 'string' || input.weekId.trim() === '') {
        throw new Error('周 ID 无效。');
      }
      if (typeof input.itemId !== 'string' || input.itemId.trim() === '') {
        throw new Error('条目 ID 无效。');
      }
      if (input.kind !== 'day' && input.kind !== 'check') {
        throw new Error('条目类型无效。');
      }
      return runExclusively(async () => {
        const found = await findPlanFile(input.planId);
        if (found === null) throw new Error('计划不存在。');
        const plan = found.plan;
        const week = plan.phases
          .flatMap((phase) => phase.weeks)
          .find((entry) => entry.id === input.weekId);
        if (week === undefined) throw new Error('周不存在。');
        const items = input.kind === 'day' ? week.days : week.checks;
        const item = items.find((entry) => entry.id === input.itemId);
        if (item === undefined) throw new Error('计划条目不存在。');
        item.done = input.done;
        plan.updatedAt = now().toISOString();
        await writeFileAtomic(found.path, serializeLongPlanFile(plan));
        return plan;
      });
    },

    async delete(planId: string): Promise<void> {
      const found = await findPlanFile(planId);
      if (found === null) return;
      await fs.rm(found.path, { force: true });
    }
  };
}
