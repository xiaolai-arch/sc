// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';
import { formatLocalDate } from '../../src/shared/date';
import type { UsageSummary } from '../../src/shared/usage';

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
  budget: {
    proactiveSessionsPerDay: 4,
    dailyTokens: 200000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 8
  },
  launchAtLogin: true
};

const today = formatLocalDate(new Date());
const usage: UsageSummary = {
  days: [
    { date: today, inputTokens: 1200, outputTokens: 300, calls: 3 },
    { date: '2026-01-01', inputTokens: 800, outputTokens: 100, calls: 2 }
  ],
  totals: { inputTokens: 2000, outputTokens: 400, calls: 5 },
  estimatedCost: 0.25
};

const emptyUsage: UsageSummary = {
  days: [],
  totals: { inputTokens: 0, outputTokens: 0, calls: 0 },
  estimatedCost: null
};

function apiStub(overrides: Record<string, unknown> = {}) {
  return {
    getSettings: vi.fn().mockResolvedValue(baseSettings),
    updateSettings: vi.fn().mockResolvedValue(baseSettings),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    getUsageSummary: vi.fn().mockResolvedValue(usage),
    clearUsage: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

test('renders today, seven-day totals and the price estimate', async () => {
  window.studyCoach = apiStub() as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('用量与成本')).toBeInTheDocument();
  const card = document.getElementById('settings-usage')!;
  expect(within(card).getByText('输入 1200 · 输出 300 · 调用 3')).toBeInTheDocument();
  expect(within(card).getByText('输入 2000 · 输出 400 · 调用 5')).toBeInTheDocument();
  expect(within(card).getByText('估算成本 ¥0.25')).toBeInTheDocument();
  expect(within(card).getByText(today)).toBeInTheDocument();
});

test('shows today tokens against the daily budget and flags an overrun', async () => {
  window.studyCoach = apiStub({
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      budget: { ...baseSettings.budget, dailyTokens: 1000 }
    })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('用量与成本')).toBeInTheDocument();
  const card = document.getElementById('settings-usage')!;
  expect(
    await within(card).findByText('每日 token：1500 / 1000（预算已用完，主动检查会暂停）')
  ).toBeInTheDocument();
});

test('prompts to configure prices when none are set', async () => {
  window.studyCoach = apiStub({
    getSettings: vi.fn().mockResolvedValue({
      ...baseSettings,
      budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 }
    }),
    getUsageSummary: vi.fn().mockResolvedValue({ ...usage, estimatedCost: null })
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('设置单价后可估算成本')).toBeInTheDocument();
});

test('shows the empty state without usage', async () => {
  window.studyCoach = apiStub({
    getUsageSummary: vi.fn().mockResolvedValue(emptyUsage)
  }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(
    await screen.findByText('还没有用量记录。和阿咲对话后这里会显示本地统计。')
  ).toBeInTheDocument();
});

test('saves token prices with the budget', async () => {
  const update = vi.fn().mockResolvedValue(baseSettings);
  window.studyCoach = apiStub({ updateSettings: update }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByLabelText('输入价格（元/百万 token）')).toHaveValue(2);
  await userEvent.clear(screen.getByLabelText('输入价格（元/百万 token）'));
  await userEvent.type(screen.getByLabelText('输入价格（元/百万 token）'), '3');
  await userEvent.clear(screen.getByLabelText('输出价格（元/百万 token）'));
  await userEvent.type(screen.getByLabelText('输出价格（元/百万 token）'), '9');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      budget: expect.objectContaining({
        inputPricePerMillion: 3,
        outputPricePerMillion: 9
      })
    })
  );
});

test('refreshes the cost estimate after saving prices', async () => {
  const getUsage = vi
    .fn()
    .mockResolvedValueOnce(usage)
    .mockResolvedValueOnce({ ...usage, estimatedCost: 0.75 });
  const update = vi.fn().mockResolvedValue(baseSettings);
  window.studyCoach = apiStub({ getUsageSummary: getUsage, updateSettings: update }) as never;
  render(<SettingsPage onClose={() => {}} />);

  expect(await screen.findByText('估算成本 ¥0.25')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('输入价格（元/百万 token）'));
  await userEvent.type(screen.getByLabelText('输入价格（元/百万 token）'), '3');
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }));

  expect(await screen.findByText('估算成本 ¥0.75')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('已保存');
  expect(getUsage).toHaveBeenCalledTimes(2);
});

test('clears usage after confirmation', async () => {
  const getUsage = vi.fn().mockResolvedValueOnce(usage).mockResolvedValueOnce(emptyUsage);
  const clear = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = apiStub({ getUsageSummary: getUsage, clearUsage: clear }) as never;
  render(<SettingsPage onClose={() => {}} />);

  await userEvent.click(await screen.findByRole('button', { name: '清空用量' }));
  await userEvent.click(screen.getByRole('button', { name: '确认清空' }));

  await waitFor(() => expect(clear).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText('还没有用量记录。和阿咲对话后这里会显示本地统计。')
  ).toBeInTheDocument();
});
