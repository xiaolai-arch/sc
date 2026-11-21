// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { homeGreeting } from '../../src/shared/greeting';
import userEvent from '@testing-library/user-event';
import { LongPlanPage } from '../../src/renderer/shell/LongPlanPage';
import { TodayOverview, countdownWorkspace } from '../../src/renderer/shell/TodayOverview';
import { Workspace } from '../../src/renderer/shell/Workspace';
import type { LongPlan } from '../../src/shared/plans';
import type { Workspace as WorkspaceRecord } from '../../src/shared/workspace';
import { createMockApi } from '../../web/mock-api';
import { pickOption } from './select-option';

const TODAY = '2026-11-21';

const exam: WorkspaceRecord = {
  id: 'kaoyan',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: '',
  targetDate: '2027-12-19'
};

const english: WorkspaceRecord = {
  id: 'english',
  name: '英语',
  kind: 'study',
  color: '#34c759',
  goal: '口语',
  description: ''
};

function renderToday(workspaces: WorkspaceRecord[], today = TODAY) {
  render(
    <TodayOverview
      tasks={[]}
      workspaces={workspaces}
      reminders={[]}
      longPlans={[]}
      today={today}
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
}

test('the Today page shows the countdown with whole days computed from today', () => {
  renderToday([exam, english]);

  const line = screen.getByRole('status', { name: '目标倒计时' });
  // 2026-11-21 → 2027-12-19 is 393 whole days.
  expect(line).toHaveTextContent('距离目标 2027-12-19 还有 393 天');
  // One deadline competes for nothing, so no project name is appended.
  expect(line.textContent).toBe('距离目标 2027-12-19 还有 393 天');
});

test('the countdown recomputes from the real today instead of being cached', () => {
  renderToday([exam], '2026-11-22');
  expect(screen.getByRole('status', { name: '目标倒计时' })).toHaveTextContent(
    '距离目标 2027-12-19 还有 392 天'
  );
});

test('a passed target date reads 目标日已过, never a negative count', () => {
  renderToday([{ ...exam, targetDate: '2026-11-20' }]);
  const line = screen.getByRole('status', { name: '目标倒计时' });
  expect(line).toHaveTextContent('目标日已过');
  expect(line.textContent).not.toMatch(/-\d+/);
});

test('no countdown renders when no project has a target date', () => {
  renderToday([english]);
  expect(screen.queryByRole('status', { name: '目标倒计时' })).not.toBeInTheDocument();
});

test('the compact chat-home card does not repeat the countdown', () => {
  render(
    <TodayOverview
      compact
      tasks={[]}
      workspaces={[exam]}
      reminders={[]}
      longPlans={[]}
      today={TODAY}
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
  expect(screen.queryByRole('status', { name: '目标倒计时' })).not.toBeInTheDocument();
});

test('a project without a date cannot win the line over a dated one', () => {
  expect(countdownWorkspace([english, exam], TODAY)?.id).toBe('kaoyan');
  expect(countdownWorkspace([english], TODAY)).toBeNull();
});

test('the soonest upcoming deadline wins, and a passed one is named when alone', () => {
  const sooner = { ...exam, id: 'late', name: '期末', targetDate: '2027-02-01' };
  // 2027-02-01 is 72 whole days out, sooner than 2027-12-19.
  expect(countdownWorkspace([exam, sooner], TODAY)?.id).toBe('late');
  // Several dated projects: the line names the one it counts to.
  renderToday([exam, sooner]);
  expect(screen.getByRole('status', { name: '目标倒计时' })).toHaveTextContent(
    '距离目标 2027-02-01 还有 72 天（期末）'
  );
  expect(
    countdownWorkspace([{ ...exam, targetDate: '2026-11-01' }], TODAY)?.id
  ).toBe('kaoyan');
});

const plan: LongPlan = {
  id: 'lp-1',
  workspaceId: 'kaoyan',
  goal: '学会数学一',
  startDate: '2026-11-02',
  weeks: 2,
  weeklyHours: 10,
  generatedBy: 'agent',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phases: []
};

function renderPlanPage(workspaces: WorkspaceRecord[], today = TODAY) {
  render(
    <LongPlanPage
      plans={[plan]}
      workspaces={workspaces}
      today={today}
      onOpenSidebar={vi.fn()}
      onCreatePlan={vi.fn()}
      onSetItemDone={vi.fn()}
    />
  );
}

test('the long-plan header shows the countdown next to the weekly hours', () => {
  renderPlanPage([exam]);

  const detail = screen.getByRole('region', { name: '计划详情' });
  expect(within(detail).getByText(/每周约\s*10 小时/)).toHaveTextContent(
    '每周约 10 小时 · 距离目标 2027-12-19 还有 393 天'
  );
  expect(within(detail).getByTestId('plan-countdown')).toHaveTextContent(
    '· 距离目标 2027-12-19 还有 393 天'
  );
});

test('the long-plan header omits the countdown without a target date', () => {
  renderPlanPage([english]);

  const detail = screen.getByRole('region', { name: '计划详情' });
  expect(within(detail).getByText(/每周约\s*10 小时/)).not.toHaveTextContent('距离目标');
  expect(within(detail).queryByTestId('plan-countdown')).not.toBeInTheDocument();
});

test('the countdown follows a passed target date on the plan page too', () => {
  renderPlanPage([{ ...exam, targetDate: '2026-11-01' }]);
  expect(screen.getByTestId('plan-countdown')).toHaveTextContent('目标日已过');
});

function setupApp() {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  return api;
}

test('the project settings date input sets and clears the target date', async () => {
  // Freeze the clock so the countdown the page renders has a known N.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 21, 10, 0, 0));
  try {
    const api = setupApp();
    await screen.findByText(homeGreeting('xiaolai', new Date(2026, 10, 21, 10, 0, 0)), {}, {
      timeout: 4000
    });
    await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
    await pickOption('切换项目', '考研');

    const input = await screen.findByLabelText('目标日期');
    expect(input).toHaveValue('');

    // jsdom fires change for a date input's value like any other input.
    await userEvent.type(input, '2027-12-19');
    await vi.waitFor(async () => {
      const workspace = (await api.listWorkspaces()).find((entry) => entry.id === 'kaoyan');
      expect(workspace?.targetDate).toBe('2027-12-19');
    });
    expect(input).toHaveValue('2027-12-19');

    // 今日 now counts down to the freshly saved date, from the frozen today.
    await userEvent.click(
      within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
        name: '今日'
      })
    );
    expect(await screen.findByRole('status', { name: '目标倒计时' })).toHaveTextContent(
      '距离目标 2027-12-19 还有 393 天'
    );

    await userEvent.click(
      within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
        name: '日常'
      })
    );
    await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
    await pickOption('切换项目', '考研');
    await userEvent.click(await screen.findByRole('button', { name: '清除' }));
    await vi.waitFor(async () => {
      const workspace = (await api.listWorkspaces()).find((entry) => entry.id === 'kaoyan');
      expect(workspace?.targetDate).toBeUndefined();
    });
    expect(screen.getByLabelText('目标日期')).toHaveValue('');
    await userEvent.click(
      within(screen.getByRole('navigation', { name: '主导航' })).getByRole('button', {
        name: '今日'
      })
    );
    expect(screen.queryByRole('status', { name: '目标倒计时' })).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
