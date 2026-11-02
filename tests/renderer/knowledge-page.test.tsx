// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgePage } from '../../src/renderer/shell/KnowledgePage';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeNote,
  KnowledgeTopic,
  UpdateKnowledgeTopicInput
} from '../../src/shared/knowledge';
import type { Workspace } from '../../src/shared/workspace';
import { clearKnowledgeNoteDrafts } from '../../src/renderer/shell/useKnowledgeNote';

beforeEach(() => {
  clearKnowledgeNoteDrafts();
});

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

const langChain: KnowledgeTopic = {
  id: 'kt-1',
  name: 'LangChain',
  aliases: ['LC'],
  status: 'mastered',
  level: 4,
  summary: '会搭 AgentExecutor',
  evidence: [
    { id: 'kev-1', kind: 'task', refId: 't1', title: '完成任务', date: '2026-11-01' }
  ],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
};

const rag: KnowledgeTopic = {
  id: 'kt-2',
  name: 'RAG',
  aliases: [],
  status: 'learning',
  workspaceId: 'agent',
  summary: '',
  evidence: [],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
};

const topics: KnowledgeTopic[] = [langChain, rag];

function note(topicId: string, body: string): KnowledgeNote {
  return { topicId, body, updatedAt: '' };
}

type RenderOptions = {
  topics?: KnowledgeTopic[];
  body?: (topicId: string) => string;
};

function renderPage(options: RenderOptions = {}) {
  const getKnowledgeNote = vi.fn(async (topicId: string) =>
    note(topicId, options.body ? options.body(topicId) : `note ${topicId}`)
  );
  const saveKnowledgeNote = vi.fn(
    async (input: { topicId: string; body: string }) => note(input.topicId, input.body)
  );
  const getKnowledgeBacklinks = vi.fn(async () => []);
  const onUpdateTopic = vi.fn(
    async (input: UpdateKnowledgeTopicInput) =>
      ({ ...langChain, ...input }) as unknown as KnowledgeTopic
  );
  const onDeleteTopic = vi.fn(async (_topicId: string) => undefined);

  let onCreateTopic = vi.fn(async (input: CreateKnowledgeTopicInput) => ({
    id: 'kt-new',
    name: input.name,
    aliases: input.aliases ?? [],
    status: input.status ?? 'learning',
    summary: input.summary ?? '',
    evidence: [],
    createdAt: '',
    updatedAt: ''
  }));

  const initialTopics = options.topics ?? topics;

  function Harness() {
    const [list, setList] = useState(initialTopics);
    onCreateTopic = vi.fn(async (input: CreateKnowledgeTopicInput) => {
      const created = {
        id: 'kt-new',
        name: input.name,
        aliases: input.aliases ?? [],
        status: input.status ?? ('learning' as const),
        summary: input.summary ?? '',
        evidence: [],
        createdAt: '',
        updatedAt: ''
      };
      setList((current) => [created, ...current]);
      return created;
    });
    const deleteTopic = async (topicId: string) => {
      await onDeleteTopic(topicId);
      setList((current) => current.filter((topic) => topic.id !== topicId));
    };
    return (
      <KnowledgePage
        topics={list}
        workspaces={workspaces}
        onOpenSidebar={vi.fn()}
        onCreateTopic={onCreateTopic}
        onUpdateTopic={onUpdateTopic}
        onDeleteTopic={deleteTopic}
        getKnowledgeNote={getKnowledgeNote}
        saveKnowledgeNote={saveKnowledgeNote}
        getKnowledgeBacklinks={getKnowledgeBacklinks}
      />
    );
  }

  render(<Harness />);
  return {
    onCreateTopic: () => onCreateTopic,
    onUpdateTopic,
    onDeleteTopic,
    getKnowledgeNote,
    saveKnowledgeNote,
    getKnowledgeBacklinks
  };
}

function directory() {
  return within(screen.getByLabelText('知识目录'));
}

test('groups topics by workspace with the global group last', async () => {
  renderPage();
  await screen.findByRole('textbox', { name: '知识笔记' });

  expect(directory().getByText('agent 开发求职')).toBeInTheDocument();
  const labels = directory()
    .getAllByText(/^(agent 开发求职|全局)$/)
    .map((node) => node.textContent);
  expect(labels).toEqual(['agent 开发求职', '全局']);
});

test('search filters the directory but keeps the selected topic visible', async () => {
  renderPage();
  expect(await screen.findByRole('textbox', { name: '知识笔记' })).toHaveValue('note kt-1');

  await userEvent.type(screen.getByLabelText('搜索知识主题'), 'RAG');

  expect(directory().getByRole('button', { name: 'RAG' })).toBeInTheDocument();
  expect(directory().queryByRole('button', { name: 'LangChain' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'LangChain' })).toBeInTheDocument();
});

test('selects the first topic and renders its note', async () => {
  renderPage();

  expect(await screen.findByRole('textbox', { name: '知识笔记' })).toHaveValue('note kt-1');
  expect(screen.getByRole('heading', { name: 'LangChain' })).toBeInTheDocument();
});

test('clicking a wiki link clears the search and selects the target', async () => {
  renderPage({
    body: (topicId) => (topicId === 'kt-1' ? '[[RAG]]' : 'RAG 笔记')
  });
  await screen.findByRole('textbox', { name: '知识笔记' });
  await userEvent.type(screen.getByLabelText('搜索知识主题'), 'Lang');

  await userEvent.click(screen.getByRole('button', { name: '预览' }));
  await userEvent.click(screen.getByRole('button', { name: '打开知识主题 RAG' }));

  expect(screen.getByLabelText('搜索知识主题')).toHaveValue('');
  expect(await screen.findByRole('heading', { name: 'RAG' })).toBeInTheDocument();
});

test('creates a topic and selects it', async () => {
  renderPage();
  await screen.findByRole('textbox', { name: '知识笔记' });

  await userEvent.click(screen.getByRole('button', { name: '新增主题' }));
  await userEvent.type(screen.getByLabelText('主题名称'), 'LangGraph');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(await screen.findByRole('heading', { name: 'LangGraph' })).toBeInTheDocument();
});

test('edits a topic through the dialog', async () => {
  const { onUpdateTopic } = renderPage();
  await screen.findByRole('textbox', { name: '知识笔记' });

  await userEvent.click(screen.getByRole('button', { name: '编辑 LangChain' }));
  await userEvent.selectOptions(screen.getByLabelText('状态'), 'learning');
  await userEvent.clear(screen.getByLabelText('掌握程度'));
  await userEvent.type(screen.getByLabelText('掌握程度'), '5');
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  expect(onUpdateTopic).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'kt-1', status: 'learning', level: 5 })
  );
});

test('deletes a topic after confirmation and selects the next one', async () => {
  const { onDeleteTopic } = renderPage();
  await screen.findByRole('textbox', { name: '知识笔记' });
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);

  await userEvent.click(screen.getByRole('button', { name: '删除 LangChain' }));

  expect(confirm).toHaveBeenCalled();
  expect(onDeleteTopic).toHaveBeenCalledWith('kt-1');
  expect(await screen.findByRole('heading', { name: 'RAG' })).toBeInTheDocument();
  confirm.mockRestore();
});

test('shows 没有匹配的主题 when the search matches nothing', async () => {
  renderPage();
  await screen.findByRole('textbox', { name: '知识笔记' });

  await userEvent.type(screen.getByLabelText('搜索知识主题'), 'zzz');

  expect(directory().getByText('没有匹配的主题。')).toBeInTheDocument();
});

test('selects the first topic when the selected one disappears externally', async () => {
  const getKnowledgeNote = vi.fn(async (topicId: string) => note(topicId, `note ${topicId}`));
  const saveKnowledgeNote = vi.fn(async (input: { topicId: string; body: string }) =>
    note(input.topicId, input.body)
  );
  const getKnowledgeBacklinks = vi.fn(async () => []);

  function ExternalRemoval() {
    const [list, setList] = useState([langChain, rag]);
    return (
      <>
        <button type="button" onClick={() => setList([rag])}>
          外部移除
        </button>
        <KnowledgePage
          topics={list}
          workspaces={workspaces}
          onOpenSidebar={vi.fn()}
          onCreateTopic={vi.fn(async () => rag)}
          onUpdateTopic={vi.fn(async () => rag)}
          onDeleteTopic={vi.fn(async () => undefined)}
          getKnowledgeNote={getKnowledgeNote}
          saveKnowledgeNote={saveKnowledgeNote}
          getKnowledgeBacklinks={getKnowledgeBacklinks}
        />
      </>
    );
  }

  render(<ExternalRemoval />);
  expect(await screen.findByRole('textbox', { name: '知识笔记' })).toHaveValue('note kt-1');

  await userEvent.click(screen.getByRole('button', { name: '外部移除' }));

  expect(await screen.findByRole('heading', { name: 'RAG' })).toBeInTheDocument();
});
