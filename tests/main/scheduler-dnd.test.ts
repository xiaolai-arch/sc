import type { AppSettings } from '../../src/shared/types';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { Scheduler } from '../../src/main/scheduler/scheduler';
import { isWithinDnd, notificationState } from '../../src/main/scheduler/time';

function settings(overrides: Partial<AppSettings['notifications']> = {}): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    notifications: { ...base.notifications, ...overrides }
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

describe('DND window', () => {
  test('handles overnight and same-day windows', () => {
    expect(isWithinDnd(at(22, 59), '23:00', '07:30')).toBe(false);
    expect(isWithinDnd(at(23, 0), '23:00', '07:30')).toBe(true);
    expect(isWithinDnd(at(0, 0), '23:00', '07:30')).toBe(true);
    expect(isWithinDnd(at(7, 29), '23:00', '07:30')).toBe(true);
    expect(isWithinDnd(at(7, 30), '23:00', '07:30')).toBe(false);
    expect(isWithinDnd(at(12, 0), '09:00', '17:00')).toBe(true);
    expect(isWithinDnd(at(17, 0), '09:00', '17:00')).toBe(false);
    expect(isWithinDnd(at(12, 0), '09:00', '09:00')).toBe(false);
  });

  test('reports disabled before the DND state', () => {
    expect(notificationState(settings({ enabled: false }), at(23, 30))).toBe('disabled');
    expect(notificationState(settings(), at(23, 30))).toBe('dnd');
    expect(notificationState(settings(), at(12, 0))).toBe('enabled');
  });

  test('suppresses a due trigger during DND and catches it up once the window ends', async () => {
    let now = at(7, 0);
    const callbacks: string[] = [];
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings({ morning: '07:00' }),
      notify: (notification) => {
        notified.push(notification.key);
      },
      onMorningPlan: (date) => {
        callbacks.push(date);
      }
    });

    const duringDnd = await scheduler.tick();
    expect(duringDnd.delivered).toHaveLength(0);
    expect(duringDnd.suppressed).toEqual([
      { key: '2026-10-31:morning-plan:morning', kind: 'morning-plan', reason: 'dnd' }
    ]);
    expect(callbacks).toHaveLength(0);

    now = at(7, 29);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(callbacks).toHaveLength(0);

    now = at(7, 30);
    const afterDnd = await scheduler.tick();
    expect(afterDnd.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
    expect(callbacks).toEqual(['2026-10-31']);
    expect(notified).toHaveLength(1);

    now = at(8, 0);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(1);
  });

  test('leaves a trigger unconsumed when the notification sink fails', async () => {
    let now = at(8, 0);
    let attempts = 0;
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      notify: () => {
        attempts += 1;
        if (attempts === 1) throw new Error('sink unavailable');
      }
    });

    const failed = await scheduler.tick();
    expect(failed.delivered).toHaveLength(0);
    expect(failed.failed).toEqual(['2026-10-31:morning-plan:morning']);

    const retried = await scheduler.tick();
    expect(retried.delivered).toHaveLength(1);
    expect(attempts).toBe(2);
  });
});
