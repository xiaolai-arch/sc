import { z } from 'zod';
import type { ModelClient } from '../../agent/model-client';
import type { Keyframe } from '../keyframes';
import { formatScreenLabel, type ScreenRead } from '../screen-read';
import type { Outline, ChapterNotes, DeckNotes, NoteBlock } from './content';
import {
  DECK_MODEL_TIMEOUT_MS,
  DeckStepError,
  jsonOutputRules,
  requestValidatedJson
} from './prompts';

/**
 * Step 6: chapter notes. The visible text is the material, and the blocks are
 * the screen reads themselves — copied verbatim, 〔遮挡〕 included — so nothing
 * can be attributed to the teacher. The model only writes, per chapter, the
 * key points a learner must remember from what is shown.
 */

/** Bump when the prompt's instructions change; feeds checkpoint fingerprints. */
export const NOTES_PROMPT_VERSION = 2;

/** One note block never exceeds this; a longer screen read is split. */
export const NOTES_MAX_BLOCK_CHARS = 600;

/** A chapter keeps at most this many blocks (the schema's cap). */
export const NOTES_MAX_BLOCKS_PER_CHAPTER = 60;

/** At most this much screen text per chapter goes into the key-point prompt. */
export const NOTES_CHAPTER_CHARS = 6_000;

export interface BuildNotesOptions {
  client: ModelClient;
  outline: Outline;
  screenReads: ScreenRead[];
  keyframes?: Keyframe[];
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

/** Only the answer the model actually owns: per-chapter key points. */
const keyPointsAnswerSchema = z.object({
  chapters: z
    .array(
      z.object({
        /** Chapter title; the outline's title is stamped back on afterwards. */
        title: z.string().trim().min(1, { message: 'empty' }).max(80, { message: 'too big' }),
        /** Seconds; accepted but replaced by the outline's start. */
        start: z.number().finite().min(0, { message: 'negative time' }).optional(),
        keyPoints: z
          .array(
            z
              .string()
              .trim()
              .min(1, { message: 'empty' })
              .max(200, { message: 'too big' })
          )
          .min(1, { message: 'needs a key point' })
          .max(8, { message: 'too big' })
      })
    )
    .min(1, { message: 'needs at least one chapter' })
    .max(40, { message: 'too big' })
});

type KeyPointsAnswer = z.infer<typeof keyPointsAnswerSchema>;

function chapterHeader(chapter: Outline['chapters'][number]): string {
  return `[${clock(chapter.start)}–${clock(chapter.end)}] ${chapter.title}（知识点：${chapter.points.join('；')}）`;
}

/** Screen text with its frame time; the marker makes the source explicit. */
function screenLines(reads: readonly ScreenRead[], limit = NOTES_CHAPTER_CHARS): string[] {
  const ordered = [...reads].sort((a, b) => a.t - b.t);
  const lines: string[] = [];
  let used = 0;
  for (const read of ordered) {
    const text = read.text.trim();
    if (text.length === 0) continue;
    const line = `${formatScreenLabel(read.t)}${text}`;
    if (lines.length > 0 && used + line.length + 1 > limit) {
      lines.push('（本章画面文字较多，后面的内容没有放进这个提示词。）');
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines;
}

/** One prompt carries every chapter with only the frames inside its window. */
export function buildNotesPrompt(
  outline: Outline,
  screenReads: readonly ScreenRead[],
  keyframes: readonly Keyframe[] = []
): string {
  const sections: string[] = [];
  for (const [index, chapter] of outline.chapters.entries()) {
    const reads = readsForChapter(screenReads, chapter.start, chapter.end);
    sections.push(
      `### ${index + 1}. ${chapterHeader(chapter)}`,
      ...(reads.length > 0 ? screenLines(reads) : ['（本章没有画面文字。）']),
      ''
    );
  }

  return [
    '你在整理一段讲课视频的分章笔记。材料只有视频关键帧上的画面文字，没有语音转写。',
    '笔记的正文由程序逐字采用画面文字，你只负责写每一章要记住的要点。',
    '',
    `关键帧：${keyframes.length > 0 ? `${keyframes.length} 张` : '若干张'}`,
    '',
    '【章节与画面文字】',
    ...sections,
    '要求：',
    '1. 每个章节输出一条，数量和顺序与上面的大纲一致；title 沿用大纲标题，一字不差。',
    '2. keyPoints 写 1–5 条这一章必须记住的结论，每条一句短句，只能根据画面文字得出。',
    '3. 只写画面上出现的内容，不补充外部知识，不猜测；英文术语和例句保留原文。',
    '4. 不要写「老师说」「视频里讲」这类话：材料里没有语音，你不知道老师说了什么。',
    '5. 画面文字里的〔遮挡〕是原样保留的标记，不要试图补全被挡住的内容。',
    '',
    '输出 JSON：',
    '{"chapters":[{"title":"章节标题","start":0,"keyPoints":["...","..."]}]}',
    '',
    jsonOutputRules()
  ].join('\n');
}

/** Reads that belong to `[start, end)`; a chapter window may be empty. */
function readsForChapter(
  reads: readonly ScreenRead[],
  start: number,
  end: number
): ScreenRead[] {
  return reads.filter((read) => read.t >= start && read.t < end);
}

/** The nearest read outside an empty chapter window, so a chapter still has text. */
function nearestRead(reads: readonly ScreenRead[], start: number, end: number): ScreenRead | null {
  let nearest: ScreenRead | null = null;
  let distance = Number.POSITIVE_INFINITY;
  for (const read of reads) {
    const current = read.t < start ? start - read.t : read.t - end;
    if (current < distance) {
      nearest = read;
      distance = current;
    }
  }
  return nearest;
}

/**
 * Splits one verbatim screen read into blocks the schema accepts. The cut
 * prefers a newline or a sentence end so a block rarely starts mid-phrase.
 */
export function splitNoteText(text: string, limit = NOTES_MAX_BLOCK_CHARS): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed.length > 0 ? [trimmed] : [];
  const out: string[] = [];
  let rest = trimmed;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(
      window.lastIndexOf('\n'),
      window.lastIndexOf('。'),
      window.lastIndexOf('；'),
      window.lastIndexOf(' ')
    );
    const take = cut > limit * 0.5 ? cut + 1 : limit;
    const piece = rest.slice(0, take).trim();
    if (piece.length > 0) out.push(piece);
    rest = rest.slice(take).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/** Every block of one chapter: verbatim reads in time order, then capped. */
function blocksForChapter(reads: readonly ScreenRead[]): NoteBlock[] {
  const ordered = [...reads].sort((a, b) => a.t - b.t);
  const blocks: NoteBlock[] = [];
  for (const read of ordered) {
    for (const text of splitNoteText(read.text)) {
      blocks.push({ t: Math.max(0, read.t), text, source: 'screen' });
    }
  }
  if (blocks.length <= NOTES_MAX_BLOCKS_PER_CHAPTER) return blocks;
  // Sample evenly instead of dropping the end of a very dense chapter.
  const kept: NoteBlock[] = [];
  for (let index = 0; index < NOTES_MAX_BLOCKS_PER_CHAPTER; index += 1) {
    const source = Math.round(
      (index * (blocks.length - 1)) / (NOTES_MAX_BLOCKS_PER_CHAPTER - 1)
    );
    kept.push(blocks[source]!);
  }
  return kept;
}

/**
 * Puts the model's key points back into outline order and stamps the outline's
 * titles and starts onto them. A chapter the model skipped is a failure: notes
 * with a silent hole are worse than a retried step.
 */
function mergeKeyPoints(outline: Outline, answer: KeyPointsAnswer): ChapterNotes[] {
  const used = new Set<number>();
  const chapters: ChapterNotes[] = [];

  for (const [index, outlineChapter] of outline.chapters.entries()) {
    let sourceIndex = -1;
    // Prefer a matching title (the model may reorder), then the same position.
    const byTitle = answer.chapters.findIndex(
      (chapter, chapterIndex) =>
        !used.has(chapterIndex) && chapter.title.trim() === outlineChapter.title.trim()
    );
    if (byTitle !== -1) {
      sourceIndex = byTitle;
    } else if (!used.has(index) && answer.chapters[index] !== undefined) {
      sourceIndex = index;
    }
    if (sourceIndex === -1) {
      throw new DeckStepError('notes', `缺少章节「${outlineChapter.title}」的要点。`);
    }
    used.add(sourceIndex);
    chapters.push({
      title: outlineChapter.title,
      start: outlineChapter.start,
      // Blocks are filled by the caller from the chapter's own screen reads.
      blocks: [],
      keyPoints: [...answer.chapters[sourceIndex]!.keyPoints]
    });
  }

  return chapters;
}

/**
 * Writes the notes for every chapter: blocks come verbatim from that chapter's
 * screen reads, key points come from one model call covering the whole outline.
 */
export async function buildNotes(options: BuildNotesOptions): Promise<DeckNotes> {
  const {
    client,
    outline,
    screenReads,
    keyframes = [],
    signal,
    timeoutMs = DECK_MODEL_TIMEOUT_MS
  } = options;

  const usable = screenReads.filter((read) => read.text.trim().length > 0);
  if (usable.length === 0) {
    throw new DeckStepError('notes', '没有读到任何画面文字，无法整理课件笔记。');
  }

  const answer = await requestValidatedJson({
    client,
    request: {
      messages: [
        { role: 'user', content: buildNotesPrompt(outline, usable, keyframes) }
      ],
      temperature: 0.2,
      maxTokens: 8_000,
      noTools: true,
      timeoutMs
    },
    schema: keyPointsAnswerSchema,
    step: 'notes',
    signal
  });

  const merged = mergeKeyPoints(outline, answer);
  return {
    chapters: merged.map((chapter, index) => {
      const outlineChapter = outline.chapters[index]!;
      const inWindow = readsForChapter(
        usable,
        outlineChapter.start,
        outlineChapter.end
      );
      const fallback = inWindow.length === 0
        ? nearestRead(usable, outlineChapter.start, outlineChapter.end)
        : null;
      const reads = inWindow.length > 0 ? inWindow : fallback ? [fallback] : [];
      const blocks = blocksForChapter(reads);
      if (blocks.length === 0) {
        throw new DeckStepError('notes', `第「${chapter.title}」章没有可用画面文字。`);
      }
      return { ...chapter, blocks };
    })
  };
}

/**
 * Renders the `notes.md` artifact: one section per chapter, every block
 * prefixed with its `[mm:ss]` time and marked `〔画面〕`, and a `要点` list at
 * the end of every chapter.
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
