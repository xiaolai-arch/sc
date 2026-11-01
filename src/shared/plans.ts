/**
 * Shared contract for long-term plans. A plan turns one goal plus a duration
 * into phases → weeks → days, mirroring the printable plan tables people keep
 * on their desktop. Progress is derived from the day rows and acceptance
 * checks, so nothing needs to be stored twice.
 */

import type { KnowledgeStatus } from './knowledge';

export type LongPlanGeneratedBy = 'agent' | 'template';

/** A knowledge topic the plan took into account when it was generated. */
export interface LongPlanKnowledge {
  name: string;
  status: KnowledgeStatus;
}

/** A web page the plan was grounded in. */
export interface LongPlanSource {
  title: string;
  url: string;
}

/** Where the plan's content came from: web research, the user's material, or the model alone. */
export type LongPlanBasis = 'web' | 'references' | 'model';

export interface LongPlanDay {
  id: string;
  /** Local calendar date (YYYY-MM-DD). */
  date: string;
  /** 周一 … 周日 */
  weekday: string;
  tasks: string[];
  /** The verifiable output the day should leave behind. */
  output: string;
  done: boolean;
}

export interface LongPlanCheck {
  id: string;
  text: string;
  done: boolean;
}

export interface LongPlanWeek {
  id: string;
  /** 1-based week number across the whole plan. */
  number: number;
  title: string;
  goal: string;
  startDate: string;
  endDate: string;
  days: LongPlanDay[];
  checks: LongPlanCheck[];
}

export interface LongPlanPhase {
  id: string;
  title: string;
  subtitle: string;
  goal: string;
  weeks: LongPlanWeek[];
}

export interface LongPlan {
  id: string;
  workspaceId: string;
  goal: string;
  /** Local date the first week starts (YYYY-MM-DD). */
  startDate: string;
  weeks: number;
  weeklyHours: number;
  generatedBy: LongPlanGeneratedBy;
  /** Reference material the user pasted when creating the plan. */
  references?: string;
  /** Pages returned by the research pass, when the model could reach the web. */
  sources?: LongPlanSource[];
  /** Active knowledge topics the agent saw; absent for template fallbacks. */
  knowledge?: LongPlanKnowledge[];
  createdAt: string;
  updatedAt: string;
  phases: LongPlanPhase[];
}

export interface CreateLongPlanInput {
  workspaceId: string;
  goal: string;
  /** Defaults to the service's current local date. */
  startDate?: string;
  /** 1–16 weeks. */
  weeks: number;
  /** Hours per week the plan should assume; defaults to 10. */
  weeklyHours?: number;
  /** Optional background (current level, constraints, preferred materials). */
  notes?: string;
  /** Course outline, job description, or notes the plan must follow. */
  references?: string;
  /** Ask the model to research the web first; failures never block generation. */
  research?: boolean;
}

export interface UpdateLongPlanItemInput {
  planId: string;
  weekId: string;
  itemId: string;
  kind: 'day' | 'check';
  done: boolean;
}

export interface LongPlanProgress {
  total: number;
  done: number;
  percent: number;
}

export interface LongPlanService {
  list(workspaceId?: string): Promise<LongPlan[]>;
  get(planId: string): Promise<LongPlan | null>;
  create(input: CreateLongPlanInput): Promise<LongPlan>;
  setItemDone(input: UpdateLongPlanItemInput): Promise<LongPlan>;
  delete(planId: string): Promise<void>;
}

/** Renderer-facing plan contract over IPC. */
export interface LongPlanApi {
  listLongPlans(workspaceId?: string): Promise<LongPlan[]>;
  getLongPlan(planId: string): Promise<LongPlan | null>;
  createLongPlan(input: CreateLongPlanInput): Promise<LongPlan>;
  setLongPlanItemDone(input: UpdateLongPlanItemInput): Promise<LongPlan>;
  deleteLongPlan(planId: string): Promise<void>;
}

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function percentOf(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

function progressOf(done: number, total: number): LongPlanProgress {
  return { total, done, percent: percentOf(done, total) };
}

function parseDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** 周日 … 周六, computed from the local calendar date. */
export function planWeekday(date: string): string {
  return WEEKDAYS[parseDate(date).getDay()] ?? '';
}

/** Compact row label such as `11/2`. */
export function planMonthDay(date: string): string {
  const parsed = parseDate(date);
  return `${parsed.getMonth() + 1}/${parsed.getDate()}`;
}

export function weekProgress(week: LongPlanWeek): LongPlanProgress {
  const total = week.days.length + week.checks.length;
  const done =
    week.days.filter((day) => day.done).length +
    week.checks.filter((check) => check.done).length;
  return progressOf(done, total);
}

export function phaseProgress(phase: LongPlanPhase): LongPlanProgress {
  let total = 0;
  let done = 0;
  for (const week of phase.weeks) {
    const progress = weekProgress(week);
    total += progress.total;
    done += progress.done;
  }
  return progressOf(done, total);
}

/** Web sources win over pasted references; neither means the model planned alone. */
export function planBasis(plan: LongPlan): LongPlanBasis {
  if ((plan.sources?.length ?? 0) > 0) return 'web';
  if (plan.references?.trim()) return 'references';
  return 'model';
}

export function planProgress(plan: LongPlan): LongPlanProgress {
  let total = 0;
  let done = 0;
  for (const phase of plan.phases) {
    const progress = phaseProgress(phase);
    total += progress.total;
    done += progress.done;
  }
  return progressOf(done, total);
}

export function findPlanWeek(
  plan: LongPlan,
  weekId: string
): { phase: LongPlanPhase; week: LongPlanWeek } | null {
  for (const phase of plan.phases) {
    const week = phase.weeks.find((entry) => entry.id === weekId);
    if (week) return { phase, week };
  }
  return null;
}

/**
 * The week containing `today`. Before the plan starts this is the first week;
 * after it ends it is the last week, so the page always has something to show.
 */
export function currentPlanWeek(plan: LongPlan, today: string): LongPlanWeek | null {
  const weeks = plan.phases.flatMap((phase) => phase.weeks);
  if (weeks.length === 0) return null;
  const containing = weeks.find((week) => week.startDate <= today && today <= week.endDate);
  if (containing) return containing;
  const upcoming = weeks.find((week) => week.startDate > today);
  return upcoming ?? weeks[weeks.length - 1] ?? null;
}
