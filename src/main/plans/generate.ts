import type { CreateLongPlanInput } from '../../shared/plans';
import {
  buildTemplatePlan,
  clipPlanText,
  normalizeLongPlanPhases,
  type GeneratedLongPlan,
  type LongPlanGenerationInput,
  type RawDay,
  type RawPhase,
  type RawWeek
} from '../../shared/plan-template';
import type { ModelClient } from '../agent/model-client';
import { extractJson } from '../planning/parse';
import { buildLongPlanPrompt } from './prompt';

const MAX_PHASES = 4;
const MAX_TASKS_PER_DAY = 4;
const MAX_CHECKS_PER_WEEK = 6;
const MAX_TITLE_LENGTH = 100;
const MAX_TASK_LENGTH = 120;
const MAX_OUTPUT_LENGTH = 160;
const MAX_CHECK_LENGTH = 120;
const MODEL_MAX_TOKENS = 16_000;
const MODEL_TEMPERATURE = 0.3;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown, maxLength = MAX_TITLE_LENGTH): string {
  return typeof value === 'string' ? clipPlanText(value, maxLength) : '';
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    const text =
      typeof entry === 'string'
        ? entry
        : Array.isArray(entry)
          ? (entry.find((part): part is string => typeof part === 'string') ?? '')
          : asText(asRecord(entry)?.text, MAX_TASK_LENGTH);
    const clipped = asText(text, MAX_TASK_LENGTH);
    if (clipped) items.push(clipped);
  }
  return items;
}

function coerceDay(value: unknown): RawDay | null {
  const record = asRecord(value);
  if (record === null) return null;
  const tasks = asTextArray(record.tasks).slice(0, MAX_TASKS_PER_DAY);
  const output = asText(record.output, MAX_OUTPUT_LENGTH);
  if (tasks.length === 0 && !output) return null;
  return { tasks, output };
}

function coerceWeek(value: unknown): RawWeek | null {
  const record = asRecord(value);
  if (record === null) return null;
  const days = Array.isArray(record.days)
    ? record.days
        .map(coerceDay)
        .filter((day): day is RawDay => day !== null)
        .slice(0, 7)
    : [];
  const checks = asTextArray(record.checks ?? record.checkItems)
    .map((entry) => clipPlanText(entry, MAX_CHECK_LENGTH))
    .slice(0, MAX_CHECKS_PER_WEEK);
  if (days.length === 0 && checks.length === 0) return null;
  return {
    title: asText(record.title),
    goal: asText(record.goal),
    days,
    checks
  };
}

function coercePhase(value: unknown): RawPhase | null {
  const record = asRecord(value);
  if (record === null) return null;
  const weeks = Array.isArray(record.weeks)
    ? record.weeks.map(coerceWeek).filter((week): week is RawWeek => week !== null)
    : [];
  if (weeks.length === 0) return null;
  return {
    title: asText(record.title),
    subtitle: asText(record.subtitle),
    goal: asText(record.goal),
    weeks
  };
}

/** Parses the model's phase/week/day JSON; null means "use the template". */
export function parseLongPlanReply(text: string): RawPhase[] | null {
  const json = extractJson(text);
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  const rawPhases = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record?.phases)
      ? record.phases
      : Array.isArray(record?.weeks)
        ? [{ title: asText(record.title), weeks: record.weeks }]
        : null;
  if (rawPhases === null) return null;
  const phases = rawPhases
    .map(coercePhase)
    .filter((phase): phase is RawPhase => phase !== null)
    .slice(0, MAX_PHASES);
  return phases.length === 0 ? null : phases;
}

export async function generateLongPlan(
  input: LongPlanGenerationInput,
  modelClient: ModelClient | null
): Promise<GeneratedLongPlan> {
  if (modelClient !== null) {
    try {
      const prompt = buildLongPlanPrompt({
        input: toCreateInput(input),
        workspace: input.workspace,
        ...(input.researchFacts?.length ? { researchFacts: input.researchFacts } : {}),
        ...(input.knownTopics?.length ? { knownTopics: input.knownTopics } : {}),
        ...(input.recalibration ? { recalibration: input.recalibration } : {})
      });
      const response = await modelClient.complete({
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user }
        ],
        temperature: MODEL_TEMPERATURE,
        maxTokens: MODEL_MAX_TOKENS
      });
      const raw = parseLongPlanReply(response.text);
      if (raw !== null) {
        return {
          phases: normalizeLongPlanPhases(raw, input),
          generatedBy: 'agent'
        };
      }
    } catch {
      // A broken model must not lose the plan request; fall through to template.
    }
  }
  return buildTemplatePlan(input);
}

function toCreateInput(input: LongPlanGenerationInput): CreateLongPlanInput {
  return {
    workspaceId: input.workspace.id,
    goal: input.goal,
    startDate: input.startDate,
    weeks: input.weeks,
    weeklyHours: input.weeklyHours,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.references ? { references: input.references } : {})
  };
}
