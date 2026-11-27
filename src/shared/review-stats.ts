import { addLocalDays, formatLocalDate, parseLocalDate } from './date';

export interface DatedReview {
  date: string;
}

/** Consecutive review days ending on `today` (skipped days still count as reviewed). */
export function reviewStreak(reviews: readonly DatedReview[], today: string): number {
  const dates = new Set(reviews.map((entry) => entry.date));
  let streak = 0;
  const cursor = parseLocalDate(today);
  while (dates.has(formatLocalDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** Distinct review days from Monday of the current week through today. */
export function reviewedDaysThisWeek(reviews: readonly DatedReview[], today: Date): number {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // getDay(): 0 = Sunday; shift so Monday is the first day of the week.
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const startKey = formatLocalDate(start);
  const todayKey = formatLocalDate(today);
  const dates = new Set(
    reviews
      .map((entry) => entry.date)
      .filter((date) => date >= startKey && date <= todayKey)
  );
  return dates.size;
}

/**
 * The longest run of consecutive review days anywhere in the history,
 * independent of today: a lapsed streak keeps its record. Same local-calendar
 * day semantics as `reviewStreak`; one day counted twice is one day, unordered
 * input is sorted first, and an empty history is 0.
 */
export function longestReviewStreak(reviews: readonly DatedReview[]): number {
  const dates = [...new Set(reviews.map((entry) => entry.date))].sort();
  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const date of dates) {
    run = previous !== null && addLocalDays(previous, 1) === date ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = date;
  }
  return longest;
}

/**
 * True for a lapsed day: history exists, but neither today nor yesterday has
 * a review. Never-reviewed is not lapsed — there is no streak that broke.
 */
export function isReviewLapsed(reviews: readonly DatedReview[], today: string): boolean {
  if (reviews.length === 0) return false;
  const dates = new Set(reviews.map((entry) => entry.date));
  return !dates.has(today) && !dates.has(addLocalDays(today, -1));
}

/**
 * True on the morning after a missed day: yesterday has no review, but the
 * history before it does. Empty history (or a history that starts no earlier
 * than yesterday) is not a fresh start — there was nothing to return to.
 */
export function isReviewFreshStart(reviews: readonly DatedReview[], today: string): boolean {
  const yesterday = addLocalDays(today, -1);
  const dates = new Set(reviews.map((entry) => entry.date));
  if (dates.has(yesterday)) return false;
  return reviews.some((entry) => entry.date < yesterday);
}

/**
 * spec 默认，评审可调：the staleness threshold for the morning tomorrow
 * bridge (iter33 P0). When the newest `STALE_TOMORROW_THRESHOLD` reviews that
 * carry a non-empty `tomorrow` all wrote the same normalized step, the
 * morning line switches to its 切小/换一步 variant. A constant, never a
 * settings-page item.
 */
export const STALE_TOMORROW_THRESHOLD = 3;

/** The review fields the tomorrow bridge reads; a subset of `ReviewRecord`. */
export interface TomorrowBridgeReview {
  /** Local calendar date (`YYYY-MM-DD`) of the review. */
  date: string;
  /** Submission timestamp; the newest record wins, as in `readReviews`. */
  submittedAt: string;
  /** Tolerated as unknown: a non-string reads as no data, like an empty one. */
  tomorrow: unknown;
}

/** The facts the morning tomorrow-bridge line is built from. */
export interface TomorrowBridgeFacts {
  /** The raw `tomorrow` text as written; the line embeds it verbatim. */
  tomorrow: string;
  /** True when the newest `STALE_TOMORROW_THRESHOLD` non-empty tomorrows agree. */
  stale: boolean;
}

/**
 * The tomorrow comparison key: trim, then collapse every whitespace run into
 * a single space. Full- and half-width characters are deliberately *not*
 * folded into each other — what the user wrote is what counts (spec 默认
 * 决定 2，不聪明).
 */
export function normalizeTomorrow(tomorrow: string): string {
  return tomorrow.trim().replace(/\s+/g, ' ');
}

/**
 * The newest review written before `today` that carries a non-empty
 * `tomorrow`, plus whether the newest `STALE_TOMORROW_THRESHOLD` such reviews
 * all wrote the same normalized step — or null when there is no such review,
 * so the morning message keeps its previous bytes.
 *
 * 「Before today」is the review's own local date, so a submission recorded
 * today can never leak into the morning line. Counting semantics (spec
 * 验收 5): only reviews with a non-empty `tomorrow` count; a review with an
 * empty, blank or badly-typed `tomorrow` neither breaks the staleness run
 * nor consumes a threshold slot — it is skipped, not a reset. Ordering
 * follows `readReviews` (newest `submittedAt` first), re-applied here so
 * unordered callers stay deterministic.
 */
export function tomorrowBridge(
  reviews: readonly TomorrowBridgeReview[],
  today: string
): TomorrowBridgeFacts | null {
  const withTomorrow = reviews
    .filter(
      (review): review is TomorrowBridgeReview & { tomorrow: string } =>
        review.date < today &&
        typeof review.tomorrow === 'string' &&
        review.tomorrow.trim() !== ''
    )
    .sort(
      (a, b) =>
        b.submittedAt.localeCompare(a.submittedAt) || b.date.localeCompare(a.date)
    );
  const newest = withTomorrow[0];
  if (newest === undefined) return null;
  const newestNormalized = normalizeTomorrow(newest.tomorrow);
  const window = withTomorrow.slice(0, STALE_TOMORROW_THRESHOLD);
  const stale =
    window.length >= STALE_TOMORROW_THRESHOLD &&
    window.every(
      (review) => normalizeTomorrow(review.tomorrow) === newestNormalized
    );
  return { tomorrow: newest.tomorrow, stale };
}
