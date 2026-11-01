// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { SchedulePage } from '../../src/renderer/shell/SchedulePage';
import { buildDailySchedule } from '../../src/renderer/shell/schedule';
import type {
  UpdateWorkspaceTaskInput,
  Workspace as Project,
  WorkspaceTask
} from '../../src/shared/workspace';
import { createMockApi } from '../../web/mock-api';

function setup() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

function nav() {
  return within(screen.getByRole('navigation', { name: '主导航' }));
}

function sidebar() {
  return screen.getAllByRole('complementary')[0]!;
}

const workspace: Project = {
  id: 'kaoyan',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '上岸',
  description: ''
};

function task(
  id: string,
  title: string,
  status: WorkspaceTask['status'],
  durationMin = 30
): WorkspaceTask {
  return {
    id,
    workspaceId: 'kaoyan',
    title,
    subject: '数学',
    durationMin,
    acceptance: '',
    status
  };
}

test('builds a deterministic timetable from open tasks', () => {
  const { entries, unscheduled } = buildDailySchedule(
    [
      task('later', '背单词', 'pending', 30),
      task('active', '做题', 'in-progress', 45),
      task('done', '已完成', 'done', 30)
    ],
    [workspace]
  );

  expect(entries.map((entry) => entry.title)).toEqual(['做题', '背单词']);
  expect(entries.map((entry) => entry.time)).toEqual(['08:00', '08:55']);
  expect(entries.every((entry) => entry.tag === '考研')).toBe(true);
  expect(unscheduled).toBe(0);

  const capped = buildDailySchedule(
    [task('a', 'A', 'pending'), task('b', 'B', 'pending'), task('c', 'C', 'pending')],
    [workspace],
    2
  );
  expect(capped.entries).toHaveLength(2);
  expect(capped.unscheduled).toBe(1);
});

test('pins tasks that have a start time and sorts the day by time', () => {
  const now = new Date(2026, 10, 1, 7, 0);
  const pinned = { ...task('pinned', '真题', 'pending', 60), startAt: '2026-11-01T14:00' };
  const loose = task('loose', '背单词', 'pending', 30);

  const { entries } = buildDailySchedule([pinned, loose], [workspace], 8, now);

  expect(entries.map((entry) => [entry.title, entry.time])).toEqual([
    ['背单词', '08:00'],
    ['真题', '14:00']
  ]);
  expect(entries[1]!.pinned).toBe(true);
  expect(entries[0]!.pinned).toBe(false);
});

test('auto-schedules open tasks around pinned blocks', () => {
  const now = new Date(2026, 10, 1, 7, 0);
  const pinned = { ...task('pinned', '真题', 'pending', 45), startAt: '2026-11-01T08:00' };
  const loose = task('loose', '背单词', 'pending', 30);

  const { entries } = buildDailySchedule([pinned, loose], [workspace], 8, now);

  expect(entries.map((entry) => [entry.title, entry.time])).toEqual([
    ['真题', '08:00'],
    ['背单词', '08:55']
  ]);
});

test('leaves tasks pinned to another day out of today', () => {
  const now = new Date(2026, 10, 1, 7, 0);
  const tomorrow = { ...task('tomorrow', '明天的真题', 'pending', 60), startAt: '2026-11-02T09:00' };
  const loose = task('loose', '背单词', 'pending', 30);

  const { entries, unscheduled } = buildDailySchedule([tomorrow, loose], [workspace], 8, now);

  expect(entries.map((entry) => entry.title)).toEqual(['背单词']);
  expect(unscheduled).toBe(0);
});

test('rolls overdue pinned tasks into today instead of dropping them', () => {
  const now = new Date(2026, 10, 1, 7, 0);
  const overdue = {
    ...task('overdue', '昨天的真题', 'pending', 30),
    startAt: '2026-10-31T09:00'
  };

  const { entries } = buildDailySchedule([overdue], [workspace], 8, now);

  expect(entries.map((entry) => [entry.title, entry.time, entry.pinned])).toEqual([
    ['昨天的真题', '08:00', false]
  ]);
});

test('keeps a completed pinned task visible for the day', () => {
  const now = new Date(2026, 10, 1, 20, 0);
  const done = { ...task('done', '已完成的真题', 'done', 60), startAt: '2026-11-01T09:00' };
  const looseDone = task('loose-done', '临时完成', 'done', 30);

  const { entries } = buildDailySchedule([done, looseDone], [workspace], 8, now);

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ title: '已完成的真题', status: 'done', pinned: true });
});

function renderSchedule(tasks: WorkspaceTask[], onUpdateTask = vi.fn()) {
  onUpdateTask.mockImplementation(async (input: UpdateWorkspaceTaskInput) => {
    const found = tasks.find((entry) => entry.id === input.taskId);
    return { ...(found as WorkspaceTask), ...input } as WorkspaceTask;
  });
  render(
    <SchedulePage
      today="2026-11-01"
      dateLabel="11月1日 星期日"
      tasks={tasks}
      workspaces={[workspace]}
      onOpenSidebar={vi.fn()}
      onOpenWorkspace={vi.fn()}
      onPrompt={vi.fn()}
      onUpdateTask={onUpdateTask}
    />
  );
  return onUpdateTask;
}

test('completes a task from the timetable', async () => {
  const onUpdateTask = renderSchedule([task('active', '做题', 'in-progress', 45)]);

  await userEvent.click(screen.getByRole('checkbox', { name: '完成任务：做题' }));

  expect(onUpdateTask).toHaveBeenCalledWith({
    taskId: 'active',
    status: 'done',
    startAt: '2026-11-01T08:00'
  });
});

test('unchecks a completed task from the timetable', async () => {
  const done = { ...task('done', '已完成的真题', 'done', 45), startAt: '2026-11-01T09:00' };
  const onUpdateTask = renderSchedule([done]);

  expect(screen.getByRole('checkbox', { name: '完成任务：已完成的真题' })).toBeChecked();
  await userEvent.click(screen.getByRole('checkbox', { name: '完成任务：已完成的真题' }));

  expect(onUpdateTask).toHaveBeenCalledWith({
    taskId: 'done',
    status: 'pending',
    startAt: '2026-11-01T09:00'
  });
});

test('drags a timetable block to a new time', async () => {
  const pinned = { ...task('pinned', '真题', 'pending', 45), startAt: '2026-11-01T08:00' };
  const onUpdateTask = renderSchedule([pinned]);

  const handle = screen.getByRole('button', { name: '调整「真题」的时间' });
  fireEvent.pointerDown(handle, { pointerId: 1, clientY: 100 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientY: 160 });
  fireEvent.pointerUp(handle, { pointerId: 1, clientY: 160 });

  expect(onUpdateTask).toHaveBeenCalledWith({
    taskId: 'pinned',
    startAt: '2026-11-01T09:00'
  });
});

test('adjusts a timetable block with the keyboard', async () => {
  const pinned = { ...task('pinned', '真题', 'pending', 45), startAt: '2026-11-01T08:00' };
  const onUpdateTask = renderSchedule([pinned]);

  const handle = screen.getByRole('button', { name: '调整「真题」的时间' });
  fireEvent.keyDown(handle, { key: 'ArrowDown' });

  expect(onUpdateTask).toHaveBeenCalledWith({
    taskId: 'pinned',
    startAt: '2026-11-01T08:15'
  });
});

test('shows the timetable on 今日安排 and keeps it out of 日常', async () => {
  setup();
  await screen.findByRole('heading', { name: '日常' });

  await userEvent.click(nav().getByRole('button', { name: '今日安排' }));
  expect(await screen.findByText('搭首页')).toBeInTheDocument();
  expect(screen.getByText('极限与连续')).toBeInTheDocument();
  expect(screen.getAllByText('08:00').length).toBeGreaterThan(0);

  await userEvent.click(nav().getByRole('button', { name: '日常' }));
  expect(await screen.findByRole('heading', { name: '日常' })).toBeInTheDocument();
  expect(screen.queryByText('今天的时间表')).not.toBeInTheDocument();
  expect(screen.queryByText('搭首页')).not.toBeInTheDocument();
});

test('lets the butler adjust the schedule in a daily conversation', async () => {
  setup();
  await screen.findByRole('heading', { name: '日常' });

  await userEvent.click(nav().getByRole('button', { name: '今日安排' }));
  await screen.findByText('搭首页');
  await userEvent.click(screen.getByRole('button', { name: '让阿咲调整' }));

  expect(
    (await screen.findAllByText(/我先按截止时间和精力排/, {}, { timeout: 3000 })).length
  ).toBeGreaterThan(0);
  expect(nav().getByRole('button', { name: '日常' })).toHaveAttribute(
    'aria-current',
    'page'
  );
  expect(
    within(sidebar()).getByRole('button', { name: /帮我调整今天的安排/ })
  ).toBeInTheDocument();
});

test('groups conversations under their workspace', async () => {
  setup();
  await screen.findByRole('heading', { name: '日常' });

  await userEvent.type(screen.getByLabelText('向阿咲提问'), '我想考研');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(/已(创建|找到)项目「考研」/, {}, { timeout: 3000 });

  const kaoyan = within(sidebar()).getByRole('button', { name: '考研' });
  await waitFor(() => expect(kaoyan).toHaveAttribute('aria-expanded', 'true'));
  const conversation = within(sidebar()).getByRole('button', { name: /我想考研/ });
  expect(conversation).toHaveAttribute('aria-current', 'page');
  expect(kaoyan).not.toHaveAttribute('aria-current');
  expect(nav().getByRole('button', { name: '日常' })).not.toHaveAttribute(
    'aria-current'
  );
});
