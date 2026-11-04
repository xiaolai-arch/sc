import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-task-schedule-'));
  const service = createWorkspaceService(dir, { seed: false });
  const workspace = await service.createWorkspace({
    name: '考研',
    kind: 'exam',
    goal: '上岸',
    description: ''
  });
  return { dir, service, workspace };
}

function taskInput(workspaceId: string, startAt?: string) {
  return {
    workspaceId,
    title: '真题',
    subject: '数学',
    durationMin: 45,
    acceptance: '做完一套',
    ...(startAt ? { startAt } : {})
  };
}

test('completing a repeating task creates the next occurrence', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const created = await service.createTask({
      ...taskInput(workspace.id),
      due: '2026-11-04',
      repeat: 'daily'
    });
    expect(created).toMatchObject({ repeat: 'daily', due: '2026-11-04' });

    await service.updateWorkspaceTask({ taskId: created.id, status: 'done' });

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    const next = snapshot.tasks.find((task) => task.id !== created.id);
    expect(next).toMatchObject({
      title: '真题',
      status: 'pending',
      due: '2026-11-05',
      repeat: 'daily'
    });
    expect(next?.actualMin).toBeUndefined();

    // Undoing and re-completing must not spawn another copy.
    await service.updateWorkspaceTask({ taskId: created.id, status: 'pending' });
    await service.updateWorkspaceTask({ taskId: created.id, status: 'done' });
    const again = await service.getWorkspaceSnapshot(workspace.id);
    expect(again.tasks.filter((task) => task.title === '真题')).toHaveLength(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('weekday repeats skip the weekend', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const created = await service.createTask({
      ...taskInput(workspace.id),
      due: '2026-11-06',
      repeat: 'weekdays'
    });
    await service.updateWorkspaceTask({ taskId: created.id, status: 'done' });

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks.find((task) => task.id !== created.id)?.due).toBe('2026-11-09');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('does not repeat a plain task and can clear a repeat rule', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const plain = await service.createTask({ ...taskInput(workspace.id), due: '2026-11-04' });
    await service.updateWorkspaceTask({ taskId: plain.id, status: 'done' });
    let snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks).toHaveLength(1);

    const repeating = await service.createTask({
      ...taskInput(workspace.id),
      title: '背单词',
      due: '2026-11-04',
      repeat: 'weekly'
    });
    const cleared = await service.updateWorkspaceTask({
      taskId: repeating.id,
      repeat: null
    });
    expect(cleared.repeat).toBeUndefined();
    await service.updateWorkspaceTask({ taskId: repeating.id, status: 'done' });
    snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks.filter((task) => task.title === '背单词')).toHaveLength(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('persists a pinned start time and reads it back from the vault', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const created = await service.createTask(taskInput(workspace.id, '2026-11-01T14:00'));
    expect(created.startAt).toBe('2026-11-01T14:00');

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    const stored = snapshot.tasks.find((task) => task.id === created.id);
    expect(stored?.startAt).toBe('2026-11-01T14:00');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reschedules a task without changing its status', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const created = await service.createTask(taskInput(workspace.id));

    const updated = await service.updateWorkspaceTask({
      taskId: created.id,
      startAt: '2026-11-01T16:30'
    });
    expect(updated).toMatchObject({
      id: created.id,
      status: 'pending',
      startAt: '2026-11-01T16:30'
    });

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks[0]?.startAt).toBe('2026-11-01T16:30');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clears a pinned start time with null', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const created = await service.createTask(taskInput(workspace.id, '2026-11-01T14:00'));

    const updated = await service.updateWorkspaceTask({
      taskId: created.id,
      startAt: null
    });
    expect(updated.startAt).toBeUndefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('lists only open pinned tasks for the scheduler', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const pinned = await service.createTask(taskInput(workspace.id, '2026-11-01T09:00'));
    await service.createTask(taskInput(workspace.id));
    const done = await service.createTask(taskInput(workspace.id, '2026-11-01T10:00'));
    await service.updateWorkspaceTask({ taskId: done.id, status: 'done' });

    const scheduled = await service.getScheduledTasks?.();
    expect(scheduled?.map((task) => task.id)).toEqual([pinned.id]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects invalid start times and empty updates', async () => {
  const { dir, service, workspace } = await setup();
  try {
    await expect(
      service.createTask(taskInput(workspace.id, '2026-11-01 14:00'))
    ).rejects.toThrow(/start time/i);

    const created = await service.createTask(taskInput(workspace.id));
    await expect(
      service.updateWorkspaceTask({ taskId: created.id, startAt: '2026-11-01T25:00' })
    ).rejects.toThrow(/start time/i);
    await expect(
      service.updateWorkspaceTask({ taskId: created.id } as never)
    ).rejects.toThrow(/no task fields/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('edits task fields and clears the due date', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const created = await service.createTask({
      ...taskInput(workspace.id),
      due: '2026-11-05'
    });

    const updated = await service.updateWorkspaceTask({
      taskId: created.id,
      title: '真题第二套',
      subject: '英语',
      durationMin: 90,
      acceptance: '阅读全对',
      due: '2026-11-08'
    });
    expect(updated).toMatchObject({
      id: created.id,
      title: '真题第二套',
      subject: '英语',
      durationMin: 90,
      acceptance: '阅读全对',
      due: '2026-11-08'
    });

    const cleared = await service.updateWorkspaceTask({ taskId: created.id, due: null });
    expect(cleared.due).toBeUndefined();

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks[0]).toMatchObject({ title: '真题第二套', durationMin: 90 });

    await expect(
      service.updateWorkspaceTask({ taskId: created.id, title: '   ' })
    ).rejects.toThrow(/title/i);
    await expect(
      service.updateWorkspaceTask({ taskId: created.id, durationMin: -5 })
    ).rejects.toThrow(/duration/i);
    await expect(
      service.updateWorkspaceTask({ taskId: created.id, due: '2026-13-40' })
    ).rejects.toThrow(/due date/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deletes a task and removes the task file when it becomes empty', async () => {
  const { dir, service, workspace } = await setup();
  try {
    const first = await service.createTask(taskInput(workspace.id));
    const second = await service.createTask(taskInput(workspace.id));

    await service.deleteTask?.({ taskId: first.id });
    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.tasks.map((task) => task.id)).toEqual([second.id]);

    await service.deleteTask?.({ taskId: second.id });
    expect((await service.getWorkspaceSnapshot(workspace.id)).tasks).toEqual([]);
    await expect(service.deleteTask?.({ taskId: second.id })).rejects.toThrow(/not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
