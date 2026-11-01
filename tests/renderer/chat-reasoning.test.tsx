// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  window.studyCoach = createMockApi(localStorage, { streamPace: 0.6 });
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
}

test('shows live reasoning and collapses after the answer starts', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));

  const header = await screen.findByRole('button', { name: /思考/ });
  expect(header).toHaveAttribute('aria-expanded', 'false');
  expect(
    await screen.findByText(/我先按截止时间和精力排/, {}, { timeout: 3000 })
  ).toBeInTheDocument();

  await userEvent.click(header);
  expect(header).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/先看今天的任务和最近的记忆/)).toBeInTheDocument();
});

test('shows tool steps and keeps narration out of the final answer', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '记一下：今天数学卡在极限' }));

  expect(await screen.findByText('写入笔记', {}, { timeout: 3000 })).toBeInTheDocument();
  expect(await screen.findByText(/记下了/, {}, { timeout: 3000 })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /思考/ }));
  expect(screen.getByText(/我先把这条记下来/)).toBeInTheDocument();

  const answer = screen.getByText(/记下了/);
  expect(answer.textContent).not.toContain('我先把这条记下来');
});
