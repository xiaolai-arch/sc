import { availableMinutesLabel } from '../../src/shared/planning';

test('names the daily minutes and where they came from', () => {
  expect(availableMinutesLabel(45, 'workspace')).toBe('每天可用 45 分钟 · 来自项目设置');
  expect(availableMinutesLabel(90, 'input')).toBe('每天可用 90 分钟 · 本次指定');
  expect(availableMinutesLabel(120, 'default')).toBe('每天可用 120 分钟 · 默认值');
});

test('omits the source when the plan does not record one, and never invents minutes', () => {
  expect(availableMinutesLabel(45, undefined)).toBe('每天可用 45 分钟');
  expect(availableMinutesLabel(undefined, 'workspace')).toBeUndefined();
  expect(availableMinutesLabel(0, 'default')).toBeUndefined();
  expect(availableMinutesLabel(Number.NaN, 'input')).toBeUndefined();
});
