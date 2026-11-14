import { z } from 'zod';
import type { ModelClient } from '../../agent/model-client';
import type { Keyframe } from '../keyframes';
import { formatScreenLabel, type ScreenRead } from '../screen-read';
import type { ChapterNotes, EnrichCard, Outline, OutlineChapter } from './content';
import {
  DECK_VERSION,
  deckSchema,
  slideSchema,
  validateDeck,
  DeckValidationError,
  type Deck,
  type Slide
} from './schema';
import {
  DECK_MODEL_TIMEOUT_MS,
  DeckStepError,
  jsonOutputRules,
  requestValidatedJson
} from './prompts';

/**
 * Step 9: compose. Each chapter's notes, screen reads and enrichment cards are
 * turned into slides, then the shell slides (cover, agenda, summary) are added
 * deterministically. The layout step later asks {@link refitSlide} to split a
 * page that overflowed the 720px stage.
 */

/** Bump when the prompt's instructions change; feeds checkpoint fingerprints. */
export const COMPOSE_PROMPT_VERSION = 1;

/** Slide types the shell owns; the model is told never to emit them. */
const SHELL_TYPES = ['cover', 'agenda', 'summary'] as const;

/** The layout step's content box ends here; anything below overflows. */
const CONTENT_BOTTOM_PX = 656;

export interface ComposeChapterOptions {
  client: ModelClient;
  /** The outline chapter this call writes. */
  chapter: OutlineChapter;
  /** Step 6 notes for the same chapter; titles and starts already follow the outline. */
  notes: ChapterNotes;
  /** Enrichment cards belonging to this chapter (the caller selects them). */
  cards: EnrichCard[];
  /** All lesson screen reads; the prompt uses the ones inside the chapter. */
  screenReads: ScreenRead[];
  /** All lesson keyframes; `figure` frames must come from this list. */
  keyframes: Keyframe[];
  durationSeconds: number;
  /** Zero-based chapter position, used for the deck-wide slide ids. */
  chapterIndex: number;
  chapterCount: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface AssembleDeckChapter {
  title: string;
  start: number;
  slides: Slide[];
  /** Optional per-chapter key points; used when `summaryPoints` is absent. */
  keyPoints?: string[];
}

export interface AssembleDeckOptions {
  title: string;
  sourcePath: string;
  durationSeconds: number;
  outline: Outline;
  chapters: AssembleDeckChapter[];
  /** Up to three closing points; defaults to the last chapter's key points. */
  summaryPoints?: string[];
}

export interface RefitSlideOptions {
  client: ModelClient;
  slide: Slide;
  excessPx: number;
  chapterTitle: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** `mm:ss`, with minutes allowed to exceed 59 for long lessons. */
function clock(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(minutes)}:${pad(total % 60)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** `frames/<name>.jpg`, derived from an absolute keyframe path. */
function frameRelativePath(framePath: string): string {
  const base = framePath.split(/[\\/]/).pop() || framePath;
  return `frames/${base}`;
}

/**
 * The frames a `figure` slide may use: a keyframe whose screen read asked for
 * the image to be kept. Everything else has to be expressed as text.
 */
function figureFrames(
  keyframes: readonly Keyframe[],
  screenReads: readonly ScreenRead[]
): Map<string, ScreenRead> {
  const reads = new Map(screenReads.map((read) => [read.frame, read]));
  const allowed = new Map<string, ScreenRead>();
  for (const keyframe of keyframes) {
    const frame = frameRelativePath(keyframe.path);
    const read = reads.get(frame);
    if (read !== undefined && read.keepImage) allowed.set(frame, read);
  }
  return allowed;
}

function isShellSlide(slide: Slide): boolean {
  return (SHELL_TYPES as readonly string[]).includes(slide.type);
}

/** Keeps every fact but pins times inside the video; a bad clock is fixed here. */
function clampSlideTimes(slide: Slide, durationSeconds: number): Slide {
  const limit = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const sources = slide.sources.map((source) => {
    if (source.kind === 'video') return { kind: 'video' as const, t: clamp(source.t, 0, limit) };
    if (source.kind === 'screen') return { kind: 'screen' as const, t: clamp(source.t, 0, limit) };
    return source;
  });
  const clamped = { ...slide, sources } as Slide;
  if (slide.t !== undefined) clamped.t = clamp(slide.t, 0, limit);
  return clamped;
}

/** Accepts either a bare array or an object with a `slides` array. */
function unwrapSlides(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const slides = (value as { slides?: unknown }).slides;
  return Array.isArray(slides) ? slides : value;
}

/** Accepts either `{ slides: [...] }` or a bare array for the refit answer. */
function wrapSlides(value: unknown): unknown {
  return Array.isArray(value) ? { slides: value } : value;
}

const SLIDE_TYPE_REFERENCE = [
  '1. cover（封面）。字段：subtitle?（副标题）。本章不要使用。',
  '2. agenda（目录）。字段：items（1–8 条字符串）。本章不要使用。',
  '3. section（章节引入页）。字段：lead（一句话引入）。',
  '4. points（要点页）。字段：points（1–5 项，每项 {"text":"...","source":{...}}）。',
  '5. passage（屏幕原文页）。字段：lines（1–30 行字符串，逐字照抄题干、选项、范文）。',
  '6. figure（截图页）。字段：frame（必须是材料里列出的 frames/*.jpg）、keepImage（必须为 true）、captions（0–3 条）。',
  '7. compare（栏对比页）。字段：columns（2–3 栏，每栏 {"heading":"...","items":["..."]}）。',
  '8. insight（补充卡片页）。字段：principle、examples（2–3 项，每项 {"wrong"?:"...","right":"..."}）、pitfall、transfer。',
  '9. derive（推演页）。字段：steps（2–8 步字符串数组）。',
  '10. quote（引文页）。字段：text。',
  '11. code（代码页）。字段：language、code（不超过 12 行）。',
  '12. quiz（小测页）。字段：question、options（2–6 条）、answer（从 0 开始的选项序号）、explanation。',
  '13. summary（小结页）。字段：points（1–3 条）、next?。本章不要使用。'
].join('\n');

function sourceReference(): string {
  return [
    '公共字段：id（字符串）、title（结论式标题）、sources（1–6 个来源，至少一个）、t?（回看秒数）、status?（只写 "contested"）、tip?（一行复习提示）。',
    '来源对象：{"kind":"video","t":秒}、{"kind":"screen","t":秒}、{"kind":"infer"}、{"kind":"ext","title"?:"书名","page"?:"页码"}。'
  ].join('\n');
}

function cardLines(cards: readonly EnrichCard[]): string[] {
  if (cards.length === 0) return ['（本章没有补充卡片。）'];
  const lines: string[] = [];
  for (const card of cards) {
    lines.push(`- 标题：${card.title}`);
    lines.push(`  原理：${card.principle}`);
    for (const example of card.examples) {
      const wrong = example.wrong === undefined ? '' : `错误：${example.wrong}；`;
      lines.push(`  例：${wrong}正确：${example.right}`);
    }
    lines.push(`  易错：${card.pitfall}`);
    lines.push(`  迁移：${card.transfer}`);
  }
  return lines;
}

/** The complete user prompt for one chapter's compose call. */
export function buildComposePrompt(options: Omit<ComposeChapterOptions, 'client' | 'signal' | 'timeoutMs'>): string {
  const {
    chapter,
    notes,
    cards,
    screenReads,
    keyframes,
    durationSeconds,
    chapterIndex,
    chapterCount
  } = options;
  const limit = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const allowed = figureFrames(keyframes, screenReads);
  const reads = [...screenReads]
    .filter((read) => read.t >= chapter.start && read.t < chapter.end && read.text.trim().length > 0)
    .sort((a, b) => a.t - b.t);

  const frameLines =
    allowed.size === 0
      ? ['（本章没有可用的截图，不要生成 figure 页。）']
      : [...allowed.entries()].map(
          ([frame, read]) => `${frame} ${formatScreenLabel(read.t)}${read.text.trim()}`
        );

  return [
    `你在为一段讲课视频编写「第 ${chapterIndex + 1}/${chapterCount} 章」的课件页面。`,
    '',
    `章节：${chapter.title}`,
    `时间范围：${clock(chapter.start)}–${clock(chapter.end)}（${Math.round(chapter.start)}–${Math.round(chapter.end)} 秒）`,
    `本章知识点：${chapter.points.join('；')}`,
    '',
    '【老师讲的内容（笔记）】',
    ...(notes.blocks.length > 0
      ? notes.blocks.map(
          (block) => `[${clock(block.t)}] ${block.source === 'screen' ? '〔画面〕' : ''}${block.text}`
        )
      : ['（本章没有笔记。）']),
    '',
    '【本章要点】',
    ...notes.keyPoints.map((point) => `- ${point}`),
    '',
    '【屏幕上的文字】',
    ...(reads.length > 0
      ? reads.map((read) => `${formatScreenLabel(read.t)}${read.text.trim()}`)
      : ['（本章没有读屏结果。）']),
    '',
    '【可用的截图】只有这里列出的帧才能用在 figure 页。',
    ...frameLines,
    '',
    '【补充卡片】',
    ...cardLines(cards),
    '',
    '可用的页面类型（type）与字段：',
    SLIDE_TYPE_REFERENCE,
    '',
    sourceReference(),
    '',
    '要求：',
    '1. 每页 title 是结论式短句（不超过 40 字），不要用「知识点」「例题」这类空标题。',
    '2. 每页 sources 至少一个，只能使用本章材料里出现的事实；不足一页时宁可少写，也不要编造。',
    '3. video 和 screen 来源的 t 只能取上面材料里出现的时间，不许编造；t 不能超过视频时长',
    `   （${Math.round(limit)} 秒）。由材料直接推出的内容用 {"kind":"infer"}；视频以外的知识用 {"kind":"ext"} 并写清出处。`,
    '4. figure 只能引用「可用的截图」里列出的 frames/*.jpg，并且必须写 "keepImage": true；不要自己编帧名。',
    '5. 题干、选项、范文等屏幕原文用 passage 页，逐字照抄，被挡住的地方保留〔遮挡〕。',
    '6. 不要生成 cover、agenda、summary：封面、目录和结尾小结由程序统一生成。',
    '7. id 写任意不重复的字符串即可，程序会统一重写。',
    '8. 可选 t 字段写这一页的回看时间，优先取对应画面时间。',
    '',
    '只输出一个 JSON 数组，每个元素是一页：',
    '[{"type":"points","id":"p1","title":"...","sources":[{"kind":"video","t":65}],"points":[{"text":"...","source":{"kind":"video","t":65}}]}]',
    '',
    jsonOutputRules()
  ].join('\n');
}

function buildRefitPrompt(options: {
  slide: Slide;
  excessPx: number;
  chapterTitle: string;
}): string {
  return [
    '你要重排一页课件：这页的内容超出页面底部，放不下了。',
    `章节：${options.chapterTitle}`,
    `内容底边超出 ${Math.round(options.excessPx)}px（页面内容区最高到 ${CONTENT_BOTTOM_PX}px，不靠缩小字号解决）。`,
    '',
    '当前这一页的 JSON：',
    JSON.stringify(options.slide, null, 2),
    '',
    '要求：',
    '1. 把这页拆成 1–2 页：内容不多时只输出 1 页；内容确实多时拆成 2 页。',
    '2. 保留原来的全部事实和每一条来源，不要新增材料以外的内容，也不要删掉要点。',
    '3. 两页之间不要重复同一句话；第二页可以用「（续）」继续同一个主题。',
    '4. 页面类型沿用原来的 type；不要生成 cover、agenda、summary。',
    '5. 每页 sources 至少一个，id 保持原样即可，程序会统一处理。',
    '',
    '只输出一个 JSON 对象，字段 slides 是 1–2 页：',
    '{"slides":[{...}]}',
    '',
    jsonOutputRules()
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/**
 * Turns one chapter into slides. The model answer is shape-validated first,
 * then cleaned deterministically: shell slides are dropped, figure slides
 * without a `keepImage` frame are dropped, times are clamped into the video,
 * and ids are rewritten as `<chapterIndex+1>-<n>` so they are unique deck-wide.
 */
export async function composeChapter(options: ComposeChapterOptions): Promise<Slide[]> {
  const {
    client,
    chapter,
    notes,
    cards,
    screenReads,
    keyframes,
    durationSeconds,
    chapterIndex,
    chapterCount,
    signal,
    timeoutMs = DECK_MODEL_TIMEOUT_MS
  } = options;

  const schema = z.preprocess(
    unwrapSlides,
    z.array(slideSchema).min(1, { message: 'needs at least one slide' }).max(60, { message: 'too big' })
  );

  const slides = await requestValidatedJson({
    client,
    request: {
      messages: [
        {
          role: 'user',
          content: buildComposePrompt({
            chapter,
            notes,
            cards,
            screenReads,
            keyframes,
            durationSeconds,
            chapterIndex,
            chapterCount
          })
        }
      ],
      temperature: 0.3,
      maxTokens: 8_000,
      noTools: true,
      timeoutMs
    },
    schema,
    step: 'compose',
    signal
  });

  const allowed = figureFrames(keyframes, screenReads);
  const kept = slides.filter((slide) => {
    if (isShellSlide(slide)) return false;
    if (slide.type === 'figure' && !allowed.has(slide.frame)) return false;
    return true;
  });

  if (kept.length === 0) {
    throw new DeckStepError('compose', `第 ${chapterIndex + 1} 章没有可用的课件页。`);
  }

  return kept.map((slide, index) => ({
    ...clampSlideTimes(slide, durationSeconds),
    id: `${chapterIndex + 1}-${index + 1}`
  }));
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function assembleFailure(error: unknown): DeckStepError {
  if (error instanceof DeckValidationError) {
    const issues = error.issues.map((issue) => `${issue.path}: ${issue.message}`);
    return new DeckStepError('assemble', issues.join('；'), issues);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DeckStepError('assemble', message, [message]);
}

/** Up to three non-empty closing points, never an empty array. */
function summaryPointList(
  summaryPoints: readonly string[] | undefined,
  fallback: readonly string[],
  lastTitle: string
): string[] {
  const points = (summaryPoints ?? fallback)
    .map((point) => point.trim())
    .filter((point) => point.length > 0)
    .slice(0, 3);
  return points.length > 0 ? points : [lastTitle];
}

/**
 * Adds the shell slides and validates the deck. Deterministic: no model call.
 * A leading `开场` chapter carries the cover and agenda; the last content
 * chapter gains the summary page. The result is shape-validated and then
 * cross-checked (sorted chapters, times within the video, no ext video claims).
 */
export function assembleDeck(options: AssembleDeckOptions): Deck {
  const { title, sourcePath, durationSeconds, outline, chapters, summaryPoints } = options;
  if (chapters.length === 0) {
    throw new DeckStepError('assemble', '没有可用的章节。');
  }

  const cover: Slide = {
    type: 'cover',
    id: 'cover',
    title,
    subtitle: `共 ${outline.chapters.length} 章`,
    sources: [{ kind: 'video', t: 0 }]
  };
  const agenda: Slide = {
    type: 'agenda',
    id: 'agenda',
    title: '本讲内容',
    items: outline.chapters.slice(0, 8).map((chapter) => chapter.title),
    sources: [{ kind: 'video', t: 0 }]
  };

  const assembled = chapters.map((chapter) => ({
    title: chapter.title,
    start: chapter.start,
    slides: [...chapter.slides]
  }));
  const last = chapters[chapters.length - 1];
  const lastContent = assembled[assembled.length - 1];
  const summary: Slide = {
    type: 'summary',
    id: 'summary',
    title: '本讲小结',
    points: summaryPointList(summaryPoints, last.keyPoints ?? [], last.title),
    sources: [{ kind: 'video', t: clamp(last.start, 0, Math.max(0, durationSeconds)) }]
  };
  lastContent.slides.push(summary);

  const deck: Deck = {
    version: DECK_VERSION,
    title,
    sourcePath,
    durationSeconds,
    chapters: [{ title: '开场', start: 0, slides: [cover, agenda] }, ...assembled]
  };

  const parsed = deckSchema.safeParse(deck);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new DeckStepError('assemble', issues.join('；'), issues);
  }

  try {
    return validateDeck(parsed.data);
  } catch (error) {
    throw assembleFailure(error);
  }
}

// ---------------------------------------------------------------------------
// Re-fit
// ---------------------------------------------------------------------------

/**
 * Splits or trims one overflowing page. The layout step calls this with the
 * measured overflow; the model returns one or two pages that keep every fact
 * and source. The original id stays on the first page, the second gets `-b`.
 */
export async function refitSlide(options: RefitSlideOptions): Promise<Slide[]> {
  const { client, slide, excessPx, chapterTitle, signal, timeoutMs = DECK_MODEL_TIMEOUT_MS } = options;

  const schema = z.preprocess(
    wrapSlides,
    z.object({
      slides: z
        .array(slideSchema)
        .min(1, { message: 'needs at least one slide' })
        .max(2, { message: 'too many slides' })
    })
  );

  const answer = await requestValidatedJson({
    client,
    request: {
      messages: [
        { role: 'user', content: buildRefitPrompt({ slide, excessPx, chapterTitle }) }
      ],
      temperature: 0.2,
      maxTokens: 4_000,
      noTools: true,
      timeoutMs
    },
    schema,
    step: 'refit',
    signal
  });

  const kept = answer.slides.filter((candidate) => !isShellSlide(candidate));
  if (kept.length === 0) {
    throw new DeckStepError('refit', '重排后没有可用的页面。');
  }

  return kept.slice(0, 2).map((candidate, index) => ({
    ...candidate,
    id: index === 0 ? slide.id : `${slide.id}-b`
  }));
}
