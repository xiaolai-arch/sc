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

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

test('uses the proactive check-in notification and does not retry it', async () => {
  let now = at(8, 0);
  const calls: string[] = [];
  const notified: Array<{ title: string; conversationId?: string }> = [];
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push({
        title: notification.title,
        ...(notification.conversationId ? { conversationId: notification.conversationId } : {})
      });
    },
    onCheckIn: (kind, date) => {
      calls.push(`${kind}:${date}`);
      return {
        key: `${date}:check-in:${kind}`,
        kind: 'morning-plan',
        date,
        scheduledTime: '08:00',
        title: '阿咲想和你聊聊今天的进度',
        body: '今天还有 1 个任务没完成，点开看看。',
        conversationId: 'check-in-1'
      };
    }
  });

  const first = await scheduler.tick();
  expect(first.delivered).toHaveLength(1);
  expect(notified).toEqual([
    { title: '阿咲想和你聊聊今天的进度', conversationId: 'check-in-1' }
  ]);
  expect(calls).toEqual(['morning:2026-10-31']);

  now = at(8, 1);
  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(notified).toHaveLength(1);
});

test('a null check-in consumes the trigger without a notification', async () => {
  const now = at(8, 0);
  const notified: string[] = [];
  let calls = 0;
  const scheduler = new Scheduler({
    now: () => now,
    getSettings: async () => settings(),
    notify: (notification) => {
      notified.push(notification.title);
    },
    onCheckIn: () => {
      calls += 1;
      return null;
    }
  });

  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(notified).toEqual([]);
  expect(calls).toBe(1);

  expect((await scheduler.tick()).delivered).toHaveLength(0);
  expect(calls).toBe(1);
});
