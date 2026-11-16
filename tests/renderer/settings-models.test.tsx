// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';
import { pickOption } from './select-option';

const baseSettings = {
  vaultPath: '/tmp/vault',
  provider: { kind: 'local-cli' as const, agent: 'codex' as const, command: 'codex' },
  notifications: {
    enabled: true,
    morning: '08:00',
    evening: '21:30',
    weekly: '20:00',
    weeklyEnabled: true,
    dndStart: '23:00',
    dndEnd: '07:30'
  },
  budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
  launchAtLogin: false
};

const codexCatalog = {
  defaultModel: 'codex/gpt-6.1-sol',
  defaultEffort: 'high',
  files: ['~/.codex/config.toml', '~/.codex/magpie-models.json'],
  warnings: [],
  options: [
    {
      id: 'codex/gpt-6.1-sol',
      origin: 'config' as const,
      source: '~/.codex/config.toml',
      label: '当前使用'
    },
    {
      id: 'codex/gpt-6.1-mini',
      origin: 'catalog' as const,
      source: '~/.codex/magpie-models.json',
      label: 'GPT-6.1 Mini'
    }
  ]
};

const claudeCatalog = {
  defaultModel: 'sonnet[1m]',
  files: ['~/.claude/settings.json'],
  warnings: [],
  options: [
    { id: 'sonnet', origin: 'alias' as const, source: '~/.claude/settings.json' }
  ]
};

function scanWith(codexCatalogValue: unknown, auth: 'ready' | 'missing' = 'ready') {
  return {
    scannedAt: '2026-11-15T10:00:00.000Z',
    entries: [
      {
        agent: 'codex',
        label: 'Codex',
        command: 'codex',
        installed: true,
        path: '/opt/homebrew/bin/codex',
        version: '0.166.0',
        auth,
        features: ['streaming', 'native-tools'],
        ...(codexCatalogValue ? { modelCatalog: codexCatalogValue } : {})
      },
      {
        agent: 'claude',
        label: 'Claude Code',
        command: 'claude',
        installed: true,
        path: '/Users/me/.local/bin/claude',
        version: '2.1.316',
        auth: 'ready',
        features: ['streaming', 'native-tools'],
        modelCatalog: claudeCatalog
      }
    ]
  };
}

function stub(
  overrides: Record<string, unknown> = {},
  provider: Record<string, unknown> = baseSettings.provider
) {
  const update = vi.fn().mockResolvedValue(baseSettings);
  const scanLocalClis = vi.fn().mockResolvedValue(scanWith(codexCatalog));
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue({ ...baseSettings, provider }),
    updateSettings: update,
    setApiKey: vi.fn().mockResolvedValue(undefined),
    scanLocalClis,
    ...overrides
  } as never;
  return { update, scanLocalClis };
}

test('offers the model the CLI config already uses and inherits it by default', async () => {
  const { update } = stub();
  render(<SettingsPage onClose={() => {}} />);

  await waitFor(() =>
    expect(screen.getByLabelText('模型')).toHaveTextContent(
      '继承 CLI 默认（codex/gpt-6.1-sol）'
    )
  );
  expect(screen.getByText(/本机读到 2 个候选/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  const patch = update.mock.calls.at(-1)?.[0] as { provider: Record<string, unknown> };
  // Inheriting means ASAKI writes no model, so the CLI keeps its own setting.
  expect(patch.provider).not.toHaveProperty('model');
  expect(patch.provider).toMatchObject({ kind: 'local-cli', agent: 'codex' });
});

test('saves a model chosen from the discovered catalog', async () => {
  const { update } = stub();
  render(<SettingsPage onClose={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText('模型')).toBeInTheDocument());

  await pickOption('模型', /GPT-6.1 Mini/);
  expect(screen.getByLabelText('模型')).toHaveTextContent('codex/gpt-6.1-mini');

  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  const patch = update.mock.calls.at(-1)?.[0] as { provider: { model?: string } };
  expect(patch.provider.model).toBe('codex/gpt-6.1-mini');
});

test('keeps a saved model that the local config no longer lists', async () => {
  stub({}, {
    kind: 'local-cli',
    agent: 'codex',
    command: 'codex',
    model: 'codex/legacy-model'
  });
  render(<SettingsPage onClose={() => {}} />);

  await waitFor(() =>
    expect(screen.getByLabelText('自定义模型 ID')).toHaveValue('codex/legacy-model')
  );
});

test('still offers inherit when the config file is broken', async () => {
  const { update } = stub({
    scanLocalClis: vi.fn().mockResolvedValue(
      scanWith({
        files: [],
        warnings: ['配置文件无法解析：~/.codex/config.toml'],
        options: []
      })
    )
  });
  render(<SettingsPage onClose={() => {}} />);

  await waitFor(() =>
    expect(screen.getByText(/配置文件无法解析/)).toBeInTheDocument()
  );
  expect(screen.getByLabelText('模型')).toHaveTextContent('继承 CLI 默认');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenCalled();
});

test('reports the selected CLI login state when testing the connection', async () => {
  stub({ scanLocalClis: vi.fn().mockResolvedValue(scanWith(codexCatalog, 'missing')) });
  render(<SettingsPage onClose={() => {}} />);

  await screen.findByLabelText('CLI agent');
  await userEvent.click(screen.getByRole('button', { name: '测试连接' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('尚未登录');
});

test('clears a model override when switching to a different CLI', async () => {
  const { update } = stub({}, {
    kind: 'local-cli',
    agent: 'codex',
    command: 'codex',
    model: 'codex/gpt-6.1-mini'
  });
  render(<SettingsPage onClose={() => {}} />);
  await waitFor(() =>
    expect(screen.getByLabelText('模型')).toHaveTextContent('codex/gpt-6.1-mini')
  );

  await pickOption('CLI agent', 'Claude Code');
  expect(screen.getByLabelText('模型')).toHaveTextContent('继承 CLI 默认（sonnet[1m]）');

  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  const patch = update.mock.calls.at(-1)?.[0] as { provider: Record<string, unknown> };
  expect(patch.provider).toMatchObject({ kind: 'local-cli', agent: 'claude' });
  expect(patch.provider).not.toHaveProperty('model');
});
