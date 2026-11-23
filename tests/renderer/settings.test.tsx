// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';
import { pickOption } from './select-option';

const settings = {
  vaultPath: '/tmp/vault',
  provider: { kind: 'anthropic' as const, model: 'claude-sonnet-5-5' },
  notifications: {
    enabled: true,
    morning: '08:00',
    evening: '21:30',
    weekly: '20:00',
    weeklyEnabled: true,
    behindSchedule: '20:30',
    behindScheduleEnabled: true,
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

test('shows whether a key is configured and clears it after confirmation', async () => {
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    setApiKey: setKey
  } as never;

  render(<SettingsPage onClose={() => {}} hasApiKey />);
  await screen.findByLabelText('模型名称');
  expect(screen.getByText('已配置')).toBeInTheDocument();
  expect(screen.getByText(/safeStorage/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '清除已保存的密钥' }));
  expect(setKey).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: '确认清除' }));

  await waitFor(() => expect(setKey).toHaveBeenCalledWith(''));
  expect(await screen.findByText('未配置')).toBeInTheDocument();
});

test('saves the display name used by greetings', async () => {  const update = vi.fn().mockResolvedValue({ ...settings, displayName: '小林' });
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue({ ...settings, displayName: 'xiaolai' }),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  const input = await screen.findByLabelText('称呼');
  expect(input).toHaveValue('xiaolai');
  await userEvent.clear(input);
  await userEvent.type(input, '小林');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(update).toHaveBeenCalledWith(expect.objectContaining({ displayName: '小林' }));
});

test('restores a backup after confirmation and offers a restart', async () => {
  const restoreBackup = vi.fn().mockResolvedValue({
    path: '/tmp/backup',
    safetyPath: '/tmp/safety',
    restored: { vault: true, conversations: true, usage: true, state: false }
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
  await pickOption('提供商', 'OpenAI 兼容');
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

test('saves the behind-schedule reminder toggle and time', async () => {
  const update = vi.fn().mockResolvedValue(settings);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;
  render(<SettingsPage onClose={() => {}} />);

  const toggle = await screen.findByRole('checkbox', { name: '落后提醒' });
  expect(toggle).toBeChecked();
  expect(screen.getByLabelText('落后提醒时间')).toHaveValue('20:30');

  await userEvent.clear(screen.getByLabelText('落后提醒时间'));
  await userEvent.type(screen.getByLabelText('落后提醒时间'), '19:45');
  await userEvent.click(toggle);
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      notifications: expect.objectContaining({
        behindSchedule: '19:45',
        behindScheduleEnabled: false
      })
    })
  );
});

test('fills behind-schedule defaults for settings payloads without them', async () => {
  const { behindSchedule: _time, behindScheduleEnabled: _on, ...notifications } =
    settings.notifications;
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue({ ...settings, notifications }),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByLabelText('落后提醒时间')).toHaveValue('20:30');
  expect(screen.getByRole('checkbox', { name: '落后提醒' })).toBeChecked();
});

test('fills weekly defaults for old settings payloads', async () => {  const oldSettings = {
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
  expect(await screen.findByLabelText('CLI agent')).toHaveTextContent('Codex');
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

test('labels CLI agents with their product names while keeping stable ids', async () => {
  const localSettings = {
    ...settings,
    provider: { kind: 'local-cli' as const, agent: 'codex' as const, command: 'codex' }
  };
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);

  const select = await screen.findByLabelText('CLI agent');
  await userEvent.click(select);
  const options = await screen.findAllByRole('option');
  expect(options.map((option) => option.textContent)).toEqual([
    'Codex',
    'Claude Code',
    'ZCode',
    'OpenCode'
  ]);
  expect(options.map((option) => option.getAttribute('data-value'))).toEqual([
    'codex',
    'claude',
    'zcode',
    'opencode'
  ]);
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
  expect(await screen.findByLabelText('CLI agent')).toHaveTextContent('ZCode');
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
  expect(await screen.findByLabelText('CLI agent')).toHaveTextContent('OpenCode');
  // Without a local scan there are no candidates, so the saved id is kept as a
  // custom entry instead of being reset to "inherit".
  expect(screen.getByLabelText('自定义模型 ID')).toHaveValue('anthropic/claude-sonnet-5-5');
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

  await pickOption('提供商', 'OpenAI 兼容');
  await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(setKey).toHaveBeenCalledWith('');
  expect(setKey.mock.invocationCallOrder[0]).toBeLessThan(
    update.mock.invocationCallOrder[0]!
  );
});

test('scans local CLIs and selects a detected agent with native tools', async () => {
  const localSettings = {
    ...settings,
    provider: { kind: 'local-cli' as const, agent: 'codex' as const, command: 'codex' }
  };
  const update = vi.fn().mockResolvedValue(localSettings);
  const scanLocalClis = vi.fn().mockResolvedValue({
    scannedAt: '2026-11-01T10:00:00.000Z',
    entries: [
      {
        agent: 'codex',
        label: 'Codex',
        command: 'codex',
        installed: true,
        path: '/opt/homebrew/bin/codex',
        version: '0.166.0',
        auth: 'ready',
        authDetail: '已登录',
        features: ['streaming', 'native-tools', 'sessions']
      },
      {
        agent: 'claude',
        label: 'Claude Code',
        command: 'claude',
        installed: true,
        path: '/Users/me/.local/bin/claude',
        version: '2.1.316',
        auth: 'ready',
        authDetail: 'OAuth 已登录',
        features: ['streaming', 'native-tools', 'mcp', 'skills']
      },
      {
        agent: 'zcode',
        label: 'ZCode',
        command: 'zcode',
        installed: false,
        auth: 'unknown',
        features: [],
        installHint: '安装 zcode 后运行 zcode login'
      }
    ]
  });
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: update,
    setApiKey: vi.fn(),
    scanLocalClis
  } as never;

  render(<SettingsPage onClose={() => {}} />);

  const list = await screen.findByRole('list', { name: '本机 CLI 扫描结果' });
  expect(list).toHaveTextContent('Codex');
  expect(list).toHaveTextContent('2.1.316');
  expect(list).toHaveTextContent('未安装 · 安装 zcode 后运行 zcode login');

  await userEvent.click(screen.getByRole('button', { name: '使用 Claude Code' }));
  expect(screen.getByLabelText('CLI agent')).toHaveTextContent('Claude Code');
  expect(screen.getByLabelText('CLI 命令')).toHaveValue('claude');

  expect(screen.getByLabelText('使用 CLI 原生工具')).toBeChecked();
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: expect.objectContaining({
        kind: 'local-cli',
        agent: 'claude',
        command: 'claude',
        nativeTools: true
      })
    })
  );
});

test('shows the local CLI common case and keeps API access collapsed by default', async () => {
  const localSettings = {
    ...settings,
    provider: { kind: 'local-cli' as const, agent: 'codex' as const, command: 'codex' }
  };
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);

  // The common case answers "what am I using?" without opening anything.
  expect(await screen.findByLabelText('CLI agent')).toHaveTextContent('Codex');
  expect(screen.getByLabelText('模型')).toBeInTheDocument();
  expect(screen.getByLabelText('推理强度')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '测试连接' })).toBeInTheDocument();
  expect(screen.getByText(/不选模型时 ASAKI 不会传 --model/)).toBeInTheDocument();

  // The summary names the live provider even while the panel is closed.
  expect(
    screen.getByText(/高级：接入方式与 API 凭据 · 当前使用：Codex（本机 CLI）/)
  ).toBeInTheDocument();

  // API access is not merely collapsed: none of its controls are rendered.
  expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Base URL')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '提供商' })).not.toBeInTheDocument();
});

test('expanding advanced reveals the provider, Base URL and API Key, and saves the key', async () => {
  const localSettings = {
    ...settings,
    provider: { kind: 'local-cli' as const, agent: 'codex' as const, command: 'codex' }
  };
  const update = vi.fn().mockResolvedValue(settings);
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(localSettings),
    updateSettings: update,
    setApiKey: setKey
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  await screen.findByLabelText('CLI agent');
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();

  await userEvent.click(screen.getByText(/高级：接入方式与 API 凭据/));

  expect(screen.getByRole('combobox', { name: '提供商' })).toBeInTheDocument();
  await pickOption('提供商', 'OpenAI 兼容');
  expect(screen.getByLabelText('Base URL')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('模型名称'), 'gpt-5');
  await userEvent.type(screen.getByLabelText('Base URL'), 'https://api.example.com/v1');
  await userEvent.type(screen.getByLabelText('API Key'), 'sk-live');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(setKey).toHaveBeenCalledWith('sk-live');
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      provider: expect.objectContaining({
        kind: 'openai-compatible',
        baseURL: 'https://api.example.com/v1',
        model: 'gpt-5'
      })
    })
  );
});

test('opens advanced by default for an API provider and names it in the summary', async () => {
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn().mockResolvedValue(undefined)
  } as never;

  render(<SettingsPage onClose={() => {}} hasApiKey />);

  // No click needed: an API user lands on the credentials they configured.
  expect(await screen.findByLabelText('API Key')).toBeInTheDocument();
  expect(screen.getByLabelText('模型名称')).toHaveValue('claude-sonnet-5-5');
  expect(screen.getByText('已配置')).toBeInTheDocument();
  expect(
    screen.getByText(/高级：接入方式与 API 凭据 · 当前使用：Anthropic API/)
  ).toBeInTheDocument();
});

test('re-expanding the API panel still clears an existing key', async () => {
  const setKey = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    setApiKey: setKey
  } as never;

  render(<SettingsPage onClose={() => {}} hasApiKey />);
  await screen.findByLabelText('API Key');

  await userEvent.click(screen.getByText(/高级：接入方式与 API 凭据/));
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();

  await userEvent.click(screen.getByText(/高级：接入方式与 API 凭据/));
  await userEvent.click(
    await screen.findByRole('button', { name: '清除已保存的密钥' })
  );
  await userEvent.click(screen.getByRole('button', { name: '确认清除' }));

  await waitFor(() => expect(setKey).toHaveBeenCalledWith(''));
});

test('settings group anchors still resolve to live sections', async () => {
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn(),
    setApiKey: vi.fn()
  } as never;
  const scrolled: string[] = [];
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: function (this: Element) {
      scrolled.push(this.id);
    }
  });

  try {
    render(<SettingsPage onClose={() => {}} />);
    const groups = await screen.findByRole('navigation', { name: '设置分组' });

    for (const [label, target] of [
      ['本机 AI', 'settings-model-section'],
      ['提醒与后台', 'settings-notifications'],
      ['个人与外观', 'settings-profile-section'],
      ['数据与备份', 'settings-backup']
    ] as const) {
      expect(document.getElementById(target)).not.toBeNull();
      await userEvent.click(within(groups).getByRole('button', { name: label }));
      expect(scrolled.at(-1)).toBe(target);
    }
  } finally {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
});

test('saves the opt-in stricter-mastery switch with an honest label', async () => {
  const update = vi.fn().mockResolvedValue({ ...settings, strictMastery: true });
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  const checkbox = await screen.findByRole('checkbox', {
    name: /更严的掌握判定/
  });
  expect(checkbox).not.toBeChecked();
  expect(
    screen.getByText('默认关闭。打开后选择题答对不再直接判掌握。')
  ).toBeInTheDocument();

  await userEvent.click(checkbox);
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(update).toHaveBeenCalledWith(expect.objectContaining({ strictMastery: true }));
});

test('reflects a stored strictMastery value when the page loads', async () => {
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue({ ...settings, strictMastery: true }),
    updateSettings: vi.fn().mockResolvedValue({ ...settings, strictMastery: true }),
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  expect(await screen.findByRole('checkbox', { name: /更严的掌握判定/ })).toBeChecked();
});

test('saves and one-tap clears the local accountability name', async () => {
  const update = vi.fn().mockResolvedValue({ ...settings, accountabilityName: '小林' });
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: update,
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  const input = (await screen.findByLabelText('问责对象（可选）')) as HTMLInputElement;
  expect(input).toHaveValue('');
  // The clear button only exists while a name is present.
  expect(screen.queryByRole('button', { name: '清空' })).toBeNull();

  await userEvent.type(input, '小林');
  expect(
    screen.getByText(
      '只在提醒里陈述事实，例如「你告诉过 A 的是周五」。不会联系、不会发送给任何人，一键清空。'
    )
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ accountabilityName: '小林' })
  );

  // One tap empties the input; saving persists the explicit clear.
  await userEvent.click(screen.getByRole('button', { name: '清空' }));
  expect(input).toHaveValue('');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenLastCalledWith(
    expect.objectContaining({ accountabilityName: '' })
  );
});

test('loads a stored accountability name and caps the input length', async () => {
  window.studyCoach = {
    getSettings: vi.fn().mockResolvedValue({ ...settings, accountabilityName: '小林' }),
    updateSettings: vi.fn().mockResolvedValue(settings),
    setApiKey: vi.fn()
  } as never;

  render(<SettingsPage onClose={() => {}} />);
  const input = await screen.findByLabelText('问责对象（可选）');
  expect(input).toHaveValue('小林');
  expect(input).toHaveAttribute('maxlength', '20');
});
