import { scanLocalClis } from '../../src/main/agent/local-cli-discovery';

function result(stdout: string, code = 0) {
  return { stdout, stderr: '', code };
}

test('detects codex, its version, login state and native capabilities', async () => {
  const run = vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === '--version') return result('codex-cli 0.166.0\n');
    if (args[0] === 'login') {
      return result('Logged in with API key - sk-secret-value-should-not-leak\n');
    }
    if (args[0] === '--help') {
      return result('--json\nresume\n--search\n--image\n');
    }
    if (args[0] === 'exec' && args[1] === '--help') {
      return result('--sandbox <MODE>\n-C, --cd <DIR>\n-c model_reasoning_effort\n');
    }
    return result('', 1);
  });

  const scan = await scanLocalClis({
    resolve: async (name) => (name === 'codex' ? '/opt/homebrew/bin/codex' : null),
    run,
    homeDir: '/tmp/home',
    now: () => new Date('2026-11-01T10:00:00.000Z')
  });

  expect(scan.scannedAt).toBe('2026-11-01T10:00:00.000Z');
  const codex = scan.entries.find((entry) => entry.agent === 'codex');
  expect(codex).toMatchObject({
    installed: true,
    path: '/opt/homebrew/bin/codex',
    version: '0.166.0',
    auth: 'ready',
    authDetail: '已登录'
  });
  expect(codex?.features).toEqual(
    expect.arrayContaining(['native-tools', 'streaming', 'reasoning', 'sessions', 'sandbox', 'web', 'images'])
  );
  expect(JSON.stringify(scan)).not.toContain('sk-secret');
});

test('reads Claude auth JSON and reports MCP/skill/web capabilities', async () => {
  const run = vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === '--version') return result('2.1.316 (Claude Code)\n');
    if (args[0] === 'auth') {
      return result(JSON.stringify({ loggedIn: true, authMethod: 'oauth_token' }));
    }
    return result('--output-format stream-json --resume --mcp-config --tools WebSearch --add-dir --permission-mode --plugin-dir\n');
  });

  const scan = await scanLocalClis({
    resolve: async (name) => (name === 'claude' ? '/Users/me/.local/bin/claude' : null),
    run,
    homeDir: '/tmp/home'
  });

  const claude = scan.entries.find((entry) => entry.agent === 'claude');
  expect(claude).toMatchObject({
    installed: true,
    version: '2.1.316',
    auth: 'ready',
    authDetail: 'OAuth 已登录'
  });
  expect(claude?.features).toEqual(
    expect.arrayContaining(['streaming', 'sessions', 'mcp', 'skills', 'web', 'sandbox', 'native-tools'])
  );
});

test('lists opencode models and login connections without network access', async () => {
  const run = vi.fn(async (_command: string, args: string[]) => {
    if (args[0] === '--version') return result('2.0.32\n');
    if (args[0] === 'auth') {
      return result(
        JSON.stringify([
          { id: 'openai', connections: [{ type: 'env', name: 'OPENAI_API_KEY' }] }
        ])
      );
    }
    if (args[0] === 'models') {
      return result('anthropic/claude-sonnet-5-5\nopenai/gpt-5.6\nnot a model\n');
    }
    return result('run --format json --session --thinking --model\nmodels\nsession\nmcp\n');
  });

  const scan = await scanLocalClis({
    resolve: async (name) => (name === 'opencode' ? '/opt/homebrew/bin/opencode' : null),
    run,
    homeDir: '/tmp/home'
  });

  const opencode = scan.entries.find((entry) => entry.agent === 'opencode');
  expect(opencode).toMatchObject({
    installed: true,
    auth: 'ready',
    authDetail: '1 个可用凭据',
    models: ['anthropic/claude-sonnet-5-5', 'openai/gpt-5.6']
  });
  expect(opencode?.features).toEqual(
    expect.arrayContaining(['streaming', 'reasoning', 'sessions', 'mcp', 'models', 'native-tools'])
  );
});

test('uses stored zcode credentials and returns install hints for missing agents', async () => {
  const scan = await scanLocalClis({
    resolve: async (name) => (name === 'zcode' ? '/opt/homebrew/bin/zcode' : null),
    run: async (_command, args) =>
      args[0] === '--version' ? result('3.17.1\n') : result('--json --cwd --mode --resume mcp skills browser-use\n'),
    readTextFile: async () => JSON.stringify({ token: 'redacted-for-test' }),
    homeDir: '/tmp/home'
  });

  const zcode = scan.entries.find((entry) => entry.agent === 'zcode');
  expect(zcode).toMatchObject({
    installed: true,
    version: '3.17.1',
    auth: 'ready',
    authDetail: '已保存登录凭据'
  });
  expect(zcode?.features).toEqual(
    expect.arrayContaining(['streaming', 'sessions', 'mcp', 'skills', 'web', 'sandbox', 'native-tools'])
  );

  const missing = scan.entries.find((entry) => entry.agent === 'codex');
  expect(missing).toMatchObject({
    installed: false,
    auth: 'unknown',
    features: [],
    installHint: 'npm install -g @openai/codex'
  });
});
