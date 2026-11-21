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

test('the first-run dialog says no system needs building and data stays local', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.01 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };

  render(<Workspace hasApiKey={false} needsOnboarding onRefresh={vi.fn()} />);

  expect(await screen.findByText('欢迎使用阿咲')).toBeInTheDocument();
  expect(
    screen.getByText('不用先搭任何系统——创建项目就能用，所有数据都是本地的 Markdown 文件。')
  ).toBeInTheDocument();

  // The rest of the dialog is unchanged: intro, goal-neutral placeholder,
  // default goal, model note and both actions.
  expect(screen.getByText(/先建一个项目，之后可以让阿咲在对话里拆目标/)).toBeInTheDocument();
  expect(
    screen.getByText('没有配置模型也可以先创建项目；模型可以在设置里稍后配置。')
  ).toBeInTheDocument();
  expect(screen.getByLabelText('项目名称')).toHaveAttribute(
    'placeholder',
    '例如：考研、学英语、读完一本书、坚持健身、推进一个项目'
  );
  expect(screen.getByLabelText('目标')).toHaveValue('先完成今天最重要的一件事');
  expect(screen.getByRole('button', { name: '稍后再说' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '创建项目并开始' })).toBeInTheDocument();
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
