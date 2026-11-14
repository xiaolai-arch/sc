import type { ModelClient, ModelRequest } from '../../agent/model-client';
import type { Transcript, TranscriptChunk } from '../mimo';
import { formatScreenLabel, type ScreenRead } from '../screen-read';
import {
  enrichResultSchema,
  type DeckNotes,
  type EnrichCard,
  type EnrichResult,
  type Outline,
  type OutlineChapter
} from './content';
import {
  DECK_MODEL_TIMEOUT_MS,
  DeckStepError,
  jsonOutputRules,
  requestValidatedJson
} from './prompts';

/**
 * Step 7: supplementary cards. The notes restate the lesson; this step adds
 * the material a learner actually needs for review — mistakes, transfer rules
 * and outside knowledge — as `insight` slides later. Cards are generated per
 * half of the outline once a lesson has more than six chapters, so one prompt
 * never has to hold a whole long lesson.
 */

export const ENRICH_PROMPT_VERSION = 1;

/** The prompt asks for 6–12 cards; the schema and the cap agree. */
export const ENRICH_MIN_CARDS = 6;
export const ENRICH_MAX_CARDS = 12;

/** Chapters above this count are split into two model calls. */
export const ENRICH_SPLIT_THRESHOLD = 6;

/** One prompt keeps at most this much transcript; a lesson transcript can be huge. */
const MAX_TRANSCRIPT_CHARS = 30_000;

/** At most this many screen reads go into one prompt. */
const MAX_SCREEN_READS = 40;

/** Seconds of transcript kept before a chapter window for context. */
const TRANSCRIPT_LEAD_SECONDS = 180;

export interface BuildEnrichmentOptions {
  client: ModelClient;
  notes: DeckNotes;
  outline: Outline;
  transcript: Transcript;
  screenReads?: readonly ScreenRead[];
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Prompt material
// ---------------------------------------------------------------------------

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatOutlineChapter(chapter: OutlineChapter): string {
  return `- ${chapter.title}（${formatClock(chapter.start)}–${formatClock(chapter.end)}）：${chapter.points.join('、')}`;
}

/**
 * Notes are shown chapter by chapter. When the notes do not line up with the
 * outline (a bad compose upstream), everything is included rather than an empty
 * section: the valid chapter list still constrains the answer.
 */
function formatNotes(notes: DeckNotes, allowed: ReadonlySet<string>): string {
  const relevant = notes.chapters.filter((chapter) => allowed.has(chapter.title));
  const chapters = relevant.length > 0 ? relevant : notes.chapters;
  const blocks: string[] = [];
  for (const chapter of chapters) {
    blocks.push(`### ${chapter.title}（起 ${formatClock(chapter.start)}）`);
    blocks.push(`要点：${chapter.keyPoints.join('；')}`);
    for (const note of chapter.blocks) {
      const tag = note.source === 'screen' ? '画面' : '视频';
      blocks.push(`- [${formatClock(note.t)}][${tag}] ${note.text}`);
    }
  }
  return blocks.length > 0 ? blocks.join('\n') : '（没有笔记。）';
}

/** A window of transcript around the chapters in one call, capped by size. */
function formatTranscript(transcript: Transcript, start: number, end: number): string {
  const chunks = transcript.chunks;
  if (chunks.length === 0) {
    const text = transcript.text.trim();
    if (text === '') return '（没有转写。）';
    return text.length > MAX_TRANSCRIPT_CHARS
      ? `${text.slice(0, MAX_TRANSCRIPT_CHARS)}\n（转写较长，已截取前 ${MAX_TRANSCRIPT_CHARS} 字。）`
      : text;
  }

  const lower = Math.max(0, start - TRANSCRIPT_LEAD_SECONDS);
  const picked: TranscriptChunk[] = [];
  let chars = 0;
  for (const chunk of chunks) {
    if (chunk.start < lower) continue;
    if (chunk.start > end && picked.length > 0) break;
    if (chars > 0 && chars + chunk.text.length > MAX_TRANSCRIPT_CHARS) break;
    picked.push(chunk);
    chars += chunk.text.length;
    if (chars >= MAX_TRANSCRIPT_CHARS) break;
  }
  if (picked.length === 0) {
    return '（这段时间没有转写。）';
  }
  const lines = picked.map((chunk) => `- [${formatClock(chunk.start)}] ${chunk.text}`);
  if (chars >= MAX_TRANSCRIPT_CHARS) {
    lines.push(`（转写较长，只截取了前 ${MAX_TRANSCRIPT_CHARS} 字。）`);
  }
  return lines.join('\n');
}

function formatScreenReads(reads: readonly ScreenRead[], start: number, end: number): string {
  const visible = reads
    .filter((read) => read.kind !== 'speaker-only')
    .filter((read) => read.t >= start - TRANSCRIPT_LEAD_SECONDS && read.t <= end)
    .slice(0, MAX_SCREEN_READS);
  if (visible.length === 0) return '（没有可用的画面文字。）';
  return visible
    .map((read) => `- ${formatScreenLabel(read.t)}${read.text}`)
    .join('\n');
}

/** Stable key for deduplicating card titles across calls. */
function normalizeTitle(title: string): string {
  return title.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
}

function chapterWindow(chapters: readonly OutlineChapter[]): { start: number; end: number } {
  let start = Number.POSITIVE_INFINITY;
  let end = 0;
  for (const chapter of chapters) {
    start = Math.min(start, chapter.start);
    end = Math.max(end, chapter.end);
  }
  return {
    start: Number.isFinite(start) ? start : 0,
    end: Math.max(end, Number.isFinite(start) ? start : 0)
  };
}

export interface EnrichPromptInput {
  notes: DeckNotes;
  chapters: readonly OutlineChapter[];
  transcript: Transcript;
  screenReads?: readonly ScreenRead[];
}

/**
 * One enrich prompt. `chapters` is the half of the outline this call covers;
 * only those titles are valid `chapter` values.
 */
export function buildEnrichPrompt(input: EnrichPromptInput): string {
  const { notes, chapters, transcript, screenReads = [] } = input;
  const titles = chapters.map((chapter) => chapter.title);
  const allowed = new Set(titles);
  const window = chapterWindow(chapters);

  return [
    '你在为讲课视频的「完整课件」编写补充卡片（渲染成 insight 页）。补充卡片不是复述笔记，而是补上笔记里没有展开、但对复习真正有用的内容。',
    '',
    '内容要求：',
    '1. 一共写 6～12 张卡片，每张只讲一个结论，标题就是结论本身。',
    '2. 优先写三类内容：',
    '   - 易错点：学生常混、常错的判断，说清错在哪里、怎么避免；',
    '   - 迁移：换一道题或换一个场景，怎么用同一条规则判断；',
    '   - 扩展知识：与本章相关、但视频里没有讲到的背景、对比或延伸，注明依据。',
    '3. 不要照抄笔记里的句子，也不要把笔记换一种说法。',
    `4. chapter 必须严格等于下面列出的某个章节标题，一字不差：${titles.map((title) => `「${title}」`).join('、')}。`,
    '5. sources 的写法：',
    '   - 老师确实讲过的内容，用 {"kind":"video","t":秒数}，t 取视频里的秒数；',
    '   - 由视频内容直接推出的，用 {"kind":"infer"}；',
    '   - 视频以外的知识，用 {"kind":"ext","title":"依据的标题","page":页码}，页码可省略。',
    '6. examples 至少 2 条，可以写 {wrong, right} 对照；pitfall 写最容易踩的坑；transfer 写怎么迁移到新题。',
    '',
    '每张卡片的字段：',
    '- chapter：章节标题，必须是上面列出的标题之一；',
    '- title：一句话结论，不超过 120 字；',
    '- principle：原理，说明为什么成立；',
    '- examples：2～3 条例子，每条有 right，可选 wrong；',
    '- pitfall：易错点；',
    '- transfer：迁移方法；',
    '- sources：至少一个来源。',
    '',
    '输出格式：',
    '{"cards":[{"chapter":"章节标题","title":"一句话结论","principle":"原理","examples":[{"wrong":"错误说法","right":"正确说法"}],"pitfall":"易错点","transfer":"迁移方法","sources":[{"kind":"video","t":120}]}]}',
    '',
    jsonOutputRules(),
    '',
    '## 章节（chapter 只能取这些标题）',
    chapters.map(formatOutlineChapter).join('\n'),
    '',
    '## 笔记',
    formatNotes(notes, allowed),
    '',
    '## 转写摘录',
    formatTranscript(transcript, window.start, window.end),
    '',
    '## 画面文字摘录',
    formatScreenReads(screenReads, window.start, window.end)
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Drops cards whose chapter is not an allowed title, deduplicates by
 * normalized title (first one wins), and caps the list at 12.
 */
function selectCards(cards: readonly EnrichCard[], allowed: ReadonlySet<string>): EnrichCard[] {
  const seen = new Set<string>();
  const selected: EnrichCard[] = [];
  for (const card of cards) {
    if (!allowed.has(card.chapter)) continue;
    const key = normalizeTitle(card.title);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    selected.push(card);
    if (selected.length >= ENRICH_MAX_CARDS) break;
  }
  return selected;
}

function retryHint(titles: readonly string[]): string {
  return [
    '上一次的回答无法使用：补充卡片的 chapter 没有对上合法章节标题，或者没有给出任何卡片。',
    'chapter 必须严格等于下列标题之一，一字不差：',
    ...titles.map((title) => `- ${title}`),
    '请重新输出 6～12 张卡片，只输出 JSON。'
  ].join('\n');
}

interface RequestCardsOptions {
  client: ModelClient;
  notes: DeckNotes;
  chapters: readonly OutlineChapter[];
  transcript: Transcript;
  screenReads: readonly ScreenRead[];
  timeoutMs: number;
  signal?: AbortSignal;
  hint?: string;
}

/** One model call; returns the cards that survive chapter and title filtering. */
async function requestCards(options: RequestCardsOptions): Promise<EnrichCard[]> {
  const { client, notes, chapters, transcript, screenReads, timeoutMs, signal, hint } = options;
  const prompt = buildEnrichPrompt({ notes, chapters, transcript, screenReads });
  const content = hint === undefined ? prompt : `${prompt}\n\n${hint}`;
  const request: ModelRequest = {
    messages: [{ role: 'user', content }],
    noTools: true,
    timeoutMs,
    signal
  };
  const result = await requestValidatedJson({
    client,
    request,
    schema: enrichResultSchema,
    step: 'enrich',
    signal
  });
  const allowed = new Set(chapters.map((chapter) => chapter.title));
  return selectCards(result.cards, allowed);
}

/**
 * Builds the supplementary cards. One call for up to six chapters, two calls
 * above that; the halves are merged and deduplicated by title. An answer whose
 * cards are all off-chapter is retried once with the valid titles spelled out;
 * a still-empty answer fails the step instead of producing an empty lesson.
 */
export async function buildEnrichment(options: BuildEnrichmentOptions): Promise<EnrichResult> {
  const {
    client,
    notes,
    outline,
    transcript,
    screenReads = [],
    signal,
    timeoutMs = DECK_MODEL_TIMEOUT_MS
  } = options;

  const chapters = outline.chapters;
  const groups: OutlineChapter[][] =
    chapters.length > ENRICH_SPLIT_THRESHOLD
      ? [chapters.slice(0, Math.ceil(chapters.length / 2)), chapters.slice(Math.ceil(chapters.length / 2))]
      : [chapters.slice()];

  const collected: EnrichCard[] = [];
  for (const group of groups) {
    const titles = group.map((chapter) => chapter.title);
    let cards = await requestCards({
      client,
      notes,
      chapters: group,
      transcript,
      screenReads,
      timeoutMs,
      signal
    });
    if (cards.length === 0) {
      cards = await requestCards({
        client,
        notes,
        chapters: group,
        transcript,
        screenReads,
        timeoutMs,
        signal,
        hint: retryHint(titles)
      });
    }
    if (cards.length === 0) {
      throw new DeckStepError('enrich', '模型没有给出可用的补充卡片：chapter 必须与大纲章节标题一致。');
    }
    collected.push(...cards);
  }

  // Merge across calls: titles repeat between halves more often than not.
  const merged = selectCards(collected, new Set(chapters.map((chapter) => chapter.title)));
  if (merged.length === 0) {
    throw new DeckStepError('enrich', '合并后没有可用的补充卡片。');
  }
  return { cards: merged };
}
