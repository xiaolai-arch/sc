import {
  isReviewFreshStart,
  isReviewLapsed,
  longestReviewStreak,
  reviewedDaysThisWeek,
  reviewStreak
} from '../../src/shared/review-stats';

function at(year: number, month: number, day: number): Date {
  return new Date(year, month - 1, day, 12, 0, 0);
}

const r = (...dates: string[]) => dates.map((date) => ({ date }));

test('counts consecutive review days ending today', () => {
  expect(reviewStreak(r('2026-11-04', '2026-11-03', '2026-11-02'), '2026-11-04')).toBe(3);
  // A missed day breaks the streak.
  expect(reviewStreak(r('2026-11-04', '2026-11-02'), '2026-11-04')).toBe(1);
  // Not reviewing today means no current streak.
  expect(reviewStreak(r('2026-11-03', '2026-11-02'), '2026-11-04')).toBe(0);
  expect(reviewStreak([], '2026-11-04')).toBe(0);
});

test('counts distinct reviewed days in the current Monday-based week', () => {
  // 2026-11-04 is a Wednesday; the week starts Monday 11-02.
  expect(reviewedDaysThisWeek(r('2026-11-04', '2026-11-02', '2026-11-04'), at(2026, 11, 4))).toBe(2);
  // Last week and future dates do not count.
  expect(reviewedDaysThisWeek(r('2026-11-01', '2026-11-05'), at(2026, 11, 4))).toBe(0);
  // On a Sunday the week still starts the previous Monday (2026-11-01).
  expect(reviewedDaysThisWeek(r('2026-11-01'), at(2026, 11, 1))).toBe(1);
});

// --- longestReviewStreak (P0 断签恢复) ----------------------------------------

test('the longest streak crosses month and year boundaries', () => {
  expect(longestReviewStreak(r('2025-12-30', '2025-12-31', '2026-01-01'))).toBe(3);
  expect(longestReviewStreak(r('2026-02-28', '2026-03-01'))).toBe(2);
});

test('the longest streak sorts unordered input', () => {
  expect(longestReviewStreak(r('2026-03-05', '2026-03-03', '2026-03-04'))).toBe(3);
});

test('the longest streak counts one day once', () => {
  expect(longestReviewStreak(r('2026-03-04', '2026-03-04', '2026-03-05', '2026-03-04'))).toBe(2);
});

test('the longest streak is 0 for an empty history', () => {
  expect(longestReviewStreak([])).toBe(0);
});

test('the longest streak picks the longest of split runs', () => {
  expect(longestReviewStreak(r('2026-03-04'))).toBe(1);
  expect(
    longestReviewStreak(r('2026-03-01', '2026-03-02', '2026-03-08', '2026-03-09', '2026-03-10'))
  ).toBe(3);
});

// --- the lapse and fresh-start predicates (P0 断签恢复) ------------------------

test('isReviewLapsed needs history and a gap on both today and yesterday', () => {
  // Lapsed: the last review is three days back, across the month boundary.
  expect(isReviewLapsed(r('2026-02-26'), '2026-03-01')).toBe(true);
  // Alive: yesterday reviewed keeps the streak on display.
  expect(isReviewLapsed(r('2026-02-28'), '2026-03-01')).toBe(false);
  // Alive: today reviewed.
  expect(isReviewLapsed(r('2026-03-01'), '2026-03-01')).toBe(false);
  // Never reviewed: there is no streak that broke.
  expect(isReviewLapsed([], '2026-03-01')).toBe(false);
});

test('isReviewFreshStart needs a missed yesterday and earlier history', () => {
  // Yesterday has no review; a review from before it does.
  expect(isReviewFreshStart(r('2026-02-26'), '2026-03-01')).toBe(true);
  // Yesterday reviewed: nothing to restart.
  expect(isReviewFreshStart(r('2026-02-28'), '2026-03-01')).toBe(false);
  // History starts no earlier than yesterday (today only): nothing to return to.
  expect(isReviewFreshStart(r('2026-03-01'), '2026-03-01')).toBe(false);
  expect(isReviewFreshStart([], '2026-03-01')).toBe(false);
});
