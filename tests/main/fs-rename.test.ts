import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { rename } from 'node:fs/promises';
import { renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Wrap the real functions so the retry loop's bookkeeping is observable while
// the filesystem still behaves normally once the injected faults run out.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

import { renameSyncWithRetry, renameWithRetry } from '../../src/main/fs/rename';

/** The module retries with 10ms sleeps and gives up after 20 attempts. */
const MAX_ATTEMPTS = 20;

const mockedRename = vi.mocked(rename);
const mockedRenameSync = vi.mocked(renameSync);

function transient(code: 'EPERM' | 'EACCES' | 'EBUSY'): NodeJS.ErrnoException {
  const error = new Error(`${code}: simulated lock`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

let root: string;
let from: string;
let to: string;

beforeEach(async () => {
  mockedRename.mockClear();
  mockedRenameSync.mockClear();
  root = await mkdtemp(join(tmpdir(), 'asaki-rename-'));
  from = join(root, 'note.md.1234.tmp');
  to = join(root, 'note.md');
  await writeFile(from, '新的内容\n', 'utf8');
  await writeFile(to, '旧的内容\n', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('renameWithRetry', () => {
  test.each([2, 5, 20])('succeeds on attempt %i after transient Windows locks', async (attempts) => {
    for (let failure = 1; failure < attempts; failure += 1) {
      mockedRename.mockRejectedValueOnce(transient('EPERM'));
    }

    await renameWithRetry(from, to);

    expect(mockedRename).toHaveBeenCalledTimes(attempts);
    // The retry loop only stopped once the real rename actually landed, so the
    // destination holds the new file rather than a torn or missing one.
    await expect(readFile(to, 'utf8')).resolves.toBe('新的内容\n');
  });

  test('retries every transient code: EPERM, EACCES and EBUSY', async () => {
    mockedRename
      .mockRejectedValueOnce(transient('EPERM'))
      .mockRejectedValueOnce(transient('EACCES'))
      .mockRejectedValueOnce(transient('EBUSY'));

    await renameWithRetry(from, to);

    expect(mockedRename).toHaveBeenCalledTimes(4);
    await expect(readFile(to, 'utf8')).resolves.toBe('新的内容\n');
  });

  test('gives up after the documented maximum attempts and rethrows the lock', async () => {
    for (let failure = 1; failure <= MAX_ATTEMPTS; failure += 1) {
      mockedRename.mockRejectedValueOnce(transient('EBUSY'));
    }

    await expect(renameWithRetry(from, to)).rejects.toMatchObject({ code: 'EBUSY' });
    expect(mockedRename).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  test('a give-up leaves the previous destination intact', async () => {
    for (let failure = 1; failure <= MAX_ATTEMPTS; failure += 1) {
      mockedRename.mockRejectedValueOnce(transient('EACCES'));
    }

    await expect(renameWithRetry(from, to)).rejects.toMatchObject({ code: 'EACCES' });
    // The failed swap never touched the destination.
    await expect(readFile(to, 'utf8')).resolves.toBe('旧的内容\n');
  });

  test('does not retry a permanent error', async () => {
    mockedRename.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    );

    await expect(renameWithRetry(from, to)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mockedRename).toHaveBeenCalledTimes(1);
    await expect(readFile(to, 'utf8')).resolves.toBe('旧的内容\n');
  });

  test('an immediate success is not delayed', async () => {
    await renameWithRetry(from, to);

    expect(mockedRename).toHaveBeenCalledTimes(1);
    await expect(readFile(to, 'utf8')).resolves.toBe('新的内容\n');
  });
});

describe('renameSyncWithRetry', () => {
  test('succeeds on the third attempt', () => {
    mockedRenameSync
      .mockImplementationOnce(() => {
        throw transient('EPERM');
      })
      .mockImplementationOnce(() => {
        throw transient('EBUSY');
      });

    renameSyncWithRetry(from, to);

    expect(mockedRenameSync).toHaveBeenCalledTimes(3);
    expect(renameSync).toHaveBeenCalled();
  });

  test('gives up after the maximum attempts and rethrows the last lock', () => {
    for (let failure = 1; failure <= MAX_ATTEMPTS; failure += 1) {
      mockedRenameSync.mockImplementationOnce(() => {
        throw transient('EPERM');
      });
    }

    expect(() => renameSyncWithRetry(from, to)).toThrow(
      expect.objectContaining({ code: 'EPERM' })
    );
    expect(mockedRenameSync).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });
});
