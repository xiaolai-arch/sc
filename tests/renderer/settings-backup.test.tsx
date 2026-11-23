// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatLocalDateTimeSeconds } from '../../src/shared/date';
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

// --- the persistent status line ----------------------------------------------

test('a fresh install shows 从未备份过。', async () => {
  window.studyCoach = apiStub() as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('从未备份过。')).toBeInTheDocument();
});

test('a same-day record shows 上次备份：今天 with the clock time', async () => {
  const stamp = formatLocalDateTimeSeconds(new Date());
  window.studyCoach = apiStub({
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      backup: { lastBackupAt: stamp, lastBackupPath: '/tmp/b', lastBackupOutcome: 'ok' }
    })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(
    await screen.findByText(`上次备份：今天 ${stamp.slice(11, 16)}`)
  ).toBeInTheDocument();
});

test('an older record shows the age in days', async () => {
  const stamp = formatLocalDateTimeSeconds(new Date(Date.now() - 6 * 86400000));
  window.studyCoach = apiStub({
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      backup: { lastBackupAt: stamp, lastBackupPath: '/tmp/b', lastBackupOutcome: 'ok' }
    })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('上次备份：6 天前')).toBeInTheDocument();
});

test('a persisted failure shows the failed state without a reason or fake date', async () => {
  // A failure from before this session: outcome failed, no reason stored (the
  // reason key arrives with P1), and no lastBackupAt ever written.
  window.studyCoach = apiStub({
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      backup: { lastBackupOutcome: 'failed' }
    })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('上次备份没有成功。')).toBeInTheDocument();
});

test('a failed export names the reason and keeps the last success', async () => {
  const stamp = formatLocalDateTimeSeconds(new Date(Date.now() - 2 * 86400000));
  window.studyCoach = apiStub({
    exportBackup: vi.fn().mockRejectedValue(new Error('备份目录不能位于 vault 内。')),
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      backup: { lastBackupAt: stamp, lastBackupPath: '/tmp/b', lastBackupOutcome: 'ok' }
    })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByRole('button', { name: '导出备份…' }));

  expect(
    await screen.findByText('上次备份没有成功（备份目录不能位于 vault 内。）。')
  ).toBeInTheDocument();
  expect(await screen.findByText('上次成功：2 天前。')).toBeInTheDocument();
  // Never a fake date for the failed try itself.
  expect(screen.queryByText(/上次备份：今天/)).not.toBeInTheDocument();
});

test('a successful export refreshes the status line to today', async () => {
  const stamp = formatLocalDateTimeSeconds(new Date());
  const getSettings = vi
    .fn()
    .mockResolvedValueOnce(baseSettings)
    .mockResolvedValue({
      ...baseSettings,
      backup: {
        lastBackupAt: stamp,
        lastBackupPath: '/tmp/study-coach-backup',
        lastBackupOutcome: 'ok'
      }
    });
  window.studyCoach = apiStub({ getSettings }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('从未备份过。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '导出备份…' }));

  expect(await screen.findByText('已导出到 /tmp/study-coach-backup')).toBeInTheDocument();
  expect(await screen.findByText(`上次备份：今天 ${stamp.slice(11, 16)}`)).toBeInTheDocument();
});

test('the age line toggle saves through the backup patch', async () => {
  const updateSettings = vi.fn().mockResolvedValue(baseSettings);
  window.studyCoach = apiStub({ updateSettings }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByLabelText('周复盘里提到上次备份'));
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  await vi.waitFor(() => {
    expect(updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ backup: { ageLineEnabled: true } })
    );
  });
  // Persisted facts are form-external: they never mark the page dirty.
  expect(updateSettings).toHaveBeenCalledTimes(1);
});
