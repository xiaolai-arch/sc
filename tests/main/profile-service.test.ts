import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfileService } from '../../src/main/memory/profile-service';
import { profileFile } from '../../src/main/workspace/paths';

async function withProfile(
  run: (service: ReturnType<typeof createProfileService>, root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-profile-'));
  try {
    const service = createProfileService({
      root,
      now: () => new Date('2026-11-15T09:00:00.000Z')
    });
    await run(service, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('stores a user fact as confirmed and survives a reload', async () => {
  await withProfile(async (service, root) => {
    const created = await service.create({
      category: 'constraints',
      text: '工作日每天只能安排 1 小时',
      origin: '手动添加'
    });

    expect(created).toMatchObject({
      category: 'constraints',
      source: 'user',
      confidence: 'confirmed',
      status: 'active'
    });
    const raw = await readFile(profileFile(root), 'utf8');
    expect(raw).toContain('工作日每天只能安排 1 小时');

    const reloaded = createProfileService({ root });
    expect(await reloaded.list()).toEqual([created]);
  });
});

test('a model guess stays a candidate until the user confirms it', async () => {
  await withProfile(async (service) => {
    const guess = await service.create({
      category: 'abilities',
      text: '数学基础不错',
      source: 'model',
      origin: '对话 2026-11-15'
    });
    expect(guess.confidence).toBe('candidate');

    const confirmed = await service.update({ id: guess.id, confidence: 'confirmed' });
    expect(confirmed).toMatchObject({
      confidence: 'confirmed',
      source: 'user'
    });
  });
});

test('editing a fact promotes it to the user statement and keeps one copy', async () => {
  await withProfile(async (service) => {
    const created = await service.create({ category: 'identity', text: '白天上班' });
    const duplicate = await service.create({ category: 'identity', text: '白天上班' });
    expect(duplicate.id).toBe(created.id);
    expect(await service.list()).toHaveLength(1);

    const edited = await service.update({ id: created.id, text: '工作日白天上班' });
    expect(edited).toMatchObject({ text: '工作日白天上班', source: 'user', confidence: 'confirmed' });
  });
});

test('facts can expire, be restored and be deleted', async () => {
  await withProfile(async (service) => {
    const entry = await service.create({ category: 'recent', text: '这周在赶论文' });

    const expired = await service.update({ id: entry.id, status: 'expired' });
    expect(expired.status).toBe('expired');
    expect((await service.list()).filter((item) => item.status === 'active')).toHaveLength(0);

    const restored = await service.update({ id: entry.id, status: 'active' });
    expect(restored.status).toBe('active');

    await service.delete({ id: entry.id });
    expect(await service.list()).toHaveLength(0);
  });
});

test('refuses to overwrite a hand-edited profile it cannot parse', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asaki-profile-'));
  try {
    const service = createProfileService({ root });
    await writeFile(join(root, 'profile.md'), '---\ntype: profile\n---\n# 手写内容\n- 只有正文\n');
    await expect(
      service.create({ category: 'identity', text: '新事实' })
    ).rejects.toThrow(/无法识别/);
    expect(await readFile(profileFile(root), 'utf8')).toContain('只有正文');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
