import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCliSpawn } from '../../src/main/agent/cli-command';

test('leaves non-Windows commands untouched', async () => {
  const spec = await prepareCliSpawn('codex', ['exec', '-'], { platform: 'darwin' });
  expect(spec).toEqual({ kind: 'direct', command: 'codex', args: ['exec', '-'] });
});

test('resolves a .cmd shim through PATH and quotes its arguments', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asaki-cli-'));
  try {
    const dir = join(root, 'Program Files');
    await mkdir(dir, { recursive: true });
    const shim = join(dir, 'codex.cmd');
    await writeFile(shim, '@echo off\r\n');

    const spec = await prepareCliSpawn('codex', ['exec', 'a & b', '"quoted"'], {
      platform: 'win32',
      env: {
        PATH: dir,
        PATHEXT: '.cmd;.EXE',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe'
      }
    });

    expect(spec.kind).toBe('cmd');
    if (spec.kind !== 'cmd') return;
    expect(spec.command).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(spec.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    const line = spec.args[3] ?? '';
    expect(line).toContain(`"${shim}"`);
    expect(line).toContain('"a & b"');
    expect(line).toContain('\\"quoted\\"');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runs a resolved .exe directly without a shell', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asaki-cli-'));
  try {
    const exe = join(root, 'codex.EXE');
    await writeFile(exe, '');
    const spec = await prepareCliSpawn('codex', ['exec'], {
      platform: 'win32',
      env: { PATH: root, PATHEXT: '.EXE;.CMD' }
    });
    expect(spec).toEqual({ kind: 'direct', command: exe, args: ['exec'] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('falls back to cmd for commands that are not on PATH', async () => {
  const spec = await prepareCliSpawn('zcode', ['-p', '总结 & 下一步'], {
    platform: 'win32',
    env: { PATH: '', PATHEXT: '.CMD', ComSpec: 'cmd.exe' }
  });
  expect(spec.kind).toBe('cmd');
  if (spec.kind !== 'cmd') return;
  expect(spec.args[3]).toBe('zcode -p "总结 & 下一步"');
});
