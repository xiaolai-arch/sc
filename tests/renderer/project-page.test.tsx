// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { sendPrompt } from './send-prompt';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { FOCUS_DURATION_MS } from '../../src/renderer/shell/focus-timer';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

function navButton(name: string) {
  return within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
    name
  });
}

async function openProjects() {
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
}

async function reopenProjects() {
  await userEvent.click(navButton('日常'));
  await openProjects();
}

async function taskStatus(api: ReturnType<typeof setup>, taskId: string) {
  const snapshot = await api.getWorkspaceSnapshot('kaoyan');
  return snapshot.tasks.find((task) => task.id === taskId)?.status;
}

test('runs start, complete, undo, skip and restore from the plan section', async () => {
  const api = setup();
  await openProjects();

  await userEvent.click(screen.getByRole('button', { name: '开始：极限与连续' }));
  expect(await screen.findByRole('button', { name: '完成：极限与连续' })).toBeInTheDocument();
  expect(await taskStatus(api, 'k1')).toBe('in-progress');

  await userEvent.click(screen.getByRole('button', { name: '完成：极限与连续' }));
  expect(await screen.findByRole('button', { name: '撤销：极限与连续' })).toBeInTheDocument();
  expect(await taskStatus(api, 'k1')).toBe('done');

  await userEvent.click(screen.getByRole('button', { name: '撤销：极限与连续' }));
  expect(await screen.findByRole('button', { name: '开始：极限与连续' })).toBeInTheDocument();
  expect(await taskStatus(api, 'k1')).toBe('pending');

  await userEvent.click(screen.getByRole('button', { name: '跳过：阅读理解' }));
  expect(await screen.findByRole('button', { name: '恢复：阅读理解' })).toBeInTheDocument();
  expect(await taskStatus(api, 'k2')).toBe('skipped');

  await userEvent.click(screen.getByRole('button', { name: '恢复：阅读理解' }));
  expect(await screen.findByRole('button', { name: '开始：阅读理解' })).toBeInTheDocument();
  expect(await taskStatus(api, 'k2')).toBe('pending');
});

test('shows an inline error when a task update fails', async () => {
  const api = setup();
  await openProjects();
  const spy = vi.spyOn(api, 'updateWorkspaceTask').mockRejectedValueOnce(new Error('保存失败'));

  await userEvent.click(screen.getByRole('button', { name: '开始：极限与连续' }));

  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '开始：极限与连续' })).toBeInTheDocument();
  spy.mockRestore();
});

test('starts, pauses, resumes and resets a focus session', async () => {
  setup();
  await openProjects();

  await userEvent.click(screen.getByRole('button', { name: '专注：极限与连续' }));
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.getByText(/2[45]:[0-5]\d/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '暂停' }));
  expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '继续' }));
  expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '重置' }));
  expect(screen.getByText('25:00')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '继续' })).toBeInTheDocument();
});

test('keeps the focus session while switching sections', async () => {
  setup();
  await openProjects();
  await userEvent.click(screen.getByRole('button', { name: '专注：极限与连续' }));

  await userEvent.click(navButton('记忆'));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

  await reopenProjects();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /暂停|继续/ })).toBeInTheDocument();
});

test('keeps the focus session after visiting the reminders page', async () => {
  setup();
  await openProjects();
  await userEvent.click(screen.getByRole('button', { name: '专注：极限与连续' }));
  expect(screen.getByRole('button', { name: '暂停' })).toBeInTheDocument();

  await userEvent.click(navButton('提醒'));
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

  await reopenProjects();
  expect(screen.getByRole('progressbar')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /暂停|继续/ })).toBeInTheDocument();
});

test('records 25 minutes exactly once when focus completes', async () => {
  vi.useFakeTimers();
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  const updateSpy = vi.spyOn(api, 'updateWorkspaceTask');

  await act(async () => {
    render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  });
  await act(async () => {});
  await act(async () => {
    screen.getByRole('button', { name: '全部工作区' }).click();
  });
  expect(screen.getByRole('button', { name: '专注：极限与连续' })).toBeInTheDocument();

  await act(async () => {
    screen.getByRole('button', { name: '专注：极限与连续' }).click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(FOCUS_DURATION_MS);
  });
  await act(async () => {});

  expect(screen.getByText('专注完成，已记录 25 分钟')).toBeInTheDocument();
  expect(updateSpy).toHaveBeenCalledTimes(1);
  expect(updateSpy).toHaveBeenCalledWith({
    taskId: 'k1',
    status: 'in-progress',
    actualMin: 25
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(5_000);
  });
  expect(updateSpy).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
});

test('writes a note from the records section', async () => {
  const api = setup();
  await openProjects();
  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');

  await userEvent.click(screen.getByRole('button', { name: '写一条记录' }));
  await userEvent.type(screen.getByLabelText('记录正文'), '今天数学卡在极限');
  await userEvent.click(screen.getByRole('button', { name: '保存记录' }));

  expect(await screen.findByText('今天数学卡在极限')).toBeInTheDocument();
  const snapshot = await api.getWorkspaceSnapshot('kaoyan');
  expect(snapshot.notes.some((note) => note.title === '今天数学卡在极限')).toBe(true);
});

test('deletes a note after a second confirmation click', async () => {
  const api = setup();
  await openProjects();
  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');

  await userEvent.click(screen.getByRole('button', { name: '写一条记录' }));
  await userEvent.type(screen.getByLabelText('记录正文'), '准备删除的记录');
  await userEvent.click(screen.getByRole('button', { name: '保存记录' }));

  await userEvent.click(await screen.findByRole('button', { name: '删除记录：准备删除的记录' }));
  // The first click only arms the confirmation.
  expect(
    (await api.getWorkspaceSnapshot('kaoyan')).notes.some(
      (note) => note.title === '准备删除的记录'
    )
  ).toBe(true);

  await userEvent.click(screen.getByRole('button', { name: '确认删除记录：准备删除的记录' }));

  await waitFor(async () => {
    expect(
      (await api.getWorkspaceSnapshot('kaoyan')).notes.some(
        (note) => note.title === '准备删除的记录'
      )
    ).toBe(false);
  });
  expect(screen.queryByText('准备删除的记录')).not.toBeInTheDocument();
});

test('disables the quick note form without a project', async () => {
  setup();
  await openProjects();

  expect(screen.getByRole('button', { name: '写一条记录' })).toBeDisabled();
  expect(screen.getByText('先选择项目')).toBeInTheDocument();
});

test('keeps the note input when saving fails', async () => {
  const api = setup();
  await openProjects();
  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');
  const spy = vi.spyOn(api, 'createNote').mockRejectedValueOnce(new Error('保存失败'));

  await userEvent.click(screen.getByRole('button', { name: '写一条记录' }));
  await userEvent.type(screen.getByLabelText('记录正文'), '别丢掉这段输入');
  await userEvent.click(screen.getByRole('button', { name: '保存记录' }));

  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  expect(screen.getByLabelText('记录正文')).toHaveValue('别丢掉这段输入');
  spy.mockRestore();
});

test('creates a reminder and toggles it off', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(navButton('提醒'));

  expect((screen.getByLabelText('提醒时间') as HTMLInputElement).value).toMatch(
    /^\d{2}:00$/
  );
  await userEvent.type(screen.getByLabelText('提醒内容'), '拉伸');
  await userEvent.click(screen.getByRole('button', { name: '添加提醒' }));

  expect(await screen.findByText('拉伸')).toBeInTheDocument();
  const created = (await api.getReminders()).find((reminder) => reminder.label === '拉伸');
  expect(created).toBeTruthy();

  const toggle = screen.getByRole('switch', { name: '拉伸 提醒开关' });
  expect(toggle).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(toggle);

  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '拉伸 提醒开关' })).toHaveAttribute(
      'aria-checked',
      'false'
    )
  );
  expect((await api.getReminders()).find((reminder) => reminder.label === '拉伸')?.enabled).toBe(
    false
  );
});

test('rolls the reminder switch back when saving fails', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await userEvent.click(navButton('提醒'));
  const spy = vi.spyOn(api, 'updateReminder').mockRejectedValueOnce(new Error('保存失败'));

  await userEvent.click(screen.getByRole('switch', { name: '早间计划 提醒开关' }));

  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: '早间计划 提醒开关' })).toHaveAttribute(
      'aria-checked',
      'true'
    )
  );
  spy.mockRestore();
});

test('routes a project prompt to the selected project, not the open chat', async () => {
  const api = setup();
  await screen.findByText('早上好，xiaolai。');
  await sendPrompt('帮我排一下今天的优先级');
  await screen.findAllByText(/我先按截止时间和精力排/);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: '停止生成' })).not.toBeInTheDocument()
  );

  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  await userEvent.selectOptions(screen.getByLabelText('切换项目'), 'kaoyan');
  await userEvent.click(screen.getByRole('button', { name: '让阿咲调整' }));

  await waitFor(async () => {
    const summaries = await api.listConversations();
    const conversations = await Promise.all(
      summaries.map((summary) => api.getConversation(summary.id))
    );
    const routed = conversations.find((conversation) =>
      conversation?.messages.some(
        (message) => message.text === '帮我调整一下今天的任务安排'
      )
    );
    expect(routed?.workspaceId).toBe('kaoyan');
  });
});
