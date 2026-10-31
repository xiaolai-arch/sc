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
  expect(await screen.findByText(/英语 ·/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '学习' }));
  expect(await screen.findAllByText('长难句 3 题')).not.toHaveLength(0);
});

test('completes a task from the plan', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '今日安排' }));
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

test('switches workspace from the API snapshot', async () => {
  const api = setup();
  const snapshot = vi.spyOn(api, 'getWorkspaceSnapshot');
  await screen.findByText('早上好，xiaolai。');
  expect(snapshot).toHaveBeenCalledWith('kaoyan');
  expect(snapshot).toHaveBeenCalledWith('english');

  await userEvent.click(screen.getByRole('button', { name: '英语' }));
  expect(await screen.findByText(/英语 ·/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '今日安排' }));
  expect(await screen.findAllByText('外刊精读')).not.toHaveLength(0);
  expect(screen.queryByText('马原第一章')).not.toBeInTheDocument();
});

test('creates a task through the today surface', async () => {
  const api = setup();
  const createTask = vi.spyOn(api, 'createTask');
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '今日安排' }));
  await screen.findByRole('button', { name: '添加任务' });
  await userEvent.type(screen.getByLabelText('任务标题'), '整理线代错题');
  await userEvent.type(screen.getByLabelText('科目'), '数学');
  await userEvent.clear(screen.getByLabelText('时长（分钟）'));
  await userEvent.type(screen.getByLabelText('时长（分钟）'), '25');
  await userEvent.type(screen.getByLabelText('验收标准'), '整理 5 道错题');
  await userEvent.click(screen.getByRole('button', { name: '添加任务' }));

  expect(await screen.findByText('任务已添加')).toBeInTheDocument();
  expect((await screen.findAllByText('整理线代错题')).length).toBeGreaterThan(0);
  expect(createTask).toHaveBeenCalledWith({
    workspaceId: 'kaoyan',
    title: '整理线代错题',
    subject: '数学',
    durationMin: 25,
    acceptance: '整理 5 道错题'
  });
});

test('creates a note through the notes surface', async () => {
  const api = setup();
  const createNote = vi.spyOn(api, 'createNote');
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '记录' }));
  await screen.findByRole('heading', { name: '极限的定义与性质' });
  await userEvent.click(screen.getByRole('button', { name: '新建记录' }));
  await userEvent.type(screen.getByLabelText('记录标题'), '线代复盘');
  await userEvent.type(screen.getByLabelText('记录正文'), '矩阵秩的判定还要再练。');
  await userEvent.click(screen.getByRole('button', { name: '保存记录' }));

  expect(await screen.findByRole('heading', { name: '线代复盘' })).toBeInTheDocument();
  expect(screen.getAllByText('线代复盘').length).toBeGreaterThan(0);
  expect(createNote).toHaveBeenCalledWith(
    expect.objectContaining({
      workspaceId: 'kaoyan',
      title: '线代复盘',
      body: '矩阵秩的判定还要再练。'
    })
  );
});

test('sends a butler message through the API and renders the reply', async () => {
  const api = setup();
  const send = vi.spyOn(api, 'send');
  await screen.findByText('早上好，xiaolai。');
  await userEvent.type(screen.getByLabelText('向管家提问'), '教我一下洛必达法则');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText('教我一下洛必达法则')).toBeInTheDocument();
  expect(await screen.findByText(/洛必达法则要先确认/)).toBeInTheDocument();
  expect(send).toHaveBeenCalledWith(
    expect.objectContaining({ message: '教我一下洛必达法则' })
  );
});

test('shows a load error and retries through the API', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage);
  vi.spyOn(api, 'listWorkspaces').mockRejectedValueOnce(new Error('本地 vault 读取失败'));
  window.studyCoach = api;
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);

  expect(await screen.findByRole('alert')).toHaveTextContent('本地 vault 读取失败');
  await userEvent.click(screen.getByRole('button', { name: '重试' }));
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
});
