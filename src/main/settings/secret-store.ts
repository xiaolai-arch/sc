import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Storage for the model API key. Implementations must never log the value. */
export interface SecretStore {
  hasApiKey(): Promise<boolean>;
  /** Main-process use only; never expose this through IPC. */
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
}

export class InMemorySecretStore implements SecretStore {
  private apiKey: string | null = null;

  async hasApiKey(): Promise<boolean> {
    return this.apiKey !== null;
  }

  async getApiKey(): Promise<string | null> {
    return this.apiKey;
  }

  async setApiKey(key: string): Promise<void> {
    if (typeof key !== 'string') {
      throw new Error('API key 必须是字符串。');
    }
    const trimmed = key.trim();
    this.apiKey = trimmed.length > 0 ? trimmed : null;
  }

  async clearApiKey(): Promise<void> {
    this.apiKey = null;
  }
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SafeStorageSecretStoreOptions {
  /** Injection seam for tests; production resolves Electron's safeStorage lazily. */
  safeStorage?: () => SafeStorageLike;
}

function loadElectronSafeStorage(): SafeStorageLike {
  // Requiring lazily keeps this module importable from plain Node tests.
  const electron = require('electron') as typeof import('electron');
  return electron.safeStorage;
}

/**
 * Stores the API key encrypted with Electron safeStorage at rest.
 * The ciphertext lives in a dedicated 0600 file outside state.json.
 */
export class SafeStorageSecretStore implements SecretStore {
  private readonly filePath: string;
  private readonly resolveSafeStorage: () => SafeStorageLike;

  constructor(filePath: string, options: SafeStorageSecretStoreOptions = {}) {
    this.filePath = filePath;
    this.resolveSafeStorage = options.safeStorage ?? loadElectronSafeStorage;
  }

  async hasApiKey(): Promise<boolean> {
    try {
      const info = await stat(this.filePath);
      return info.size > 0;
    } catch {
      return false;
    }
  }

  async getApiKey(): Promise<string | null> {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch {
      return null;
    }
    try {
      const key = this.resolveSafeStorage().decryptString(encrypted);
      return key.length > 0 ? key : null;
    } catch {
      // Never surface the ciphertext or the plaintext key in an error.
      throw new Error('无法读取 API key。');
    }
  }

  async setApiKey(key: string): Promise<void> {
    if (typeof key !== 'string') {
      throw new Error('API key 必须是字符串。');
    }
    const trimmed = key.trim();
    if (trimmed.length === 0) {
      await this.clearApiKey();
      return;
    }
    const safeStorage = this.resolveSafeStorage();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统安全存储不可用，无法保存 API key。');
    }
    let encrypted: Buffer;
    try {
      encrypted = safeStorage.encryptString(trimmed);
    } catch {
      throw new Error('保存 API key 失败。');
    }
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, encrypted, { mode: 0o600 });
    } catch {
      throw new Error('保存 API key 失败。');
    }
  }

  async clearApiKey(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
