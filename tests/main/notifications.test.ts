import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAppContext } from '../../src/main/context';
import { serializeCommitmentsFile } from '../../src/main/commitments/records';
import type { Commitment } from '../../src/main/commitments/records';
import { InMemorySecretStore } from '../../src/main/settings/secret-store';

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-notifications-'));
  dirs.push(dir);
  return dir;
}

const TODAY = '2026-11-22';

async function contextWith(commitments: Commitment[]) {
  const dir = await tempDir();
  const vaultPath = join(dir, 'vault');
  const context = await createAppContext({
    userDataPath: join(dir, 'user-data'),
    defaultVaultPath: vaultPath,
    secretStore: new InMemorySecretStore(),
    now: () => new Date(2026, 10, 22, 15, 30, 0)
  });
  // The app context creates the vault lazily; a first list call makes sure the
  // directory exists before the hand-written file is dropped in.
  await context.api.listWorkspaces();
  await writeFile(
    join(vaultPath, 'commitments.md'),
    serializeCommitmentsFile(commitments),
    'utf8'
  );
  return context;
}

function promise(overrides: Partial<Commitment>): Commitment {
  return {
    id: 'cm-1',
    text: '整理错题',
    due: TODAY,
    status: 'open',
    createdAt: '2026-11-21T08:00:00.000Z',
    ...overrides
  };
}

test('listPendingCommitments returns only open promises due by the day', async () => {
  const context = await contextWith([
    promise({ id: 'cm-overdue', text: '交作业', due: '2026-11-20' }),
    promise({ id: 'cm-today', text: '整理错题', due: TODAY }),
    promise({ id: 'cm-future', text: '下周的事', due: '2026-11-25' }),
    promise({ id: 'cm-done', text: '已经做完', due: '2026-11-19', status: 'done' })
  ]);

  const pending = await context.api.listPendingCommitments({ byDate: TODAY });

  expect(pending.map((entry) => entry.id)).toEqual(['cm-overdue', 'cm-today']);
  expect(pending[0]).toMatchObject({ text: '交作业', due: '2026-11-20', status: 'open' });
  await context.dispose();
});

test('an empty vault yields an empty list, not a placeholder', async () => {
  const context = await contextWith([]);
  expect(await context.api.listPendingCommitments({ byDate: TODAY })).toEqual([]);
  await context.dispose();
});

test('rejects a missing or malformed day before touching the vault', async () => {
  const context = await contextWith([promise({})]);
  await expect(
    context.api.listPendingCommitments({ byDate: '' })
  ).rejects.toThrow('日期不能为空。');
  await context.dispose();
});
