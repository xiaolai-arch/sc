// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgePage } from '../../src/renderer/shell/KnowledgePage';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeTopic,
  UpdateKnowledgeTopicInput
} from '../../src/shared/knowledge';
import type { Workspace } from '../../src/shared/workspace';

const workspaces: Workspace[] = [
  {
    id: 'agent',
    name: 'agent 开发求职',
    kind: 'study',
    color: '#34c759',
    goal: '找到 Agent 方向的工作',
    description: ''
  },
  {
    id: 'english',
    name: '英语',
    kind: 'study',
    color: '#0071e3',
    goal: '过六级',
    description: ''
  }
];

const topics: KnowledgeTopic[] = [
  {
    id: 'kt-1',
    name: 'LangChain',
    aliases: ['LC'],
    status: 'mastered',
    level: 4,
    summary: '会搭 AgentExecutor',
    evidence: [
      {
        id: 'kev-1',
        kind: 'task',
        refId: 't1',
        title: '完成任务',
        date: '2026-11-01'
      }
    ],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  },
  {
    id: 'kt-2',
    name: 'RAG',
    aliases: [],
    status: 'learning',
    workspaceId: 'agent',
    summary: '',
    evidence: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
];

function renderPage(options: { topics?: KnowledgeTopic[] } = {}) {
  const onCreateTopic = vi.fn(async (input: CreateKnowledgeTopicInput) => ({
    id: 'kt-new',
    name: input.name,
    aliases: input.aliases ?? [],
    status: input.status ?? 'learning',
    summary: input.summary ?? '',
    evidence: [],
    createdAt: '',
    updatedAt: ''
  }));
  const onUpdateTopic = vi.fn(
    async (input: UpdateKnowledgeTopicInput) =>
      ({ ...topics[0]!, ...input }) as unknown as KnowledgeTopic
  );
  const onDeleteTopic = vi.fn(async () => undefined);
  render(
    <KnowledgePage
      topics={options.topics ?? topics}
      workspaces={workspaces}
      onOpenSidebar={vi.fn()}
      onCreateTopic={onCreateTopic}
      onUpdateTopic={onUpdateTopic}
      onDeleteTopic={onDeleteTopic}
    />
  );
  return { onCreateTopic, onUpdateTopic, onDeleteTopic };
}

test('lists topics, filters by workspace and keeps global topics', async () => {
  renderPage();
  expect(screen.getByText('LangChain')).toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('按工作区筛选知识主题'), 'english');
  expect(screen.getByText('LangChain')).toBeInTheDocument();
  expect(screen.queryByText('RAG')).not.toBeInTheDocument();
});

test('creates a global topic from the dialog', async () => {
  const { onCreateTopic } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: '新增主题' }));
  await userEvent.type(screen.getByLabelText('主题名称'), 'LangGraph');
  await userEvent.selectOptions(screen.getByLabelText('所属工作区'), '');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onCreateTopic).toHaveBeenCalledWith({ name: 'LangGraph' });
});

test('shows the evidence timeline when a topic is expanded', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: '展开 LangChain' }));
  expect(screen.getByText(/11\/1 · 完成任务/)).toBeInTheDocument();
});

test('edits a topic through the dialog', async () => {
  const { onUpdateTopic } = renderPage();
  await userEvent.click(screen.getByRole('button', { name: '编辑 LangChain' }));
  await userEvent.selectOptions(screen.getByLabelText('状态'), 'learning');
  await userEvent.clear(screen.getByLabelText('掌握程度'));
  await userEvent.type(screen.getByLabelText('掌握程度'), '5');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(onUpdateTopic).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'kt-1', status: 'learning', level: 5 })
  );
});

test('deletes a topic after confirmation', async () => {
  const { onDeleteTopic } = renderPage();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  await userEvent.click(screen.getByRole('button', { name: '删除 RAG' }));
  expect(confirm).toHaveBeenCalled();
  expect(onDeleteTopic).toHaveBeenCalledWith('kt-2');
  confirm.mockRestore();
});

test('searches topics by name and alias', async () => {
  renderPage();
  await userEvent.type(screen.getByLabelText('搜索知识主题'), 'LC');
  expect(screen.getByText('LangChain')).toBeInTheDocument();
  expect(screen.queryByText('RAG')).not.toBeInTheDocument();
});
