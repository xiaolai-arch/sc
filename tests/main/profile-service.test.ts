import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProfileService } from '../../src/main/memory/profile-service';
import { profileFile } from '../../src/main/workspace/paths';
import { serializeNote } from '../../src/main/vault/note';
import type { NoteMeta } from '../../src/shared/types';

async function withProfile(
  run: (service: ReturnType<typeof createProfileService>, root: string) => Promise<void>,
  now: () => Date = () => new Date('2026-11-15T09:00:00.000Z')
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-profile-'));
  try {
    const service = createProfileService({ root, now });
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

test('an edit stores exactly one history record with the old value', async () => {
  let clock = new Date('2026-11-15T09:00:00.000Z');
  await withProfile(
    async (service, root) => {
      const created = await service.create({
        category: 'constraints',
        text: '工作日每天只能安排 1 小时',
        origin: '手动添加'
      });

      clock = new Date('2026-11-16T10:00:00.000Z');
      const edited = await service.update({ id: created.id, text: '工作日每天只能安排 2 小时' });

      expect(edited.text).toBe('工作日每天只能安排 2 小时');
      expect(edited.history).toEqual([
        {
          text: '工作日每天只能安排 1 小时',
          origin: '手动添加',
          source: 'user',
          replacedAt: '2026-11-16T10:00:00.000Z'
        }
      ]);

      // The old value survives a reload and shows up compactly in profile.md.
      const reloaded = createProfileService({ root });
      const entries = await reloaded.list();
      expect(entries).toHaveLength(1);
      expect(entries[0]!.history).toEqual(edited.history);
      const raw = await readFile(profileFile(root), 'utf8');
      expect(raw).toContain('原：工作日每天只能安排 1 小时');
    },
    () => clock
  );
});

test('a second edit prepends so history is newest first', async () => {
  let clock = new Date('2026-11-15T09:00:00.000Z');
  await withProfile(
    async (service) => {
      const created = await service.create({ category: 'identity', text: '住在城市 A', origin: '手动添加' });

      clock = new Date('2026-11-16T10:00:00.000Z');
      await service.update({ id: created.id, text: '搬到城市 B' });
      clock = new Date('2026-11-17T10:00:00.000Z');
      const again = await service.update({ id: created.id, text: '又搬回城市 A' });

      expect(again.history).toEqual([
        {
          text: '搬到城市 B',
          origin: '手动添加',
          source: 'user',
          replacedAt: '2026-11-17T10:00:00.000Z'
        },
        {
          text: '住在城市 A',
          origin: '手动添加',
          source: 'user',
          replacedAt: '2026-11-16T10:00:00.000Z'
        }
      ]);
    },
    () => clock
  );
});

test('category-only and status-only changes record no history', async () => {
  let clock = new Date('2026-11-15T09:00:00.000Z');
  await withProfile(
    async (service) => {
      const created = await service.create({ category: 'recent', text: '这周在赶论文', origin: '对话 2026-11-15' });

      const moved = await service.update({ id: created.id, category: 'constraints' });
      expect(moved.category).toBe('constraints');
      expect(moved.history).toBeUndefined();

      const expired = await service.update({ id: created.id, status: 'expired' });
      expect(expired.history).toBeUndefined();
    },
    () => clock
  );
});

test('a legacy entry without history loads unchanged and edits normally', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asaki-profile-'));
  try {
    const legacyMeta: NoteMeta = {
      type: 'profile',
      source: 'user',
      items: [
        {
          id: 'p1',
          category: 'constraints',
          text: '工作日每天只能安排 1 小时',
          source: 'user',
          confidence: 'confirmed',
          status: 'active',
          origin: '手动添加',
          createdAt: '2026-11-01T00:00:00.000Z',
          updatedAt: '2026-11-01T00:00:00.000Z'
        }
      ]
    };
    await writeFile(join(root, 'profile.md'), serializeNote(legacyMeta, '# 个人档案\n'));
    const before = await readFile(join(root, 'profile.md'), 'utf8');

    const service = createProfileService({ root });
    const [entry] = await service.list();
    // Reading a legacy file adds no field and does not rewrite the file.
    expect(entry).toMatchObject({ id: 'p1', text: '工作日每天只能安排 1 小时' });
    expect(entry!.history).toBeUndefined();
    expect(await readFile(join(root, 'profile.md'), 'utf8')).toBe(before);

    const edited = await service.update({ id: 'p1', text: '工作日每天只能安排 2 小时' });
    expect(edited.history).toHaveLength(1);
    expect(edited.history![0]).toMatchObject({ text: '工作日每天只能安排 1 小时' });
    const reloaded = createProfileService({ root });
    expect((await reloaded.list())[0]!.history).toEqual(edited.history);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('history keeps only the five newest replaced values', async () => {
  let clock = new Date('2026-11-01T09:00:00.000Z');
  await withProfile(
    async (service) => {
      const created = await service.create({ category: 'abilities', text: '词汇 0' });
      for (let round = 1; round <= 6; round += 1) {
        clock = new Date(`2026-11-0${round + 1}T09:00:00.000Z`);
        await service.update({ id: created.id, text: `词汇 ${round}` });
      }

      const final = (await service.list())[0]!;
      expect(final.history).toHaveLength(5);
      expect(final.history!.map((record) => record.text)).toEqual([
        '词汇 5',
        '词汇 4',
        '词汇 3',
        '词汇 2',
        '词汇 1'
      ]);
      expect(final.history![0]).toMatchObject({ replacedAt: '2026-11-07T09:00:00.000Z' });
    },
    () => clock
  );
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
