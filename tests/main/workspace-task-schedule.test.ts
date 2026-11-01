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
