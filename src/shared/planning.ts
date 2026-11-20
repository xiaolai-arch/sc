/**
 * Shared contract for workspace planning. The planner turns a workspace goal
 * plus recent notes/memory and the available time for a day into a small,
 * validated list of actionable tasks.
 */

/** Who produced the plan: the injected model or the deterministic template. */
export type WorkspacePlanGeneratedBy = 'agent' | 'template';

/** Which input supplied the daily minute budget the plan was built around. */
export type AvailableMinutesSource = 'input' | 'workspace' | 'default';

/** Plain-Chinese provenance shown next to the planned daily minutes. */
export const AVAILABLE_MINUTES_SOURCE_LABELS: Record<AvailableMinutesSource, string> = {
  input: '本次指定',
  workspace: '来自项目设置',
  default: '默认值'
};

/**
 * Deterministic one-line label for a plan's daily budget, e.g.
 * "每天可用 45 分钟 · 来自项目设置". Returns undefined when the plan carries no
 * usable minute budget, so the UI never invents a value or a source.
 */
export function availableMinutesLabel(
  minutes: number | undefined,
  source: AvailableMinutesSource | undefined
): string | undefined {
  if (minutes === undefined || !Number.isFinite(minutes) || minutes <= 0) return undefined;
  const origin = source ? AVAILABLE_MINUTES_SOURCE_LABELS[source] : undefined;
  return origin ? `每天可用 ${minutes} 分钟 · ${origin}` : `每天可用 ${minutes} 分钟`;
}

export interface WorkspacePlanTask {
  title: string;
  subject: string;
  durationMin: number;
  /** A verifiable definition of done for the task. */
  acceptance: string;
}

export interface WorkspacePlan {
  workspaceId: string;
  /** Local calendar date in YYYY-MM-DD form. */
  date: string;
  tasks: WorkspacePlanTask[];
  generatedBy: WorkspacePlanGeneratedBy;
  /** Minutes the plan was built around, and where that number came from. */
  availableMinutes?: number;
  availableMinutesSource?: AvailableMinutesSource;
}

export interface PlanWorkspaceInput {
  workspaceId: string;
  /** Local date (YYYY-MM-DD). Defaults to the planner's current local date. */
  date?: string;
  /** Total minutes available today. Defaults to 120. */
  availableMinutes?: number;
  /** Aborting must stop the model call instead of returning a template plan. */
  signal?: AbortSignal;
}

export interface WorkspacePlanner {
  plan(input: PlanWorkspaceInput): Promise<WorkspacePlan>;
}
