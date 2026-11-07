// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendPrompt } from './send-prompt';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  const listeners = new Set<() => void>();
  api.onQuickCapture = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return {
    api,
    openCapture: () => {
      for (const listener of listeners) listener();
    }
  };
}

// Let any turn started by the test settle before the jsdom environment is torn
// down; otherwise its final state updates run without `window` and surface as
// an unhandled ReferenceError.
afterEach(async () => {
  await waitFor(
    () =>
      expect(
        screen.queryByRole('button', { name: '停止生成' })
      ).not.toBeInTheDocument(),
    { timeout: 3000 }
  );
});

test('opens the quick capture dialog from the app event', async () => {
  const { openCapture } = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));

  act(() => openCapture());

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByText('快速记录')).toBeInTheDocument();
  expect(screen.getByLabelText('快速记录内容')).toBeInTheDocument();
});

test('sends the captured text through the butler conversation', async () => {
  const { openCapture } = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));

  act(() => openCapture());
  await userEvent.type(screen.getByLabelText('快速记录内容'), '记一下：今天背了 50 个单词');
  await userEvent.click(screen.getByRole('button', { name: '发送给阿咲' }));

  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect((await screen.findAllByText('记一下：今天背了 50 个单词')).length).toBeGreaterThan(0);
});

test('disables sending empty captures', async () => {
  const { openCapture } = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));

  act(() => openCapture());

  expect(screen.getByRole('button', { name: '发送给阿咲' })).toBeDisabled();
  await userEvent.type(screen.getByLabelText('快速记录内容'), '   ');
  expect(screen.getByRole('button', { name: '发送给阿咲' })).toBeDisabled();
});

test('cancels without sending', async () => {
  const { openCapture } = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));

  act(() => openCapture());
  await userEvent.type(screen.getByLabelText('快速记录内容'), '不要发送这条');
  await userEvent.click(screen.getByRole('button', { name: '取消' }));

  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('不要发送这条')).not.toBeInTheDocument();
});

test('starts a new draft with Cmd+N', async () => {
  setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findAllByText(/我先按截止时间和精力排/);

  fireEvent.keyDown(window, { key: 'n', metaKey: true });

  expect(await screen.findByText(homeGreeting('xiaolai', new Date()))).toBeInTheDocument();
});

test('does not start a draft from Cmd+N inside the composer', async () => {
  setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findAllByText(/我先按截止时间和精力排/);

  const composer = screen.getByLabelText('向阿咲提问');
  composer.focus();
  fireEvent.keyDown(composer, { key: 'n', metaKey: true });

  expect(screen.queryByText(homeGreeting('xiaolai', new Date()))).not.toBeInTheDocument();
  expect(screen.getAllByText(/我先按截止时间和精力排/).length).toBeGreaterThan(0);
});

test('ignores Cmd+N while the quick capture dialog is open', async () => {
  const { openCapture } = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findAllByText(/我先按截止时间和精力排/);

  act(() => openCapture());
  fireEvent.keyDown(window, { key: 'n', metaKey: true });

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByText(homeGreeting('xiaolai', new Date()))).not.toBeInTheDocument();
});
