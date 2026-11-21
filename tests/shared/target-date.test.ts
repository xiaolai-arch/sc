import { formatLocalDate } from '../../src/shared/date';
import {
  daysUntilTarget,
  isTargetDate,
  targetCountdownLabel
} from '../../src/shared/workspace';

test('counts whole local days to the target date', () => {
  expect(daysUntilTarget('2027-12-19', '2026-11-21')).toBe(393);
  expect(daysUntilTarget('2027-12-19', '2027-12-18')).toBe(1);
  expect(daysUntilTarget('2027-12-19', '2027-12-19')).toBe(0);
});

test('a passed deadline counts negative days, never a wrapped-around value', () => {
  expect(daysUntilTarget('2027-12-19', '2027-12-20')).toBe(-1);
  expect(daysUntilTarget('2027-12-19', '2028-01-19')).toBe(-31);
});

test('is not shifted by a daylight-saving change or a month boundary', () => {
  // November 2026 crosses the end of US daylight saving time.
  expect(daysUntilTarget('2026-11-30', '2026-10-31')).toBe(30);
  expect(daysUntilTarget('2027-03-01', '2027-02-01')).toBe(28);
});

test('rejects unreadable dates instead of inventing a count', () => {
  expect(daysUntilTarget('2027-02-31', '2026-11-21')).toBeNull();
  expect(daysUntilTarget('2027-12-19', 'not-a-date')).toBeNull();
  expect(daysUntilTarget('', '2026-11-21')).toBeNull();
});

test('recognizes only real YYYY-MM-DD calendar dates', () => {
  expect(isTargetDate('2027-12-19')).toBe(true);
  expect(isTargetDate('2028-02-29')).toBe(true);
  expect(isTargetDate('2027-02-29')).toBe(false);
  expect(isTargetDate('2027-12-19T00:00')).toBe(false);
  expect(isTargetDate(undefined)).toBe(false);
  expect(isTargetDate(20271219)).toBe(false);
});

test('renders the quiet one-line countdown', () => {
  expect(targetCountdownLabel('2027-12-19', '2026-11-21')).toBe(
    '距离目标 2027-12-19 还有 393 天'
  );
  expect(targetCountdownLabel('2027-12-19', '2027-12-19')).toBe(
    '距离目标 2027-12-19 还有 0 天'
  );
  expect(targetCountdownLabel('2027-12-19', '2027-12-20')).toBe('目标日已过');
});

test('renders nothing without a usable target date', () => {
  expect(targetCountdownLabel(undefined, '2026-11-21')).toBeUndefined();
  expect(targetCountdownLabel('', '2026-11-21')).toBeUndefined();
  expect(targetCountdownLabel('2027-02-31', '2026-11-21')).toBeUndefined();
});

test('the countdown follows the real local date, not a cached one', () => {
  // Same target, two different "todays" — the label moves with the calendar.
  const target = '2027-12-19';
  expect(targetCountdownLabel(target, formatLocalDate(new Date(2026, 10, 21)))).toContain(
    '还有 393 天'
  );
  expect(targetCountdownLabel(target, formatLocalDate(new Date(2026, 10, 22)))).toContain(
    '还有 392 天'
  );
});
