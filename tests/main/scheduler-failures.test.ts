import type { AppSettings } from '../../src/shared/types';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { Scheduler } from '../../src/main/scheduler/scheduler';

function settings(): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  return {
    ...base,
    notifications: { ...base.notifications, morning: '08:00', evening: '21:30' }
  };
}

const NOW = new Date(2026, 9, 31, 8, 0, 0);

test('a failed notification sink retries delivery without regenerating the check-in', async () => {
  let notifyCalls = 0;
  let checkInCalls = 0;
  const errors: unknown[] = [];
  const scheduler = new Scheduler({
    now: () => NOW,
    getSettings: async () => settings(),
    notify: () => {
      notifyCalls += 1;
      throw new Error('notification unavailable');
    },
    onCheckIn: (_kind, date) => {
      checkInCalls += 1;
      return {
        key: `${date}:check-in:morning`,
        kind: 'morning-plan',
        date,
        scheduledTime: '08:00',
        title: '阿咲想和你聊聊今天的进度',
        body: '今天还有 1 个任务没完成。'
      };
    },
    onError: (error) => errors.push(error)
  });

  const first = await scheduler.tick();
  expect(first.delivered).toHaveLength(0);
  expect(first.failed).toHaveLength(1);
  expect(notifyCalls).toBe(1);
  expect(checkInCalls).toBe(1);

  // The retry delivers the notification that was already generated; it does
  // not call the check-in service (and therefore cannot spend model budget)
  // again.
  const second = await scheduler.tick();
  expect(second.delivered).toHaveLength(0);
  expect(notifyCalls).toBe(2);
  expect(checkInCalls).toBe(1);

  // A third failure gives up for the day and reports the cause.
  const third = await scheduler.tick();
  expect(third.delivered).toHaveLength(0);
  expect(notifyCalls).toBe(3);
  expect(checkInCalls).toBe(1);
  expect(errors).toHaveLength(1);
});

test('a permanently failing callback is consumed after three attempts', async () => {
  const errors: unknown[] = [];
  let calls = 0;
  const scheduler = new Scheduler({
    now: () => NOW,
    getSettings: async () => settings(),
    notify: () => undefined,
    onCheckIn: () => {
      calls += 1;
      throw new Error('model unavailable');
    },
    onError: (error) => errors.push(error)
  });

  expect((await scheduler.tick()).failed).toHaveLength(1);
  expect((await scheduler.tick()).failed).toHaveLength(1);
  expect((await scheduler.tick()).failed).toHaveLength(1);
  expect(calls).toBe(3);
  expect(errors).toHaveLength(1);

  // The trigger is consumed, so a fourth tick does no work.
  expect((await scheduler.tick()).failed).toHaveLength(0);
  expect(calls).toBe(3);
});

test('a throwing error reporter cannot break the scheduler', async () => {
  let checkInCalls = 0;
  const scheduler = new Scheduler({
    now: () => NOW,
    getSettings: async () => settings(),
    notify: () => undefined,
    onCheckIn: () => {
      checkInCalls += 1;
      throw new Error('model unavailable');
    },
    onError: () => {
      throw new Error('reporter broken');
    }
  });

  expect((await scheduler.tick()).failed).toHaveLength(1);
  expect((await scheduler.tick()).failed).toHaveLength(1);
  // The third failure reports the cause; the reporter's own failure must stay
  // contained instead of rejecting the tick.
  await expect(scheduler.tick()).resolves.toBeDefined();
  expect(checkInCalls).toBe(3);
});

test('forgets bookkeeping from earlier days', async () => {
  let now = NOW;
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: () => {
      throw new Error('notification unavailable');
    },
    onCheckIn: (_kind, date) => ({
      key: `${date}:check-in:morning`,
      kind: 'morning-plan',
      date,
      scheduledTime: '08:00',
      title: '阿咲想和你聊聊今天的进度',
      body: '今天还有 1 个任务没完成。'
    })
  });

  await scheduler.tick();
  const internals = scheduler as unknown as {
    pending: Map<string, unknown>;
    attempts: Map<string, unknown>;
    delivered: Set<string>;
  };
  expect(internals.pending.size).toBe(1);

  // A long-running session must not accumulate one entry per trigger per day.
  now = new Date(2026, 10, 1, 0, 0, 0);
  await scheduler.tick();
  expect(internals.pending.size).toBe(0);
  expect(internals.attempts.size).toBe(0);
  expect(internals.delivered.size).toBe(0);
});
