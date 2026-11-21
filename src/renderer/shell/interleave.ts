import type { PracticeQuestion, PracticeSet } from '../../shared/practice';

/**
 * Interleaved mixed practice.
 *
 * The evidence (Brunmair & Richter 2019) favours mixing *similar* material:
 * the effect is positive for similar categories and maths/visual material but
 * negative for unrelated word lists (g = −0.39). So a mixed session only ever
 * combines practice sets that share one non-empty subject — never two subjects
 * — and it is offered, never forced.
 */

/** A mixed session never grows past this many questions. */
export const INTERLEAVE_MAX_QUESTIONS = 10;

/** One question plus the set it came from, so the card can show its source. */
export interface InterleavedQuestion {
  question: PracticeQuestion;
  sourceSetId: string;
  sourceSetTitle: string;
}

/** An in-memory practice set that is never persisted to the vault. */
export interface MixedPracticeSet extends PracticeSet {
  /** Source set title keyed by question id, for the `来自：…` line. */
  sources: Record<string, string>;
}

/** A set can join a mix only if it carries a subject and at least one question. */
function usable(set: PracticeSet): boolean {
  return set.subject.trim() !== '' && set.questions.length > 0;
}

/**
 * The sets that may be mixed together: the largest group sharing one
 * non-empty subject (ties keep the first subject seen). Null when fewer than
 * two sets qualify, so an entry is never shown for unrelated material.
 */
export function findMixableSets(sets: readonly PracticeSet[]): PracticeSet[] | null {
  const groups = new Map<string, PracticeSet[]>();
  for (const set of sets) {
    if (!usable(set)) continue;
    const subject = set.subject.trim();
    const group = groups.get(subject);
    if (group) group.push(set);
    else groups.set(subject, [set]);
  }

  let best: PracticeSet[] | null = null;
  for (const group of groups.values()) {
    // Groups arrive in first-seen order, so `>` keeps the earliest subject on
    // a tie and makes the choice deterministic for a given input order.
    if (group.length >= 2 && (best === null || group.length > best.length)) {
      best = group;
    }
  }
  return best;
}

/**
 * Round-robins one question from each set per pass: set1[0], set2[0], set1[1],
 * set2[1], … Exhausted sets are skipped, the order is fixed (no randomness),
 * and the list stops at `maxQuestions`.
 *
 * Returns an empty list unless at least two sets share one non-empty subject:
 * mixing different subjects is exactly the case the evidence warns against.
 */
export function interleave(
  sets: readonly PracticeSet[],
  maxQuestions: number = INTERLEAVE_MAX_QUESTIONS
): InterleavedQuestion[] {
  const rows = sets.filter(usable);
  if (rows.length < 2 || maxQuestions <= 0) return [];
  const subject = rows[0].subject.trim();
  if (rows.some((set) => set.subject.trim() !== subject)) return [];

  const result: InterleavedQuestion[] = [];
  for (let index = 0; result.length < maxQuestions; index += 1) {
    let added = false;
    for (const set of rows) {
      const question = set.questions[index];
      if (question === undefined) continue;
      result.push({
        question,
        sourceSetId: set.id,
        sourceSetTitle: set.title
      });
      added = true;
      if (result.length >= maxQuestions) break;
    }
    if (!added) break;
  }
  return result;
}

/**
 * Builds the throwaway set a mixed session answers. Attempts still resolve
 * through the real question ids, so the real sets keep their attempts and
 * mistakes; this object only names the session and remembers the sources.
 */
export function buildMixedPracticeSet(
  sets: readonly PracticeSet[]
): MixedPracticeSet | null {
  const mixable = findMixableSets(sets);
  if (mixable === null) return null;
  const entries = interleave(mixable);
  if (entries.length === 0) return null;

  const sources: Record<string, string> = {};
  for (const entry of entries) {
    sources[entry.question.id] = entry.sourceSetTitle;
  }

  const subject = mixable[0].subject.trim();
  return {
    id: `mix-${subject}`,
    workspaceId: mixable[0].workspaceId,
    title: `交错混练 · ${subject}`,
    subject,
    questions: entries.map((entry) => entry.question),
    sources
  };
}