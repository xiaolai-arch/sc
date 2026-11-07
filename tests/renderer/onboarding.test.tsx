// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

test('creates the first workspace without requiring a model', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };

  render(<Workspace hasApiKey={false} needsOnboarding onRefresh={vi.fn()} />);

  expect(await screen.findByText('欢迎使用阿咲')).toBeInTheDocument();
  const name = screen.getByLabelText('项目名称');
  await userEvent.clear(name);
  await userEvent.type(name, '我的项目');
  await userEvent.click(screen.getByRole('button', { name: '创建项目并开始' }));

  await waitFor(() =>
    expect(screen.queryByText('欢迎使用阿咲')).not.toBeInTheDocument()
  );
  expect((await screen.findAllByText('我的项目')).length).toBeGreaterThan(0);
});

test('locks the first-run controls while the workspace is being created', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  api.completeWorkspaceOnboarding = vi.fn(() => new Promise(() => undefined)) as never;
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };

  render(<Workspace hasApiKey={false} needsOnboarding onRefresh={vi.fn()} />);

  expect(await screen.findByText('欢迎使用阿咲')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '创建项目并开始' }));

  expect(screen.getByLabelText('项目名称')).toBeDisabled();
  expect(screen.getByLabelText('类型')).toBeDisabled();
  expect(screen.getByLabelText('目标')).toBeDisabled();
  expect(screen.getByRole('button', { name: '稍后再说' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '正在创建…' })).toBeDisabled();
});
