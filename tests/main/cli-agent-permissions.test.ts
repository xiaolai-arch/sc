import { buildAgentArgs } from '../../src/main/agent/cli-agent-client';
import type { ProviderConfig } from '../../src/shared/types';

type LocalCliProvider = Extract<ProviderConfig, { kind: 'local-cli' }>;

const claude: LocalCliProvider = {
  kind: 'local-cli',
  agent: 'claude',
  command: 'claude',
  nativeTools: true
};

test('native claude grants web access without narrowing its toolset', () => {
  const args = buildAgentArgs(claude, ['-p', 'hi'], {
    nativeTools: true,
    webTools: true,
    cwd: 'C:/vault'
  });

  expect(args).toContain('--allowedTools');
  expect(args).toContain('WebSearch,WebFetch');
  // `--tools` would strip the native file tools native mode depends on.
  expect(args).not.toContain('--tools');
});

test('native claude subtracts file writes and shell when they are forbidden', () => {
  const readOnly = buildAgentArgs(claude, ['-p', 'hi'], {
    nativeTools: true,
    allowWrites: false,
    allowShell: false
  });

  expect(readOnly).toEqual(
    expect.arrayContaining([
      '--disallowedTools',
      'Edit,Write,MultiEdit,NotebookEdit,Bash,BashOutput'
    ])
  );
});

test('native claude keeps Bash when only writes are forbidden', () => {
  const args = buildAgentArgs(claude, ['-p', 'hi'], {
    nativeTools: true,
    allowWrites: false,
    allowShell: true
  });

  const disallowed = args[args.indexOf('--disallowedTools') + 1];
  expect(disallowed).toBe('Edit,Write,MultiEdit,NotebookEdit');
});

test('one-shot claude gets an explicit web-only toolset', () => {
  const args = buildAgentArgs(
    { ...claude, nativeTools: false },
    ['-p', 'hi'],
    { webTools: true }
  );

  expect(args).toEqual(expect.arrayContaining(['--tools', 'WebSearch,WebFetch']));
  expect(args).toEqual(expect.arrayContaining(['--allowedTools', 'WebSearch,WebFetch']));
});

test('codex uses a read-only sandbox when writes are forbidden', () => {
  const codex: LocalCliProvider = {
    kind: 'local-cli',
    agent: 'codex',
    command: 'codex',
    nativeTools: true
  };

  const args = buildAgentArgs(codex, ['exec', '-'], {
    nativeTools: true,
    cwd: 'C:/vault',
    allowWrites: false,
    webTools: true
  });

  expect(args).toContain('--sandbox');
  expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only');
  expect(args[0]).toBe('--search');
});
