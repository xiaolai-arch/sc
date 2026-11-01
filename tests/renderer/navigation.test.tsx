// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  return { api };
}

async function mount(api: ReturnType<typeof createMockApi>) {
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText('早上好，xiaolai。');
}

function nav() {
  return within(screen.getByRole('navigation', { name: '主导航' }));
}

function sidebar() {
  return screen.getAllByRole('complementary')[0]!;
}

test('switches across all six sections and marks the active one', async () => {
  const { api } = setup();
  await mount(api);

  const pages: Array<{ label: string; assert: () => Promise<unknown> }> = [
    {
      label: '项目',
      assert: async () =>
        expect(
          await screen.findByRole('heading', { name: '全部项目' })
        ).toBeInTheDocument()
    },
    {
      label: '记忆',
      assert: async () =>
        expect(
          await screen.findByText('极限定义还不稳，建议先复习再做新题。')
        ).toBeInTheDocument()
    },
    {
      label: '复盘',
      assert: async () =>
        expect(await screen.findByText('还没有复盘记录。')).toBeInTheDocument()
    },
    {
      label: '提醒',
      assert: async () =>
        expect(
          await screen.findByRole('switch', { name: '早间计划 提醒开关' })
        ).toBeInTheDocument()
    },
    {
      label: '设置',
      assert: async () => expect(await screen.findByLabelText('模型名称')).toBeInTheDocument()
    }
  ];

  for (const page of pages) {
    const button = nav().getByRole('button', { name: page.label });
    await userEvent.click(button);
    expect(nav().getByRole('button', { name: page.label })).toHaveAttribute(
      'aria-current',
      'page'
    );
    await page.assert();
  }

  await userEvent.click(nav().getByRole('button', { name: '对话' }));
  expect(nav().getByRole('button', { name: '对话' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
  expect(screen.getAllByRole('complementary')).toHaveLength(1);
});

test('keeps the conversation and project when moving between sections', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.type(screen.getByLabelText('向管家提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(
    await screen.findByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 })
  ).toBeInTheDocument();

  await userEvent.click(nav().getByRole('button', { name: '项目' }));
  expect(await screen.findByRole('heading', { name: '考研' })).toBeInTheDocument();

  await userEvent.click(nav().getByRole('button', { name: '记忆' }));
  expect(
    await screen.findByText('极限定义还不稳，建议先复习再做新题。')
  ).toBeInTheDocument();
  expect(screen.queryByText('外刊表达积累有效，继续保持。')).not.toBeInTheDocument();

  await userEvent.click(nav().getByRole('button', { name: '对话' }));
  expect(
    await screen.findByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: '打开项目：考研' })
  ).toBeInTheDocument();
});

test('opens the projects page from the chat header project name', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.type(screen.getByLabelText('向管家提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 });

  await userEvent.click(await screen.findByRole('button', { name: '打开项目：考研' }));

  expect(await screen.findByRole('heading', { name: '考研' })).toBeInTheDocument();
  expect(screen.getByText('2027 考研：数学一 / 英语一 / 政治')).toBeInTheDocument();
});

test('keeps a composer draft when switching sections', async () => {
  const { api } = setup();
  await mount(api);

  const composer = screen.getByLabelText('向管家提问');
  await userEvent.type(composer, '先记下这句话');
  await userEvent.click(nav().getByRole('button', { name: '项目' }));
  await screen.findByRole('heading', { name: '全部项目' });
  await userEvent.click(nav().getByRole('button', { name: '对话' }));

  expect(screen.getByLabelText('向管家提问')).toHaveValue('先记下这句话');
});

test('starts a new conversation from the settings page', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.click(nav().getByRole('button', { name: '设置' }));
  expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));

  expect(await screen.findByText('早上好，xiaolai。')).toBeInTheDocument();
  expect(nav().getByRole('button', { name: '对话' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('lists review history and starts a chat review', async () => {
  const { api } = setup();
  await api.submitReview({
    date: '2026-10-31',
    workspaceId: 'kaoyan',
    answers: {
      completed: '完成数学 10 题',
      stuck: '极限定义',
      tomorrow: '复盘错题'
    }
  });
  await mount(api);

  await userEvent.click(nav().getByRole('button', { name: '复盘' }));
  await waitFor(() => expect(screen.getAllByText('2026-10-31').length).toBeGreaterThan(0));
  expect(screen.getByText('完成：完成数学 10 题')).toBeInTheDocument();
  expect(screen.getAllByText('卡点：极限定义').length).toBeGreaterThan(0);
  expect(screen.getByText('明天：复盘错题')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '开始复盘' }));

  expect(
    await screen.findByText('我们开始今天复盘', { selector: 'p' })
  ).toBeInTheDocument();
  expect(nav().getByRole('button', { name: '对话' })).toHaveAttribute(
    'aria-current',
    'page'
  );
});

test('filters memories from the project list on the memory page', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.click(nav().getByRole('button', { name: '记忆' }));
  expect(
    await screen.findByText('外刊表达积累有效，继续保持。')
  ).toBeInTheDocument();

  await userEvent.click(within(sidebar()).getByRole('button', { name: '考研' }));
  expect(
    await screen.findByText('极限定义还不稳，建议先复习再做新题。')
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText('外刊表达积累有效，继续保持。')).not.toBeInTheDocument()
  );

  await userEvent.click(within(sidebar()).getByRole('button', { name: '全部项目' }));
  expect(
    await screen.findByText('外刊表达积累有效，继续保持。')
  ).toBeInTheDocument();
});
