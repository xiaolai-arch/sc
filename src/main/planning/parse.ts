import type { WorkspacePlan, WorkspacePlanTask } from '../../shared/planning';

export const MAX_PLAN_TASKS = 5;
export const MIN_TASK_MINUTES = 5;
export const MAX_TASK_MINUTES = 600;

/**
 * Parses a model reply into a validated workspace plan. Returns null when the
 * reply is prose, empty, truncated, or contains no usable task, so callers can
 * fall back to the deterministic template plan.
 */
export function parseWorkspacePlanReply(
  text: string,
  workspaceId: string,
  date: string
): WorkspacePlan | null {
  const json = extractJson(text);
  if (json === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  const rawTasks = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.tasks)
      ? record.tasks
      : null;
  if (rawTasks === null) return null;

  const tasks: WorkspacePlanTask[] = [];
  const seen = new Set<string>();
  for (const raw of rawTasks) {
    if (tasks.length >= MAX_PLAN_TASKS) break;
    const task = parseTask(raw);
    if (task === null) continue;
    const key = `${task.title.toLocaleLowerCase()}\u0000${task.subject.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tasks.push(task);
  }

  if (tasks.length === 0) return null;
  return { workspaceId, date, tasks, generatedBy: 'agent' };
}

/** Extracts the last fenced or bare JSON block from a model reply. */
export function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Prefer the last fenced block: CLI agents may print a banner or example first.
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (let index = fenced.length - 1; index >= 0; index -= 1) {
    const body = fenced[index]?.[1]?.trim();
    if (body) return body;
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');

  // A bare array must be sliced as an array, not as its first object.
  if (trimmed.startsWith('[') && firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  return null;
}

function parseTask(value: unknown): WorkspacePlanTask | null {
  const record = asRecord(value);
  if (!record) return null;

  const title = asText(record.title);
  const subject = asText(record.subject);
  const acceptance = asText(record.acceptance);
  if (!title || !subject || !acceptance) return null;

  const rawDuration =
    typeof record.durationMin === 'number' ? record.durationMin : Number(record.durationMin);
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) return null;

  return {
    title,
    subject,
    durationMin: Math.max(
      MIN_TASK_MINUTES,
      Math.min(MAX_TASK_MINUTES, Math.round(rawDuration))
    ),
    acceptance
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
