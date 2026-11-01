import type { ReviewAnswers } from '../../shared/types';
import type { MemoryKind } from '../../shared/memory';
import type { ModelClient, ModelMessage } from '../agent/model-client';
import { isMemoryKind } from './records';

/** Shape the model must produce (before validation). */
type Candidate = { text: string; kind: MemoryKind };

export interface ReviewSynthesisSource {
  workspaceName: string;
  workspaceGoal: string;
  date: string;
  answers: ReviewAnswers;
}

/** Keep memory items short enough to inject into butler prompts. */
const MAX_TEXT_LENGTH = 200;
const MAX_ITEMS = 3;

function truncate(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length <= MAX_TEXT_LENGTH ? trimmed : `${trimmed.slice(0, MAX_TEXT_LENGTH)}…`;
}

function nonEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Deterministic fallback: one memory item per non-empty review answer, capped at
 * three. Same answers always produce the same items, so behavior is identical
 * with and without a model key.
 */
export function synthesizeByRules(answers: ReviewAnswers): Candidate[] {
  const candidates: Candidate[] = [];
  const stuck = nonEmpty(answers?.stuck);
  const completed = nonEmpty(answers?.completed);
  const tomorrow = nonEmpty(answers?.tomorrow);
  // Stuck points matter most for coaching, so they come first when the cap hits.
  if (stuck) candidates.push({ text: truncate(stuck), kind: 'weakness' });
  if (completed) candidates.push({ text: truncate(completed), kind: 'strength' });
  if (tomorrow) candidates.push({ text: truncate(tomorrow), kind: 'plan' });
  return candidates.slice(0, MAX_ITEMS);
}

function coerceItems(parsed: unknown): Candidate[] | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { items } = parsed as Record<string, unknown>;
  if (!Array.isArray(items) || items.length === 0) return null;
  const candidates: Candidate[] = [];
  for (const value of items) {
    if (typeof value !== 'object' || value === null) continue;
    const text = nonEmpty((value as Record<string, unknown>).text);
    if (!text) continue;
    const rawKind = (value as Record<string, unknown>).kind;
    candidates.push({ text: truncate(text), kind: isMemoryKind(rawKind) ? rawKind : 'fact' });
  }
  return candidates.length === 0 ? null : candidates.slice(0, MAX_ITEMS);
}

/**
 * Extracts a JSON object from model output: fenced ```json blocks first, then
 * the outermost brace-to-brace span, so prose around the JSON is tolerated.
 */
export function parseModelItems(raw: string): Candidate[] | null {
  const candidates: string[] = [];
  for (const match of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    candidates.push(match[1].trim());
  }
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start !== -1 && end > start) candidates.push(raw.slice(start, end + 1));
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate);
    } catch {
      continue;
    }
    const items = coerceItems(parsed);
    if (items !== null) return items;
  }
  return null;
}

function buildMessages(source: ReviewSynthesisSource): ModelMessage[] {
  const system = [
    '你是阿咲的记忆整理助手。根据用户的每日复盘回答，提炼 1–3 条对后续辅导有长期参考价值的记忆。',
    '只输出一个 JSON 对象，不要任何其他文字，格式：',
    '{"items":[{"text":"...","kind":"weakness|strength|preference|plan|fact"}]}',
    'text 不超过 60 字，用第三人称陈述（例如“极限定义不熟”而不是“我今天……”）；',
    'kind 说明该条记忆的类型：weakness=薄弱点，strength=优势/进展，preference=学习偏好，plan=接下来的打算，fact=其他值得记住的事实。'
  ].join('\n');
  const user = [
    `工作区：${source.workspaceName}`,
    source.workspaceGoal ? `目标：${source.workspaceGoal}` : null,
    `复盘日期：${source.date}`,
    '复盘回答（completed=完成了什么，stuck=卡在哪里，tomorrow=明天做什么）：',
    JSON.stringify(
      {
        completed: nonEmpty(source.answers?.completed),
        stuck: nonEmpty(source.answers?.stuck),
        tomorrow: nonEmpty(source.answers?.tomorrow)
      },
      null,
      2
    )
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
}

/**
 * Model-backed synthesis. Returns null when the client fails or its output is
 * not a valid 1–3 item JSON — the caller then falls back to `synthesizeByRules`.
 */
export async function synthesizeByModel(
  modelClient: ModelClient,
  source: ReviewSynthesisSource,
  options: {
    temperature?: number;
    maxTokens?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Candidate[] | null> {
  let text: string;
  try {
    const response = await modelClient.complete({
      messages: buildMessages(source),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { maxTokens: options.maxTokens } : {}),
      ...(options.signal ? { signal: options.signal } : {})
    });
    text = response.text;
  } catch (error) {
    if (options.signal?.aborted) throw abortError();
    return null;
  }
  if (options.signal?.aborted) throw abortError();
  return parseModelItems(text);
}

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}
