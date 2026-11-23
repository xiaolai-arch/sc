import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  copyFileAtomic,
  createBackup,
  handleExportBackup,
  handleRestoreBackup,
  restoreBackup,
  swapDirectory
} from '../../src/main/backup';

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
    // G7: the fixture copies exactly 4 files (workspace.md, c1.json,
    // state.json, usage.json; 41 bytes), so the completeness line must say
    // 4 — not 5, i.e. the README does not count itself.
    expect(readme).toContain('本次备份包含 4 个文件，约 0 MB。');
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
    // Nothing was copied, so the completeness line says so plainly.
    const readme = await readFile(join(result.path, 'README.txt'), 'utf8');
    expect(readme).toContain('本次备份包含 0 个文件，约 0 MB。');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the README count and size line matches the actually copied payload', async () => {
  const { root, vault, userData, destination } = await fixture();
  try {
    // 1.5 MiB of extra vault payload, so the size is not just the 0 MB floor:
    // 1572864 + 41 bytes = 1.5000 MiB → 约 1.5 MB across 5 files.
    await writeFile(
      join(vault, 'workspaces', 'kaoyan', 'bulk.bin'),
      Buffer.alloc(Math.round(1.5 * 1024 * 1024)),
      'utf8'
    );

    const result = await createBackup({
      vaultPath: vault,
      userDataPath: userData,
      destinationRoot: destination,
      now: NOW
    });

    const readme = await readFile(join(result.path, 'README.txt'), 'utf8');
    expect(readme).toContain('本次备份包含 5 个文件，约 1.5 MB。');
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

async function backupFixture() {
  const current = await fixture();
  const backup = join(current.root, 'my-backup');
  await mkdir(join(backup, 'vault', 'workspaces', 'kaoyan'), { recursive: true });
  await writeFile(join(backup, 'vault', 'workspaces', 'kaoyan', 'workspace.md'), 'restored-vault', 'utf8');
  await mkdir(join(backup, 'conversations'), { recursive: true });
  await writeFile(join(backup, 'conversations', 'c2.json'), '{"id":"c2"}', 'utf8');
  await writeFile(join(backup, 'usage.json'), '[{"restored":true}]', 'utf8');
  await writeFile(join(backup, 'state.json'), '{"backup":true}', 'utf8');
  return { ...current, backup };
}

test('restores vault, conversations and usage after snapshotting current data', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  try {
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData,
      now: NOW
    });

    expect(result.restored).toEqual({
      vault: true,
      conversations: true,
      usage: true,
      state: false
    });
    expect(
      await readFile(join(vault, 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')
    ).toBe('restored-vault');
    expect(await readFile(join(userData, 'conversations', 'c2.json'), 'utf8')).toBe(
      '{"id":"c2"}'
    );
    expect(await exists(join(userData, 'conversations', 'c1.json'))).toBe(false);
    expect(await readFile(join(userData, 'usage.json'), 'utf8')).toBe('[{"restored":true}]');

    // Settings and secrets are deliberately left alone.
    expect(await readFile(join(userData, 'state.json'), 'utf8')).toBe('{"onboarded":true}');
    expect(await readFile(join(userData, 'secrets', 'api-key.bin'), 'utf8')).toBe('secret');

    const safety = join(userData, 'restore-safety', 'restore-safety-2026-11-02-143000');
    expect(result.safetyPath).toBe(safety);
    expect(
      await readFile(join(safety, 'vault', 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')
    ).toBe('vault-data');
    expect(await readFile(join(safety, 'conversations', 'c1.json'), 'utf8')).toBe(
      '{"id":"c1"}'
    );
    expect(await readFile(join(safety, 'state.json'), 'utf8')).toBe('{"onboarded":true}');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- P3: state.json adoption (fresh machine only) -----------------------------

test('adopts the backup state.json on a machine without one, with the local vault path', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  // A fresh machine: no state.json of its own yet.
  await rm(join(userData, 'state.json'));
  await writeFile(
    join(backup, 'state.json'),
    JSON.stringify({
      onboarded: true,
      settings: {
        displayName: '小林',
        vaultPath: 'D:\\old-machine\\StudyCoachVault',
        provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' },
        notifications: { enabled: true, morning: '07:30', weeklyEnabled: false },
        budget: { dailyTokens: 150000 },
        launchAtLogin: true,
        strictMastery: true
      }
    }),
    'utf8'
  );
  try {
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData,
      now: NOW
    });

    expect(result.restored.state).toBe(true);
    const adopted = JSON.parse(await readFile(join(userData, 'state.json'), 'utf8'));
    expect(adopted).toEqual({
      onboarded: true,
      settings: {
        displayName: '小林',
        // The old machine's path must never survive the adoption.
        vaultPath: vault,
        provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' },
        notifications: { enabled: true, morning: '07:30', weeklyEnabled: false },
        budget: { dailyTokens: 150000 },
        launchAtLogin: true,
        strictMastery: true
      }
    });
    // The staged copy is cleaned up with the restore.
    expect(
      (await readdir(userData)).filter((name) => name.includes('asaki-restore-state'))
    ).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('leaves an existing state.json byte-identical even when the backup carries one', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  const localStatePath = join(userData, 'state.json');
  const local =
    '{"onboarded":true,"settings":{"vaultPath":"C:\\\\mine","provider":{"kind":"ollama","baseURL":"http://127.0.0.1:11434","model":"qwen"}}}';
  await writeFile(localStatePath, local, 'utf8');
  // The backup's own state.json must be *adoptable* here (settings record and
  // onboarded): with the fixture's unusable `{"backup":true}` the adoption
  // path would bail out on the content check alone, leaving the
  // "local file exists" guard untested.
  await writeFile(
    join(backup, 'state.json'),
    JSON.stringify({
      onboarded: true,
      settings: {
        displayName: '旧机器',
        vaultPath: 'D:\\old-machine\\StudyCoachVault',
        provider: { kind: 'anthropic', model: 'claude-sonnet-5-5' }
      }
    }),
    'utf8'
  );
  try {
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData,
      now: NOW
    });

    expect(await readFile(localStatePath, 'utf8')).toBe(local);
    expect(result.restored.state).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a backup without state.json restores without creating one', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  await rm(join(userData, 'state.json'));
  await rm(join(backup, 'state.json'));
  try {
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData,
      now: NOW
    });

    expect(result.restored).toEqual({
      vault: true,
      conversations: true,
      usage: true,
      state: false
    });
    expect(await exists(join(userData, 'state.json'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a corrupt backup state.json is treated as absent and the restore still succeeds', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  await rm(join(userData, 'state.json'));
  await writeFile(join(backup, 'state.json'), '{not-json', 'utf8');
  try {
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData,
      now: NOW
    });

    expect(result.restored.state).toBe(false);
    expect(await exists(join(userData, 'state.json'))).toBe(false);
    // The data restore itself is unaffected by the unusable settings file.
    expect(await readFile(join(vault, 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')).toBe(
      'restored-vault'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a backup state.json without a settings record is not adopted', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  await rm(join(userData, 'state.json'));
  await writeFile(join(backup, 'state.json'), '{"onboarded":true}', 'utf8');
  try {
    const result = await restoreBackup({
      backupPath: backup,
      vaultPath: vault,
      userDataPath: userData,
      now: NOW
    });

    expect(result.restored.state).toBe(false);
    expect(await exists(join(userData, 'state.json'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a folder without a vault and leaves current data untouched', async () => {
  const { root, vault, userData } = await fixture();
  const notABackup = join(root, 'not-a-backup');
  await mkdir(notABackup, { recursive: true });
  try {
    await expect(
      restoreBackup({ backupPath: notABackup, vaultPath: vault, userDataPath: userData, now: NOW })
    ).rejects.toThrow(/不是 ASAKI 备份/);

    expect(
      await readFile(join(vault, 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')
    ).toBe('vault-data');
    expect(await exists(join(userData, 'restore-safety'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a backup folder inside the current vault', async () => {
  const { root, vault, userData } = await fixture();
  const inside = join(vault, 'backups');
  await mkdir(join(inside, 'vault'), { recursive: true });
  try {
    await expect(
      restoreBackup({ backupPath: inside, vaultPath: vault, userDataPath: userData, now: NOW })
    ).rejects.toThrow(/不能位于/);
    expect(await exists(join(userData, 'restore-safety'))).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('swapDirectory replaces the target only after the staged rename succeeds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-swap-'));
  try {
    const target = join(root, 'vault');
    const staged = join(root, 'staged');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'old.md'), 'old', 'utf8');
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, 'new.md'), 'new', 'utf8');

    await swapDirectory(staged, target);

    expect(await readFile(join(target, 'new.md'), 'utf8')).toBe('new');
    expect(await exists(join(target, 'old.md'))).toBe(false);
    expect(await exists(staged)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('swapDirectory puts the old directory back when the staged rename fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-swap-'));
  try {
    const target = join(root, 'vault');
    await mkdir(target, { recursive: true });
    await writeFile(join(target, 'keep.md'), 'current', 'utf8');

    await expect(swapDirectory(join(root, 'missing-stage'), target)).rejects.toThrow();

    expect(await readFile(join(target, 'keep.md'), 'utf8')).toBe('current');
    expect((await readdir(root)).filter((name) => name.includes('asaki-restore-old'))).toEqual(
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('copyFileAtomic leaves the previous file intact when the source is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-swap-'));
  try {
    const target = join(root, 'usage.json');
    await writeFile(target, 'old', 'utf8');

    await expect(copyFileAtomic(join(root, 'missing.json'), target)).rejects.toThrow();

    expect(await readFile(target, 'utf8')).toBe('old');
    expect(await readdir(root)).toEqual(['usage.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('handleRestoreBackup returns null without touching data on cancel', async () => {
  const pickDirectory = vi.fn().mockResolvedValue(null);
  const getPaths = vi.fn();

  expect(await handleRestoreBackup({ pickDirectory, getPaths })).toBeNull();
  expect(getPaths).not.toHaveBeenCalled();
});

test('handleRestoreBackup restores the picked backup folder', async () => {
  const { root, vault, userData, backup } = await backupFixture();
  try {
    const result = await handleRestoreBackup({
      pickDirectory: async () => backup,
      getPaths: async () => ({ vaultPath: vault, userDataPath: userData }),
      now: NOW
    });

    expect(result?.restored.vault).toBe(true);
    expect(
      await readFile(join(vault, 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')
    ).toBe('restored-vault');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('dereferences a symlinked vault instead of copying the link', async () => {
  const root = await mkdtemp(join(tmpdir(), 'study-coach-backup-'));
  try {
    const realVault = join(root, 'real-vault');
    const linkedVault = join(root, 'vault-link');
    const userData = join(root, 'user-data');
    await mkdir(join(realVault, 'workspaces', 'kaoyan'), { recursive: true });
    await writeFile(join(realVault, 'workspaces', 'kaoyan', 'workspace.md'), 'vault-data', 'utf8');
    await mkdir(userData, { recursive: true });
    try {
      await symlink(realVault, linkedVault, 'dir');
    } catch {
      return;
    }

    const result = await createBackup({
      vaultPath: linkedVault,
      userDataPath: userData,
      destinationRoot: join(root, 'exports'),
      now: NOW
    });

    const copiedVault = join(result.path, 'vault');
    expect((await lstat(copiedVault)).isSymbolicLink()).toBe(false);
    expect(
      await readFile(join(copiedVault, 'workspaces', 'kaoyan', 'workspace.md'), 'utf8')
    ).toBe('vault-data');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
