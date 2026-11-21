// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
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

const task: WorkspaceTask = {
  id: 't1',
  workspaceId: 'ws-exam',
  title: '极限基础',
  subject: '数学',
  durationMin: 45,
  acceptance: '完成 10 题',
  status: 'pending'
};

function renderOverview(tasks: WorkspaceTask[]) {
  return render(
    <TodayOverview
      tasks={tasks}
      workspaces={[workspace]}
      reminders={[]}
      longPlans={[]}
      today="2026-11-08"
      compact
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
}

test('renders the if-then plan sentence for a cued task', () => {
  renderOverview([{ ...task, cue: '晚饭后' }]);

  expect(screen.getByText('如果 晚饭后，就先做「极限基础」')).toBeInTheDocument();
});

test('renders nothing extra for a task without a cue', () => {
  renderOverview([task]);

  const row = screen.getByText('极限基础').closest('li');
  expect(row).not.toBeNull();
  expect(within(row as HTMLElement).queryByText(/如果/)).not.toBeInTheDocument();
});