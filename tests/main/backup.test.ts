import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBackup, handleExportBackup } from '../../src/main/backup';

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const NOW = () => new Date(2026, 10, 2, 14, 30, 0);

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-backup-'));
  const vault = join(root, 'vault');
  const userData = join(root, 'user-data');
  const destination = join(root, 'exports');

  await mkdir(join(vault, 'workspaces', 'kaoyan'), { recursive: true });
  await writeFile(join(vault, 'workspaces', 'kaoyan', 'workspace.md'), 'vault-data', 'utf8');

  await mkdir(join(userData, 'conversations'), { recursive: true });
  await writeFile(join(userData, 'conversations', 'c1.json'), '{"id":"c1"}', 'utf8');
  await writeFile(join(userData, 'state.json'), '{"onboarded":true}', 'utf8');
  await writeFile(join(userData, 'usage.json'), '[]', 'utf8');
  await mkdir(join(userData, 'secrets'), { recursive: true });
  await writeFile(join(userData, 'secrets', 'api-key.bin'), 'secret', 'utf8');

  return { root, vault, userData, destination };
}

test('copies the vault, conversations, state and usage without secrets', async () => {
  const { root, vault, userData, destination } = await fixture();
  try {
    const result = await createBackup({
      vaultPath: vault,
      userDataPath: userData,
      destinationRoot: destination,
      now: NOW
    });

    expect(result.path).toBe(join(destination, 'study-coach-backup-2026-11-02-1430'));
    expect(result.copied).toEqual({
      vault: true,
      conversations: true,
      state: true,
      usage: true
    });

    expect(
      await readFile(join(result.path, 'vault', 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')
    ).toBe('vault-data');
    expect(await readFile(join(result.path, 'conversations', 'c1.json'), 'utf8')).toBe(
      '{"id":"c1"}'
    );
    expect(await readFile(join(result.path, 'state.json'), 'utf8')).toBe('{"onboarded":true}');
    expect(await readFile(join(result.path, 'usage.json'), 'utf8')).toBe('[]');
    expect(await exists(join(result.path, 'secrets'))).toBe(false);

    const readme = await readFile(join(result.path, 'README.txt'), 'utf8');
    expect(readme).toContain('导出时间');
    expect(readme).toContain('vault');
    expect(readme).toContain('conversations');
    expect(readme).toContain('state.json');
    expect(readme).toContain('usage.json');
    expect(readme).toContain('API Key');
    expect(readme).toContain('secrets');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('skips missing sources but still writes the backup and README', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-backup-'));
  try {
    const userData = join(root, 'user-data');
    await mkdir(userData, { recursive: true });

    const result = await createBackup({
      vaultPath: join(root, 'missing-vault'),
      userDataPath: userData,
      destinationRoot: join(root, 'exports'),
      now: NOW
    });

    expect(result.copied).toEqual({
      vault: false,
      conversations: false,
      state: false,
      usage: false
    });
    expect(await exists(join(result.path, 'README.txt'))).toBe(true);
    expect(await exists(join(result.path, 'vault'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('appends a suffix instead of overwriting an existing backup', async () => {
  const { root, vault, userData, destination } = await fixture();
  try {
    const first = await createBackup({
      vaultPath: vault,
      userDataPath: userData,
      destinationRoot: destination,
      now: NOW
    });
    await writeFile(join(first.path, 'README.txt'), 'first', 'utf8');

    const second = await createBackup({
      vaultPath: vault,
      userDataPath: userData,
      destinationRoot: destination,
      now: NOW
    });
    const third = await createBackup({
      vaultPath: vault,
      userDataPath: userData,
      destinationRoot: destination,
      now: NOW
    });

    expect(first.path).toBe(join(destination, 'study-coach-backup-2026-11-02-1430'));
    expect(second.path).toBe(`${first.path}-2`);
    expect(third.path).toBe(`${first.path}-3`);
    expect(await readFile(join(first.path, 'README.txt'), 'utf8')).toBe('first');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects destinations inside the vault or user data directory', async () => {
  const { root, vault, userData } = await fixture();
  try {
    await expect(
      createBackup({
        vaultPath: vault,
        userDataPath: userData,
        destinationRoot: join(vault, 'backups'),
        now: NOW
      })
    ).rejects.toThrow(/不能位于/);
    expect(await exists(join(vault, 'backups'))).toBe(false);

    await expect(
      createBackup({
        vaultPath: vault,
        userDataPath: userData,
        destinationRoot: join(userData, 'backups'),
        now: NOW
      })
    ).rejects.toThrow(/不能位于/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a destination symlink pointing inside the vault', async () => {
  const { root, vault, userData } = await fixture();
  try {
    const link = join(root, 'vault-workspaces-link');
    try {
      await symlink(join(vault, 'workspaces'), link, 'dir');
    } catch {
      // Platforms without symlink support (e.g. Windows without privileges).
      return;
    }

    await expect(
      createBackup({
        vaultPath: vault,
        userDataPath: userData,
        destinationRoot: link,
        now: NOW
      })
    ).rejects.toThrow(/不能位于/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handleExportBackup returns null without creating anything on cancel', async () => {
  const pickDirectory = vi.fn().mockResolvedValue(null);
  const getPaths = vi.fn();

  expect(await handleExportBackup({ pickDirectory, getPaths })).toBeNull();
  expect(getPaths).not.toHaveBeenCalled();
});

test('handleExportBackup creates a backup for the picked directory', async () => {
  const { root, vault, userData, destination } = await fixture();
  try {
    const result = await handleExportBackup({
      pickDirectory: async () => destination,
      getPaths: async () => ({ vaultPath: vault, userDataPath: userData }),
      now: NOW
    });

    expect(result?.path).toBe(join(destination, 'study-coach-backup-2026-11-02-1430'));
    expect(result?.copied.vault).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handleExportBackup surfaces a rejected destination', async () => {
  const { root, vault, userData } = await fixture();
  try {
    await expect(
      handleExportBackup({
        pickDirectory: async () => join(vault, 'backups'),
        getPaths: async () => ({ vaultPath: vault, userDataPath: userData }),
        now: NOW
      })
    ).rejects.toThrow(/不能位于/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
