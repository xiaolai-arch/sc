import { join } from 'node:path';
import { readCliModelCatalog, displayConfigPath } from '../../src/main/agent/cli-model-config';

const home = join('/tmp', 'asaki-home');
const codexDir = join(home, '.codex');
const codexConfig = join(codexDir, 'config.toml');
const codexCatalog = join(codexDir, 'magpie-models.json');
const claudeSettings = join(home, '.claude', 'settings.json');
const opencodeConfig = join(home, '.config', 'opencode', 'opencode.json');

function reader(files: Record<string, string>) {
  return async (path: string): Promise<string> => {
    const value = files[path];
    if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return value;
  };
}

test('reads the codex model, effort and the catalog it references', async () => {
  const catalog = await readCliModelCatalog('codex', {
    homeDir: home,
    readTextFile: reader({
      [codexConfig]: [
        'model = "codex/gpt-6.1-sol"',
        'model_reasoning_effort = "high"',
        'model_catalog_json = "magpie-models.json"',
        'api_key = "sk-should-never-leak"',
        '',
        '[profiles.fast]',
        'model = "codex/gpt-6.1-mini"'
      ].join('\n'),
      [codexCatalog]: JSON.stringify({
        models: [
          { slug: 'codex/gpt-6.1-sol', display_name: 'GPT-6.1 Sol' },
          { slug: 'codex/gpt-6.1-mini', display_name: 'GPT-6.1 Mini' }
        ]
      })
    })
  });

  expect(catalog.defaultModel).toBe('codex/gpt-6.1-sol');
  expect(catalog.defaultEffort).toBe('high');
  expect(catalog.files).toEqual(['~/.codex/config.toml', '~/.codex/magpie-models.json']);
  expect(catalog.warnings).toEqual([]);
  expect(catalog.options.map((option) => option.id)).toEqual([
    'codex/gpt-6.1-sol',
    'codex/gpt-6.1-mini'
  ]);
  expect(catalog.options[1]).toMatchObject({
    label: 'GPT-6.1 Mini',
    origin: 'catalog',
    source: '~/.codex/magpie-models.json'
  });
  expect(JSON.stringify(catalog)).not.toContain('sk-should-never-leak');
});

test('keeps the default when a referenced catalog is broken', async () => {
  const catalog = await readCliModelCatalog('codex', {
    homeDir: home,
    readTextFile: reader({
      [codexConfig]: 'model = "codex/gpt-6.1-sol"\nmodel_catalog_json = "magpie-models.json"\n',
      [codexCatalog]: '{ this is not json'
    })
  });

  expect(catalog.defaultModel).toBe('codex/gpt-6.1-sol');
  expect(catalog.options.map((option) => option.id)).toEqual(['codex/gpt-6.1-sol']);
  expect(catalog.warnings[0]).toContain('模型目录无法解析');
});

test('reads Claude aliases and environment mappings without credentials', async () => {
  const catalog = await readCliModelCatalog('claude', {
    homeDir: home,
    readTextFile: reader({
      [claudeSettings]: JSON.stringify({
        model: 'sonnet[1m]',
        env: {
          ANTHROPIC_DEFAULT_SONNET_MODEL: 'claude-sonnet-5-5',
          ANTHROPIC_DEFAULT_HAIKU_MODEL: 'claude-haiku-5-5',
          ANTHROPIC_API_KEY: 'sk-ant-secret'
        }
      })
    })
  });

  // ASAKI must report what Claude would use, not replace it.
  expect(catalog.defaultModel).toBe('sonnet[1m]');
  const ids = catalog.options.map((option) => option.id);
  expect(ids).toContain('sonnet');
  expect(ids).toContain('claude-sonnet-5-5');
  expect(ids).toContain('haiku');
  expect(ids).not.toContain('opus');
  expect(catalog.options.find((option) => option.id === 'sonnet')?.label).toContain(
    'claude-sonnet-5-5'
  );
  expect(JSON.stringify(catalog)).not.toContain('sk-ant-secret');
});

test('reports a broken Claude settings file but stays usable', async () => {
  const catalog = await readCliModelCatalog('claude', {
    homeDir: home,
    readTextFile: reader({ [claudeSettings]: '{ nope' })
  });

  expect(catalog.defaultModel).toBeUndefined();
  expect(catalog.options).toEqual([]);
  expect(catalog.warnings.some((warning) => warning.includes('无法解析'))).toBe(true);
});

test('reads opencode provider models from JSONC with comments and trailing commas', async () => {
  const catalog = await readCliModelCatalog('opencode', {
    homeDir: home,
    env: {},
    readTextFile: reader({
      [opencodeConfig]: `{
        // the default model
        "model": "anthropic/claude-sonnet-5-5",
        "provider": {
          "anthropic": { "models": { "claude-sonnet-5-5": { "name": "Sonnet" } } },
          "openai": { "models": { "gpt-5.6": {} } },
        },
        "apiKey": "sk-opencode-secret",
      }`
    })
  });

  expect(catalog.defaultModel).toBe('anthropic/claude-sonnet-5-5');
  expect(catalog.options.map((option) => option.id)).toEqual([
    'anthropic/claude-sonnet-5-5',
    'openai/gpt-5.6'
  ]);
  expect(catalog.options[0]?.label).toBe('当前使用');
  expect(JSON.stringify(catalog)).not.toContain('sk-opencode-secret');
});

test('merges models the CLI itself advertises after config candidates', async () => {
  const { mergeCliAdvertisedModels } = await import('../../src/main/agent/cli-model-config');
  const catalog = {
    defaultModel: 'codex/gpt-6.1-sol',
    options: [
      {
        id: 'codex/gpt-6.1-sol',
        origin: 'config' as const,
        source: '~/.codex/config.toml'
      }
    ],
    files: ['~/.codex/config.toml'],
    warnings: []
  };
  const merged = mergeCliAdvertisedModels(
    catalog,
    ['codex/gpt-6.1-sol', 'codex/extra'],
    'Codex'
  );
  expect(merged.options.map((option) => option.id)).toEqual([
    'codex/gpt-6.1-sol',
    'codex/extra'
  ]);
  expect(merged.options[1]).toMatchObject({ origin: 'cli', source: 'Codex' });
});

test('returns an empty catalog when no config exists', async () => {
  const catalog = await readCliModelCatalog('codex', {
    homeDir: home,
    readTextFile: async () => {
      throw new Error('ENOENT');
    }
  });
  expect(catalog).toEqual({ options: [], files: [], warnings: [] });
});

test('shortens home paths for display', () => {
  expect(displayConfigPath(codexConfig, home)).toBe('~/.codex/config.toml');
  expect(displayConfigPath('/etc/hosts', home)).toBe('/etc/hosts');
});
