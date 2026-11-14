import { z } from 'zod';

/**
 * The deck JSON model produced by the compose step. The model never writes
 * HTML: it returns this shape, which is validated here and rendered by
 * `render.ts`. Every text field has an upper bound so a runaway model cannot
 * produce a multi-megabyte slide or an empty page.
 */

export const DECK_VERSION = 1;

/** Upper bounds for text fields, shared with the tests. */
export const DECK_LIMITS = {
  deckTitle: 120,
  sourcePath: 1024,
  chapterTitle: 80,
  slideTitle: 80,
  slideId: 64,
  tip: 200,
  subtitle: 160,
  agendaItem: 120,
  lead: 300,
  point: 300,
  passageLine: 300,
  caption: 200,
  compareHeading: 60,
  compareItem: 200,
  principle: 400,
  example: 300,
  pitfall: 300,
  transfer: 300,
  step: 200,
  quote: 500,
  codeLanguage: 24,
  codeChars: 2000,
  quizQuestion: 300,
  quizOption: 200,
  quizExplanation: 500,
  summaryPoint: 200,
  next: 200,
  extTitle: 120,
  extPage: 24
} as const;

/** Maximum lines of a `code` slide; the visual layout cannot show more. */
export const CODE_MAX_LINES = 12;

const text = (max: number) =>
  z.string().trim().min(1, { message: 'empty' }).max(max, { message: 'too big' });

const pageValue = z.union([
  z.string().trim().min(1, { message: 'empty' }).max(DECK_LIMITS.extPage, { message: 'too big' }),
  z.number().int({ message: 'page must be an integer' }).min(0, { message: 'page must be positive' })
]);

/**
 * Where a claim comes from. `video`/`screen` carry a second offset in the
 * lesson video; `infer` is derived from the video; `ext` is outside material
 * and must never be phrased as something the teacher said on screen.
 */
export const sourceSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('video'),
    t: z.number().finite().min(0, { message: 'negative time' })
  }),
  z.object({
    kind: z.literal('screen'),
    t: z.number().finite().min(0, { message: 'negative time' })
  }),
  z.object({ kind: z.literal('infer') }),
  z.object({
    kind: z.literal('ext'),
    title: text(DECK_LIMITS.extTitle).optional(),
    page: pageValue.optional()
  })
]);

export type Source = z.infer<typeof sourceSchema>;

/** Fields every slide shares. */
const baseShape = {
  id: text(DECK_LIMITS.slideId),
  /** Conclusion-style heading, not a topic label. */
  title: text(DECK_LIMITS.slideTitle),
  /** At least one provenance marker per page is required. */
  sources: z
    .array(sourceSchema)
    .min(1, { message: 'needs a source' })
    .max(6, { message: 'too many sources' }),
  /** Replay offset; usually the keyframe time, not the transcript segment. */
  t: z.number().finite().min(0, { message: 'negative time' }).optional(),
  status: z.literal('contested').optional(),
  /** Optional one-line review hint shown at the bottom of the slide. */
  tip: text(DECK_LIMITS.tip).optional()
};

const coverSlide = z.object({
  ...baseShape,
  type: z.literal('cover'),
  subtitle: text(DECK_LIMITS.subtitle).optional()
});

const agendaSlide = z.object({
  ...baseShape,
  type: z.literal('agenda'),
  items: z
    .array(text(DECK_LIMITS.agendaItem))
    .min(1, { message: 'empty' })
    .max(8, { message: 'too big' })
});

const sectionSlide = z.object({
  ...baseShape,
  type: z.literal('section'),
  lead: text(DECK_LIMITS.lead)
});

const pointsSlide = z.object({
  ...baseShape,
  type: z.literal('points'),
  points: z
    .array(
      z.object({
        text: text(DECK_LIMITS.point),
        source: sourceSchema
      })
    )
    .min(1, { message: 'empty' })
    .max(5, { message: 'too big' })
});

const passageSlide = z.object({
  ...baseShape,
  type: z.literal('passage'),
  lines: z
    .array(text(DECK_LIMITS.passageLine))
    .min(1, { message: 'empty' })
    .max(30, { message: 'too big' })
});

/**
 * A screenshot is only allowed when screen-read marked the frame as content
 * that cannot be expressed as text (`keepImage: true`). The literal true makes
 * a missing flag a schema error instead of an accidental empty image.
 */
const figureSlide = z.object({
  ...baseShape,
  type: z.literal('figure'),
  frame: z
    .string()
    .trim()
    .regex(/^frames\/[A-Za-z0-9._-]+\.jpg$/, { message: 'must be a frames/*.jpg path' }),
  keepImage: z.literal(true, { message: 'figure requires keepImage: true' }),
  captions: z
    .array(text(DECK_LIMITS.caption))
    .max(3, { message: 'too big' })
});

const compareColumn = z.object({
  heading: text(DECK_LIMITS.compareHeading),
  items: z
    .array(text(DECK_LIMITS.compareItem))
    .min(1, { message: 'empty' })
    .max(6, { message: 'too big' })
});

const compareSlide = z.object({
  ...baseShape,
  type: z.literal('compare'),
  /** Two or three columns: a side-by-side contrast, not a full table. */
  columns: z
    .array(compareColumn)
    .min(2, { message: 'needs at least two columns' })
    .max(3, { message: 'too big' })
});

const insightSlide = z.object({
  ...baseShape,
  type: z.literal('insight'),
  principle: text(DECK_LIMITS.principle),
  examples: z
    .array(
      z.object({
        wrong: text(DECK_LIMITS.example).optional(),
        right: text(DECK_LIMITS.example)
      })
    )
    .min(2, { message: 'needs at least two examples' })
    .max(3, { message: 'too big' }),
  pitfall: text(DECK_LIMITS.pitfall),
  transfer: text(DECK_LIMITS.transfer)
});

const deriveSlide = z.object({
  ...baseShape,
  type: z.literal('derive'),
  steps: z
    .array(text(DECK_LIMITS.step))
    .min(2, { message: 'needs at least two steps' })
    .max(8, { message: 'too big' })
});

const quoteSlide = z.object({
  ...baseShape,
  type: z.literal('quote'),
  text: text(DECK_LIMITS.quote)
});

const codeSlide = z.object({
  ...baseShape,
  type: z.literal('code'),
  language: text(DECK_LIMITS.codeLanguage),
  /** Code is shown literally (escaped); line count is checked separately. */
  code: z
    .string()
    .min(1, { message: 'empty' })
    .max(DECK_LIMITS.codeChars, { message: 'too big' })
});

const quizSlide = z.object({
  ...baseShape,
  type: z.literal('quiz'),
  question: text(DECK_LIMITS.quizQuestion),
  options: z
    .array(text(DECK_LIMITS.quizOption))
    .min(2, { message: 'needs at least two options' })
    .max(6, { message: 'too big' }),
  /** Zero-based index into `options`; bounds are checked against options. */
  answer: z.number().int({ message: 'answer must be an integer' }).min(0, { message: 'answer out of range' }),
  explanation: text(DECK_LIMITS.quizExplanation)
});

const summarySlide = z.object({
  ...baseShape,
  type: z.literal('summary'),
  points: z
    .array(text(DECK_LIMITS.summaryPoint))
    .min(1, { message: 'empty' })
    .max(3, { message: 'too big' }),
  next: text(DECK_LIMITS.next).optional()
});

/** All slide types. Adding one here also requires a renderer branch. */
export const slideSchema = z.discriminatedUnion('type', [
  coverSlide,
  agendaSlide,
  sectionSlide,
  pointsSlide,
  passageSlide,
  figureSlide,
  compareSlide,
  insightSlide,
  deriveSlide,
  quoteSlide,
  codeSlide,
  quizSlide,
  summarySlide
]);

export type Slide = z.infer<typeof slideSchema>;
export type SlideType = Slide['type'];

export const chapterSchema = z.object({
  title: text(DECK_LIMITS.chapterTitle),
  /** Chapter start in seconds; chapters are sorted ascending. */
  start: z.number().finite().min(0, { message: 'negative time' }),
  slides: z
    .array(slideSchema)
    .min(1, { message: 'needs at least one slide' })
    .max(60, { message: 'too big' })
});

export type Chapter = z.infer<typeof chapterSchema>;

export const deckSchema = z.object({
  version: z.literal(DECK_VERSION),
  title: text(DECK_LIMITS.deckTitle),
  sourcePath: text(DECK_LIMITS.sourcePath),
  durationSeconds: z
    .number()
    .finite()
    .positive({ message: 'duration must be positive' })
    .max(43_200, { message: 'duration too big' }),
  chapters: z
    .array(chapterSchema)
    .min(1, { message: 'needs at least one chapter' })
    .max(200, { message: 'too big' })
});

export type Deck = z.infer<typeof deckSchema>;

/** A single path-annotated validation problem. */
export interface DeckIssue {
  /** e.g. `chapters[2].slides[5].points[1].text`. */
  path: string;
  message: string;
}

export class DeckValidationError extends Error {
  readonly issues: DeckIssue[];

  constructor(issues: DeckIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('\n'));
    this.name = 'DeckValidationError';
    this.issues = issues;
  }
}

/** Turns a zod path array into `chapters[2].slides[5].title`. */
function formatPath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
      continue;
    }
    const name = String(segment);
    if (/^[A-Za-z_$][\w$]*$/.test(name)) {
      out += out.length > 0 ? `.${name}` : name;
    } else {
      out += `[${JSON.stringify(name)}]`;
    }
  }
  return out.length > 0 ? out : '(root)';
}

function issuesFromZod(error: z.ZodError): DeckIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message
  }));
}

/**
 * Phrases that claim the page's content was said on screen. They are only
 * forbidden on pages whose sources are exclusively `ext`: an external source
 * cannot be something the teacher said in this video.
 */
const EXT_VIDEO_CLAIMS = ['老师说', '视频里讲', '讲的'] as const;

interface TextEntry {
  path: string;
  value: string;
}

/** Every model-provided text on a slide, with a relative path. */
function slideTextEntries(slide: Slide): TextEntry[] {
  const entries: TextEntry[] = [{ path: 'title', value: slide.title }];
  const push = (path: string, value: string | undefined) => {
    if (value !== undefined) entries.push({ path, value });
  };

  switch (slide.type) {
    case 'cover':
      push('subtitle', slide.subtitle);
      break;
    case 'agenda':
      slide.items.forEach((item, index) => push(`items[${index}]`, item));
      break;
    case 'section':
      push('lead', slide.lead);
      break;
    case 'points':
      slide.points.forEach((point, index) => push(`points[${index}].text`, point.text));
      break;
    case 'passage':
      slide.lines.forEach((line, index) => push(`lines[${index}]`, line));
      break;
    case 'figure':
      slide.captions.forEach((caption, index) => push(`captions[${index}]`, caption));
      break;
    case 'compare':
      slide.columns.forEach((column, columnIndex) => {
        push(`columns[${columnIndex}].heading`, column.heading);
        column.items.forEach((item, itemIndex) =>
          push(`columns[${columnIndex}].items[${itemIndex}]`, item)
        );
      });
      break;
    case 'insight':
      push('principle', slide.principle);
      push('pitfall', slide.pitfall);
      push('transfer', slide.transfer);
      slide.examples.forEach((example, index) => {
        push(`examples[${index}].wrong`, example.wrong);
        push(`examples[${index}].right`, example.right);
      });
      break;
    case 'derive':
      slide.steps.forEach((step, index) => push(`steps[${index}]`, step));
      break;
    case 'quote':
      push('text', slide.text);
      break;
    case 'code':
      push('language', slide.language);
      push('code', slide.code);
      break;
    case 'quiz':
      push('question', slide.question);
      slide.options.forEach((option, index) => push(`options[${index}]`, option));
      push('explanation', slide.explanation);
      break;
    case 'summary':
      slide.points.forEach((point, index) => push(`points[${index}]`, point));
      push('next', slide.next);
      break;
  }

  push('tip', slide.tip);
  return entries;
}

function isTimed(source: Source): source is Extract<Source, { kind: 'video' | 'screen' }> {
  return source.kind === 'video' || source.kind === 'screen';
}

/**
 * Cross-field checks that zod's shape schemas cannot express: times need the
 * deck duration, chapter order needs the whole list, and `ext` phrasing needs
 * all of a slide's text at once.
 */
function collectDeckIssues(deck: Deck, framePaths?: ReadonlySet<string>): DeckIssue[] {
  const issues: DeckIssue[] = [];
  let previousStart = Number.NEGATIVE_INFINITY;

  deck.chapters.forEach((chapter, chapterIndex) => {
    const chapterPath = `chapters[${chapterIndex}]`;

    if (chapter.start < previousStart) {
      issues.push({ path: `${chapterPath}.start`, message: 'chapters must be sorted by start' });
    }
    previousStart = chapter.start;

    chapter.slides.forEach((slide, slideIndex) => {
      const slidePath = `${chapterPath}.slides[${slideIndex}]`;
      const extOnly =
        slide.sources.some((source) => source.kind === 'ext') &&
        !slide.sources.some((source) => source.kind === 'video' || source.kind === 'screen');

      slide.sources.forEach((source, sourceIndex) => {
        if (!isTimed(source)) return;
        if (source.t > deck.durationSeconds) {
          issues.push({
            path: `${slidePath}.sources[${sourceIndex}].t`,
            message: `time ${source.t} exceeds duration ${deck.durationSeconds}`
          });
        }
      });

      if (slide.t !== undefined && slide.t > deck.durationSeconds) {
        issues.push({
          path: `${slidePath}.t`,
          message: `time ${slide.t} exceeds duration ${deck.durationSeconds}`
        });
      }

      if (extOnly) {
        for (const entry of slideTextEntries(slide)) {
          for (const phrase of EXT_VIDEO_CLAIMS) {
            if (entry.value.includes(phrase)) {
              issues.push({
                path: `${slidePath}.${entry.path}`,
                message: `ext source cannot claim video content ("${phrase}")`
              });
            }
          }
        }
      }

      if (slide.type === 'figure') {
        if (framePaths !== undefined && !framePaths.has(slide.frame)) {
          issues.push({
            path: `${slidePath}.frame`,
            message: `frame "${slide.frame}" does not exist`
          });
        }
      }

      if (slide.type === 'quiz') {
        if (slide.answer >= slide.options.length) {
          issues.push({
            path: `${slidePath}.answer`,
            message: `answer ${slide.answer} is out of range for ${slide.options.length} options`
          });
        }
      }

      if (slide.type === 'code') {
        const lineCount = slide.code.split(/\r\n|\r|\n/).length;
        if (lineCount > CODE_MAX_LINES) {
          issues.push({
            path: `${slidePath}.code`,
            message: `too many lines (${lineCount} > ${CODE_MAX_LINES})`
          });
        }
      }
    });
  });

  return issues;
}

export interface ValidateDeckOptions {
  /** Absolute frame paths available to the renderer, keyed the same way as `figure.frame`. */
  framePaths?: Iterable<string>;
}

/**
 * Runs the cross-field rules on an already shape-valid deck. Pass `framePaths`
 * to also check that every `figure.frame` exists; `renderDeck` does this with
 * the keys of its frame map so a missing image is an error, not a blank slide.
 */
export function validateDeck(deck: Deck, options: ValidateDeckOptions = {}): Deck {
  const framePaths =
    options.framePaths === undefined ? undefined : new Set<string>(options.framePaths);
  const issues = collectDeckIssues(deck, framePaths);
  if (issues.length > 0) throw new DeckValidationError(issues);
  return deck;
}

/**
 * Parses untrusted JSON into a `Deck`, throwing a readable, path-annotated
 * error such as `chapters[2].slides[5].points[1].text: too big`.
 */
export function parseDeck(json: unknown): Deck {
  const result = deckSchema.safeParse(json);
  if (!result.success) throw new DeckValidationError(issuesFromZod(result.error));
  return validateDeck(result.data);
}
