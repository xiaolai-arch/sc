// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { formatLocalDate } from '../../src/shared/date';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('updates the project check-in preference and keeps it', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '项目' }));
  await userEvent.click(screen.getByRole('button', { name: '考研' }));

  const select = await screen.findByLabelText('参与检查');
  expect(select).toHaveValue('daily');

  await userEvent.selectOptions(select, 'off');
  await waitFor(async () => {
    expect(
      (await api.listWorkspaces()).find((workspace) => workspace.id === 'kaoyan')?.checkIn
    ).toBe('off');
  });
  expect(screen.getByLabelText('参与检查')).toHaveValue('off');

  await userEvent.selectOptions(screen.getByLabelText('参与检查'), 'daily');
  await waitFor(async () => {
    expect(
      (await api.listWorkspaces()).find((workspace) => workspace.id === 'kaoyan')?.checkIn
    ).toBe('daily');
  });
});

test('snoozes proactive check-ins for today', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '提醒' }));

  expect(screen.getByText('仅暂停主动检查，不影响你设的提醒。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '今天别再提醒我' }));

  expect(await screen.findByText('今天已静音，明天恢复')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '今天别再提醒我' })).not.toBeInTheDocument();
  expect((await api.getSettings()).notifications.snoozedUntil).toBe(
    formatLocalDate(new Date())
  );
});

test('shows the muted state when today is already snoozed', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  await api.updateSettings({ notifications: { snoozedUntil: formatLocalDate(new Date()) } });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '提醒' }));

  expect(screen.getByText('今天已静音，明天恢复')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '今天别再提醒我' })).not.toBeInTheDocument();
});
