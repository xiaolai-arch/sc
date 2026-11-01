// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { buildDailySchedule } from '../../src/renderer/shell/schedule';
import type { Workspace as Project, WorkspaceTask } from '../../src/shared/workspace';
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
