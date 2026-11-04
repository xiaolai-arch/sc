import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { workspacesDir } from '../../src/main/workspace/paths';

test('updates workspace name, goal and description', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-workspace-update-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '考研',
      kind: 'exam',
      goal: '2027 上岸',
      description: '每天四小时'
    });

    const updated = await service.updateWorkspace?.({
      workspaceId: workspace.id,
      name: '考研冲刺',
      goal: '2027 考研 400 分',
      description: '数学一、英语一、408'
    });
    expect(updated).toMatchObject({
      id: workspace.id,
      name: '考研冲刺',
      goal: '2027 考研 400 分',
      description: '数学一、英语一、408'
    });

    const snapshot = await service.getWorkspaceSnapshot(workspace.id);
    expect(snapshot.workspace.name).toBe('考研冲刺');
    await expect(
      service.updateWorkspace?.({ workspaceId: workspace.id })
    ).rejects.toThrow(/No workspace fields/);
    await expect(
      service.updateWorkspace?.({ workspaceId: 'missing', goal: 'x' })
    ).rejects.toThrow(/not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deletes a note file and drops it from the snapshot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-note-delete-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const workspace = await service.createWorkspace({
      name: '英语',
      kind: 'study',
      goal: '',
      description: ''
    });
    const note = await service.createNote({
      workspaceId: workspace.id,
      title: '听力复盘',
      subject: '英语',
      body: '今天精听了一篇 TED。'
    });

    await service.deleteNote?.({ noteId: note.id });

    expect((await service.getWorkspaceSnapshot(workspace.id)).notes).toEqual([]);
    await expect(service.deleteNote?.({ noteId: note.id })).rejects.toThrow(/not found/i);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('moves a deleted workspace into a recoverable trash folder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-workspace-delete-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const kept = await service.createWorkspace({
      name: '英语',
      kind: 'study',
      goal: '',
      description: ''
    });
    const removed = await service.createWorkspace({
      name: '数学',
      kind: 'study',
      goal: '',
      description: ''
    });

    await service.deleteWorkspace?.(removed.id);
    expect((await service.listWorkspaces()).map((entry) => entry.id)).toEqual([kept.id]);

    const root = workspacesDir(dir);
    expect(await readdir(root)).not.toContain(removed.id);
    const trashed = await readdir(join(root, '.trash'));
    expect(trashed.some((entry) => entry.startsWith(`${removed.id}-`))).toBe(true);

    await expect(service.deleteWorkspace?.(removed.id)).rejects.toThrow(/not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
