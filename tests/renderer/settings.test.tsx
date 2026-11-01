// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';

const settings = {
  vaultPath: '/tmp/vault',
  provider: { kind: 'anthropic' as const, model: 'claude-sonnet-5-5' },
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
  launchAtLogin: true
};

test('saves provider model and api key without echoing the key', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: setKey
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByLabelText('模型名称')).toHaveValue('claude-sonnet-5-5');
  await userEvent.clear(screen.getByLabelText('模型名称'));
  await userEvent.type(screen.getByLabelText('模型名称'), 'claude-opus-5-5');
  await userEvent.type(screen.getByLabelText('API Key'), 'sk-test');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ provider: expect.objectContaining({ model: 'claude-opus-5-5' }) })
  );
  expect(setKey).toHaveBeenCalledWith('sk-test');
  expect(screen.getByLabelText('API Key')).toHaveValue('');
});

test('restores a backup after confirmation and offers a restart', async () => {
  const restoreBackup = vi.fn().mockResolvedValue({
    path: '/tmp/backup',
    safetyPath: '/tmp/safety',
    restored: { vault: true, conversations: true, usage: true }
  });
  const restartApp = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn(),
    restoreBackup,
    restartApp
  } as never;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

  render(<SettingsPage onClose={() => {}} />);
  await screen.findByLabelText('模型名称');
  await userEvent.click(screen.getByRole('button', { name: '从备份恢复…' }));

  expect(confirm).toHaveBeenCalled();
  expect(restoreBackup).toHaveBeenCalled();
  expect(await screen.findByRole('status')).toHaveTextContent('恢复完成');
  expect(screen.getByText(/\/tmp\/safety/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '立即重启' }));
  expect(restartApp).toHaveBeenCalled();
  confirm.mockRestore();
});

test('does not restore when the confirmation is dismissed', async () => {
  const restoreBackup = vi.fn();
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn(),
    restoreBackup
  } as never;
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

  render(<SettingsPage onClose={() => {}} />);
  await screen.findByLabelText('模型名称');
  await userEvent.click(screen.getByRole('button', { name: '从备份恢复…' }));

  expect(restoreBackup).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test('clears a previous saved status and validates the model', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: vi.fn().mockResolvedValue(undefined)
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  await screen.findByLabelText('模型名称');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(await screen.findByRole('status')).toHaveTextContent('已保存');
  await userEvent.clear(screen.getByLabelText('模型名称'));
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请填写模型名称');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(update).toHaveBeenCalledTimes(1);
});

test('requires a base URL for non-Anthropic providers', async () => {
  const update = vi.fn();
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  await screen.findByLabelText('模型名称');
  await userEvent.selectOptions(screen.getByLabelText('提供商'), 'openai-compatible');
  await userEvent.clear(screen.getByLabelText('Base URL'));
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请填写 Base URL');
  expect(update).not.toHaveBeenCalled();
});

test('saves the weekly review toggle and time', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;
  render(<SettingsPage onClose={() => {}} />);

  const toggle = await screen.findByLabelText('周日复盘');
  expect(toggle).toBeChecked();
  expect(screen.getByLabelText('周复盘时间')).toHaveValue('20:00');

  await userEvent.clear(screen.getByLabelText('周复盘时间'));
  await userEvent.type(screen.getByLabelText('周复盘时间'), '19:30');
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      notifications: expect.objectContaining({ weekly: '19:30', weeklyEnabled: false })
    })
  );
});

test('fills weekly defaults for old settings payloads', async () => {
  const oldSettings = {
    ...settings,
    notifications: {
      enabled: true,
      morning: '08:00',
      evening: '21:30',
      dndStart: '23:00',
      dndEnd: '07:30'
    }
  };
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(oldSettings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByLabelText('周复盘时间')).toHaveValue('20:00');
  expect(screen.getByLabelText('周日复盘')).toBeChecked();
});

test('saves a local cli provider without an api key', async () => {
  const localSettings = {
    ...settings,
    provider: { kind: 'local-cli' as const, agent: 'codex' as const, command: 'codex' }
  };
  const update = vi.fn().mockResolvedValue(localSettings);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByLabelText('CLI agent')).toHaveValue('codex');
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: expect.objectContaining({
        kind: 'local-cli',
        agent: 'codex',
        command: 'codex'
      })
    })
  );
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('hides model and effort for zcode and explains where to change them', async () => {
  const localSettings = {
    ...settings,
    provider: { kind: 'local-cli' as const, agent: 'zcode' as const, command: 'zcode' }
  };
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByLabelText('CLI agent')).toHaveValue('zcode');
  expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
  expect(screen.getByText(/在 zcode 内/)).toBeInTheDocument();
});

test('shows model and effort for opencode', async () => {
  const localSettings = {
    ...settings,
    provider: {
      kind: 'local-cli' as const,
      agent: 'opencode' as const,
      command: 'opencode',
      model: 'anthropic/claude-sonnet-5-5'
    }
  };
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByLabelText('CLI agent')).toHaveValue('opencode');
  expect(screen.getByLabelText('模型名称')).toHaveValue('anthropic/claude-sonnet-5-5');
  expect(screen.getByLabelText('推理强度')).toBeInTheDocument();
});

test('clears the saved key before switching to a different endpoint', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: setKey
  } as never;
  render(<SettingsPage onClose={() => {}} />);
  await screen.findByLabelText('模型名称');

  await userEvent.selectOptions(screen.getByLabelText('提供商'), 'openai-compatible');
  await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(setKey).toHaveBeenCalledWith('');
  expect(setKey.mock.invocationCallOrder[0]).toBeLessThan(
    update.mock.invocationCallOrder[0]!
  );
});
