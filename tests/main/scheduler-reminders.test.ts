import type { AppSettings } from '../../src/shared/types';
import type { Reminder, WorkspaceTask } from '../../src/shared/workspace';
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

  test('fires a notification when a pinned task reaches its start time', async () => {
    let now = at(8, 59);
    const task: WorkspaceTask = {
      id: 't1',
      workspaceId: 'kaoyan',
      title: '数学真题',
      subject: '数学',
      durationMin: 45,
      acceptance: '',
      status: 'pending',
      startAt: '2026-10-31T09:00'
    };
    const base = settings();
    const notified: Array<{ kind: string; taskId?: string; title: string }> = [];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => ({
        ...base,
        notifications: { ...base.notifications, morning: '23:00' }
      }),
      getReminders: async () => [],
      getScheduledTasks: async () => [task],
      notify: (notification) => {
        notified.push({
          kind: notification.kind,
          ...(notification.taskId ? { taskId: notification.taskId } : {}),
          title: notification.title
        });
      }
    });

    expect((await scheduler.tick()).delivered).toHaveLength(0);

    now = at(9, 0);
    const delivered = await scheduler.tick();
    expect(delivered.delivered.map((entry) => entry.kind)).toEqual(['task']);
    expect(notified).toEqual([{ kind: 'task', taskId: 't1', title: '现在该做：数学真题' }]);

    now = at(9, 1);
    expect((await scheduler.tick()).delivered).toHaveLength(0);
  });

  test('skips completed tasks and tasks pinned to another day', async () => {
    const now = at(9, 0);
    const base = settings();
    const tasks: WorkspaceTask[] = [
      {
        id: 'done',
        workspaceId: 'kaoyan',
        title: '已完成',
        subject: '数学',
        durationMin: 30,
        acceptance: '',
        status: 'done',
        startAt: '2026-10-31T09:00'
      },
      {
        id: 'tomorrow',
        workspaceId: 'kaoyan',
        title: '明天',
        subject: '数学',
        durationMin: 30,
        acceptance: '',
        status: 'pending',
        startAt: '2026-11-01T09:00'
      }
    ];
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => ({
        ...base,
        notifications: { ...base.notifications, morning: '23:00' }
      }),
      getReminders: async () => [],
      getScheduledTasks: async () => tasks,
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered).toHaveLength(0);
  });

  test('a broken task read does not block reminders', async () => {
    const now = at(15, 0);
    const scheduler = new Scheduler({
      now: () => now,
      getSettings: async () => settings(),
      getReminders: async () => [],
      getScheduledTasks: async () => {
        throw new Error('tasks unreadable');
      },
      notify: () => undefined
    });

    const result = await scheduler.tick();
    expect(result.delivered.map((entry) => entry.kind)).toEqual(['morning-plan']);
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
