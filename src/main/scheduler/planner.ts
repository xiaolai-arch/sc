import { randomUUID } from 'node:crypto';
import type { DailyPlan, ExamProfile, StudyTask } from '../../shared/types';
import type { ButlerService } from '../../shared/workspace';

export interface TodayPlanPlanner {
  /** Returns null when the model reply is unavailable or not valid JSON. */
  plan(date: string, profile: ExamProfile | null): Promise<DailyPlan | null>;
}

export interface TodayPlanPlannerOptions {
  butler: ButlerService;
}

const MAX_TASKS = 20;

/**
 * Builds the JSON-only planning request. The butler already owns the
 * teacher/planner persona and workspace context, so this prompt only adds the
 * structured task contract.
 */
export function buildTodayPlanPrompt(date: string, profile: ExamProfile | null): string {
  const subjects = profile && profile.subjects.length > 0 ? profile.subjects : [{ name: '学习' }];
  const dailyMinutes = profile?.dailyMinutes ?? 120;
  return [
    `请为 ${date} 生成一份可直接执行的中文学习计划。`,
    `目标科目：${subjects.map((subject) => subject.name).join('、')}。`,
    `今日可用时间：约 ${dailyMinutes} 分钟。`,
    '结合当前工作区、待办和长期记忆，安排 2-6 个任务。',
    '只输出一个 JSON 对象，不要 Markdown、解释或代码围栏。',
    '格式：{"tasks":[{"title":"任务标题","subject":"科目","durationMin":45,"acceptance":"完成标准","materialRefs":[]}]}',
    '每项 durationMin 必须是正整数，所有任务总时长应接近可用时间。'
  ].join('\n');
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();

  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');

  // A bare array reply must be sliced as an array, not as its first object.
  if (trimmed.startsWith('[') && firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  if (firstBrace >= 0 && lastBrace > firstBrace) return trimmed.slice(firstBrace, lastBrace + 1);
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTask(value: unknown): StudyTask | null {
  const record = asRecord(value);
  if (!record) return null;
  const title = asText(record.title);
  const subject = asText(record.subject);
  const rawDuration = typeof record.durationMin === 'number' ? record.durationMin : Number(record.durationMin);
  if (!title || !subject || !Number.isFinite(rawDuration) || rawDuration <= 0) return null;

  const acceptance = asText(record.acceptance) || '完成任务并记录结果';
  const materialRefs = Array.isArray(record.materialRefs)
    ? record.materialRefs.filter((entry): entry is string => typeof entry === 'string')
    : [];

  return {
    id: randomUUID(),
    title,
    subject,
    durationMin: Math.max(5, Math.min(600, Math.round(rawDuration))),
    materialRefs,
    acceptance,
    status: 'pending'
  };
}

/** Parses a model reply into a validated daily plan; null means "fall back". */
export function parseTodayPlanReply(text: string, date: string): DailyPlan | null {
  const json = extractJson(text);
  if (!json) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }

  const record = asRecord(parsed);
  const rawTasks = Array.isArray(parsed) ? parsed : record?.tasks;
  if (!Array.isArray(rawTasks)) return null;

  const tasks = rawTasks
    .slice(0, MAX_TASKS)
    .map(parseTask)
    .filter((task): task is StudyTask => task !== null);

  if (tasks.length === 0) return null;
  return { date, tasks, generatedBy: 'agent' };
}

/**
 * Butler-backed planner. It deliberately depends only on the `ButlerService`
 * contract, so tests can drive it with template replies or a FakeModelClient.
 */
export function createTodayPlanPlanner(options: TodayPlanPlannerOptions): TodayPlanPlanner {
  return {
    async plan(date, profile) {
      try {
        const result = await options.butler.send({
          message: buildTodayPlanPrompt(date, profile)
        });
        return parseTodayPlanReply(result.text, date);
      } catch {
        return null;
      }
    }
  };
}
