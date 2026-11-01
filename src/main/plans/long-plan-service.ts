import { promises as fs } from 'node:fs';
import { resolve } from 'node:path';
import { formatLocalDate } from '../../shared/date';
import type { KnowledgeService } from '../../shared/knowledge';
import { isActiveKnowledgeTopic } from '../../shared/knowledge';
import type {
  CreateLongPlanInput,
  LongPlan,
  LongPlanKnowledge,
  LongPlanService,
  UpdateLongPlanItemInput
} from '../../shared/plans';
import type { LongPlanGenerationInput } from '../../shared/plan-template';
import type { Workspace, WorkspaceService } from '../../shared/workspace';
import type { ModelClient } from '../agent/model-client';
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
      return topics
        .filter(isActiveKnowledgeTopic)
        .sort((a, b) => {
          const aMastered = a.status === 'mastered' ? 0 : 1;
          const bMastered = b.status === 'mastered' ? 0 : 1;
          return aMastered - bMastered || b.updatedAt.localeCompare(a.updatedAt);
        })
        .slice(0, MAX_KNOWN_TOPICS)
        .map(({ name, status }) => ({ name, status }));
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
        ...(generated.generatedBy === 'agent' && knownTopics.length
          ? { knowledge: knownTopics }
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
