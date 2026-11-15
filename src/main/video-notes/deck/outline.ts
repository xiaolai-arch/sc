import { z } from 'zod';
import type { ModelClient } from '../../agent/model-client';
import type { Keyframe } from '../keyframes';
import type { ScreenRead } from '../screen-read';
import { outlineSchema, type Outline, type OutlineChapter } from './content';
import {
  DECK_MODEL_TIMEOUT_MS,
  jsonOutputRules,
  requestValidatedJson
} from './prompts';

/**
 * Step 5: chapter outline. One model call turns the sequence of screen reads
 * into 3–12 chapters covering the whole video. Chapters follow visible content
 * changes, not speech: there is no transcript. The answer is normalized first
 * — sorted, clamped to the video, and with the first chapter pinned to 0 and
 * the last to the duration — and only then validated, so a model that returns
 * a usable outline in a slightly scrambled order still produces a valid one.
 */

/** Bump when the prompt's instructions change; feeds checkpoint fingerprints. */
export const OUTLINE_PROMPT_VERSION = 2;

/** On-screen text is the only material now, so the prompt gets a real budget. */
export const OUTLINE_SCREEN_CHARS = 12_000;

export interface BuildOutlineOptions {
  client: ModelClient;
  durationSeconds: number;
  keyframes: Keyframe[];
  screenReads?: ScreenRead[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** `mm:ss`, with minutes allowed to exceed 59 for long lessons. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(total % 60)}`;
}

function normalizedDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface TimedLine {
  start: number;
  line: string;
}

function fitLines(lines: readonly TimedLine[], limit: number): string[] {
  if (lines.length === 0) return [];
  const out: string[] = [];
  let used = 0;
  for (const { line } of lines) {
    if (used + line.length + 1 <= limit) {
      out.push(line);
      used += line.length + 1;
      continue;
    }
    const room = limit - used - 1;
    if (room > 8) out.push(`${line.slice(0, room - 1)}…`);
    break;
  }
  return out.length > 0 ? out : [lines[0].line.slice(0, Math.max(1, limit))];
}

/**
 * A compact digest of what the frames say, in time order. Identical text is
 * shown once; a frame that needs a screenshot is marked so the outline knows a
 * figure exists. This digest is the only evidence the outline has.
 */
function screenDigest(
  reads: readonly ScreenRead[],
  limit = OUTLINE_SCREEN_CHARS
): string[] {
  const ordered = [...reads].sort((a, b) => a.t - b.t);
  const seen = new Set<string>();
  const lines: TimedLine[] = [];
  for (const read of ordered) {
    const text = read.text.trim();
    if (text.length === 0) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    const marker = read.keepImage ? '（截图）' : '';
    lines.push({ start: read.t, line: `[${clock(read.t)}] ${marker}${text}` });
  }
  return fitLines(lines, limit);
}

/**
 * The complete user prompt for the outline call: material, the field list and
 * the output rules. Exported so tests can assert on the prompt without a call.
 */
export function buildOutlinePrompt(
  durationSeconds: number,
  keyframes: readonly Keyframe[],
  screenReads: readonly ScreenRead[] = []
): string {
  const duration = normalizedDuration(durationSeconds);
  const screenLines = screenDigest(screenReads);

  return [
    '你在为一段讲课视频划分章节大纲。材料是视频里的关键帧和每帧画面上的文字，没有语音转写。只根据下面给出的画面文字，不要补充材料以外的知识。',
    '',
    `视频时长：${clock(duration)}（${Math.round(duration)} 秒）`,
    `关键帧：${keyframes.length} 张`,
    '',
    '【带时间戳的画面文字】',
    ...(screenLines.length > 0 ? screenLines : ['（没有可用的画面文字。）']),
    '',
    '要求：',
    '1. 按画面内容的变化把全片分成 3–12 个章节，按时间顺序覆盖整个视频：第一章从 0 秒开始，最后一章到视频结束。',
    '2. 章节首尾相接，不重叠、不留空档；start 和 end 都是秒数，end 必须大于 start。',
    '3. 每章的 start 和 end 要夹住这一章包含的画面时间；完全没有画面文字的章节可以省略，但整片仍要有章节覆盖。',
    '4. title 用中文写出这一章的内容结论，不超过 24 个字；不要写「第一部分」「本章」这类空标题。',
    '5. points 是 1–6 条本章知识点，每条一句短句，只能取自屏幕文字里出现的内容。',
    '6. 时间只能取自上面材料里出现的时间，不许编造。',
    '7. 不要写「老师说」「视频里讲」这类话：材料里没有语音，你不知道老师说了什么。',
    '',
    '输出 JSON：',
    '{"chapters":[{"title":"...","start":0,"end":180,"points":["...","..."]}]}',
    '',
    jsonOutputRules()
  ].join('\n');
}

/**
 * Normalizes a raw model answer before strict validation: keeps the chapters
 * whose window is usable, clamps them into `[0, duration]`, sorts them by
 * start, pins the first start to 0 and the last end to the duration, and drops
 * anything whose end is no longer after its start.
 */
function normalizeOutlineAnswer(value: unknown, durationSeconds: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const raw = (value as { chapters?: unknown }).chapters;
  if (!Array.isArray(raw)) return value;
  const duration = normalizedDuration(durationSeconds);

  const chapters: OutlineChapter[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.title !== 'string') continue;
    if (typeof record.start !== 'number' || !Number.isFinite(record.start)) continue;
    if (typeof record.end !== 'number' || !Number.isFinite(record.end)) continue;
    const start = clamp(record.start, 0, duration);
    const end = clamp(record.end, 0, duration);
    if (end <= start) continue;
    const points = Array.isArray(record.points)
      ? record.points
          .filter((point): point is string => typeof point === 'string')
          .map((point) => point.trim())
          .filter((point) => point.length > 0)
      : [];
    chapters.push({ title: record.title.trim(), start, end, points });
  }

  chapters.sort((a, b) => a.start - b.start);
  if (chapters.length === 0) return { chapters };
  chapters[0] = { ...chapters[0], start: 0 };
  const last = chapters[chapters.length - 1];
  chapters[chapters.length - 1] = { ...last, end: duration };
  return { chapters };
}

/**
 * Builds the chapter outline. The answer is normalized and validated inside
 * `requestValidatedJson`, so a broken answer is retried once with the
 * validation error and a second failure raises `DeckStepError`.
 */
export async function buildOutline(options: BuildOutlineOptions): Promise<Outline> {
  const {
    client,
    durationSeconds,
    keyframes,
    screenReads = [],
    signal,
    timeoutMs
  } = options;
  const duration = normalizedDuration(durationSeconds);

  const schema = z.preprocess(
    (value) => normalizeOutlineAnswer(value, duration),
    outlineSchema
  );

  return requestValidatedJson({
    client,
    request: {
      messages: [
        { role: 'user', content: buildOutlinePrompt(duration, keyframes, screenReads) }
      ],
      temperature: 0.2,
      maxTokens: 4_000,
      noTools: true,
      timeoutMs: timeoutMs ?? DECK_MODEL_TIMEOUT_MS
    },
    schema,
    step: 'outline',
    signal
  });
}
