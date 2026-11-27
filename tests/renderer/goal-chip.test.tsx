// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { PlanSection } from '../../src/renderer/shell/ProjectSections';
import type { Workspace, WorkspaceTask } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'ws-agent',
  name: '学习 Agent',
  kind: 'study',
  color: '#34c759',
  goalId: 'g-agent',
  goal: '转行做 Agent',
  description: ''
};

function task(overrides: Partial<WorkspaceTask>): WorkspaceTask {
  return {
    id: 't1',
    workspaceId: 'ws-agent',
    title: '读第一本书',
    subject: '学习 Agent',
    durationMin: 30,
    acceptance: '',
    status: 'pending',
    ...overrides
  };
}

function renderPlan(tasks: WorkspaceTask[]) {
  render(
    <PlanSection
      workspace={workspace}
      tasks={tasks}
      onUpdateTask={vi.fn()}
      onPrompt={vi.fn()}
      focus={null}
      focusNotice={null}
      focusRestore={null}
      canStartFocus={false}
      onStartFocus={vi.fn()}
      onStartDefaultFocus={vi.fn()}
      onPauseFocus={vi.fn()}
      onResumeFocus={vi.fn()}
      onResetFocus={vi.fn()}
      onAcceptFocusRestore={vi.fn()}
      onDismissFocusRestore={vi.fn()}
      onAbandonFocus={vi.fn()}
    />
  );
}

test('a task that serves this project goal shows the goal chip', () => {
  renderPlan([task({ goalId: 'g-agent', planId: 'lp-1', planItemId: 'w1d1' })]);
  expect(screen.getByLabelText('任务目标：转行做 Agent')).toBeInTheDocument();
});

test('a task without a goal shows no chip, and neither does one pointing elsewhere', () => {
  renderPlan([task({ id: 't1' }), task({ id: 't2', title: '别的目标下的任务', goalId: 'g-other' })]);
  expect(screen.queryByLabelText(/任务目标：/)).not.toBeInTheDocument();
});
