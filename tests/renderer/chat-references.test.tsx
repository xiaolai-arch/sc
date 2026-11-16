// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendPrompt } from './send-prompt';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  window.studyCoach = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
}

test('shows 本次参考 and opens the profile it came from', async () => {
  setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('今天怎么安排？');

  const summary = await screen.findByText(/本次参考 · 2/, {}, { timeout: 3000 });
  await userEvent.click(summary);
  const entry = await screen.findByText('工作日每天可用时间约 1 小时，周末 3 小时。');
  expect(entry).toBeInTheDocument();

  // The row may still be re-rendered while the streaming answer settles, so
  // dispatch a single click instead of userEvent's multi-step pointer sequence.
  fireEvent.click(entry.closest('button') ?? entry);
  expect(
    await screen.findByText('这里是你亲口说过、或经你确认的事实', { exact: false })
  ).toBeInTheDocument();
  expect(
    screen.getByText('工作日每天可用时间约 1 小时，周末 3 小时。')
  ).toBeInTheDocument();
});
