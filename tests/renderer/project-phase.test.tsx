// @vitest-environment jsdom
import { homeGreeting } from '../../src/shared/greeting';
import { render, screen, waitFor } from '@testing-library/react';
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

async function openExamProject() {
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '全部项目' }));
  await pickOption('切换项目', '考研');
}

test('the project card sets, shows and clears the exam stage (验收 24)', async () => {
  const api = setup();
  await openExamProject();

  const picker = await screen.findByLabelText('备考阶段');
  expect(picker).toHaveTextContent('未设置');
  // No stage yet: no tag on the card.
  expect(screen.queryByTestId('workspace-phase-tag')).not.toBeInTheDocument();

  await pickOption('备考阶段', '基础');
  await waitFor(async () => {
    const workspace = (await api.listWorkspaces()).find((entry) => entry.id === 'kaoyan');
    expect(workspace?.phase).toBe('基础');
  });
  expect(await screen.findByTestId('workspace-phase-tag')).toHaveTextContent('基础阶段');
  expect(screen.getByLabelText('备考阶段')).toHaveTextContent('基础');

  // Switching stages updates the tag; clearing drops it again.
  await pickOption('备考阶段', '强化');
  await waitFor(async () => {
    const workspace = (await api.listWorkspaces()).find((entry) => entry.id === 'kaoyan');
    expect(workspace?.phase).toBe('强化');
  });
  expect(screen.getByTestId('workspace-phase-tag')).toHaveTextContent('强化阶段');

  await pickOption('备考阶段', '未设置');
  await waitFor(async () => {
    const workspace = (await api.listWorkspaces()).find((entry) => entry.id === 'kaoyan');
    expect(workspace?.phase).toBeUndefined();
  });
  expect(screen.queryByTestId('workspace-phase-tag')).not.toBeInTheDocument();
});

test('a non-exam project has no stage picker (验收 24 negative)', async () => {
  setup();
  await screen.findByText(homeGreeting('xiaolai', new Date()));
  await userEvent.click(screen.getByRole('button', { name: '全部项目' }));
  // The demo vault's 英语 project is a study project.
  await pickOption('切换项目', '英语');

  expect(await screen.findByLabelText('参与检查')).toBeInTheDocument();
  expect(screen.queryByLabelText('备考阶段')).not.toBeInTheDocument();
  expect(screen.queryByTestId('workspace-phase-tag')).not.toBeInTheDocument();
});
