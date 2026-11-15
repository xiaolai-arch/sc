import type { ModelClient, ModelRequest } from '../../agent/model-client';
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
 * Step 7: supplementary cards. The notes restate what is on screen; this step
 * adds the material a learner actually needs for review — mistakes, transfer
 * rules and outside knowledge — as `insight` slides later. Cards may explain,
 * contrast or extend the visible material, but they must never claim the
 * teacher said anything. Cards are generated per half of the outline once a
 * lesson has more than six chapters, so one prompt never has to hold a whole
 * long lesson.
 */

/** Bump when the prompt's instructions change; feeds checkpoint fingerprints. */
export const ENRICH_PROMPT_VERSION = 2;

/** The prompt asks for 6–12 cards; the schema and the cap agree. */
export const ENRICH_MIN_CARDS = 6;
export const ENRICH_MAX_CARDS = 12;

/** Chapters above this count are split into two model calls. */
export const ENRICH_SPLIT_THRESHOLD = 6;

/** At most this many screen reads go into one prompt. */
const MAX_SCREEN_READS = 40;

/** Seconds of screen material kept before a chapter window for context. */
const SCREEN_LEAD_SECONDS = 180;

export interface BuildEnrichmentOptions {
  client: ModelClient;
  notes: DeckNotes;
  outline: Outline;
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
      blocks.push(`- [${formatClock(note.t)}][画面] ${note.text}`);
    }
  }
  return blocks.length > 0 ? blocks.join('\n') : '（没有笔记。）';
}

function formatScreenReads(reads: readonly ScreenRead[], start: number, end: number): string {
  const visible = reads
    .filter((read) => read.kind !== 'speaker-only')
    .filter((read) => read.t >= start - SCREEN_LEAD_SECONDS && read.t <= end)
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
  screenReads?: readonly ScreenRead[];
}

/**
 * One enrich prompt. `chapters` is the half of the outline this call covers;
 * only those titles are valid `chapter` values.
 */
export function buildEnrichPrompt(input: EnrichPromptInput): string {
  const { notes, chapters, screenReads = [] } = input;
  const titles = chapters.map((chapter) => chapter.title);
  const allowed = new Set(titles);
  const window = chapterWindow(chapters);

  return [
    '你在为讲课视频的「完整课件」编写补充卡片（渲染成 insight 页）。课件只有画面内容（关键帧上抄下来的文字），没有语音；补充卡片不是复述笔记，而是补上笔记里没有展开、但对复习真正有用的内容。',
    '',
    '内容要求：',
    '1. 一共写 6～12 张卡片，每张只讲一个结论，标题就是结论本身。',
    '2. 优先写三类内容：',
    '   - 易错点：学生常混、常错的判断，说清错在哪里、怎么避免；',
    '   - 迁移：换一道题或换一个场景，怎么用屏幕上同一条规则判断；',
    '   - 扩展知识：与本章相关、但画面上没有出现的背景、对比或延伸，注明依据。',
    '3. 不要照抄笔记里的句子，也不要把笔记换一种说法。',
    '4. 卡片只解释、对比或扩展画面上的内容；绝不能声称是老师说过的话，也不要写「老师说」「视频里讲」这类表述。',
    `5. chapter 必须严格等于下面列出的某个章节标题，一字不差：${titles.map((title) => `「${title}」`).join('、')}。`,
    '6. sources 的写法：',
    '   - 画面上的内容，用 {"kind":"screen","t":秒数}，t 必须取自下面列出的画面时间；',
    '   - 由画面内容直接推出的，用 {"kind":"infer"}；',
    '   - 画面以外的知识，用 {"kind":"ext","title":"依据的标题","page":页码}，页码可省略。',
    '   - 不要使用 {"kind":"video"}：材料里没有语音。',
    '7. examples 至少 2 条，可以写 {wrong, right} 对照；pitfall 写最容易踩的坑；transfer 写怎么迁移到新题。',
    '',
    '每张卡片的字段：',
    '- chapter：章节标题，必须是上面列出的标题之一；',
    '- title：一句话结论，不超过 120 字；',
    '- principle：原理，说明为什么成立；',
    '- examples：2～3 条例子，每条有 right，可选 wrong；',
    '- pitfall：易错点；',
    '- transfer：迁移方法；',
    '- sources：至少一个来源，只能用 screen、infer 或 ext。',
    '',
    '输出格式：',
    '{"cards":[{"chapter":"章节标题","title":"一句话结论","principle":"原理","examples":[{"wrong":"错误说法","right":"正确说法"}],"pitfall":"易错点","transfer":"迁移方法","sources":[{"kind":"screen","t":120}]}]}',
    '',
    jsonOutputRules(),
    '',
    '## 章节（chapter 只能取这些标题）',
    chapters.map(formatOutlineChapter).join('\n'),
    '',
    '## 笔记',
    formatNotes(notes, allowed),
    '',
    '## 画面文字摘录',
    formatScreenReads(screenReads, window.start, window.end)
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Drops cards whose chapter is not an allowed title, strips `video` sources
 * (the deck has no speech evidence), drops cards left without a source,
 * deduplicates by normalized title (first one wins), and caps at 12.
 */
function selectCards(cards: readonly EnrichCard[], allowed: ReadonlySet<string>): EnrichCard[] {
  const seen = new Set<string>();
  const selected: EnrichCard[] = [];
  for (const card of cards) {
    if (!allowed.has(card.chapter)) continue;
    const sources = card.sources.filter((source) => source.kind !== 'video');
    if (sources.length === 0) continue;
    const key = normalizeTitle(card.title);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    selected.push({ ...card, sources });
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
  screenReads: readonly ScreenRead[];
  timeoutMs: number;
  signal?: AbortSignal;
  hint?: string;
}

/** One model call; returns the cards that survive chapter and source filtering. */
async function requestCards(options: RequestCardsOptions): Promise<EnrichCard[]> {
  const { client, notes, chapters, screenReads, timeoutMs, signal, hint } = options;
  const prompt = buildEnrichPrompt({ notes, chapters, screenReads });
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
      screenReads,
      timeoutMs,
      signal
    });
    if (cards.length === 0) {
      cards = await requestCards({
        client,
        notes,
        chapters: group,
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
