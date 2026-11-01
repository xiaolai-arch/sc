import { elapsedMinutes } from '../../src/renderer/shell/timer-logic';

test('counts whole minutes and never goes negative', () => {
  expect(elapsedMinutes(new Date('2026-10-31T10:00:00'), new Date('2026-10-31T10:25:30'))).toBe(25);
  expect(elapsedMinutes(new Date('2026-10-31T10:10:00'), new Date('2026-10-31T10:00:00'))).toBe(0);
});
