// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';

const baseSettings = {
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
    exportBackup: vi.fn().mockResolvedValue({
      path: '/tmp/study-coach-backup',
      copied: { vault: true, conversations: true, state: true, usage: true }
    }),
    ...overrides
  };
}

test('exports a backup and shows the destination', async () => {
  const exportBackup = vi.fn().mockResolvedValue({
    path: '/tmp/study-coach-backup',
    copied: { vault: true, conversations: true, state: true, usage: true }
  });
  window.studyCoach = apiStub({ exportBackup }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(
    await screen.findByText(/备份包含项目、记录、对话、设置和用量，不包含 API Key。/)
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '导出备份…' }));

  expect(await screen.findByText('已导出到 /tmp/study-coach-backup')).toBeInTheDocument();
  expect(exportBackup).toHaveBeenCalledTimes(1);
});

test('shows a canceled state when the picker is dismissed', async () => {
  window.studyCoach = apiStub({ exportBackup: vi.fn().mockResolvedValue(null) }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByRole('button', { name: '导出备份…' }));

  expect(await screen.findByText('已取消')).toBeInTheDocument();
});

test('shows an error when export fails', async () => {
  window.studyCoach = apiStub({
    exportBackup: vi.fn().mockRejectedValue(new Error('备份失败'))
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByRole('button', { name: '导出备份…' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('备份失败');
});

test('disables the button while exporting', async () => {
  let resolveExport: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    resolveExport = resolve;
  });
  window.studyCoach = apiStub({ exportBackup: vi.fn().mockReturnValue(pending) }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByRole('button', { name: '导出备份…' }));
  expect(screen.getByRole('button', { name: '正在导出…' })).toBeDisabled();

  resolveExport({
    path: '/tmp/done',
    copied: { vault: true, conversations: true, state: true, usage: true }
  });
  expect(await screen.findByText('已导出到 /tmp/done')).toBeInTheDocument();
});
