import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultAppState } from '../../src/main/context';
import {
  InMemorySecretStore,
  SafeStorageSecretStore,
  type SafeStorageLike
} from '../../src/main/settings/secret-store';
import { SettingsService } from '../../src/main/settings/settings-service';
import { JsonStateStore } from '../../src/main/state-store';

test('keeps the api key out of settings and persisted state', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-secret-'));
  try {
    const statePath = join(dir, 'state.json');
    const state = new JsonStateStore({
      filePath: statePath,
      createDefault: () => createDefaultAppState('/tmp/vault')
    });
    const settings = new SettingsService(state);
    const secrets = new InMemorySecretStore();

    expect(await secrets.hasApiKey()).toBe(false);
    await secrets.setApiKey('  sk-test-secret-value  ');
    expect(await secrets.hasApiKey()).toBe(true);
    expect(await secrets.getApiKey()).toBe('sk-test-secret-value');

    const settingsJson = JSON.stringify(await settings.get());
    expect(settingsJson).not.toContain('sk-test-secret-value');
    const stateJson = await readFile(statePath, 'utf8').catch(() => '');
    expect(stateJson).not.toContain('sk-test-secret-value');

    await secrets.setApiKey('   ');
    expect(await secrets.hasApiKey()).toBe(false);
    expect(await secrets.getApiKey()).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('safeStorage backend encrypts at rest and never stores plaintext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-safe-storage-'));
  try {
    const filePath = join(dir, 'secrets', 'api-key.bin');
    const fakeSafeStorage: SafeStorageLike = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText) => Buffer.from(Buffer.from(plainText, 'utf8').toString('base64')),
      decryptString: (encrypted) => Buffer.from(encrypted.toString('utf8'), 'base64').toString('utf8')
    };
    const store = new SafeStorageSecretStore(filePath, { safeStorage: () => fakeSafeStorage });
    await store.setApiKey('sk-ant-super-secret-123456');

    const raw = await readFile(filePath);
    expect(raw.toString('utf8')).not.toContain('sk-ant-super-secret-123456');
    expect(await store.hasApiKey()).toBe(true);
    expect(await store.getApiKey()).toBe('sk-ant-super-secret-123456');

    await store.clearApiKey();
    expect(await store.hasApiKey()).toBe(false);
    expect(await store.getApiKey()).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('safeStorage backend reports a key-free error when encryption is unavailable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-safe-storage-off-'));
  try {
    const store = new SafeStorageSecretStore(join(dir, 'api-key.bin'), {
      safeStorage: () => ({
        isEncryptionAvailable: () => false,
        encryptString: () => Buffer.from(''),
        decryptString: () => ''
      })
    });
    await expect(store.setApiKey('sk-should-not-appear')).rejects.toThrow(
      '系统安全存储不可用，无法保存 API key。'
    );
    expect(await store.hasApiKey()).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('corrupt state files fall back to defaults instead of crashing the app', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-coach-corrupt-'));
  try {
    const filePath = join(dir, 'state.json');
    await import('node:fs/promises').then((fs) => fs.writeFile(filePath, '{not json', 'utf8'));
    const state = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/fallback')
    });
    const settings = new SettingsService(state);
    expect((await settings.get()).vaultPath).toBe('/tmp/fallback');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
