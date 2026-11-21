import { formatLocalDate, isMutedOn, parseLocalDate } from '../../src/shared/date';

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

test('isMutedOn mutes the stored day itself', () => {
  expect(isMutedOn('2026-11-25', '2026-11-25')).toBe(true);
});

test('isMutedOn mutes earlier days inside the range', () => {
  expect(isMutedOn('2026-11-25', '2026-11-23')).toBe(true);
});

test('isMutedOn resumes the day after the stored date', () => {
  expect(isMutedOn('2026-11-25', '2026-11-26')).toBe(false);
});

test('isMutedOn leaves an already past date unmuted', () => {
  expect(isMutedOn('2026-11-20', '2026-11-22')).toBe(false);
});

test('isMutedOn treats empty, missing and malformed dates as unmuted', () => {
  expect(isMutedOn('', '2026-11-22')).toBe(false);
  expect(isMutedOn(undefined, '2026-11-22')).toBe(false);
  expect(isMutedOn(null, '2026-11-22')).toBe(false);
  expect(isMutedOn('someday', '2026-11-22')).toBe(false);
  expect(isMutedOn('2026-13-01', '2026-11-22')).toBe(false);
  expect(isMutedOn('2026-11-22', 'not-a-date')).toBe(false);
});
