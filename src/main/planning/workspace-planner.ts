import { formatLocalDate } from '../../shared/date';
import type {
  PlanWorkspaceInput,
  WorkspacePlan,
  WorkspacePlanner
} from '../../shared/planning';
import type { WorkspaceService } from '../../shared/workspace';
import type { ModelClient } from '../agent/model-client';
import { parseWorkspacePlanReply } from './parse';
import { buildWorkspacePlanPrompt } from './prompt';
import { buildTemplatePlan } from './template';

const DEFAULT_AVAILABLE_MINUTES = 120;
const MIN_AVAILABLE_MINUTES = 5;
const MAX_AVAILABLE_MINUTES = 24 * 60;
const PLAN_MAX_TOKENS = 1_000;
const PLAN_TEMPERATURE = 0.2;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface WorkspacePlannerOptions {
  /** When null/omitted, the planner uses the deterministic template. */
  modelClient?: ModelClient | null;
  workspaceService: WorkspaceService;
  now?: () => Date;
}

/**
 * Generates a validated workspace plan from the workspace goal, recent
 * notes/memory, and the available time for a day. Model failures or unusable
 * replies degrade to a deterministic template plan instead of surfacing errors.
 */
export class WorkspacePlannerImpl implements WorkspacePlanner {
  private readonly modelClient: ModelClient | null;
  private readonly workspaceService: WorkspaceService;
  private readonly now: () => Date;

  constructor(options: WorkspacePlannerOptions) {
    this.modelClient = options.modelClient ?? null;
    this.workspaceService = options.workspaceService;
    this.now = options.now ?? (() => new Date());
  }

  async plan(input: PlanWorkspaceInput): Promise<WorkspacePlan> {
    throwIfAborted(input.signal);
    const date = resolveDate(input.date, this.now());
    const availableMinutes = normalizeAvailableMinutes(input.availableMinutes);
    const snapshot = await this.workspaceService.getWorkspaceSnapshot(input.workspaceId);

    if (this.modelClient !== null) {
      try {
        const prompt = buildWorkspacePlanPrompt({
          workspace: snapshot.workspace,
          notes: snapshot.notes,
          memory: snapshot.memory,
          date,
          availableMinutes
        });
        const response = await this.modelClient.complete({
          messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
          ],
          temperature: PLAN_TEMPERATURE,
          maxTokens: PLAN_MAX_TOKENS,
          ...(input.signal ? { signal: input.signal } : {})
        });
        throwIfAborted(input.signal);
        const plan = parseWorkspacePlanReply(response.text, snapshot.workspace.id, date);
        if (plan !== null) return plan;
      } catch (error) {
        // Abort is not a model failure: never mask it with a template plan.
        if (input.signal?.aborted) throw abortError();
        // Any other model failure falls through to the local template plan.
      }
    }

    return buildTemplatePlan({
      workspace: snapshot.workspace,
      date,
      availableMinutes
    });
  }
}

export function createWorkspacePlanner(options: WorkspacePlannerOptions): WorkspacePlanner {
  return new WorkspacePlannerImpl(options);
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError();
}

function resolveDate(value: string | undefined, now: Date): string {
  if (value === undefined) return formatLocalDate(now);
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Invalid plan date: ${value}`);
  }
  return value;
}

function normalizeAvailableMinutes(value: number | undefined): number {
  if (value === undefined) return DEFAULT_AVAILABLE_MINUTES;
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_AVAILABLE_MINUTES;
  return Math.min(MAX_AVAILABLE_MINUTES, Math.max(MIN_AVAILABLE_MINUTES, Math.round(value)));
}
