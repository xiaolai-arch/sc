// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  const originalStream = api.stream.bind(api);
  let calls = 0;
  api.stream = async (input, onEvent) => {
    calls += 1;
    if (calls === 1) throw new Error('网络断开');
    return originalStream(input, onEvent);
  };
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return { api, calls: () => calls };
}

test('retries the failed turn from the error banner instead of only refreshing', async () => {
  setup();

  const composer = await screen.findByLabelText('向阿咲提问');
  await userEvent.type(composer, '帮我排一下今天的优先级');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText(/网络断开/)).toBeInTheDocument();
  const retry = await screen.findByRole('button', { name: '重试发送' });
  await userEvent.click(retry);

  expect(
    (await screen.findAllByText(/我先按截止时间和精力排/)).length
  ).toBeGreaterThan(0);
  await waitFor(() =>
    expect(screen.queryByText(/网络断开/)).not.toBeInTheDocument()
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  );
});

test('keeps the draft when the message never reaches the conversation', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  api.createConversation = async () => {
    throw new Error('写入失败');
  };
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);

  const composer = await screen.findByLabelText('向阿咲提问');
  await userEvent.type(composer, '这句话不能丢');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  expect(await screen.findByText(/写入失败/)).toBeInTheDocument();
  expect(screen.getByLabelText('向阿咲提问')).toHaveValue('这句话不能丢');
});
