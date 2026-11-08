import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VideoNotesLanguage } from '../../shared/video-notes';

export interface TranscriptChunk {
  /** Seconds from the start of the media. */
  start: number;
  text: string;
}

export interface Transcript {
  source: string;
  duration: number;
  language: VideoNotesLanguage;
  model: string;
  chars: number;
  text: string;
  chunks: TranscriptChunk[];
}

export interface MimoAsrConfig {
  baseURL: string;
  apiKey: string;
  model: string;
}

/** 180 seconds keeps the model from truncating long audio (measured). */
export const ASR_CHUNK_SECONDS = 180;
export const ASR_MIN_SPLIT_SECONDS = 40;
export const ASR_MAX_SPLIT_DEPTH = 2;
export const ASR_NORMAL_CHARS_PER_SECOND = 5;
export const ASR_SPLIT_GAIN = 1.05;
export const ASR_REPEAT_LIMIT = 0.35;
const ASR_TIMEOUT_MS = 900_000;
const MAX_BASE64_BYTES = 10 * 1024 * 1024;

/**
 * Accepts the OpenAI-compatible base URL (usually ending in `/v1`) or the full
 * chat-completions URL, and removes the anthropic suffix MiMo's own config uses.
 */
export function chatCompletionsUrl(baseURL: string): string {
  let base = baseURL.trim().replace(/\/+$/, '');
  if (base.endsWith('/anthropic')) base = base.slice(0, -'/anthropic'.length);
  if (base.endsWith('/chat/completions')) return base;
  if (!/\/v1$/i.test(base)) base += '/v1';
  return `${base}/chat/completions`;
}

type FetchLike = typeof fetch;

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((part) =>
        typeof part === 'string'
          ? part
          : part && typeof part === 'object' && 'text' in part
            ? String((part as { text?: unknown }).text ?? '')
            : ''
      )
      .join('');
  }
  if (value && typeof value === 'object' && 'text' in value) {
    return String((value as { text?: unknown }).text ?? '');
  }
  return '';
}

export function createMimoAsrClient(
  config: MimoAsrConfig,
  fetchImpl: FetchLike = fetch
): (audio: Buffer, language: VideoNotesLanguage) => Promise<string> {
  const endpoint = chatCompletionsUrl(config.baseURL);
  return async (audio, language) => {
    const data = audio.toString('base64');
    if (data.length > MAX_BASE64_BYTES) {
      throw new Error('音频分片过大，无法上传到语音识别接口。');
    }
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: `data:audio/mpeg;base64,${data}` }
              }
            ]
          }
        ],
        asr_options: { language }
      }),
      signal: AbortSignal.timeout(ASR_TIMEOUT_MS)
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `语音识别失败：HTTP ${response.status}${body ? `（${body.slice(0, 300)}）` : ''}`
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const text = contentText(payload.choices?.[0]?.message?.content).trim();
    if (!text) throw new Error('语音识别返回了空结果。');
    return text;
  };
}

/** Repeated n-gram share; normal speech is ~0.05, a looping model exceeds 0.7. */
export function repeatRatio(text: string, n = 24): number {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < n * 2) return 0;
  const grams: string[] = [];
  for (let index = 0; index + n <= compact.length; index += Math.floor(n / 2)) {
    grams.push(compact.slice(index, index + n));
  }
  if (grams.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let repeated = 0;
  for (const count of counts.values()) if (count > 1) repeated += count;
  return repeated / grams.length;
}

/** A chunk is suspect when it is either truncated or loop-hallucinating. */
export function qualityOk(text: string, durationSeconds: number): boolean {
  if (repeatRatio(text) > ASR_REPEAT_LIMIT) return false;
  if (durationSeconds > 0 && text.length / durationSeconds < ASR_NORMAL_CHARS_PER_SECOND) {
    return false;
  }
  return true;
}

function splitIsBetter(child: string, parent: string): boolean {
  const childRepeat = repeatRatio(child);
  const parentRepeat = repeatRatio(parent);
  if (childRepeat < parentRepeat - 0.05) return true;
  return child.length > parent.length * ASR_SPLIT_GAIN && childRepeat <= parentRepeat + 0.05;
}

export interface TranscribeMediaOptions {
  durationSeconds: number;
  cacheDir: string;
  /** Writes one mp3 window. Injected in tests. */
  encode: (destination: string, start: number, duration: number) => Promise<void>;
  /** Sends one mp3 buffer to the ASR endpoint. Injected in tests. */
  asr: (audio: Buffer, language: VideoNotesLanguage) => Promise<string>;
  language: VideoNotesLanguage;
  model: string;
  onProgress?: (completed: number, total: number) => void;
  chunkSeconds?: number;
}

interface WindowPiece {
  start: number;
  text: string;
}

/**
 * Turns a media file into timestamped text. Long windows are recursively split
 * and compared against the whole window when the model looks truncated or
 * stuck in a repetition loop. Transcribed windows are cached on disk, so a
 * killed run resumes where it stopped.
 */
export async function transcribeMedia(
  source: string,
  options: TranscribeMediaOptions
): Promise<Transcript> {
  const chunkSeconds = options.chunkSeconds ?? ASR_CHUNK_SECONDS;
  if (!(options.durationSeconds > 0)) {
    throw new Error('无法确定媒体时长，不能开始转写。');
  }
  await mkdir(options.cacheDir, { recursive: true });
  const temp = await mkdtemp(join(tmpdir(), 'asaki-video-notes-'));
  const cacheTag = (tag: string) => join(options.cacheDir, `${tag}.txt`);

  async function windowText(start: number, duration: number, tag: string): Promise<string> {
    const cached = await readFile(cacheTag(tag), 'utf8').catch(() => null);
    if (cached !== null) return cached.trim();
    const mp3 = join(temp, `${tag}.mp3`);
    await options.encode(mp3, start, duration);
    try {
      const audio = await readFile(mp3);
      const text = (await options.asr(audio, options.language)).trim();
      await writeFile(cacheTag(tag), text, 'utf8');
      return text;
    } finally {
      await unlink(mp3).catch(() => undefined);
    }
  }

  async function runWindow(
    start: number,
    duration: number,
    tag: string,
    depth = 0
  ): Promise<WindowPiece[]> {
    const text = await windowText(start, duration, tag);
    if (
      duration <= ASR_MIN_SPLIT_SECONDS ||
      depth >= ASR_MAX_SPLIT_DEPTH ||
      qualityOk(text, duration)
    ) {
      return [{ start: roundTime(start), text }];
    }

    const half = duration / 2;
    const left = await runWindow(start, half, `${tag}a`, depth + 1);
    const right = await runWindow(start + half, duration - half, `${tag}b`, depth + 1);
    const child = left.concat(right).map((piece) => piece.text).join('');
    return splitIsBetter(child, text) ? left.concat(right) : [{ start: roundTime(start), text }];
  }

  try {
    const total = options.durationSeconds;
    const windows: Array<[number, number]> = [];
    for (let start = 0; start < total; start += chunkSeconds) {
      windows.push([start, Math.min(chunkSeconds, total - start)]);
    }

    const pieces: WindowPiece[] = [];
    for (let index = 0; index < windows.length; index += 1) {
      const [start, duration] = windows[index]!;
      pieces.push(...(await runWindow(start, duration, `w${String(index).padStart(4, '0')}`)));
      options.onProgress?.(index + 1, windows.length);
    }

    const text = pieces
      .map((piece) => piece.text)
      .filter((piece) => piece.length > 0)
      .join('\n');
    return {
      source,
      duration: roundTime(total),
      language: options.language,
      model: options.model,
      chars: text.length,
      text,
      chunks: pieces
    };
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => undefined);
  }
}

function roundTime(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
