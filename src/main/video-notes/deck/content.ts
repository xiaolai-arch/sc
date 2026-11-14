import { z } from 'zod';
import { sourceSchema } from './schema';

/**
 * Intermediate content produced between the transcript and `deck.json`:
 * outline → notes → enrich → factcheck. Each step's model output is validated
 * here so a bad answer fails the step instead of leaking into the deck.
 */

const boundedText = (max: number) =>
  z.string().trim().min(1, { message: 'empty' }).max(max, { message: 'too big' });

// ---------------------------------------------------------------------------
// Step 5: outline
// ---------------------------------------------------------------------------

export const outlineChapterSchema = z.object({
  title: boundedText(80),
  /** Chapter start in seconds; the first chapter starts at 0. */
  start: z.number().finite().min(0, { message: 'negative time' }),
  /** Chapter end in seconds; later chapters must start at or after it. */
  end: z.number().finite().min(0, { message: 'negative time' }),
  /** Knowledge points covered by the chapter, one short phrase each. */
  points: z
    .array(boundedText(200))
    .min(1, { message: 'needs a knowledge point' })
    .max(12, { message: 'too big' })
});

export type OutlineChapter = z.infer<typeof outlineChapterSchema>;

export const outlineSchema = z.object({
  chapters: z
    .array(outlineChapterSchema)
    .min(1, { message: 'needs at least one chapter' })
    .max(40, { message: 'too big' })
});

export type Outline = z.infer<typeof outlineSchema>;

// ---------------------------------------------------------------------------
// Step 6: notes
// ---------------------------------------------------------------------------

export const noteBlockSchema = z.object({
  /** Seconds into the lesson video. */
  t: z.number().finite().min(0, { message: 'negative time' }),
  text: boundedText(600),
  /** `video` is what the teacher said; `screen` is what the frame shows. */
  source: z.enum(['video', 'screen'])
});

export type NoteBlock = z.infer<typeof noteBlockSchema>;

export const chapterNotesSchema = z.object({
  title: boundedText(80),
  start: z.number().finite().min(0, { message: 'negative time' }),
  blocks: z
    .array(noteBlockSchema)
    .min(1, { message: 'needs a note' })
    .max(60, { message: 'too big' }),
  /** What the learner must remember from this chapter. */
  keyPoints: z
    .array(boundedText(200))
    .min(1, { message: 'needs a key point' })
    .max(8, { message: 'too big' })
});

export type ChapterNotes = z.infer<typeof chapterNotesSchema>;

export const deckNotesSchema = z.object({
  chapters: z
    .array(chapterNotesSchema)
    .min(1, { message: 'needs at least one chapter' })
    .max(40, { message: 'too big' })
});

export type DeckNotes = z.infer<typeof deckNotesSchema>;

// ---------------------------------------------------------------------------
// Step 7: enrichment cards (rendered as `insight` slides)
// ---------------------------------------------------------------------------

export const enrichCardSchema = z.object({
  /** Chapter title this card belongs to; must match an outline chapter. */
  chapter: boundedText(80),
  /** One-line conclusion shown as the slide title. */
  title: boundedText(120),
  principle: boundedText(400),
  examples: z
    .array(
      z.object({
        wrong: boundedText(300).optional(),
        right: boundedText(300)
      })
    )
    .min(2, { message: 'needs at least two examples' })
    .max(3, { message: 'too big' }),
  pitfall: boundedText(300),
  transfer: boundedText(300),
  /** At least one origin; `infer`/`ext` are allowed for outside knowledge. */
  sources: z
    .array(sourceSchema)
    .min(1, { message: 'needs a source' })
    .max(4, { message: 'too big' })
});

export type EnrichCard = z.infer<typeof enrichCardSchema>;

export const enrichResultSchema = z.object({
  cards: z.array(enrichCardSchema).max(12, { message: 'too big' })
});

export type EnrichResult = z.infer<typeof enrichResultSchema>;

// ---------------------------------------------------------------------------
// Steps 8 and 12: fact-check
// ---------------------------------------------------------------------------

export const factIssueSchema = z.object({
  target: z.enum(['notes', 'card', 'deck']),
  /**
   * Locator inside the target: a slide id, a card title, or `章节/段落`
   * for notes. Free text because the checker sees a flat list.
   */
  ref: boundedText(200),
  /** The claim being challenged, quoted from the material. */
  claim: boundedText(400),
  /** What is wrong with it and why (the transcript evidence). */
  problem: boundedText(400),
  severity: z.enum(['error', 'warn'])
});

export type FactIssue = z.infer<typeof factIssueSchema>;

export const factcheckResultSchema = z.object({
  issues: z.array(factIssueSchema).max(60, { message: 'too big' })
});

export type FactcheckResult = z.infer<typeof factcheckResultSchema>;
