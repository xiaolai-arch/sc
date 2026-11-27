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
