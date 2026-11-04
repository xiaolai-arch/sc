import { reviewedDaysThisWeek, reviewStreak } from '../../src/shared/review-stats';

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
