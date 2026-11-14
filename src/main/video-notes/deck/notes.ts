import type { ModelClient } from '../../agent/model-client';
import type { Transcript, TranscriptChunk } from '../mimo';
import type { ScreenRead } from '../screen-read';
import {
  chapterNotesSchema,
  deckNotesSchema,
  type ChapterNotes,
  type DeckNotes,
  type Outline
} from './content';
import {
  DECK_MODEL_TIMEOUT_MS,
  DeckStepError,
  jsonOutputRules,
  requestValidatedJson
} from './prompts';

/**
 * Step 6: chapter notes. One call covers a normal transcript; a transcript
 * over {@link NOTES_SPLIT_THRESHOLD_CHARS} is written chapter by chapter so no
 * single request exceeds the model's comfortable context. Both paths end in
 * the same merge, which keeps the outline's order and titles: the model may
 * drift, the outline may not.
 */

/** Bump when the prompt's instructions change; feeds checkpoint fingerprints. */
export const NOTES_PROMPT_VERSION = 1;

/** Longer transcripts are written one chapter per call. */
export const NOTES_SPLIT_THRESHOLD_CHARS = 120_000;

const NOTES_SCREEN_CHARS = 8_000;

export interface BuildNotesOptions {
  client: ModelClient;
  transcript: Transcript;
  outline: Outline;
  screenReads: ScreenRead[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface NotesMarkdownMeta {
  title: string;
  durationSeconds: number;
  sourcePath: string;
}

/** `mm:ss`, with minutes allowed to exceed 59 for long lessons. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(total % 60)}`;
}

function transcriptLines(chunks: readonly TranscriptChunk[]): string[] {
  return chunks
    .filter((chunk) => chunk.text.trim().length > 0)
    .map((chunk) => {
      const start = Number.isFinite(chunk.start) ? Math.max(0, chunk.start) : 0;
      return `[${clock(start)}] ${chunk.text.trim()}`;
    });
}

/** Screen text with its frame time; the marker makes the source explicit. */
function screenLines(reads: readonly ScreenRead[], limit = NOTES_SCREEN_CHARS): string[] {
  const ordered = [...reads].sort((a, b) => a.t - b.t);
  const lines: string[] = [];
  let used = 0;
  for (const read of ordered) {
    const text = read.text.trim();
    if (text.length === 0) continue;
    const line = `[${clock(read.t)}] 〔画面〕${text}`;
    if (used + line.length + 1 > limit) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}

function chapterHeader(chapter: Outline['chapters'][number]): string {
  return `[${clock(chapter.start)}–${clock(chapter.end)}] ${chapter.title}（知识点：${chapter.points.join('；')}）`;
}

/** Instructions shared by the single-call and per-chapter prompts. */
function notesRules(chapterOnly: boolean): string[] {
  return [
    '要求：',
    chapterOnly
      ? '1. 只输出上面这一章的笔记，title 沿用上面给出的章节标题。'
      : '1. 每个章节输出一条，数量和顺序与上面的大纲一致；title 沿用大纲标题。',
    '2. 每章的 blocks 按时间 t 从小到大排序，至少 1 条；材料足够时写 4–12 条。',
    '3. 老师讲的内容 source 为 "video"，t 取这句话所在转写分片的开始秒数，只能取材料里出现的 [mm:ss]。',
    '4. 屏幕上的文字 source 为 "screen"，t 取画面时间，也只能取材料里出现的画面时间；text 逐字照抄，被挡住的地方保留〔遮挡〕。',
    '5. 同一章尽量同时包含 "video" 和 "screen" 两种来源，除非材料里确实没有对应内容。',
    '6. keyPoints 写 1–5 条这一章必须记住的结论，每条一句短句。',
    '7. 只写材料里的内容，不补充外部知识，不猜测；英文术语和例句保留原文。'
  ];
}

function buildNotesPrompt(
  transcript: Transcript,
  outline: Outline,
  screenReads: readonly ScreenRead[]
): string {
  const duration = Number.isFinite(transcript.duration) ? Math.max(0, transcript.duration) : 0;
  return [
    '你在整理一段讲课视频的分章笔记。笔记要能让学生不重看视频就理解知识点。',
    '',
    `视频时长：${clock(duration)}（${Math.round(duration)} 秒）`,
    '',
    '【章节大纲】',
    ...outline.chapters.map((chapter, index) => `${index + 1}. ${chapterHeader(chapter)}`),
    '',
    '【带时间戳的转写】',
    ...(transcript.chunks.length > 0
      ? transcriptLines(transcript.chunks)
      : ['（没有可用的转写。）']),
    '',
    '【屏幕上的文字】',
    ...(screenReads.length > 0 ? screenLines(screenReads) : ['（没有读屏结果。）']),
    '',
    ...notesRules(false),
    '',
    '输出 JSON：',
    '{"chapters":[{"title":"...","start":0,"blocks":[{"t":65,"text":"...","source":"video"}],"keyPoints":["..."]}]}',
    '',
    jsonOutputRules()
  ].join('\n');
}

function buildChapterNotesPrompt(
  transcript: Transcript,
  outline: Outline,
  chapter: Outline['chapters'][number],
  chunks: readonly TranscriptChunk[],
  reads: readonly ScreenRead[]
): string {
  const duration = Number.isFinite(transcript.duration) ? Math.max(0, transcript.duration) : 0;
  return [
    `你在整理一段讲课视频中一章的笔记：${chapter.title}`,
    '',
    `视频时长：${clock(duration)}（${Math.round(duration)} 秒）`,
    `本章范围：${clock(chapter.start)}–${clock(chapter.end)}（${Math.round(chapter.start)}–${Math.round(chapter.end)} 秒）`,
    `本章知识点：${chapter.points.join('；')}`,
    '',
    '【本章带时间戳的转写】',
    ...(chunks.length > 0 ? transcriptLines(chunks) : ['（本章没有转写，只根据屏幕文字整理。）']),
    '',
    '【本章屏幕上的文字】',
    ...(reads.length > 0 ? screenLines(reads) : ['（本章没有读屏结果。）']),
    '',
    ...notesRules(true),
    '',
    '只输出这一章的 JSON 对象（不要数组，不要外面的 chapters 字段）：',
    `{"title":"${chapter.title}","start":${chapter.start},"blocks":[{"t":65,"text":"...","source":"video"}],"keyPoints":["..."]}`,
    '',
    jsonOutputRules()
  ].join('\n');
}

/** Chunks that belong to `[start, end)`; a gap falls back to the nearest one. */
function chunksForChapter(
  chunks: readonly TranscriptChunk[],
  start: number,
  end: number
): TranscriptChunk[] {
  const inRange = chunks.filter((chunk) => chunk.start >= start && chunk.start < end);
  if (inRange.length > 0) return inRange;
  let nearest: TranscriptChunk | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const chunk of chunks) {
    const distance = chunk.start < start ? start - chunk.start : chunk.start - end;
    if (distance < nearestDistance) {
      nearest = chunk;
      nearestDistance = distance;
    }
  }
  return nearest ? [nearest] : [];
}

function readsForChapter(
  reads: readonly ScreenRead[],
  start: number,
  end: number
): ScreenRead[] {
  return reads.filter((read) => read.t >= start && read.t < end);
}

/**
 * Puts the model's chapters back into outline order and stamps the outline's
 * titles and starts onto them. A chapter the model skipped is a failure: notes
 * with a silent hole are worse than a retried step.
 */
function mergeNotes(outline: Outline, notes: DeckNotes): DeckNotes {
  const used = new Set<number>();
  const chapters: ChapterNotes[] = [];

  for (const [index, outlineChapter] of outline.chapters.entries()) {
    let sourceIndex = -1;
    // Prefer a matching title (the model may reorder), then the same position.
    const byTitle = notes.chapters.findIndex(
      (chapter, chapterIndex) =>
        !used.has(chapterIndex) && chapter.title.trim() === outlineChapter.title.trim()
    );
    if (byTitle !== -1) {
      sourceIndex = byTitle;
    } else if (!used.has(index) && notes.chapters[index] !== undefined) {
      sourceIndex = index;
    }
    if (sourceIndex === -1) {
      throw new DeckStepError('notes', `缺少章节「${outlineChapter.title}」的笔记。`);
    }
    used.add(sourceIndex);
    const source = notes.chapters[sourceIndex];
    chapters.push({
      title: outlineChapter.title,
      start: outlineChapter.start,
      blocks: [...source.blocks].sort((a, b) => a.t - b.t),
      keyPoints: [...source.keyPoints]
    });
  }

  return { chapters };
}

/**
 * Writes the notes for every chapter. A transcript at or under
 * {@link NOTES_SPLIT_THRESHOLD_CHARS} goes in one call; a longer one is split
 * chapter by chapter, each request carrying only that chapter's material.
 */
export async function buildNotes(options: BuildNotesOptions): Promise<DeckNotes> {
  const {
    client,
    transcript,
    outline,
    screenReads,
    signal,
    timeoutMs = DECK_MODEL_TIMEOUT_MS
  } = options;

  if (transcript.text.length <= NOTES_SPLIT_THRESHOLD_CHARS) {
    const notes = await requestValidatedJson({
      client,
      request: {
        messages: [
          { role: 'user', content: buildNotesPrompt(transcript, outline, screenReads) }
        ],
        temperature: 0.2,
        maxTokens: 12_000,
        noTools: true,
        timeoutMs
      },
      schema: deckNotesSchema,
      step: 'notes',
      signal
    });
    return mergeNotes(outline, notes);
  }

  const chapters: ChapterNotes[] = [];
  for (const chapter of outline.chapters) {
    const chunks = chunksForChapter(transcript.chunks, chapter.start, chapter.end);
    const reads = readsForChapter(screenReads, chapter.start, chapter.end);
    if (chunks.length === 0 && reads.length === 0) {
      throw new DeckStepError('notes', `第「${chapter.title}」章没有可用素材。`);
    }
    const notes = await requestValidatedJson({
      client,
      request: {
        messages: [
          {
            role: 'user',
            content: buildChapterNotesPrompt(transcript, outline, chapter, chunks, reads)
          }
        ],
        temperature: 0.2,
        maxTokens: 6_000,
        noTools: true,
        timeoutMs
      },
      schema: chapterNotesSchema,
      step: 'notes',
      signal
    });
    chapters.push(notes);
  }

  return mergeNotes(outline, { chapters });
}

/**
 * Renders the `notes.md` artifact: one section per chapter, every block
 * prefixed with its `[mm:ss]` time, on-screen text additionally marked
 * `〔画面〕`, and a `要点` list at the end of every chapter.
 */
export function renderNotesMarkdown(notes: DeckNotes, meta: NotesMarkdownMeta): string {
  const lines: string[] = [];
  lines.push(`# ${meta.title}`, '');
  lines.push(`- 时长：${clock(meta.durationSeconds)}`);
  lines.push(`- 来源：${meta.sourcePath}`, '');

  for (const chapter of notes.chapters) {
    lines.push(`## ${chapter.title}`, '');
    for (const block of chapter.blocks) {
      const marker = block.source === 'screen' ? '〔画面〕' : '';
      lines.push(`[${clock(block.t)}] ${marker}${block.text}`);
    }
    lines.push('', '**要点**');
    for (const point of chapter.keyPoints) lines.push(`- ${point}`);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
