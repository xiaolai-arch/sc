import { isTaskRepeat, nextRepeatDate, TASK_REPEAT_LABELS } from '../../src/shared/recurrence';

test('advances daily repeats by one day', () => {
  expect(nextRepeatDate('2026-11-04', 'daily')).toBe('2026-11-05');
  expect(nextRepeatDate('2026-11-30', 'daily')).toBe('2026-12-01');
});

test('skips the weekend for weekday repeats', () => {
  expect(nextRepeatDate('2026-11-05', 'weekdays')).toBe('2026-11-06');
  expect(nextRepeatDate('2026-11-06', 'weekdays')).toBe('2026-11-09');
  expect(nextRepeatDate('2026-11-07', 'weekdays')).toBe('2026-11-09');
});

test('advances weekly repeats by seven days', () => {
  expect(nextRepeatDate('2026-11-04', 'weekly')).toBe('2026-11-11');
});

test('recognises the repeat values and labels them in Chinese', () => {
  expect(isTaskRepeat('daily')).toBe(true);
  expect(isTaskRepeat('weekdays')).toBe(true);
  expect(isTaskRepeat('weekly')).toBe(true);
  expect(isTaskRepeat('monthly')).toBe(false);
  expect(TASK_REPEAT_LABELS).toEqual({
    daily: '每天',
    weekdays: '工作日',
    weekly: '每周'
  });
});
