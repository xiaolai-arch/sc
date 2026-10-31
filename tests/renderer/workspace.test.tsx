// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage);
  window.studyCoach = api;
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('shows the butler briefing and sends a message', async () => {
  setup();
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
  expect(screen.getByText('未配置模型，当前使用模板计划。')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  expect(screen.getByText('帮我排一下今天的优先级')).toBeInTheDocument();
  expect(await screen.findByText(/我先按截止时间和精力排/)).toBeInTheDocument();
});

test('records a note from the butler and shows it in the notes surface', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '记一下：今天数学卡在极限' }));
  expect(await screen.findByText(/记下了/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '记录' }));
  expect(
    await screen.findByRole('heading', { name: '今天数学卡在极限' })
  ).toBeInTheDocument();
});

test('filters by workspace and shows its practice', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '英语' }));
  expect(await screen.findByText(/今天有 2 个任务，已完成 1 个/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '学习' }));
  expect(await screen.findAllByText('长难句 3 题')).not.toHaveLength(0);
});

test('completes a task from the plan', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '计划' }));
  expect(await screen.findByText('目标')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(await screen.findAllByText('已完成')).not.toHaveLength(0);
});

test('saves a review and updates the saved state', async () => {
  const api = setup();
  const submit = vi.spyOn(api, 'submitReview');
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '复盘' }));
  await screen.findByText('画像与记忆');
  await userEvent.type(screen.getByLabelText('今天完成了什么？'), '数学');
  await userEvent.type(screen.getByLabelText('卡在哪里？'), '极限');
  await userEvent.type(screen.getByLabelText('明天想怎么调整？'), '先复习');
  await userEvent.click(screen.getByRole('button', { name: '保存复盘' }));
  expect(await screen.findByRole('status')).toHaveTextContent('已保存');
  expect(submit).toHaveBeenCalledWith({
    date: expect.any(String),
    answers: { completed: '数学', stuck: '极限', tomorrow: '先复习' }
  });
});

test('answers a practice question', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '学习' }));
  await screen.findByText('当 x→0 时，sin x / x 的极限是？');
  await userEvent.click(screen.getByRole('button', { name: /^B\. 1/ }));
  await userEvent.click(screen.getByRole('button', { name: '检查答案' }));
  expect(await screen.findByText('回答正确')).toBeInTheDocument();
  expect(screen.getByText(/这是第一个重要极限/)).toBeInTheDocument();
});
