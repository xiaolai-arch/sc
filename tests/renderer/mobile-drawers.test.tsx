// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendPrompt } from './send-prompt';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

const DEFAULT_WIDTH = window.innerWidth;

function setup(width = 500) {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

afterEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: DEFAULT_WIDTH });
});

function sidebar(): HTMLElement {
  return screen.getAllByRole('complementary')[0]!;
}

test('opens and closes the navigation drawer on narrow screens', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  expect(sidebar().className).toContain('-translate-x-full');
  const open = screen.getByRole('button', { name: '打开导航' });
  expect(open).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(open);
  expect(sidebar().className).toContain('translate-x-0');
  expect(screen.getByRole('button', { name: '打开导航' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  const closers = screen.getAllByRole('button', { name: '关闭导航' });
  expect(closers.length).toBeGreaterThanOrEqual(2);
  await userEvent.click(closers[0]!);
  expect(sidebar().className).toContain('-translate-x-full');
});

test('closes the navigation drawer from its close button', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '打开导航' }));
  const closers = screen.getAllByRole('button', { name: '关闭导航' });
  await userEvent.click(closers[closers.length - 1]!);

  expect(sidebar().className).toContain('-translate-x-full');
});

test('closes the navigation drawer after selecting a conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '打开导航' }));
  await userEvent.click(
    within(sidebar()).getByRole('button', { name: /帮我排一下今天的优先级/ })
  );

  expect(sidebar().className).toContain('-translate-x-full');
});

test('closes the drawer when switching sections', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '打开导航' }));
  await userEvent.click(within(sidebar()).getByRole('button', { name: '记忆' }));

  expect(sidebar().className).toContain('-translate-x-full');
  expect(screen.getByText('外刊表达积累有效，继续保持。')).toBeInTheDocument();

  // Other pages have their own menu button that reopens the same drawer.
  await userEvent.click(screen.getByRole('button', { name: '打开导航' }));
  expect(sidebar().className).toContain('translate-x-0');
  await userEvent.click(within(sidebar()).getByRole('button', { name: '复盘' }));
  expect(sidebar().className).toContain('-translate-x-full');
  expect(screen.getByText('还没有复盘记录。')).toBeInTheDocument();
});

test('opens the navigation drawer with the keyboard', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  const open = screen.getByRole('button', { name: '打开导航' });
  open.focus();
  await userEvent.keyboard('{Enter}');

  expect(sidebar().className).toContain('translate-x-0');
});

test('keeps the desktop single-column layout classes', async () => {
  setup(1024);
  await screen.findByText('早上好，xiaolai。');

  const aside = sidebar();
  expect(aside.className).toContain('md:w-[var(--sidebar-width)]');
  expect(aside.className).toContain('md:relative');
  expect(aside.className).toContain('md:translate-x-0');
  expect(aside.style.getPropertyValue('--sidebar-width')).toBe('280px');

  // Only one column exists now: there is no right-side project panel.
  expect(screen.getAllByRole('complementary')).toHaveLength(1);
  expect(screen.queryByRole('button', { name: '打开项目面板' })).not.toBeInTheDocument();

  expect(screen.getByRole('button', { name: '打开导航' }).className).toContain('md:hidden');
  for (const label of ['今日安排', '日常', '记忆', '复盘', '提醒']) {
    expect(within(aside).getByRole('button', { name: label })).toBeInTheDocument();
  }
  expect(within(aside).getByRole('button', { name: '打开设置' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByText(/早上好，xiaolai。/).closest('[class*="max-w-"]')?.className).toContain(
      'max-w-[680px]'
    )
  );
});

test('resizes the sidebar with keyboard and clamps to the dsh range', async () => {
  setup(1024);
  await screen.findByText('早上好，xiaolai。');
  const aside = sidebar();
  const handle = screen.getByRole('separator', { name: '调整导航栏宽度' });

  expect(handle).toHaveAttribute('aria-valuemin', '264');
  expect(handle).toHaveAttribute('aria-valuemax', '420');

  handle.focus();
  await userEvent.keyboard('{End}');
  expect(aside.style.getPropertyValue('--sidebar-width')).toBe('420px');
  expect(handle).toHaveAttribute('aria-valuenow', '420');

  await userEvent.keyboard('{Home}');
  expect(aside.style.getPropertyValue('--sidebar-width')).toBe('264px');

  await userEvent.keyboard('{ArrowRight}');
  expect(aside.style.getPropertyValue('--sidebar-width')).toBe('280px');
  expect(localStorage.getItem('asaki:sidebar-width')).toBe('280');
});
