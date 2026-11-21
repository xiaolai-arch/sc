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

test('the first-run dialog speaks to any goal, not only exams', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };

  render(<Workspace hasApiKey={false} needsOnboarding onRefresh={vi.fn()} />);

  expect(await screen.findByText('欢迎使用阿咲')).toBeInTheDocument();
  // The name placeholder lists goals beyond an exam.
  expect(screen.getByLabelText('项目名称')).toHaveAttribute(
    'placeholder',
    '例如：考研、学英语、读完一本书、坚持健身、推进一个项目'
  );
  expect(screen.getByText(/读完一本书、坚持健身、推进一个项目/)).toBeInTheDocument();
  // The four kinds stay available.
  await userEvent.click(screen.getByRole('combobox', { name: '类型' }));
  expect(
    (await screen.findAllByRole('option')).map((option) => option.textContent)
  ).toEqual(['学习', '考试', '项目', '生活']);
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
