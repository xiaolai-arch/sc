// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkspaceOnboarding } from '../../src/renderer/onboarding/WorkspaceOnboarding';

test('creates a general workspace', async () => {
  const complete = vi.fn().mockResolvedValue(undefined);
  const onComplete = vi.fn();
  window.studyCoach = { completeWorkspaceOnboarding: complete } as never;

  render(<WorkspaceOnboarding onComplete={onComplete} />);
  await userEvent.clear(screen.getByLabelText('Workspace 名称'));
  await userEvent.type(screen.getByLabelText('Workspace 名称'), '英语');
  await userEvent.selectOptions(screen.getByLabelText('类型'), 'project');
  await userEvent.type(screen.getByLabelText('你想先达成什么？'), '本月上线个人网站');
  await userEvent.click(screen.getByRole('button', { name: '开始使用' }));

  expect(complete).toHaveBeenCalledWith({
    name: '英语',
    kind: 'project',
    goal: '本月上线个人网站',
    description: ''
  });
  expect(onComplete).toHaveBeenCalled();
});

test('starts with the example workspaces', async () => {
  const complete = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { completeWorkspaceOnboarding: complete } as never;

  render(<WorkspaceOnboarding />);
  await userEvent.click(screen.getByRole('button', { name: '先看看示例工作区' }));

  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ useDemo: true }));
});
