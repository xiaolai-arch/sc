import { parseLocalDate } from '../../shared/date';
import type { PracticeAttempt, PracticeMistake } from '../../shared/practice';

/** The window shared with 正确率趋势 / 把握度校准: this Monday week plus seven. */
export const WEEKLY_HONEST_WEEKS = 8;

export interface WeeklyHonest {
  /** e.g. `有把握但错 2 道 · 没把握但对 1 道`; null when neither cell exists. */
  calibration: string | null;
  /** e.g. `下周先练「三角函数」的到期错题（3 道）`; null when no subject qualifies. */
  nextStep: string | null;
}

/**
 * A mistake joined with its source set's subject. `PracticeMistake` carries no
 * subject itself, so the caller annotates it from `listSets` before calling
 * `weeklyHonest`; a mistake left without one is never guessed at.
 */
export interface WeeklyHonestMistake extends PracticeMistake {
  subject?: string;
}

export interface WeeklyHonestInput {
  /** Whole attempt history; the 8-week window is applied here. */
  attempts: readonly PracticeAttempt[];
  /** Active mistakes only, optionally annotated with `subject`. */
  mistakes: readonly WeeklyHonestMistake[];
  /** Local date `YYYY-MM-DD`, keyed to the review's own date. */
  today: string;
  /**
   * Per-subject answered/correct totals over the same 8-week window. Used to
   * break due-mistake ties and as the fallback when no mistake is due.
   */
  accuracyBySubject?: Record<string, { answered: number; correct: number }>;
}

type SubjectStats = { answered: number; correct: number };

function startOfWeek(today: Date): Date {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // getDay(): 0 = Sunday; shift so Monday starts the week.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** True when `value` falls in the current Monday week or the seven before. */
function inHonestWindow(value: Date, currentMonday: Date): boolean {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  // `Math.round` absorbs daylight-saving drift between two local midnights.
  const offset = Math.round((currentMonday.getTime() - startOfWeek(value).getTime()) / weekMs);
  return offset >= 0 && offset < WEEKLY_HONEST_WEEKS;
}

/** Accuracy as a ratio; a subject without answers ranks after every known one. */
function accuracyOf(stats: SubjectStats | undefined): number {
  if (!stats || stats.answered <= 0) return Number.POSITIVE_INFINITY;
  return stats.correct / stats.answered;
}

function compareAccuracy(
  a: SubjectStats | undefined,
  b: SubjectStats | undefined
): number {
  const left = accuracyOf(a);
  const right = accuracyOf(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Code-unit order, so the tie-break never depends on the host locale. */
function compareSubject(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The honest receipt appended to the Sunday review.
 *
 * Selection order (deterministic):
 * 1. Calibration counts only the two mismatch cells inside the same 8-week
 *    Monday window as 正确率趋势/把握度校准: `有把握但错` (sure + wrong) and
 *    `没把握但对` (unsure + correct). Matching cells, attempts without a
 *    confidence mark, attempts outside the window and unparseable timestamps
 *    are all ignored. Null when neither mismatch cell exists.
 * 2. Next step first looks at active mistakes already due (`due <= today`).
 *    The subject with the most such mistakes wins; ties go to the lowest
 *    accuracy in `accuracyBySubject` (missing accuracy ranks after known
 *    values), then the subject name so input order never decides.
 * 3. With no subject-bearing due mistake, the lowest-accuracy subject with at
 *    least 10 answers wins (same tie order).
 * 4. Otherwise both fields are null and the weekly message stays byte-identical.
 *
 * A mistake without a non-empty known subject is skipped, never guessed.
 */
export function weeklyHonest(input: WeeklyHonestInput): WeeklyHonest {
  const todayDate = parseLocalDate(input.today);
  const currentMonday = startOfWeek(todayDate);
  const accuracy = input.accuracyBySubject ?? {};

  let sureWrong = 0;
  let unsureCorrect = 0;
  for (const attempt of input.attempts) {
    if (attempt.confidence !== 'sure' && attempt.confidence !== 'unsure') continue;
    const answeredAt = new Date(attempt.answeredAt);
    if (Number.isNaN(answeredAt.getTime())) continue;
    if (!inHonestWindow(answeredAt, currentMonday)) continue;
    if (attempt.confidence === 'sure' && !attempt.correct) sureWrong += 1;
    if (attempt.confidence === 'unsure' && attempt.correct) unsureCorrect += 1;
  }

  const segments = [
    sureWrong > 0 ? `有把握但错 ${sureWrong} 道` : null,
    unsureCorrect > 0 ? `没把握但对 ${unsureCorrect} 道` : null
  ].filter((segment): segment is string => segment !== null);

  const todayKey = input.today;
  const dueCounts = new Map<string, number>();
  for (const mistake of input.mistakes) {
    if (mistake.status !== 'active') continue;
    if (mistake.due > todayKey) continue;
    const subject = mistake.subject?.trim();
    if (!subject) continue;
    dueCounts.set(subject, (dueCounts.get(subject) ?? 0) + 1);
  }

  let nextStep: string | null = null;
  if (dueCounts.size > 0) {
    const [subject, count] = [...dueCounts.entries()].sort(
      (a, b) =>
        b[1] - a[1] ||
        compareAccuracy(accuracy[a[0]], accuracy[b[0]]) ||
        compareSubject(a[0], b[0])
    )[0]!;
    nextStep = `下周先练「${subject}」的到期错题（${count} 道）`;
  } else {
    const candidates = Object.entries(accuracy)
      .filter(([subject, stats]) => subject.trim() !== '' && stats.answered >= 10)
      .sort(
        (a, b) =>
          compareAccuracy(a[1], b[1]) || compareSubject(a[0], b[0])
      );
    if (candidates.length > 0) {
      const [subject, stats] = candidates[0]!;
      const percent = Math.round((stats.correct / stats.answered) * 100);
      nextStep = `下周先补一补「${subject}」：近 8 周正确率 ${percent}%`;
    }
  }

  return {
    calibration: segments.length === 0 ? null : segments.join(' · '),
    nextStep
  };
}

/**
 * Per-subject answered/correct totals inside the same 8-week window, for the
 * provider that feeds `weeklyHonest`. The join is by `setId`, so each
 * workspace must be aggregated with its own set map: seed set ids repeat
 * across workspaces.
 */
export function weeklyAccuracyBySubject(
  attempts: readonly PracticeAttempt[],
  subjectBySetId: ReadonlyMap<string, string>,
  today: string
): Record<string, SubjectStats> {
  const currentMonday = startOfWeek(parseLocalDate(today));
  const result: Record<string, SubjectStats> = {};
  for (const attempt of attempts) {
    const answeredAt = new Date(attempt.answeredAt);
    if (Number.isNaN(answeredAt.getTime())) continue;
    if (!inHonestWindow(answeredAt, currentMonday)) continue;
    const subject = subjectBySetId.get(attempt.setId)?.trim();
    if (!subject) continue;
    const stats = result[subject] ?? { answered: 0, correct: 0 };
    stats.answered += 1;
    if (attempt.correct) stats.correct += 1;
    result[subject] = stats;
  }
  return result;
}