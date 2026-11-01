import type { AppSettings } from '../../src/shared/types';
import type { Reminder } from '../../src/shared/workspace';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { Scheduler } from '../../src/main/scheduler/scheduler';

function settings(): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return { ...base, notifications: { ...base.notifications, morning: '15:00' } };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

describe('Scheduler reminders', () => {
  test('fires each enabled reminder once and skips disabled ones', async () => {
    let now = at(11, 59);
    const reminders: Reminder[] = [
      { id: 'r1', time: '12:00', label: '喝水', enabled: true },
      { id: 'r2', time: '12:00', label: '停用', enabled: false },
      { id: 'r3', time: '12:00', label: '休息', enabled: true },
      { id: 'r4', time: '15:00', label: '早间计划', enabled: true }
    ];
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => reminders,
      notify: (notification) => {
        notified.push(`${notification.kind}:${notification.reminderId}`);
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(12, 0);
    const delivered = await scheduler.tick();
    expect(delivered.delivered.map((entry) => entry.reminderId).sort()).toEqual(['r1', 'r3']);
    expect(notified.sort()).toEqual(['reminder:r1', 'reminder:r3']);

    now = at(12, 1);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(2);
  });

  test('a broken reminder read does not block the morning trigger', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => {
        throw new Error('reminders.md unreadable');
      },
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
  });
});

  test('skips the seed reminder that mirrors the morning check-in', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => [
        { id: 'r1', time: '15:00', label: '早间计划', enabled: true }
      ],
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
    expect(result.delivered.some((entry) => entry.reminderId === 'r1')).toBe(false);
  });

  test('keeps a user reminder that shares the check-in time', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => [
        { id: 'user-1', time: '15:00', label: '吃药', enabled: true }
      ],
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind).sort()).toEqual([
      'morning-plan',
      'reminder'
    ]);
    expect(result.delivered.some((entry) => entry.reminderId === 'user-1')).toBe(true);
  });
