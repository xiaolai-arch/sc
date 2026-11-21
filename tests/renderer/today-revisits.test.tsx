// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  dueRevisitTopics,
  TodayOverview
} from '../../src/renderer/shell/TodayOverview';
import type { KnowledgeTopic } from '../../src/shared/knowledge';
import type { Workspace } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: ''
};

function knowledgeTopic(
  overrides: Partial<KnowledgeTopic> & Pick<KnowledgeTopic, 'id' | 'name'>
): KnowledgeTopic {
  return {
    aliases: [],
    status: 'learning',
    summary: '',
    evidence: [],
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

function renderOverview(revisits: Parameters<typeof TodayOverview>[0]['revisits']) {
  const onPrompt = vi.fn();
  render(
    <TodayOverview
      tasks={[]}
      workspaces={[workspace]}
      reminders={[]}
      longPlans={[]}
      today="2026-11-21"
      revisits={revisits}
      compact
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={onPrompt}
    />
  );
  return { onPrompt };
}

test('a due topic gets one revisit line and the quiz button targets it', async () => {
  const { onPrompt } = renderOverview([{ topicId: 'kt-1', name: 'LangChain' }]);

  expect(
    screen.getByText('今天是「LangChain」的回访日：让阿咲抽 3 道？')
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '抽 3 道复习「LangChain」' }));
  expect(onPrompt).toHaveBeenCalledTimes(1);
  expect(onPrompt).toHaveBeenCalledWith('考考我「LangChain」，出 3 道题');
});

test('no due topics means no revisit line', () => {
  renderOverview([]);

  expect(screen.queryByText(/回访日/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /抽 3 道/ })).not.toBeInTheDocument();
});

test('dueRevisitTopics keeps due and overdue topics, drops the rest', () => {
  const topics = [
    knowledgeTopic({ id: 'kt-future', name: '级数', revisitDue: '2026-11-25' }),
    knowledgeTopic({ id: 'kt-overdue', name: '积分', revisitDue: '2026-11-19' }),
    knowledgeTopic({ id: 'kt-due', name: '极限', revisitDue: '2026-11-21' }),
    knowledgeTopic({ id: 'kt-none', name: '向量' })
  ];

  expect(dueRevisitTopics(topics, '2026-11-21')).toEqual([
    { topicId: 'kt-overdue', name: '积分' },
    { topicId: 'kt-due', name: '极限' }
  ]);
  expect(dueRevisitTopics([], '2026-11-21')).toEqual([]);
});
