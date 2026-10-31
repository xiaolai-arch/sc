import type { AppSettings } from '../../src/shared/types';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { Scheduler } from '../../src/main/scheduler/scheduler';

function settings(overrides: Partial<AppSettings> = {}): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    ...overrides,
    notifications: { ...base.notifications, ...(overrides.notifications ?? {}) }
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

describe('Scheduler morning and evening triggers', () => {
  test('fires at the configured times exactly once per day', async () => {
    let now = at(7, 59);
    const notifications: string[] = [];
    const callbacks: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      notify: (notification) => {
        notifications.push(`${notification.kind}:${notification.scheduledTime}`);
      },
      onMorningPlan: (date) => {
        callbacks.push(`morning:${date}`);
      },
      onEveningReview: (date) => {
        callbacks.push(`evening:${date}`);
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(8, 0);
    let result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
    expect(callbacks).toEqual(['morning:2026-10-31']);

    now = at(8, 1);
    result = await scheduler.tick();
    expect(result.delivered).toHaveLength(0);

    now = at(21, 29);
    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(21, 30);
    result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['evening-review']);
    expect(callbacks).toEqual(['morning:2026-10-31', 'evening:2026-10-31']);

    now = at(21, 31);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(notifications).toEqual(['morning-plan:08:00', 'evening-review:21:30']);
  });

  test('catches up a missed morning trigger once after sleep', async () => {
    let now = at(6, 0);
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      notify: (notification) => {
        notified.push(notification.key);
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    // Simulate the machine sleeping through 08:00 and waking in the afternoon.
    now = at(13, 0);
    const first = await scheduler.tick();
    expect(first.delivered).toHaveLength(1);
    expect(first.delivered[0]).toMatchObject({ kind: 'morning-plan', date: '2026-10-31' });

    now = at(13, 5);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(1);
  });

  test('does not consume triggers while notifications are disabled', async () => {
    let now = at(8, 0);
    let current = settings({ notifications: { ...settings().notifications, enabled: false } });
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => current,
      notify: (notification) => {
        notified.push(notification.kind);
      }
    });

    const suppressed = await scheduler.tick();
    expect(suppressed.delivered).toHaveLength(0);
    expect(suppressed.suppressed).toEqual([
      { key: '2026-10-31:morning-plan:morning', kind: 'morning-plan', reason: 'disabled' }
    ]);

    current = settings();
    expect((await scheduler.tick()).delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
    expect(notified).toEqual(['morning-plan']);
  });

  test('does not duplicate a trigger if start is called twice', async () => {
    let now = at(8, 0);
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      notify: (notification) => {
        notified.push(notification.key);
      }
    });

    const stopFirst = scheduler.start(60_000);
    const stopSecond = scheduler.start(60_000);
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(notified).toHaveLength(1);
    stopFirst();
    stopSecond();
    now = at(8, 10);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
  });
});
