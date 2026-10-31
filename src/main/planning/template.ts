import type { WorkspacePlan, WorkspacePlanTask } from '../../shared/planning';
import type { Workspace, WorkspaceKind } from '../../shared/workspace';
import { MAX_PLAN_TASKS, MIN_TASK_MINUTES } from './parse';

const MAX_TITLE_LENGTH = 48;

const KIND_LABEL: Record<WorkspaceKind, string> = {
  exam: '复习',
  study: '学习',
  project: '项目',
  life: '生活'
};

export interface TemplatePlanInput {
  workspace: Workspace;
  date: string;
  availableMinutes: number;
}

/**
 * Deterministic fallback used when the model is unavailable or returns prose,
 * empty tasks, or malformed/truncated JSON. It only uses the workspace goal
 * (then description/name) and the user's available time.
 */
export function buildTemplatePlan(input: TemplatePlanInput): WorkspacePlan {
  const subject = input.workspace.name.trim() || KIND_LABEL[input.workspace.kind];
  const source =
    input.workspace.goal.trim() ||
    input.workspace.description.trim() ||
    input.workspace.name.trim() ||
    '今天的下一步';

  const titles = dedupe(
    source
      .split(/[。；;！!？?\n，,、]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => clip(part, MAX_TITLE_LENGTH))
  ).slice(0, MAX_PLAN_TASKS);

  if (titles.length === 0) {
    titles.push(clip(source, MAX_TITLE_LENGTH));
  }

  const durations = distributeMinutes(input.availableMinutes, titles.length);
  const tasks: WorkspacePlanTask[] = titles.map((title, index) => ({
    title,
    subject,
    durationMin: durations[index] ?? MIN_TASK_MINUTES,
    acceptance: `完成「${title}」并记录结果`
  }));

  return {
    workspaceId: input.workspace.id,
    date: input.date,
    tasks,
    generatedBy: 'template'
  };
}

function distributeMinutes(totalMinutes: number, count: number): number[] {
  const total = Math.max(Math.round(totalMinutes), count * MIN_TASK_MINUTES);
  const base = Math.floor(total / count);
  return Array.from({ length: count }, (_value, index) =>
    index === count - 1 ? total - base * (count - 1) : base
  );
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function clip(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
