// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

function panel(): HTMLElement {
  return screen.getAllByRole('complementary')[1]!;
}

test('opens and closes the conversation drawer on narrow screens', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  expect(sidebar().className).toContain('-translate-x-full');
  const open = screen.getByRole('button', { name: '打开对话列表' });
  expect(open).toHaveAttribute('aria-expanded', 'false');

  await userEvent.click(open);
  expect(sidebar().className).toContain('translate-x-0');
  expect(screen.getByRole('button', { name: '打开对话列表' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );

  const closers = screen.getAllByRole('button', { name: '关闭对话列表' });
  expect(closers.length).toBeGreaterThanOrEqual(2);
  await userEvent.click(closers[0]!);
  expect(sidebar().className).toContain('-translate-x-full');
});

test('closes the conversation drawer from its close button', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  await userEvent.click(screen.getByRole('button', { name: '打开对话列表' }));
  const closers = screen.getAllByRole('button', { name: '关闭对话列表' });
  await userEvent.click(closers[closers.length - 1]!);

  expect(sidebar().className).toContain('-translate-x-full');
});

test('closes the conversation drawer after selecting a conversation', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '帮我排一下今天的优先级' }));
  await screen.findAllByText(/我先按截止时间和精力排/);

  await userEvent.click(screen.getByRole('button', { name: '打开对话列表' }));
  await userEvent.click(
    within(sidebar()).getByRole('button', { name: /帮我排一下今天的优先级/ })
  );

  expect(sidebar().className).toContain('-translate-x-full');
});

test('opens and closes the project drawer on narrow screens', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');
  expect(screen.getAllByRole('complementary')).toHaveLength(1);

  await userEvent.click(screen.getByRole('button', { name: '打开项目面板' }));
  await waitFor(() => expect(screen.getAllByRole('complementary')).toHaveLength(2));
  expect(panel().className).toContain('translate-x-0');

  const closers = screen.getAllByRole('button', { name: '关闭项目面板' });
  expect(closers.length).toBeGreaterThanOrEqual(2);
  await userEvent.click(closers[0]!);
  await waitFor(() => expect(screen.getAllByRole('complementary')).toHaveLength(1));

  await userEvent.click(screen.getByRole('button', { name: '打开项目面板' }));
  await waitFor(() => expect(screen.getAllByRole('complementary')).toHaveLength(2));
  const panelClosers = screen.getAllByRole('button', { name: '关闭项目面板' });
  await userEvent.click(panelClosers[panelClosers.length - 1]!);
  await waitFor(() => expect(screen.getAllByRole('complementary')).toHaveLength(1));
});

test('opens the conversation drawer with the keyboard', async () => {
  setup();
  await screen.findByText('早上好，xiaolai。');

  const open = screen.getByRole('button', { name: '打开对话列表' });
  open.focus();
  await userEvent.keyboard('{Enter}');

  expect(sidebar().className).toContain('translate-x-0');
});

test('keeps the desktop three-column layout classes', async () => {
  setup(1024);
  await screen.findByText('早上好，xiaolai。');

  const aside = sidebar();
  expect(aside.className).toContain('md:w-[220px]');
  expect(aside.className).toContain('md:static');
  expect(aside.className).toContain('md:translate-x-0');

  const complements = screen.getAllByRole('complementary');
  expect(complements).toHaveLength(2);
  expect(complements[1]!.className).toContain('md:w-[300px]');
  expect(complements[1]!.className).toContain('md:static');
  expect(complements[1]!.className).toContain('md:translate-x-0');

  expect(screen.getByRole('button', { name: '打开对话列表' }).className).toContain(
    'md:hidden'
  );
});
