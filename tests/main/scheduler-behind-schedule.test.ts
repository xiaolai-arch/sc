import type { AppSettings } from '../../src/shared/types';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import {
  BEHIND_SCHEDULE_TITLE,
  behindScheduleSummary,
  buildBehindScheduleNotification
} from '../../src/main/scheduler/behind-schedule';
import { Scheduler, buildTriggers } from '../../src/main/scheduler/scheduler';
import type { WorkspaceTask } from '../../src/shared/workspace';

function settings(overrides: Partial<AppSettings['notifications']> = {}): AppSettings {
  const base = createDefaultSettings('/tmp/vault');
  // Keep the other check-ins out of the way so each test isolates the nudge.
  return {
    ...base,
    notifications: {
      ...base.notifications,
      morning: '23:50',
      evening: '23:55',
      weekly: '23:58',
      ...overrides
    }
  };
}

function at(hour: number, minute: number): Date {
  return new Date(2026, 9, 31, hour, minute, 0);
}

function task(
  id: string,
  status: WorkspaceTask['status'],
  title = id
): WorkspaceTask {
  return {
    id,
    workspaceId: 'kaoyan',
    title,
    subject: '数学',
    durationMin: 30,
    acceptance: '',
    status,
    due: '2026-10-31'
  };
}

describe('behind-schedule summary', () => {
  test('fires only while fewer than half of today’s tasks are done', () => {
    expect(behindScheduleSummary([])).toBeNull();
    expect(behindScheduleSummary([task('a', 'done'), task('b', 'done')])).toBeNull();
    // Exactly half is already "on track".
    expect(behindScheduleSummary([task('a', 'done'), task('b', 'pending')])).toBeNull();
    expect(
      behindScheduleSummary([task('a', 'done'), task('b', 'pending'), task('c', 'pending')])
    ).toMatchObject({ remaining: 2, first: { id: 'b' } });
    expect(behindScheduleSummary([task('a', 'pending'), task('b', 'pending')])).toMatchObject({
      remaining: 2,
      first: { id: 'a' }
    });
  });

  test('names the count and the first open task', () => {
    const composed = buildBehindScheduleNotification([
      task('done', 'done'),
      task('t2', 'pending', '数学真题'),
      task('t3', 'in-progress', '英语阅读')
    ]);
    expect(composed).toEqual({
      title: BEHIND_SCHEDULE_TITLE,
      body: '今天还有 2 个任务没完成，下一项是「数学真题」。要不要一起调整一下今天的安排？'
    });
    expect(buildBehindScheduleNotification([task('a', 'done')])).toBeNull();
  });
});

describe('落后提醒 scheduler trigger', () => {
  test('is on by default at 20:30 and off with its toggle', () => {
    const base = createDefaultSettings('/tmp/vault');
    expect(base.notifications.behindSchedule).toBe('20:30');
    expect(base.notifications.behindScheduleEnabled).toBe(true);

    const on = buildTriggers(settings(), [], [], '2026-10-31').find(
      (trigger) => trigger.kind === 'behind-schedule'
    );
    expect(on).toMatchObject({ id: 'behind-schedule', time: '20:30', title: BEHIND_SCHEDULE_TITLE });

    const off = buildTriggers(
      settings({ behindScheduleEnabled: false }),
      [],
      [],
      '2026-10-31'
    );
    expect(off.some((trigger) => trigger.kind === 'behind-schedule')).toBe(false);
  });

  test('composes the deterministic nudge and fires once when the plan falls behind', async () => {
    let now = at(20, 29);
    const tasks = [
      task('t1', 'done', '极限基础'),
      task('t2', 'pending', '数学真题'),
      task('t3', 'pending', '英语阅读')
    ];
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getTodayTasks: async () => tasks,
      notify: (notification) => {
        notified.push(`${notification.kind}:${notification.title}:${notification.body}`);
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(20, 30);
    const first = await scheduler.tick();
    expect(first.delivered).toHaveLength(1);
    expect(first.delivered[0]).toMatchObject({
      key: '2026-10-31:behind-schedule:behind-schedule',
      kind: 'behind-schedule',
      scheduledTime: '20:30',
      title: BEHIND_SCHEDULE_TITLE,
      body: '今天还有 2 个任务没完成，下一项是「数学真题」。要不要一起调整一下今天的安排？'
    });

    // Later ticks in the same day stay silent; the trigger is consumed.
    now = at(20, 31);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    now = at(23, 0);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
    expect(notified).toHaveLength(1);
  });

  test('stays silent when every task is done or today has no tasks', async () => {
    const now = at(20, 30);
    const doneTasks = [task('t1', 'done'), task('t2', 'done')];
    const done = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getTodayTasks: async () => doneTasks,
      notify: () => {
        throw new Error('should not notify');
      }
    });
    expect((await done.tick()).delivered).toHaveLength(0);

    const empty = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getTodayTasks: async () => [],
      notify: () => {
        throw new Error('should not notify');
      }
    });
    expect((await empty.tick()).delivered).toHaveLength(0);

    // Tomorrow's task does not count as today's plan.
    const tomorrow = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getTodayTasks: async () => [{ ...task('t9', 'pending'), due: '2026-11-01' }],
      notify: () => {
        throw new Error('should not notify');
      }
    });
    expect((await tomorrow.tick()).delivered).toHaveLength(0);

    // An undated backlog is not today's plan, so it cannot fire the nudge every day.
    const backlog = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getTodayTasks: async () => {
        const { due: _due, ...undated } = task('t1', 'pending');
        return [undated];
      },
      notify: () => {
        throw new Error('should not notify');
      }
    });
    expect((await backlog.tick()).delivered).toHaveLength(0);
  });

  test('a restart does not deliver the same day’s nudge twice', async () => {
    const stored = new Map<string, string[]>();
    const deliveryLog = {
      load: async (date: string) => stored.get(date) ?? [],
      save: async (date: string, keys: readonly string[]) => {
        stored.set(date, [...keys]);
      }
    };
    const now = at(20, 30);
    const options = {
      now: () => now,
      getSettings: async () => settings(),
      getTodayTasks: async () => [task('t1', 'pending'), task('t2', 'pending')],
      notify: () => undefined,
      deliveryLog
    };

    expect((await new Scheduler(options).tick()).delivered).toHaveLength(1);
    // A fresh process (empty in-memory set) reloads today's delivered keys.
    expect((await new Scheduler(options).tick()).delivered).toHaveLength(0);
  });

  test('defers under DND without consuming the trigger', async () => {
    let now = at(20, 31);
    const notified: string[] = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings({ dndStart: '20:00', dndEnd: '22:00' }),
      getTodayTasks: async () => [task('t1', 'pending'), task('t2', 'pending')],
      notify: (notification) => {
        notified.push(notification.key);
      }
    });

    const suppressed = await scheduler.tick();
    expect(suppressed.delivered).toHaveLength(0);
    expect(suppressed.suppressed).toContainEqual({
      key: '2026-10-31:behind-schedule:behind-schedule',
      kind: 'behind-schedule',
      reason: 'dnd'
    });

    // The nudge was not consumed: it still fires once the window ends.
    now = at(22, 0);
    const delivered = await scheduler.tick();
    expect(delivered.delivered.map((entry) => entry.kind)).toEqual(['behind-schedule']);
    expect(notified).toHaveLength(1);
  });

  test('prefers the check-in pipeline when one is available', async () => {
    const notified: Array<{ kind: string; body: string; conversationId?: string }> = [];
    const scheduler = new Scheduler({
      now: () => at(20, 30),
      getSettings: async () => settings(),
      notify: (notification) => {
        notified.push({
          kind: notification.kind,
          body: notification.body,
          ...(notification.conversationId
            ? { conversationId: notification.conversationId }
            : {})
        });
      },
      onCheckIn: (kind, date) =>
        kind === 'behind'
          ? {
              key: `${date}:check-in:behind`,
              kind: 'behind-schedule',
              date,
              scheduledTime: '20:30',
              title: BEHIND_SCHEDULE_TITLE,
              body: '今天还有 2 个任务没完成，下一项是「数学真题」。要不要一起调整一下今天的安排？',
              conversationId: 'behind-1'
            }
          : null
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['behind-schedule']);
    expect(notified).toEqual([
      {
        kind: 'behind-schedule',
        body: '今天还有 2 个任务没完成，下一项是「数学真题」。要不要一起调整一下今天的安排？',
        conversationId: 'behind-1'
      }
    ]);
  });

  test('an on-track day consumes the trigger silently through the check-in', async () => {
    const scheduler = new Scheduler({
      now: () => at(20, 30),
      getSettings: async () => settings(),
      notify: () => {
        throw new Error('should not notify');
      },
      onCheckIn: () => null
    });
    expect((await scheduler.tick()).delivered).toHaveLength(0);
  });
});
