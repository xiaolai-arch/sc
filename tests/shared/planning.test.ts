import { availableMinutesLabel, compressionTargetMinutes } from '../../src/shared/planning';

test('names the daily minutes and where they came from', () => {
  expect(availableMinutesLabel(45, 'workspace')).toBe('每天可用 45 分钟 · 来自项目设置');
  expect(availableMinutesLabel(90, 'input')).toBe('每天可用 90 分钟 · 本次指定');
  expect(availableMinutesLabel(10, 'week')).toBe('每天可用 10 分钟 · 来自你说的一周安排');
  expect(availableMinutesLabel(120, 'default')).toBe('每天可用 120 分钟 · 默认值');
});

test('omits the source when the plan does not record one, and never invents minutes', () => {
  expect(availableMinutesLabel(45, undefined)).toBe('每天可用 45 分钟');
  expect(availableMinutesLabel(undefined, 'workspace')).toBeUndefined();
  expect(availableMinutesLabel(0, 'default')).toBeUndefined();
  expect(availableMinutesLabel(Number.NaN, 'input')).toBeUndefined();
});

// 压量建议的目标分钟数：代码算出，模型只收到事实。
test('scales the day budget by the completion rate and rounds to 5 minutes', () => {
  expect(compressionTargetMinutes(120, 40)).toBe(50);
  expect(compressionTargetMinutes(100, 52)).toBe(50); // 52 / 5 = 10.4 → 10 → 50
  expect(compressionTargetMinutes(90, 59)).toBe(55); // 53.1 / 5 = 10.62 → 11 → 55
  expect(compressionTargetMinutes(60, 0)).toBe(15);
});

test('never suggests fewer than 15 minutes however low the rate is', () => {
  expect(compressionTargetMinutes(30, 20)).toBe(15); // 6 minutes → floored to 15
  expect(compressionTargetMinutes(120, 1)).toBe(15); // 2.4 → 5 → floored to 15
});

test('stays exact when the scaled budget is already a multiple of 5 above 15', () => {
  expect(compressionTargetMinutes(100, 60)).toBe(60);
  expect(compressionTargetMinutes(25, 60)).toBe(15);
});
