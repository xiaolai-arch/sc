import { formatLocalDate, parseLocalDate } from '../../src/shared/date';

test('formats using local date, not UTC', () => {
  expect(formatLocalDate(new Date(2026, 9, 31, 0, 30))).toBe('2026-10-31');
});

test('parses a date string to local midnight', () => {
  const d = parseLocalDate('2026-10-31');
  expect(d.getFullYear()).toBe(2026);
  expect(d.getMonth()).toBe(9);
  expect(d.getDate()).toBe(31);
  expect(d.getHours()).toBe(0);
});

test('pads single-digit months and days', () => {
  expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
});
