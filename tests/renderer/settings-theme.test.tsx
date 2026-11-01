// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';
import { THEME_STORAGE_KEY } from '../../src/renderer/theme';

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

const emptyUsage = {
  days: [],
  totals: { inputTokens: 0, outputTokens: 0, calls: 0 },
  estimatedCost: null
};

function apiStub() {
  return {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    getUsageSummary: vi.fn().mockResolvedValue(emptyUsage),
    clearUsage: vi.fn().mockResolvedValue(undefined),
    exportBackup: vi.fn().mockResolvedValue(null)
  };
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

test('defaults to following the system', async () => {
  window.studyCoach = apiStub() as never;
  render(<SettingsPage onClose={() => {}} />);

  const system = await screen.findByRole('button', { name: '跟随系统' });
  expect(system).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: '浅色' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  expect(screen.getByText('默认跟随系统；偏好只保存在本机。')).toBeInTheDocument();
});

test('switches to dark and light immediately and persists', async () => {
  window.studyCoach = apiStub() as never;
  render(<SettingsPage onClose={() => {}} />);
  await screen.findByText('外观');

  await userEvent.click(screen.getByRole('button', { name: '深色' }));
  expect(document.documentElement.classList.contains('dark')).toBe(true);
  expect(document.documentElement.style.colorScheme).toBe('dark');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await userEvent.click(screen.getByRole('button', { name: '浅色' }));
  expect(document.documentElement.classList.contains('dark')).toBe(false);
  expect(document.documentElement.style.colorScheme).toBe('light');
  expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
  expect(screen.getByRole('button', { name: '浅色' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
