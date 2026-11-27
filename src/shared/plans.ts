/**
 * Shared contract for long-term plans. A plan turns one goal plus a duration
 * into phases → weeks → days, mirroring the printable plan tables people keep
 * on their desktop. Progress is derived from the day rows and acceptance
 * checks, so nothing needs to be stored twice.
 *
 * Phase progression is mastery-gated, not calendar-gated (see `phaseGate`):
 * phase 0 is always reachable, and phase N>0 becomes reachable only once every
 * acceptance check of every earlier phase is checked. A phase with no checks
 * cannot block the phases after it, and a plan whose phases have no checks at
 * all therefore has no locks — the gate adds no requirements the plan did not
 * already contain.
 */

import type { KnowledgeStatus } from './knowledge';
import { localDaysBetween } from './date';

export type LongPlanGeneratedBy = 'agent' | 'template';

/** A knowledge topic the plan took into account when it was generated. */
export interface LongPlanKnowledge {
  name: string;
  status: KnowledgeStatus;
  /**
   * Prompt-only detail used to decide where to start; plan files persist
   * only name and status, so these never become vault data.
   */
  level?: number;
  summary?: string;
  noteExcerpt?: string;
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

/**
 * What the last recalibration actually changed, computed from the plan before
 * and after it ran. All numbers are counts of day tasks plus weekly checks.
 */
export interface LongPlanRecalibrationSummary {
  /** First week number the recalibration rewrote. */
  fromWeek: number;
  /** Total weeks in the plan before and after the recalibration. */
  weeksBefore: number;
  weeksAfter: number;
  /** Total tasks + checks in the whole plan before and after. */
  itemsBefore: number;
  itemsAfter: number;
  /** Items in the rewritten weeks that are new / no longer present. */
  addedItems: number;
  removedItems: number;
  /** Checked items in the preserved (untouched) weeks. */
  keptDoneItems: number;
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
  /** When the remaining weeks were last replanned from actual progress. */
  recalibratedAt?: string;
  /** First week number the last recalibration rewrote. */
  recalibratedFrom?: number;
  /** Deterministic diff of the last recalibration; absent on older plans. */
  recalibration?: LongPlanRecalibrationSummary;
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

export interface UpdateLongPlanInput {
  planId: string;
  /** New plan goal; weeks keep their generated content. */
  goal?: string;
  /** New hours-per-week baseline for future recalibrations. */
  weeklyHours?: number;
}

export interface RecalibrateLongPlanInput {
  planId: string;
  /** Hours per week for the remaining weeks; defaults to the plan's setting. */
  weeklyHours?: number;
  /** What changed since the plan was made (extra busy week, new material). */
  notes?: string;
}

export interface LongPlanProgress {
  total: number;
  done: number;
  percent: number;
}

/** `locked`: an earlier phase still has unchecked acceptance items. */
export type LongPlanPhaseGateState = 'locked' | 'open' | 'done';

export interface LongPlanPhaseGate {
  state: LongPlanPhaseGateState;
  /** Unchecked acceptance checks in the earlier phases still gating this one. */
  remaining: number;
  /**
   * Acceptance checks across all earlier phases — the set `remaining` counts
   * down from. Phase 0 has no prerequisites, so its total is 0.
   */
  total: number;
}

export interface LongPlanService {
  list(workspaceId?: string): Promise<LongPlan[]>;
  get(planId: string): Promise<LongPlan | null>;
  create(input: CreateLongPlanInput): Promise<LongPlan>;
  update(input: UpdateLongPlanInput): Promise<LongPlan>;
  recalibrate(input: RecalibrateLongPlanInput): Promise<LongPlan>;
  setItemDone(input: UpdateLongPlanItemInput): Promise<LongPlan>;
  delete(planId: string): Promise<void>;
}

/** Renderer-facing plan contract over IPC. */
export interface LongPlanApi {
  listLongPlans(workspaceId?: string): Promise<LongPlan[]>;
  getLongPlan(planId: string): Promise<LongPlan | null>;
  createLongPlan(input: CreateLongPlanInput): Promise<LongPlan>;
  updateLongPlan(input: UpdateLongPlanInput): Promise<LongPlan>;
  recalibrateLongPlan(input: RecalibrateLongPlanInput): Promise<LongPlan>;
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

/** True once the user checked any day or acceptance item in the week. */
export function weekHasProgress(week: LongPlanWeek): boolean {
  return week.days.some((day) => day.done) || week.checks.some((check) => check.done);
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

function phaseChecks(phase: LongPlanPhase): LongPlanCheck[] {
  return phase.weeks.flatMap((week) => week.checks);
}

/**
 * The mastery gate in front of `plan.phases[index]`. Pure and deterministic:
 *
 * - Phase 0 is always reachable; it is `done` once all of its own checks are
 *   checked, otherwise `open`.
 * - Phase N>0 is `locked` while any check of any earlier phase is unchecked,
 *   with `remaining` counting those unchecked checks. Once every earlier check
 *   is done it is `done` if all of its own checks are checked, else `open`.
 * - A phase with no checks cannot block later phases. It is never reported as
 *   `done` (there is nothing to demonstrate), and its own emptiness means later
 *   phases have fewer prerequisites, not more.
 *
 * An out-of-range index reports an empty `open` gate so callers can render
 * defensively without inventing a lock.
 */
export function phaseGate(plan: LongPlan, index: number): LongPlanPhaseGate {
  const phase = plan.phases[index];
  if (!phase) return { state: 'open', remaining: 0, total: 0 };
  const earlierChecks = plan.phases.slice(0, index).flatMap(phaseChecks);
  const remaining = earlierChecks.filter((check) => !check.done).length;
  const total = earlierChecks.length;
  if (remaining > 0) return { state: 'locked', remaining, total };
  const checks = phaseChecks(phase);
  if (checks.length > 0 && checks.every((check) => check.done)) {
    return { state: 'done', remaining: 0, total };
  }
  return { state: 'open', remaining: 0, total };
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

/**
 * How many plan days have passed by `today`, clamped to the plan's own length:
 * 0 before the start date, capped at `weeks × 7` after the end.
 */
export function planElapsedDays(plan: LongPlan, today: string): number {
  return Math.min(Math.max(localDaysBetween(plan.startDate, today), 0), plan.weeks * 7);
}

/**
 * The hours-per-week the recalibrate dialog suggests as its default.
 *
 * The first seven days carry too little history to scale from, and a plan
 * with no items has no progress at all — both return the plan's own weekly
 * hours, so the dialog never invents a number. After that the suggestion is
 * the plan's weekly hours scaled by the actual pace: progress made so far
 * over progress expected by today, rounded, clamped to the input's 1–80
 * range. It stays a default — the user reviews and can change it before
 * confirming; nothing recalibrates automatically.
 */
export function suggestedRecalibrateHours(plan: LongPlan, today: string): number {
  const elapsed = planElapsedDays(plan, today);
  if (elapsed < 7) return plan.weeklyHours;
  const progress = planProgress(plan);
  if (progress.total === 0) return plan.weeklyHours;
  const expected = elapsed / (plan.weeks * 7);
  const actual = progress.percent / 100;
  return Math.min(80, Math.max(1, Math.round((plan.weeklyHours * actual) / expected)));
}
