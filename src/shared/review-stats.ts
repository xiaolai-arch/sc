import { formatLocalDate, parseLocalDate } from './date';

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
