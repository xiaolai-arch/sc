import { z } from 'zod';
import type { ModelClient, ModelImage, ModelRequest } from '../agent/model-client';
import { createAbortError } from './frames';
import type { Keyframe } from './keyframes';

/**
 * Screen reading: hand keyframes to a vision model four at a time and get back
 * the on-screen text for each frame. The model never sees file paths or times,
 * only a one-based index, so a confused answer cannot misattribute a timestamp.
 */

export const SCREEN_READ_KINDS = [
  'slide',
  'handwriting',
  'figure',
  'speaker-only',
  'other'
] as const;

export type ScreenReadKind = (typeof SCREEN_READ_KINDS)[number];

/** Marker the prompt asks for wherever the text is covered. */
export const OCCLUDED_MARK = '〔遮挡〕';

/** The doc fixes the batch at four frames (each 1280px frame costs ~650 tokens). */
export const SCREEN_READ_BATCH_SIZE = 4;

/** Vision calls are slow; the CLI default of 180s is not enough for four frames. */
export const DEFAULT_SCREEN_READ_TIMEOUT_MS = 240_000;

export interface ScreenRead {
  /** Frame path relative to the lesson folder, e.g. `frames/12000.jpg`. */
  frame: string;
  /** Seconds into the source video. */
  t: number;
  kind: ScreenReadKind;
  /** Verbatim on-screen text; covered spots carry {@link OCCLUDED_MARK}. */
  text: string;
  occluded: boolean;
  /** The frame must be shown as an image (diagrams, handwriting). */
  keepImage: boolean;
}

/** One validated item from the model, before a frame is attached to it. */
export interface ScreenReadDraft {
  /** One-based index into the batch, when the model supplied a usable one. */
  index: number | null;
  kind: ScreenReadKind;
  text: string;
  occluded: boolean;
  keepImage: boolean;
}

/** Reported per failed batch; one bad batch never aborts the whole run. */
export interface ScreenBatchError {
  /** Zero-based batch number. */
  batch: number;
  /** How many frames were sent in this batch. */
  frames: number;
  /** How many frames produced a usable read (0 after a second failure). */
  read: number;
  message: string;
}

export interface ReadScreensOptions {
  frames: Keyframe[];
  client: ModelClient;
  signal?: AbortSignal;
  batchSize?: number;
  timeoutMs?: number;
  /** Called with the retained reads of each successful batch. */
  onBatch?: (reads: ScreenRead[]) => void;
  /** Called when a batch still failed after one retry. */
  onBatchError?: (update: ScreenBatchError) => void;
}

/** Raised when a model answer cannot be turned into screen reads. */
export class ScreenParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScreenParseError';
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Formats a source time as `〔画面 mm:ss〕`. Minutes are not wrapped at 60 and
 * are padded to two digits, matching how the compose step labels screen
 * sources.
 */
export function formatScreenLabel(t: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(t) ? t : 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `〔画面 ${pad(minutes)}:${pad(seconds)}〕`;
}

/**
 * Ensures a read carries the occlusion marker. Idempotent: text that already
 * has the marker is returned unchanged, and empty text becomes the marker.
 */
export function markOccluded(text: string): string {
  const trimmed = text.trim();
  if (trimmed.includes(OCCLUDED_MARK)) return trimmed;
  if (trimmed === '') return OCCLUDED_MARK;
  return `${trimmed}${OCCLUDED_MARK}`;
}

/** Validates one raw model item. Unknown extra fields are ignored. */
export const screenReadSchema = z.object({
  index: z.number().int().min(1).optional(),
  kind: z.enum(SCREEN_READ_KINDS),
  text: z.string(),
  occluded: z.boolean().optional(),
  keepImage: z.boolean().optional()
});

export type ScreenReadItem = z.infer<typeof screenReadSchema>;

/** Maps common spelling variants onto the canonical kinds. */
function normalizeKind(value: unknown): ScreenReadKind {
  if (typeof value !== 'string') return 'other';
  const key = value.trim().toLowerCase().replace(/[\s_]+/g, '-');
  switch (key) {
    case 'slide':
    case 'slides':
    case 'screen':
      return 'slide';
    case 'handwriting':
    case 'handwritten':
      return 'handwriting';
    case 'figure':
    case 'diagram':
    case 'image':
      return 'figure';
    case 'speaker-only':
    case 'speaker':
    case 'talking-head':
      return 'speaker-only';
    default:
      return 'other';
  }
}

function normalizeIndex(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    return parsed > 0 ? parsed : undefined;
  }
  return undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Pre-digests a raw item into the schema shape. Items without a string `text`
 * are passed through untouched so validation rejects them: we never fabricate
 * a read for a frame whose answer we could not parse.
 */
function normalizeScreenItem(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== 'string') return value;
  const index = normalizeIndex(record.index);
  return {
    ...(index === undefined ? {} : { index }),
    kind: normalizeKind(record.kind),
    text: record.text,
    occluded: normalizeBoolean(record.occluded),
    keepImage: normalizeBoolean(record.keepImage)
  };
}

/**
 * Extracts the outermost `[...]` from a model answer, tolerating a code fence
 * and prose on either side, then returns it as raw JSON text.
 */
function extractJsonArray(text: string): string {
  const withoutFence = text
    .replace(/^﻿/, '')
    .replace(/^\s*```[a-zA-Z0-9_-]*[ \t]*\r?\n?/, '')
    .replace(/```\s*$/, '');
  const start = withoutFence.indexOf('[');
  const end = withoutFence.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new ScreenParseError('模型返回的内容里没有 JSON 数组。');
  }
  return withoutFence.slice(start, end + 1);
}

/**
 * Parses and validates a model answer into drafts. Malformed items are
 * skipped; the returned list may be shorter than the array in the answer.
 * Throws {@link ScreenParseError} when there is no usable JSON array at all.
 */
export function parseScreenReads(responseText: string): ScreenReadDraft[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonArray(responseText));
  } catch (error) {
    if (error instanceof ScreenParseError) throw error;
    throw new ScreenParseError('模型返回的内容不是合法的 JSON。');
  }
  if (!Array.isArray(parsed)) {
    throw new ScreenParseError('模型返回的不是 JSON 数组。');
  }

  const drafts: ScreenReadDraft[] = [];
  for (const item of parsed) {
    const result = screenReadSchema.safeParse(normalizeScreenItem(item));
    if (!result.success) continue;
    const data = result.data;
    const text = data.text.trim();
    drafts.push({
      index: data.index ?? null,
      kind: data.kind,
      text,
      occluded: data.occluded ?? text.includes(OCCLUDED_MARK),
      keepImage: data.keepImage ?? data.kind === 'figure'
    });
  }
  return drafts;
}

/** Instructions for one batch. Frames are referred to only by their index. */
export function buildScreenPrompt(batch: Keyframe[]): string {
  const count = batch.length;
  const example = JSON.stringify([
    { index: 1, kind: 'slide', text: '主谓一致', occluded: false, keepImage: false }
  ]);
  return [
    `你在为讲课视频抄录「画面上的文字」。下面按顺序给出 ${count} 张关键帧，编号从 1 到 ${count}。`,
    '',
    '只输出一个 JSON 数组，不要任何解释，也不要加代码围栏。数组中每个元素对应一张画面，字段固定为：',
    '- index：画面编号，从 1 开始（最多一次处理 4 张画面）；',
    '- kind：画面类型，只能是 "slide"（幻灯片或屏幕文字）、"handwriting"（手写批注）、"figure"（整屏图片或图表）、"speaker-only"（只有老师，没有文字）、"other"；',
    '- text：逐字抄写画面上的文字，保留原文和标点；看不清或被挡住的地方写〔遮挡〕，不许猜测或补全；',
    '- occluded：画面文字是否被遮挡，true 或 false；',
    '- keepImage：是否需要保留截图，整屏图片或图表为 true，纯文字为 false。',
    '',
    '规则：',
    '1. 只抄写画面里真实存在的文字，绝不编造、补充或改写。',
    '2. 题干、选项、范文等屏幕原文要逐字照抄。',
    '3. 手写批注归为 "handwriting"。',
    '4. 整屏图片或图表归为 "figure"，并把 keepImage 设为 true。',
    '5. 画面里只有老师、没有文字时，kind 为 "speaker-only"，text 为空字符串。',
    '6. 文字被老师或遮挡物挡住时，occluded 设为 true，并在 text 的对应位置写〔遮挡〕。',
    '',
    '最多一次处理 4 张画面。示例：',
    example
  ].join('\n');
}

/** `frames/<ms>.jpg`, derived from the absolute keyframe path. */
function frameRelativePath(framePath: string): string {
  const base = framePath.split(/[\\/]/).pop() || framePath;
  return `frames/${base}`;
}

/**
 * Attaches frames to drafts. A valid one-based index wins; otherwise the next
 * unused frame in order is used. Each frame is claimed at most once, and a
 * frame without an answer is simply omitted.
 */
function toScreenReads(drafts: ScreenReadDraft[], batch: Keyframe[]): ScreenRead[] {
  const total = batch.length;
  const used = new Set<number>();
  const assigned: Array<{ frameIndex: number; draft: ScreenReadDraft }> = [];
  const unassigned: ScreenReadDraft[] = [];

  for (const draft of drafts) {
    const index = draft.index;
    if (index !== null && index >= 1 && index <= total && !used.has(index - 1)) {
      used.add(index - 1);
      assigned.push({ frameIndex: index - 1, draft });
    } else {
      unassigned.push(draft);
    }
  }

  for (const draft of unassigned) {
    let frameIndex = -1;
    for (let i = 0; i < total; i += 1) {
      if (!used.has(i)) {
        frameIndex = i;
        break;
      }
    }
    if (frameIndex === -1) continue;
    used.add(frameIndex);
    assigned.push({ frameIndex, draft });
  }

  assigned.sort((a, b) => a.frameIndex - b.frameIndex);

  const reads: ScreenRead[] = [];
  for (const { frameIndex, draft } of assigned) {
    const frame = batch[frameIndex];
    if (!frame) continue;
    // A talking head with no text produces nothing downstream.
    if (draft.kind === 'speaker-only') continue;
    const occluded = draft.occluded || draft.text.includes(OCCLUDED_MARK);
    reads.push({
      frame: frameRelativePath(frame.path),
      t: frame.t,
      kind: draft.kind,
      text: occluded ? markOccluded(draft.text) : draft.text,
      occluded,
      keepImage: draft.keepImage
    });
  }
  return reads;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

/** Calls the model once and parses; an empty answer counts as a failure. */
async function completeBatch(
  client: ModelClient,
  request: ModelRequest
): Promise<ScreenReadDraft[]> {
  const response = await client.complete(request);
  const drafts = parseScreenReads(response.text);
  if (drafts.length === 0) {
    throw new ScreenParseError('模型没有返回任何可用的画面记录。');
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Reads the on-screen text of every keyframe, four frames per model call.
 * Client errors (unsupported images, timeout, abort) propagate unchanged. A
 * parse failure is retried once; a second failure is reported through
 * `onBatchError` and the affected frames are omitted rather than invented.
 */
export async function readScreens(options: ReadScreensOptions): Promise<ScreenRead[]> {
  const {
    frames,
    client,
    signal,
    batchSize = SCREEN_READ_BATCH_SIZE,
    timeoutMs = DEFAULT_SCREEN_READ_TIMEOUT_MS,
    onBatch,
    onBatchError
  } = options;

  const requested = Math.floor(batchSize);
  const size = Math.min(
    Math.max(1, Number.isFinite(requested) ? requested : SCREEN_READ_BATCH_SIZE),
    SCREEN_READ_BATCH_SIZE
  );

  throwIfAborted(signal);

  const reads: ScreenRead[] = [];
  for (let start = 0; start < frames.length; start += size) {
    throwIfAborted(signal);
    const batch = frames.slice(start, start + size);
    const images: ModelImage[] = batch.map((frame) => ({
      path: frame.path,
      mediaType: 'image/jpeg'
    }));
    const request: ModelRequest = {
      messages: [{ role: 'user', content: buildScreenPrompt(batch), images }],
      noTools: true,
      timeoutMs,
      signal
    };

    let drafts: ScreenReadDraft[];
    try {
      drafts = await completeBatch(client, request);
    } catch (error) {
      throwIfAborted(signal);
      if (!(error instanceof ScreenParseError)) throw error;
      try {
        drafts = await completeBatch(client, request);
      } catch (retryError) {
        throwIfAborted(signal);
        if (!(retryError instanceof ScreenParseError)) throw retryError;
        onBatchError?.({
          batch: start / size,
          frames: batch.length,
          read: 0,
          message: retryError.message
        });
        continue;
      }
    }

    const retained = toScreenReads(drafts, batch);
    reads.push(...retained);
    onBatch?.(retained);
  }

  return reads;
}
