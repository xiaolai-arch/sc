import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { workspacesDir } from '../../src/main/workspace/paths';
import { parseNote } from '../../src/main/vault/note';

async function examVault(name = '考研') {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-phase-'));
  const service = createWorkspaceService(dir, { seed: false });
  const workspace = await service.createWorkspace({
    name,
    kind: 'exam',
    goal: '2027 上岸',
    description: ''
  });
  return { dir, service, workspace };
}

function phaseFile(dir: string, id: string): string {
  return join(workspacesDir(dir), id, 'workspace.md');
}

// --- 验收 24: phase round-trip, bad values, non-exam refusal -----------------

test('a phase set on an exam project lands in workspace.md and reads back (验收 24)', async () => {
  const { dir, service, workspace } = await examVault();
  try {
    expect(workspace.phase).toBeUndefined();
    expect(await readFile(phaseFile(dir, workspace.id), 'utf8')).not.toContain('phase');

    const set = await service.updateWorkspace?.({
      workspaceId: workspace.id,
      phase: '基础'
    });
    expect(set?.phase).toBe('基础');
    expect(parseNote(await readFile(phaseFile(dir, workspace.id), 'utf8')).meta.phase).toBe(
      '基础'
    );
    expect((await service.getWorkspaceSnapshot(workspace.id)).workspace.phase).toBe('基础');

    // A fresh instance reads the same value: the file is the source of truth.
    const reopened = createWorkspaceService(dir, { seed: false });
    expect((await reopened.getWorkspaceSnapshot(workspace.id)).workspace.phase).toBe('基础');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('clearing the phase drops both keys and asks nothing again (验收 24)', async () => {
  const { dir, service, workspace } = await examVault();
  try {
    await service.updateWorkspace?.({ workspaceId: workspace.id, phase: '冲刺' });
    await service.updateWorkspace?.({
      workspaceId: workspace.id,
      phaseAskedAt: '2026-11-08'
    });
    const cleared = await service.updateWorkspace?.({
      workspaceId: workspace.id,
      phase: null
    });
    expect(cleared).not.toHaveProperty('phase');
    // Clearing the stage must also forget its ask, or a later re-set would
    // count as "already asked" and stay silent.
    expect(cleared).not.toHaveProperty('phaseAskedAt');
    const raw = await readFile(phaseFile(dir, workspace.id), 'utf8');
    expect(raw).not.toContain('phase:');
    expect(raw).not.toContain('phaseAskedAt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('switching the phase clears phaseAskedAt; re-setting the same one keeps it (验收 26)', async () => {
  const { dir, service, workspace } = await examVault();
  try {
    await service.updateWorkspace?.({ workspaceId: workspace.id, phase: '基础' });
    await service.updateWorkspace?.({
      workspaceId: workspace.id,
      phaseAskedAt: '2026-11-08'
    });
    // Same stage: nothing changed, so the recorded ask survives.
    const same = await service.updateWorkspace?.({
      workspaceId: workspace.id,
      phase: '基础'
    });
    expect(same?.phaseAskedAt).toBe('2026-11-08');

    const switched = await service.updateWorkspace?.({
      workspaceId: workspace.id,
      phase: '强化'
    });
    expect(switched?.phase).toBe('强化');
    expect(switched).not.toHaveProperty('phaseAskedAt');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a non-exam project refuses a phase, and refuses it before writing (验收 24)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-phase-nonexam-'));
  try {
    const service = createWorkspaceService(dir, { seed: false });
    const study = await service.createWorkspace({
      name: '英语',
      kind: 'study',
      goal: '',
      description: ''
    });
    await expect(
      service.updateWorkspace?.({ workspaceId: study.id, phase: '基础' })
    ).rejects.toThrow(/exam project/);
    const after = await service.getWorkspaceSnapshot(study.id);
    expect(after.workspace).not.toHaveProperty('phase');
    // The ask marker is exam-only too (it is only ever written for a stage).
    await expect(
      service.updateWorkspace?.({ workspaceId: study.id, phaseAskedAt: '2026-11-08' })
    ).rejects.toThrow(/exam project/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a bad phase value is refused outright, never silently stored (验收 24)', async () => {
  const { dir, service, workspace } = await examVault();
  try {
    await expect(
      service.updateWorkspace?.({ workspaceId: workspace.id, phase: '预习' as never })
    ).rejects.toThrow(/Invalid exam phase/);
    expect((await service.getWorkspaceSnapshot(workspace.id)).workspace).not.toHaveProperty(
      'phase'
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
