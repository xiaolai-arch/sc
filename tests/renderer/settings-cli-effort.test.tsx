// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';

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

const emptyUsage = {
  days: [],
  totals: { inputTokens: 0, outputTokens: 0, calls: 0 },
  estimatedCost: null
};

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    getSettings: vi.fn().mockResolvedValue(baseSettings),
    updateSettings: vi.fn().mockResolvedValue(baseSettings),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    getUsageSummary: vi.fn().mockResolvedValue(emptyUsage),
    clearUsage: vi.fn().mockResolvedValue(undefined),
    exportBackup: vi.fn().mockResolvedValue(null),
    ...overrides
  };
}

test('renders the effort selector with a default and explains the CLI flags', async () => {
  window.studyCoach = apiStub() as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByLabelText('推理强度')).toHaveValue('');
  expect(
    screen.getByText(/Codex 使用 -c model_reasoning_effort，Claude 使用 --effort/)
  ).toBeInTheDocument();
});

test('saves the chosen effort and omits it for the default', async () => {
  const update = vi.fn().mockResolvedValue(baseSettings);
  window.studyCoach = apiStub({ updateSettings: update }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByRole('button', { name: '保存设置' }));
  expect(update).toHaveBeenLastCalledWith(
    expect.objectContaining({
      provider: expect.objectContaining({ kind: 'local-cli', agent: 'codex' })
    })
  );
  expect(
    (update.mock.calls.at(-1)?.[0] as { provider: { effort?: string } }).provider.effort
  ).toBeUndefined();

  await userEvent.selectOptions(screen.getByLabelText('推理强度'), 'high');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));
  expect(
    (update.mock.calls.at(-1)?.[0] as { provider: { effort?: string } }).provider.effort
  ).toBe('high');
});

test('loads an existing effort and keeps it when switching agents', async () => {
  window.studyCoach = apiStub({
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      provider: {
        kind: 'local-cli',
        agent: 'codex',
        command: 'codex',
        effort: 'low'
      }
    })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByLabelText('推理强度')).toHaveValue('low');

  await userEvent.selectOptions(screen.getByLabelText('CLI agent'), 'claude');
  expect(screen.getByLabelText('推理强度')).toHaveValue('low');
});
