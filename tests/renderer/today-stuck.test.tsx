// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TodayOverview } from '../../src/renderer/shell/TodayOverview';
import type { Workspace, WorkspaceTask } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: ''
};

const TODAY = '2026-11-21';

const TASKS: WorkspaceTask[] = [
  {
    id: 't1',
    workspaceId: 'ws-exam',
    title: '极限基础',
    subject: '数学',
    durationMin: 45,
    acceptance: '完成 10 题',
    status: 'in-progress',
    startAt: `${TODAY}T09:00`
  },
  {
    id: 't2',
    workspaceId: 'ws-exam',
    title: '阅读理解',
    subject: '英语',
    durationMin: 30,
    acceptance: '精读 1 篇',
    status: 'pending'
  }
];

function renderOverview(overrides: Partial<Parameters<typeof TodayOverview>[0]> = {}) {
  const onPrompt = vi.fn();
  const utils = render(
    <TodayOverview
      tasks={TASKS}
      workspaces={[workspace]}
      reminders={[]}
      longPlans={[]}
      today={TODAY}
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={onPrompt}
      {...overrides}
    />
  );
  return { onPrompt, ...utils };
}

// The same component renders both surfaces: the 今日 page (page frame) and the
// chat home's compact card. Both must send the exact same string, so the butler
// receives the task the user is stuck on either way.
describe.each([
  ['the today page', {}],
  ['the compact chat-home card', { compact: true }]
])('%s', (_label, overrides) => {
  test('the task row carries a quiet 我卡住了 action', () => {
    renderOverview(overrides);

    const buttons = screen.getAllByRole('button', { name: /^我卡住了：/ });
    expect(buttons).toHaveLength(TASKS.length);
    expect(buttons.map((button) => button.textContent)).toEqual(['我卡住了', '我卡住了']);
  });

  test('it sends exactly 我卡住了：「task title」 for that row', async () => {
    const { onPrompt } = renderOverview(overrides);

    await userEvent.click(screen.getByRole('button', { name: '我卡住了：阅读理解' }));
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith('我卡住了：「阅读理解」');

    await userEvent.click(screen.getByRole('button', { name: '我卡住了：极限基础' }));
    expect(onPrompt).toHaveBeenCalledTimes(2);
    expect(onPrompt).toHaveBeenLastCalledWith('我卡住了：「极限基础」');
  });
});

test('a task row without a done state still offers the action; done tasks are not listed', () => {
  renderOverview({ tasks: [] });

  expect(screen.queryByRole('button', { name: /我卡住了/ })).not.toBeInTheDocument();
});
