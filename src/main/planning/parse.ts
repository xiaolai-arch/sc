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

  const parsed = parseJsonLenient(json);
  if (parsed === null) return null;

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

/**
 * Strict JSON.parse first; when it fails, repairs the small mistakes a model
 * makes in long Chinese JSON — raw line breaks inside string literals, trailing
 * commas, a reply cut off before the final closers — and parses again.
 * `truncated` reports that the tail was rebuilt, which callers that need a
 * complete plan treat as a failed reply so they can retry.
 */
export type LenientJsonResult = { value: unknown; truncated: boolean };

export function parseJsonLenientDetailed(json: string): LenientJsonResult | null {
  try {
    return { value: JSON.parse(json), truncated: false };
  } catch {
    // Fall through to the repair pass.
  }
  const repaired = repairJson(json);
  if (repaired.text === json) return null;
  try {
    return { value: JSON.parse(repaired.text), truncated: repaired.truncated };
  } catch {
    return null;
  }
}

export function parseJsonLenient(json: string): unknown | null {
  return parseJsonLenientDetailed(json)?.value ?? null;
}

function repairJson(json: string): { text: string; truncated: boolean } {
  const closed = closeOpenStructures(escapeRawControlChars(json));
  return { text: removeTrailingCommas(closed.text), truncated: closed.truncated };
}

/** Escapes \n / \r / \t that sit inside string literals. */
function escapeRawControlChars(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
      } else if (ch === '\\') {
        out += ch;
        escaped = true;
      } else if (ch === '"') {
        inString = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
      } else if (ch === '\r') {
        out += '\\r';
      } else if (ch === '\t') {
        out += '\\t';
      } else {
        out += ch;
      }
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

/** Closes a truncated reply: an unterminated string and any open brackets. */
function closeOpenStructures(json: string): { text: string; truncated: boolean } {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of json) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if ((ch === '}' || ch === ']') && stack[stack.length - 1] === ch) stack.pop();
  }
  if (!inString && stack.length === 0) return { text: json, truncated: false };
  let out = json;
  if (inString) out += '"';
  while (stack.length > 0) out += stack.pop();
  return { text: out, truncated: true };
}

/** Drops `, }` / `, ]` sequences outside string literals. */
function removeTrailingCommas(json: string): string {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let index = 0; index < json.length; index += 1) {
    const ch = json[index]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === ',') {
      let look = index + 1;
      while (look < json.length && /\s/.test(json[look]!)) look += 1;
      const next = json[look];
      if (next === '}' || next === ']') continue;
    }
    out += ch;
  }
  return out;
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
