// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';
import { pickOption } from './select-option';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  return { api };
}

async function mount(api: ReturnType<typeof createMockApi>) {
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText(homeGreeting('xiaolai', new Date()));
}

function nav() {
  return within(screen.getByRole('navigation', { name: '主导航' }));
}

function sidebar() {
  return screen.getAllByRole('complementary')[0]!;
}

test('opens a knowledge topic from global search', async () => {
  const { api } = setup();
  await api.createKnowledgeTopic({ name: 'LangChain', workspaceId: 'project' });
  await mount(api);

  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  const input = await screen.findByLabelText('搜索全部内容');
  await userEvent.type(input, 'LangChain');
  await userEvent.click(await screen.findByRole('option', { name: /LangChain/ }));

  expect(await screen.findByLabelText('知识笔记')).toBeInTheDocument();
  expect(screen.queryByLabelText('搜索全部内容')).not.toBeInTheDocument();
});

test('switches across the top sections and marks the active one', async () => {
  const { api } = setup();
  await mount(api);

  const pages: Array<{ label: string; assert: () => Promise<unknown> }> = [
    {
      label: '今日安排',
      assert: async () =>
        expect((await screen.findAllByText('今天的时间表')).length).toBeGreaterThan(0)
    },
    {
      label: '长期计划',
      assert: async () =>
        expect(await screen.findByText('还没有长期计划。')).toBeInTheDocument()
    },
    {
      label: '知识库',
      assert: async () =>
        expect(await screen.findByText('还没有知识主题。')).toBeInTheDocument()
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

  await userEvent.click(nav().getByRole('button', { name: '日常' }));
  expect(nav().getByRole('button', { name: '日常' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(await screen.findByRole('heading', { name: '日常' })).toBeInTheDocument();
  expect(await screen.findByText(homeGreeting('xiaolai', new Date()))).toBeInTheDocument();
  expect(screen.getAllByRole('complementary')).toHaveLength(1);
});

test('the daily section has no trailing disclosure arrow', async () => {
  const { api } = setup();
  await mount(api);

  const daily = nav().getByRole('button', { name: '日常' });
  // Only the leading sun icon remains; the right-side chevron is gone.
  expect(daily.querySelectorAll('svg')).toHaveLength(1);
});

test('keeps the conversation and project when moving between sections', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.type(screen.getByLabelText('向阿咲提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(
    (await screen.findAllByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 })).length
  ).toBeGreaterThan(0);

  await userEvent.click(nav().getByRole('button', { name: '记忆' }));
  expect(
    await screen.findByText('极限定义还不稳，建议先复习再做新题。')
  ).toBeInTheDocument();
  expect(screen.getByText('外刊表达积累有效，继续保持。')).toBeInTheDocument();

  await userEvent.click(within(sidebar()).getByRole('button', { name: '考研' }));
  expect(
    (await screen.findAllByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 })).length
  ).toBeGreaterThan(0);
  expect(
    screen.getByRole('button', { name: '打开项目：考研' })
  ).toBeInTheDocument();
});

test('opens the projects page from the chat header project name', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.type(screen.getByLabelText('向阿咲提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findAllByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 });

  await userEvent.click(await screen.findByRole('button', { name: '打开项目：考研' }));

  expect(await screen.findByRole('heading', { name: '考研' })).toBeInTheDocument();
  expect(screen.getByText('2027 考研：数学一 / 英语一 / 政治')).toBeInTheDocument();
});

test('keeps a composer draft when switching sections', async () => {
  const { api } = setup();
  await mount(api);

  const composer = screen.getByLabelText('向阿咲提问');
  await userEvent.type(composer, '先记下这句话');
  await userEvent.click(nav().getByRole('button', { name: '今日安排' }));
  await screen.findAllByText('今天的时间表');
  await userEvent.click(nav().getByRole('button', { name: '日常' }));

  expect(screen.getByLabelText('向阿咲提问')).toHaveValue('先记下这句话');
});

test('starts a new conversation from the settings page', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  expect(await screen.findByLabelText('模型名称')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));

  expect(await screen.findByRole('heading', { name: '日常' })).toBeInTheDocument();
  expect(nav().getByRole('button', { name: '日常' })).toHaveAttribute(
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
  expect(nav().getByRole('button', { name: '日常' })).toHaveAttribute(
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

  await pickOption('按工作区筛选记忆', '考研');
  expect(
    await screen.findByText('极限定义还不稳，建议先复习再做新题。')
  ).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByText('外刊表达积累有效，继续保持。')).not.toBeInTheDocument()
  );

  await pickOption('按工作区筛选记忆', '全部工作区');
  expect(
    await screen.findByText('外刊表达积累有效，继续保持。')
  ).toBeInTheDocument();
});

test('expands and collapses a workspace folder with repeated clicks', async () => {
  const { api } = setup();
  await mount(api);

  const kaoyan = within(sidebar()).getByRole('button', { name: '考研' });
  const group = within(kaoyan.parentElement as HTMLElement);
  await userEvent.click(kaoyan);
  expect(kaoyan).toHaveAttribute('aria-expanded', 'true');
  expect(group.getByText('还没有对话。')).toBeInTheDocument();

  await userEvent.click(kaoyan);
  expect(kaoyan).toHaveAttribute('aria-expanded', 'false');
  expect(group.queryByText('还没有对话。')).not.toBeInTheDocument();
});

test('expands and collapses the daily conversation list with repeated clicks', async () => {
  const { api } = setup();
  await mount(api);

  const daily = nav().getByRole('button', { name: '日常' });
  expect(daily).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('还没有对话。')).toBeInTheDocument();

  await userEvent.click(daily);
  expect(daily).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('还没有对话。')).not.toBeInTheDocument();

  await userEvent.click(daily);
  expect(daily).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('还没有对话。')).toBeInTheDocument();
});

// jsdom has no matchMedia; the sidebar treats that as desktop so the existing
// tests keep the column interactive. These tests opt into a layout explicitly.
const originalMatchMedia = window.matchMedia;

function stubLayout(layout: 'narrow' | 'desktop') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: layout === 'desktop' ? query === '(min-width: 768px)' : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  });
}

afterEach(() => {
  if (originalMatchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: originalMatchMedia
    });
  } else {
    delete (window as { matchMedia?: unknown }).matchMedia;
  }
});

function navAside(): HTMLElement {
  const aside = document.querySelector<HTMLElement>('aside[aria-label="导航"]');
  if (!aside) throw new Error('导航侧栏不存在');
  return aside;
}

test('marks the closed narrow drawer inert and hidden from screen readers', async () => {
  stubLayout('narrow');
  const { api } = setup();
  await mount(api);

  const aside = navAside();
  expect(aside).toHaveAttribute('inert');
  expect(aside).toHaveAttribute('aria-hidden', 'true');

  await userEvent.click(screen.getByRole('button', { name: '打开导航' }));

  await waitFor(() => {
    expect(aside).not.toHaveAttribute('inert');
    expect(aside).not.toHaveAttribute('aria-hidden');
  });
});

test('Escape closes the narrow drawer and returns focus to the opener', async () => {
  stubLayout('narrow');
  const { api } = setup();
  await mount(api);

  const opener = screen.getByRole('button', { name: '打开导航' });
  await userEvent.click(opener);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '关闭导航' })).toHaveFocus()
  );

  await userEvent.keyboard('{Escape}');

  await waitFor(() => expect(navAside()).toHaveAttribute('aria-hidden', 'true'));
  expect(navAside()).toHaveAttribute('inert');
  expect(opener).toHaveFocus();
});

test('keeps the drawer interactive on desktop screens', async () => {
  stubLayout('desktop');
  const { api } = setup();
  await mount(api);

  const aside = navAside();
  expect(aside).not.toHaveAttribute('inert');
  expect(aside).not.toHaveAttribute('aria-hidden');

  // mobileOpen is false, but the md+ column must remain usable.
  await userEvent.click(nav().getByRole('button', { name: '记忆' }));
  expect(
    await screen.findByText('极限定义还不稳，建议先复习再做新题。')
  ).toBeInTheDocument();
});

test('warns before leaving settings with unsaved edits', async () => {
  const { api } = setup();
  await mount(api);

  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  const model = await screen.findByLabelText('模型名称');
  await userEvent.type(model, '-x');

  await userEvent.click(nav().getByRole('button', { name: '记忆' }));
  expect(await screen.findByText('设置尚未保存')).toBeInTheDocument();
  expect(screen.getByLabelText('模型名称')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByText('设置尚未保存')).not.toBeInTheDocument();
  expect(screen.getByLabelText('模型名称')).toBeInTheDocument();

  // Sidebar workspace switches and new drafts must also be guarded, not just
  // the page-level navigation buttons.
  await userEvent.click(screen.getByRole('button', { name: '考研' }));
  expect(await screen.findByText('设置尚未保存')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '取消' }));

  await userEvent.click(screen.getByRole('button', { name: '新对话' }));
  expect(await screen.findByText('设置尚未保存')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '取消' }));

  await userEvent.click(nav().getByRole('button', { name: '记忆' }));
  expect(await screen.findByText('设置尚未保存')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '放弃修改并离开' }));
  expect(
    await screen.findByText('极限定义还不稳，建议先复习再做新题。')
  ).toBeInTheDocument();
});

test('opens review and settings from app navigation events', async () => {  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  let navigate: ((target: 'review' | 'settings') => void) | null = null;
  api.onNavigate = (listener) => {
    navigate = listener;
    return () => {
      navigate = null;
    };
  };
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText(homeGreeting('xiaolai', new Date()));

  act(() => navigate?.('review'));
  expect(await screen.findByRole('button', { name: '补录复盘' })).toBeInTheDocument();

  act(() => navigate?.('settings'));
  expect(await screen.findByRole('button', { name: '保存设置' })).toBeInTheDocument();
});
