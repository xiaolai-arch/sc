// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsPage } from '../../src/renderer/settings/SettingsPage';

const settings = {
  vaultPath: '/tmp/vault',
  provider: { kind: 'anthropic' as const, model: 'claude-sonnet-5-5' },
  notifications: { enabled: true, morning: '08:00', evening: '21:30', dndStart: '23:00', dndEnd: '07:30' },
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
