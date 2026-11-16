/**
 * Shared contract for workspace planning. The planner turns a workspace goal
 * plus recent notes/memory and the available time for a day into a small,
 * validated list of actionable tasks.
 */

/** Who produced the plan: the injected model or the deterministic template. */
export type WorkspacePlanGeneratedBy = 'agent' | 'template';

/** Which input supplied the daily minute budget the plan was built around. */
export type AvailableMinutesSource = 'input' | 'workspace' | 'default';

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
