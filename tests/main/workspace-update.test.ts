import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';

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
