import type { AppSettings } from '../../src/shared/types';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { Scheduler } from '../../src/main/scheduler/scheduler';

function settings(overrides: Partial<AppSettings['notifications']> = {}): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  // Keep morning/evening out of the way so each test isolates the weekly trigger.
  return {
    ...base,
    notifications: {
      ...base.notifications,
      morning: '23:50',
      evening: '23:55',
      weekly: '20:00',
      ...overrides
    }
  };
}

function at(day: number, hour: number, minute: number): Date {
  return new Date(2026, 10, day, hour, minute, 0);
}

test('fires the weekly review on Sunday at the configured time only', async () => {
  let now = at(2, 20, 0); // Monday
  const notified: string[] = [];
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push(`${notification.kind}:${notification.date}:${notification.scheduledTime}`);
    }
  });

  expect((await scheduler.tick()).delivered).toHaveLength(0);

  now = at(1, 19, 59); // Sunday, one minute early
  expect((await scheduler.tick()).delivered).toHaveLength(0);

  now = at(1, 20, 0); // Sunday 20:00
  const result = await scheduler.tick();
  expect(result.delivered).toHaveLength(1);
  expect(result.delivered[0]).toMatchObject({
    key: '2026-11-01:weekly-review:weekly',
    kind: 'weekly-review',
    date: '2026-11-01',
    scheduledTime: '20:00'
  });
  expect(notified).toEqual(['weekly-review:2026-11-01:20:00']);
});

test('does not fire when the weekly recap is disabled', async () => {
  const now = at(1, 20, 0);
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings({ weeklyEnabled: false }),
    notify: () => {
      throw new Error('should not notify');
    }
  });

  expect((await scheduler.tick()).delivered).toHaveLength(0);
});

test('fires once per Sunday and again on the next Sunday', async () => {
  let now = at(1, 20, 0);
  const notified: string[] = [];
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push(notification.key);
    }
  });

  expect((await scheduler.tick()).delivered).toHaveLength(1);
  now = at(1, 20, 5);
  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(notified).toHaveLength(1);

  now = at(8, 20, 0); // next Sunday
  expect((await scheduler.tick()).delivered).toHaveLength(1);
  expect(notified).toHaveLength(2);
});

test('suppresses a user reminder at the weekly recap time', async () => {
  const now = at(1, 20, 0); // Sunday 20:00
  const notified: string[] = [];
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    getReminders: async () => [{ id: 'r1', time: '20:00', label: '拉伸', enabled: true }],
    notify: (notification) => {
      notified.push(notification.kind);
    }
  });

  const result = await scheduler.tick();

  expect(result.delivered.map((notification) => notification.kind)).toEqual([
    'weekly-review'
  ]);
  expect(notified).toEqual(['weekly-review']);
});

test('keeps the reminder at that time when the weekly recap is disabled', async () => {
  const now = at(1, 20, 0);
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings({ weeklyEnabled: false }),
    getReminders: async () => [{ id: 'r1', time: '20:00', label: '拉伸', enabled: true }],
    notify: () => undefined
  });

  const result = await scheduler.tick();

  expect(result.delivered).toHaveLength(1);
  expect(result.delivered[0]).toMatchObject({ kind: 'reminder', reminderId: 'r1' });
});

test('passes weekly to the check-in callback and forwards its notification', async () => {
  let now = at(1, 20, 0);
  const calls: string[] = [];
  const notified: Array<{ kind: string; conversationId?: string; title: string }> = [];
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push({
        kind: notification.kind,
        title: notification.title,
        ...(notification.conversationId
          ? { conversationId: notification.conversationId }
          : {})
      });
    },
    onCheckIn: (kind, date) => {
      calls.push(`${kind}:${date}`);
      return {
        key: `${date}:check-in:${kind}`,
        kind: 'weekly-review',
        date,
        scheduledTime: '20:00',
        title: '管家想和你回顾这一周',
        body: '周日复盘时间到了',
        conversationId: 'weekly-1'
      };
    }
  });

  const first = await scheduler.tick();
  expect(calls).toEqual(['weekly:2026-11-01']);
  expect(first.delivered[0]).toMatchObject({
    kind: 'weekly-review',
    date: '2026-11-01',
    scheduledTime: '20:00',
    conversationId: 'weekly-1'
  });
  expect(notified).toEqual([
    { kind: 'weekly-review', title: '管家想和你回顾这一周', conversationId: 'weekly-1' }
  ]);

  now = at(1, 20, 1);
  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(calls).toHaveLength(1);
});
