// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendPrompt } from './send-prompt';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup(streamPace = 0.05) {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('shows the welcome draft and sends a message', async () => {
  setup();
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
  expect(screen.getByText('还没有对话。')).toBeInTheDocument();

  await sendPrompt('帮我排一下今天的优先级');

  expect((await screen.findAllByText(/我先按截止时间和精力排/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText('帮我排一下今天的优先级').length).toBeGreaterThan(1);
});

test('starts a new draft and reopens a previous conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();

  const sidebar = screen.getAllByRole('complementary')[0]!;
  const conversation = within(sidebar).getByRole('button', {
    name: /帮我排一下今天的优先级/
  });
  await userEvent.click(conversation);
  expect((await screen.findAllByText(/我先按截止时间和精力排/)).length).toBeGreaterThan(0);
});

test('opens the projects page and filters by project', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  expect(await screen.findByText('外刊精读')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');

  expect(await screen.findByText('极限与连续')).toBeInTheDocument();
  expect(screen.getByText('2027 考研：数学一 / 英语一 / 政治')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('外刊精读')).not.toBeInTheDocument());
});

test('records a note and previews it from the records tab', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await sendPrompt('记一下：今天数学卡在极限');
  expect((await screen.findAllByText(/记下了/, {}, { timeout: 3000 })).length).toBeGreaterThan(0);

  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');
  const noteButton = await screen.findByRole(
    'button',
    { name: /^今天数学卡在极限/ },
    { timeout: 3000 }
  );
  await userEvent.click(noteButton);

  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(/记一下：今天数学卡在极限/)).toBeInTheDocument();
});

test('shows the review and reminder tabs', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '复盘' }));
  expect(await screen.findByText('还没有复盘记录。')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '提醒' }));
  expect(await screen.findByText('21:30')).toBeInTheDocument();
});

test('opens the settings page and returns to chat', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '返回对话' }));
  await waitFor(() => expect(screen.queryByLabelText('模型名称')).not.toBeInTheDocument());
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
});

test('creates a project through the conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.type(screen.getByLabelText('向阿咲提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(
    await screen.findByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 })
  ).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');
  expect(await screen.findByRole('heading', { name: '考研' })).toBeInTheDocument();
  expect(await screen.findByText('2027 考研：数学一 / 英语一 / 政治')).toBeInTheDocument();
});

test('opens practice from the projects page', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));

  await userEvent.click(screen.getByRole('button', { name: '练习' }));
  expect((await screen.findAllByText('极限基础 3 题')).length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: '关闭练习' })).toBeInTheDocument();
});


test('edits and deletes a practice set from the practice sidebar', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  await userEvent.click(screen.getByRole('button', { name: '练习' }));

  await userEvent.click(
    await screen.findByRole('button', { name: '编辑练习集：极限基础 3 题' })
  );
  const dialog = screen.getByRole('dialog', { name: '编辑练习集' });
  const titleInput = within(dialog).getByLabelText('标题');
  await userEvent.clear(titleInput);
  await userEvent.type(titleInput, '极限冲刺');
  const promptInput = within(dialog).getByLabelText('第 1 题题干');
  await userEvent.clear(promptInput);
  await userEvent.type(promptInput, '改过的题干');
  await userEvent.click(within(dialog).getByRole('button', { name: '保存修改' }));

  expect(
    await screen.findByRole('button', { name: '编辑练习集：极限冲刺' })
  ).toBeInTheDocument();
  const edited = (await api.listPracticeSets('kaoyan')).find(
    (set) => set.title === '极限冲刺'
  );
  expect(edited?.questions[0]?.prompt).toBe('改过的题干');

  await userEvent.click(screen.getByRole('button', { name: '删除练习集：极限冲刺' }));
  await userEvent.click(screen.getByRole('button', { name: '确认删除练习集：极限冲刺' }));

  await waitFor(async () => {
    expect(
      (await api.listPracticeSets('kaoyan')).some((set) => set.title === '极限冲刺')
    ).toBe(false);
  });
});


test('stops an in-flight generation', async () => {
  setup(1);
  await screen.findByText('早上好，xiaolai。');

  await sendPrompt('帮我排一下今天的优先级');
  const stop = await screen.findByRole('button', { name: '停止生成' });
  await userEvent.click(stop);

  expect(
    (await screen.findAllByText('（已停止生成）', {}, { timeout: 3000 })).length
  ).toBeGreaterThan(0);
});
