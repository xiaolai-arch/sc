// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { formatLocalDate } from '../../src/shared/date';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  api.onNavigate = () => () => undefined;
  api.getUsageSummary = async () => ({
    days: [
      {
        date: formatLocalDate(new Date()),
        inputTokens: 600,
        outputTokens: 500,
        calls: 1
      }
    ],
    totals: { inputTokens: 600, outputTokens: 500, calls: 1 },
    estimatedCost: null
  });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('asks once before a manual turn over the daily token budget', async () => {
  const api = setup();
  const current = await api.getSettings();
  await api.updateSettings({ budget: { ...current.budget, dailyTokens: 1000 } });

  const composer = await screen.findByLabelText('向阿咲提问');
  await userEvent.type(composer, '帮我排一下今天的优先级');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('今日 token 预算已用完')).toBeInTheDocument();
  expect(screen.getByText(/今天已使用 1100 token/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(screen.queryByText('今日 token 预算已用完')).not.toBeInTheDocument());
  expect(composer).toHaveValue('帮我排一下今天的优先级');

  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await userEvent.click(await screen.findByRole('button', { name: '继续发送' }));

  expect((await screen.findAllByText(/我先按截止时间和精力排/)).length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.queryByText('今日 token 预算已用完')).not.toBeInTheDocument());
  // Let the turn finish before teardown; a late stream update would otherwise
  // dispatch state after jsdom is gone.
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  );
});

test('a zero budget only pauses proactive check-ins', async () => {
  const api = setup();
  const current = await api.getSettings();
  await api.updateSettings({ budget: { ...current.budget, dailyTokens: 0 } });

  const composer = await screen.findByLabelText('向阿咲提问');
  await userEvent.type(composer, '帮我排一下今天的优先级');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect((await screen.findAllByText(/我先按截止时间和精力排/)).length).toBeGreaterThan(0);
  expect(screen.queryByText('今日 token 预算已用完')).not.toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  );
});
