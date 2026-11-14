import type { z } from 'zod';
import type { ModelClient, ModelMessage, ModelRequest } from '../../agent/model-client';

/**
 * Shared plumbing for the deck-writing model calls. Every step follows the same
 * contract: ask for one JSON value, parse it defensively, validate it with zod,
 * and retry exactly once with the error text appended when the answer is
 * unusable. A second failure ends the step.
 */

/** Bump when a prompt's instructions change; feeds checkpoint fingerprints. */
export const DECK_PROMPT_VERSION = 1;

/** Deck-writing calls read long transcripts; 5 minutes is the practical cap. */
export const DECK_MODEL_TIMEOUT_MS = 300_000;

/** A step's model answer could not be turned into valid content. */
export class DeckStepError extends Error {
  constructor(
    readonly step: string,
    message: string,
    readonly issues: string[] = []
  ) {
    super(`课件步骤「${step}」失败：${message}`);
    this.name = 'DeckStepError';
  }
}

/**
 * Pulls the first complete JSON value out of a model answer. Tolerates a code
 * fence and prose on either side; objects and arrays are both accepted.
 */
export function extractJsonValue(text: string): unknown {
  const cleaned = text.replace(/^﻿/, '').trim();
  const fenced = /```(?:json)?\s*\r?\n?([\s\S]*?)```/i.exec(cleaned);
  const body = fenced ? fenced[1].trim() : cleaned;
  const objectStart = body.indexOf('{');
  const arrayStart = body.indexOf('[');
  let start: number;
  if (objectStart === -1) start = arrayStart;
  else if (arrayStart === -1) start = objectStart;
  else start = Math.min(objectStart, arrayStart);
  if (start === -1) {
    throw new DeckStepError('parse', '模型返回的内容里没有 JSON。');
  }
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) {
    throw new DeckStepError('parse', '模型返回的 JSON 不完整。');
  }
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new DeckStepError('parse', '模型返回的内容不是合法 JSON。');
  }
}

/** Instructions shared by every deck prompt, appended before the schema. */
export function jsonOutputRules(): string {
  return [
    '输出规则：',
    '1. 只输出一个 JSON 值，不要解释，不要代码围栏，不要前后缀文字。',
    '2. 所有文字使用简体中文；引号和换行必须按 JSON 规则转义。',
    '3. 时间一律用秒数（数字），不要用 mm:ss。',
    '4. 只使用材料里出现的事实。材料里没有的内容不要补写；确实需要补充时，必须标成「扩展」并说明依据。',
    '5. 字段名和取值范围严格按下面的说明，不要增加字段，不要省略必填字段。'
  ].join('\n');
}

/** Appends a retry hint to the last user message of a request. */
function withRetryHint(request: ModelRequest, hint: string): ModelRequest {
  const messages: ModelMessage[] = request.messages.map((message) => ({ ...message }));
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      messages[i] = { ...messages[i], content: `${messages[i].content}\n\n${hint}` };
      break;
    }
  }
  return { ...request, messages };
}

function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

export interface RequestValidatedJsonOptions<T> {
  client: ModelClient;
  request: ModelRequest;
  schema: z.ZodType<T>;
  /** Step name used in errors and logs, e.g. `outline`. */
  step: string;
  signal?: AbortSignal;
  /** Defaults to one retry, which the design doc fixes. */
  retries?: number;
}

/**
 * Calls the model and validates its answer. An invalid answer is retried once
 * with the validation error fed back; the returned value is always valid.
 * Abort and provider errors (timeout, no image support) propagate untouched.
 */
export async function requestValidatedJson<T>(
  options: RequestValidatedJsonOptions<T>
): Promise<T> {
  const { client, request, schema, step, signal, retries = 1 } = options;
  let current = request;
  let lastMessage = '模型没有返回可用内容。';

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) {
      const aborted = new Error('已取消。');
      aborted.name = 'AbortError';
      throw aborted;
    }
    const response = await client.complete({ ...current, signal });
    let value: unknown;
    let issues: string[] = [];
    try {
      value = extractJsonValue(response.text);
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      issues = [lastMessage];
    }
    if (issues.length === 0) {
      const parsed = schema.safeParse(value);
      if (parsed.success) return parsed.data;
      issues = describeIssues(parsed.error);
      lastMessage = issues.join('；');
    }
    if (attempt === retries) break;
    current = withRetryHint(
      current,
      `上一次的回答无法使用：${lastMessage}\n请只输出符合要求的 JSON，修正上述问题后重试。`
    );
  }

  throw new DeckStepError(step, lastMessage);
}
