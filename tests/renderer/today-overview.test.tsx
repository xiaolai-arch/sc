// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { TodayOverview } from '../../src/renderer/shell/TodayOverview';
import { buildDailySchedule } from '../../src/renderer/shell/schedule';
import { formatLocalDate } from '../../src/shared/date';
import { DAILY_WORKSPACE_ID } from '../../src/shared/conversations';
import type { Workspace as WorkspaceRecord, WorkspaceTask } from '../../src/shared/workspace';
import { createMockApi } from '../../web/mock-api';
import { TODAY_CARD_BASELINE } from './fixtures/today-card-baseline';

/** Exactly the tasks the pinned baseline fixture was captured with. */
const BASELINE_TASKS: WorkspaceTask[] = [
  {
    id: 't1',
    workspaceId: 'ws-exam',
    title: '极限基础',
    subject: '数学',
    durationMin: 45,
    acceptance: '完成 10 题',
    status: 'in-progress',
    startAt: '2026-11-21T09:00'
  },
  {
    id: 't2',
    workspaceId: 'ws-exam',
    title: '阅读理解',
    subject: '英语',
    durationMin: 30,
    acceptance: '精读 1 篇',
    status: 'pending',
    startAt: '2026-11-21T10:30'
  },
  {
    id: 't3',
    workspaceId: 'ws-exam',
    title: '408 数据结构',
    subject: '专业课',
    durationMin: 60,
    acceptance: '完成第一章框架',
    status: 'pending'
  }
];

const BASELINE_WORKSPACE: WorkspaceRecord = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: ''
};

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

test('今日只做一件 off renders the 接下来 card byte-identical to before it existed', () => {
  localStorage.clear();
  // No oneThingStore, so the mode is not even offered; the card must be the
  // pinned markup from before 今日只做一件 was added, character for character.
  const { container } = render(
    <TodayOverview
      tasks={BASELINE_TASKS}
      workspaces={[BASELINE_WORKSPACE]}
      reminders={[]}
      longPlans={[]}
      today="2026-11-21"
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={vi.fn()}
    />
  );

  expect(container.querySelector('section[aria-label="接下来"]')?.outerHTML).toBe(
    TODAY_CARD_BASELINE
  );
});

test('the home screen answers what is next and what reminds you', async () => {
  setup();

  expect(await screen.findByRole('region', { name: '接下来' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '最近提醒' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: '目标进度' })).toBeInTheDocument();
  expect(
    within(screen.getByRole('region', { name: '接下来' })).getAllByRole('checkbox').length
  ).toBeGreaterThan(0);
  expect(
    within(screen.getByRole('region', { name: '目标进度' })).getByText(
      /还没有进行中的长期目标|%/
    )
  ).toBeInTheDocument();
});

test('the sidebar groups entries without hiding any old page', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  for (const label of ['阿咲', '目标与计划', '记录与提醒']) {
    expect(nav().getByText(label)).toBeInTheDocument();
  }
  for (const label of [
    '今日',
    '日常',
    '知识库',
    '我的资料',
    '今日安排',
    '长期计划',
    '复盘',
    '记忆',
    '提醒'
  ]) {
    expect(nav().getByRole('button', { name: label })).toBeInTheDocument();
  }
});

test('the Today page opens with the four regions and the one-line input', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  expect(
    await screen.findByText('不用先想清楚全部，只需要知道现在最值得做的一件事。')
  ).toBeInTheDocument();
  for (const label of ['接下来', '今日时间表', '最近提醒', '目标进度']) {
    expect(screen.getByRole('region', { name: label })).toBeInTheDocument();
  }
  expect(screen.getByLabelText('问阿咲今天怎么安排')).toBeInTheDocument();
});

test('the one-line input never steals focus on mount', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  const input = screen.getByLabelText('问阿咲今天怎么安排');
  expect(input).toBeInTheDocument();
  expect(input).not.toHaveFocus();
});

test('the embedded timetable shows exactly what buildDailySchedule produces', async () => {
  const api = setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  const region = within(screen.getByRole('region', { name: '今日时间表' }));

  const workspaces = await api.listWorkspaces();
  const snapshots = await Promise.all(
    workspaces.map((workspace) => api.getWorkspaceSnapshot(workspace.id))
  );
  const tasks = snapshots.flatMap((snapshot) => snapshot.tasks);
  const expected = buildDailySchedule(
    tasks,
    workspaces,
    8,
    new Date(`${formatLocalDate(new Date())}T00:00:00`)
  );
  expect(expected.entries.length).toBeGreaterThan(0);

  for (const entry of expected.entries) {
    const row = region.getByText(entry.title).closest('li');
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText(entry.time)).toBeInTheDocument();
    expect(within(row as HTMLElement).getByText(entry.detail)).toBeInTheDocument();
  }
  const times = region.getAllByText(/^\d{2}:\d{2}$/).map((node) => node.textContent);
  expect(times).toEqual(expected.entries.map((entry) => entry.time));
});

test('the timetable link opens the full 今日安排 page', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  await userEvent.click(
    within(screen.getByRole('region', { name: '今日时间表' })).getByRole('button', {
      name: '今日安排'
    })
  );
  expect(await screen.findByText('今天的时间表')).toBeInTheDocument();
});

test('submitting the one-line input sends one message into the daily conversation', async () => {
  const api = setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  const append = vi.spyOn(api, 'appendConversationMessage');
  const stream = vi.spyOn(api, 'stream');

  await userEvent.type(screen.getByLabelText('问阿咲今天怎么安排'), '今天怎么安排？');
  await userEvent.click(screen.getByRole('button', { name: '发送' }));

  // Exactly one user message goes through the chat send path.
  await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
  expect(append).toHaveBeenCalledTimes(1);
  const [conversationId, message] = append.mock.calls[0]!;
  expect(message.role).toBe('user');
  expect(message.text).toBe('今天怎么安排？');
  expect((await api.getConversation(conversationId))?.workspaceId).toBe(DAILY_WORKSPACE_ID);

  // The question lands as a normal message in the daily conversation on screen.
  expect((await screen.findAllByText('今天怎么安排？')).length).toBeGreaterThan(0);
  expect(nav().getByRole('button', { name: '日常' })).toHaveAttribute('aria-current', 'page');
  await screen.findByText(/我先按截止时间和精力排/, {}, { timeout: 3000 });
});

test('the suggestion composes into the input instead of firing', async () => {
  const api = setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  const append = vi.spyOn(api, 'appendConversationMessage');

  await userEvent.click(screen.getByRole('button', { name: '今天最重要的三件事' }));
  const input = screen.getByLabelText('问阿咲今天怎么安排');
  expect(input).toHaveValue('帮我看今天最重要的三件事，并给出具体下一步。');
  expect(append).not.toHaveBeenCalled();

  // Submitting the composed suggestion sends it like any typed question.
  await userEvent.type(input, '{Enter}');
  await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
  const [, message] = append.mock.calls[0]!;
  expect(message.text).toBe('帮我看今天最重要的三件事，并给出具体下一步。');
  await screen.findByText(/收到。目前是原型模式/, {}, { timeout: 3000 });
});

test('shows a postponed reminder at its new time and hides completed ones today', async () => {
  const api = setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(nav().getByRole('button', { name: '提醒' }));
  await userEvent.type(screen.getByLabelText('提醒内容'), '喝水');
  await userEvent.click(screen.getByRole('button', { name: '添加提醒' }));
  expect(await screen.findByRole('switch', { name: '喝水 提醒开关' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '延后 10 分钟：喝水' }));
  const reminderRow = () =>
    within(screen.getByRole('switch', { name: '喝水 提醒开关' }).closest('div') as HTMLElement);
  await waitFor(() => expect(reminderRow().getByText(/已延后 · \d{2}:\d{2}/)).toBeInTheDocument());

  const postponed = (await api.getReminders()).find((entry) => entry.label === '喝水');
  const postponedTime = postponed!.postponedTo!.slice(11, 16);

  // 今日 lists the reminder at the time it will actually fire.
  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  const upcoming = within(await screen.findByRole('region', { name: '最近提醒' }));
  const upcomingItem = upcoming.getByText('喝水').closest('li') as HTMLElement;
  expect(within(upcomingItem).getByText(postponedTime)).toBeInTheDocument();

  // A completed reminder is no longer "upcoming".
  await userEvent.click(nav().getByRole('button', { name: '提醒' }));
  await userEvent.click(screen.getByRole('button', { name: '标为完成：喝水' }));
  await waitFor(() => expect(reminderRow().getByText('已完成')).toBeInTheDocument());

  await userEvent.click(nav().getByRole('button', { name: '今日' }));
  const afterDone = within(await screen.findByRole('region', { name: '最近提醒' }));
  expect(afterDone.queryByText('喝水')).not.toBeInTheDocument();
});

test('settings expose the four groups', async () => {
  setup();
  await screen.findByRole('region', { name: '接下来' });

  await userEvent.click(screen.getByRole('button', { name: '打开设置' }));
  const groups = await screen.findByRole('navigation', { name: '设置分组' });
  for (const label of ['本机 AI', '提醒与后台', '个人与外观', '数据与备份']) {
    expect(within(groups).getByRole('button', { name: label })).toBeInTheDocument();
  }
});
