// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';
import { pickOption } from './select-option';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

async function openProjectTasks() {
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  await pickOption('切换项目', '考研');
}

function navButton(name: string) {
  return within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
    name
  });
}

test('creates, edits and deletes a task from the plan section', async () => {
  const api = setup();
  await openProjectTasks();

  await userEvent.click(screen.getByRole('button', { name: '新增任务' }));
  await userEvent.type(screen.getByLabelText('新任务标题'), '线性代数专题');
  await userEvent.clear(screen.getByLabelText('新任务时长'));
  await userEvent.type(screen.getByLabelText('新任务时长'), '45');
  await userEvent.click(screen.getByRole('button', { name: '保存任务' }));

  expect(await screen.findByText('线性代数专题')).toBeInTheDocument();
  let snapshot = await api.getWorkspaceSnapshot('kaoyan');
  const created = snapshot.tasks.find((task) => task.title === '线性代数专题');
  expect(created).toMatchObject({ durationMin: 45, status: 'pending' });

  await userEvent.click(
    screen.getByRole('button', { name: '编辑任务：线性代数专题' })
  );
  const titleInput = screen.getByLabelText('编辑任务标题');
  await userEvent.clear(titleInput);
  await userEvent.type(titleInput, '线性代数复盘');
  await userEvent.click(screen.getByRole('button', { name: '保存修改' }));

  expect(await screen.findByText('线性代数复盘')).toBeInTheDocument();
  snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.tasks.some((task) => task.title === '线性代数复盘')).toBe(true);

  await userEvent.click(
    screen.getByRole('button', { name: '删除任务：线性代数复盘' })
  );
  await userEvent.click(
    screen.getByRole('button', { name: '确认删除任务：线性代数复盘' })
  );

  await waitFor(() =>
    expect(screen.queryByText('线性代数复盘')).not.toBeInTheDocument()
  );
  snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.tasks.some((task) => task.title === '线性代数复盘')).toBe(false);
});

test('creates a daily task whose next occurrence appears after completion', async () => {
  const api = setup();
  await openProjectTasks();

  await userEvent.click(screen.getByRole('button', { name: '新增任务' }));
  await userEvent.type(screen.getByLabelText('新任务标题'), '每日背单词');
  await pickOption('新任务重复', '每天');
  await userEvent.click(screen.getByRole('button', { name: '保存任务' }));

  expect(await screen.findByText('每日背单词')).toBeInTheDocument();
  let snapshot = await api.getWorkspaceSnapshot('kaoyan');
  const created = snapshot.tasks.find((task) => task.title === '每日背单词');
  expect(created).toMatchObject({ repeat: 'daily', status: 'pending' });

  await userEvent.click(screen.getByRole('button', { name: '开始：每日背单词' }));
  await userEvent.click(await screen.findByRole('button', { name: '完成：每日背单词' }));

  expect(await screen.findAllByText('每日背单词')).toHaveLength(2);
  snapshot = await api.getWorkspaceSnapshot('kaoyan');
  const occurrences = snapshot.tasks.filter((task) => task.title === '每日背单词');
  expect(occurrences.map((task) => task.status).sort()).toEqual(['done', 'pending']);
  expect(occurrences.find((task) => task.status === 'pending')).toMatchObject({
    repeat: 'daily',
    recurredFrom: created?.id
  });
});

test('edits the project name, goal and description', async () => {
  const api = setup();
  await openProjectTasks();

  await userEvent.click(screen.getByRole('button', { name: '编辑项目' }));
  const nameInput = screen.getByLabelText('项目名称');
  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, '数学强化');
  const goalInput = screen.getByLabelText('项目目标');
  await userEvent.clear(goalInput);
  await userEvent.type(goalInput, '数学一 130+');
  const descriptionInput = screen.getByLabelText('项目描述');
  await userEvent.clear(descriptionInput);
  await userEvent.type(descriptionInput, '每天两小时');
  await userEvent.click(screen.getByRole('button', { name: '保存项目' }));

  expect(await screen.findByRole('heading', { name: '数学强化' })).toBeInTheDocument();
  const workspace = (await api.listWorkspaces()).find((entry) => entry.id === 'kaoyan');
  expect(workspace).toMatchObject({
    name: '数学强化',
    goal: '数学一 130+',
    description: '每天两小时'
  });
});

test('drops an open project edit when switching projects', async () => {
  const api = setup();
  await openProjectTasks();

  await userEvent.click(screen.getByRole('button', { name: '编辑项目' }));
  const nameInput = screen.getByLabelText('项目名称');
  await userEvent.clear(nameInput);
  await userEvent.type(nameInput, '改到一半的考研');

  await pickOption('切换项目', '英语');
  expect(await screen.findByRole('heading', { name: '英语' })).toBeInTheDocument();
  expect(screen.queryByLabelText('项目名称')).not.toBeInTheDocument();

  // Reopening starts from the project that is now selected, and saving it
  // cannot write the abandoned 考研 draft into 英语.
  await userEvent.click(screen.getByRole('button', { name: '编辑项目' }));
  expect(screen.getByLabelText('项目名称')).toHaveValue('英语');
  await userEvent.click(screen.getByRole('button', { name: '保存项目' }));

  const workspaces = await api.listWorkspaces();
  expect(workspaces.find((entry) => entry.id === 'kaoyan')?.name).toBe('考研');
  expect(workspaces.find((entry) => entry.id === 'english')?.name).toBe('英语');
});

test('deletes a project after confirmation', async () => {
  const api = setup();
  await openProjectTasks();

  await userEvent.click(screen.getByRole('button', { name: '编辑项目' }));
  await userEvent.click(screen.getByRole('button', { name: '删除项目' }));
  await userEvent.click(screen.getByRole('button', { name: '确认删除项目' }));

  await waitFor(async () =>
    expect((await api.listWorkspaces()).some((entry) => entry.id === 'kaoyan')).toBe(false)
  );
  expect(await screen.findByRole('heading', { name: '全部项目' })).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole('option', { name: '考研' })).not.toBeInTheDocument()
  );
});

test('creates a repeating reminder, edits it and deletes it', async () => {
  const api = setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(navButton('提醒'));

  await userEvent.type(screen.getByLabelText('提醒内容'), '跑步');
  await pickOption('提醒重复', '周末');
  await userEvent.click(screen.getByRole('button', { name: '添加提醒' }));

  expect(await screen.findByText('跑步')).toBeInTheDocument();
  expect(screen.getByText('周末', { selector: 'span' })).toBeInTheDocument();
  let reminders = await api.getReminders();
  expect(reminders.find((item) => item.label === '跑步')?.days).toEqual([0, 6]);

  await userEvent.click(screen.getByRole('button', { name: '编辑提醒：跑步' }));
  const labelInput = screen.getByLabelText('编辑提醒内容');
  await userEvent.clear(labelInput);
  await userEvent.type(labelInput, '晨跑');
  await pickOption('编辑提醒重复', '工作日');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(await screen.findByText('晨跑')).toBeInTheDocument();
  expect(screen.getByText('工作日', { selector: 'span' })).toBeInTheDocument();
  reminders = await api.getReminders();
  expect(reminders.find((item) => item.label === '晨跑')?.days).toEqual([1, 2, 3, 4, 5]);

  await userEvent.click(screen.getByRole('button', { name: '删除提醒：晨跑' }));
  await userEvent.click(screen.getByRole('button', { name: '确认删除提醒：晨跑' }));

  await waitFor(() => expect(screen.queryByText('晨跑')).not.toBeInTheDocument());
  reminders = await api.getReminders();
  expect(reminders.some((item) => item.label === '晨跑')).toBe(false);
});
