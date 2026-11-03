// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KnowledgeGraph } from '../../src/renderer/shell/KnowledgeGraph';
import { KnowledgePage } from '../../src/renderer/shell/KnowledgePage';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeBacklink,
  KnowledgeNote,
  KnowledgeStatus,
  KnowledgeTopic,
  SaveKnowledgeNoteInput,
  UpdateKnowledgeTopicInput
} from '../../src/shared/knowledge';
import { clearKnowledgeNoteDrafts } from '../../src/renderer/shell/useKnowledgeNote';
import type { Workspace } from '../../src/shared/workspace';

beforeEach(() => {
  clearKnowledgeNoteDrafts();
});

function makeTopic(
  id: string,
  name: string,
  status: KnowledgeStatus,
  level?: number
): KnowledgeTopic {
  return {
    id,
    name,
    aliases: [],
    status,
    ...(level === undefined ? {} : { level }),
    summary: '',
    evidence: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  };
}

const langChain = makeTopic('kt-a', 'LangChain', 'learning', 3);
const rag = makeTopic('kt-b', 'RAG', 'mastered');

const emptyBacklinks = new Map<string, KnowledgeBacklink[]>();

function graphGroup() {
  return within(screen.getByRole('group', { name: '图谱主题' }));
}

function nodeButtons() {
  return graphGroup().getAllByRole('button', { name: /^图谱主题：/ });
}

test('renders one accessible node per topic and no edges when unlinked', () => {
  const { container } = render(
    <KnowledgeGraph
      topics={[rag, langChain]}
      backlinks={emptyBacklinks}
      selectedId={null}
      onSelect={vi.fn()}
    />
  );

  expect(nodeButtons()).toHaveLength(2);
  expect(graphGroup().getByRole('button', { name: '图谱主题：LangChain' })).toBeInTheDocument();
  expect(graphGroup().getByRole('button', { name: '图谱主题：RAG' })).toBeInTheDocument();
  expect(container.querySelectorAll('[data-edge]')).toHaveLength(0);
});

test('marks the selected node and shows name plus level', () => {
  render(
    <KnowledgeGraph
      topics={[langChain, rag]}
      backlinks={emptyBacklinks}
      selectedId="kt-a"
      onSelect={vi.fn()}
    />
  );

  const node = graphGroup().getByRole('button', { name: '图谱主题：LangChain' });
  expect(node).toHaveAttribute('aria-pressed', 'true');
  expect(node).toHaveTextContent('LangChain');
  expect(node).toHaveTextContent('L3');
  expect(graphGroup().getByRole('button', { name: '图谱主题：RAG' })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
});

test('draws one deduplicated source→target edge per backlink', () => {
  // LangChain's note links to RAG, so the edge points LangChain → RAG.
  const backlinks = new Map<string, KnowledgeBacklink[]>([
    ['kt-b', [{ topicId: 'kt-a', name: 'LangChain' }]]
  ]);
  const { container } = render(
    <KnowledgeGraph
      topics={[langChain, rag]}
      backlinks={backlinks}
      selectedId={null}
      onSelect={vi.fn()}
    />
  );

  const edges = container.querySelectorAll('[data-edge]');
  expect(edges).toHaveLength(1);
  expect(edges[0]).toHaveAttribute('data-edge', 'kt-a->kt-b');
});

test('skips self-loops and duplicate backlinks', () => {
  const backlinks = new Map<string, KnowledgeBacklink[]>([
    [
      'kt-b',
      [
        { topicId: 'kt-a', name: 'LangChain' },
        { topicId: 'kt-a', name: 'LangChain' }
      ]
    ],
    ['kt-a', [{ topicId: 'kt-a', name: 'LangChain' }]]
  ]);
  const { container } = render(
    <KnowledgeGraph
      topics={[langChain, rag]}
      backlinks={backlinks}
      selectedId={null}
      onSelect={vi.fn()}
    />
  );

  expect(container.querySelectorAll('[data-edge]')).toHaveLength(1);
});

test('clicking a node selects that topic', async () => {
  const onSelect = vi.fn();
  render(
    <KnowledgeGraph
      topics={[langChain, rag]}
      backlinks={emptyBacklinks}
      selectedId={null}
      onSelect={onSelect}
    />
  );

  await userEvent.click(graphGroup().getByRole('button', { name: '图谱主题：RAG' }));

  expect(onSelect).toHaveBeenCalledWith('kt-b');
});

test('shows the empty state when there are no topics', () => {
  const onSelect = vi.fn();
  render(
    <KnowledgeGraph topics={[]} backlinks={emptyBacklinks} selectedId={null} onSelect={onSelect} />
  );

  expect(screen.getByText('还没有知识主题。')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: '图谱主题' })).not.toBeInTheDocument();
});

test('loads backlinks through the loader and draws the resulting edge', async () => {
  const getBacklinks = vi.fn(async (topicId: string) =>
    topicId === 'kt-b' ? [{ topicId: 'kt-a', name: 'LangChain' }] : []
  );
  const { container } = render(
    <KnowledgeGraph
      topics={[langChain, rag]}
      getBacklinks={getBacklinks}
      selectedId={null}
      onSelect={vi.fn()}
    />
  );

  await waitFor(() => expect(container.querySelectorAll('[data-edge]')).toHaveLength(1));
  expect(getBacklinks).toHaveBeenCalledWith('kt-a');
  expect(getBacklinks).toHaveBeenCalledWith('kt-b');
});

test('a backlink load failure keeps the nodes usable', async () => {
  const getBacklinks = vi.fn(async (topicId: string) => {
    if (topicId === 'kt-a') throw new Error('vault unavailable');
    return [];
  });
  render(
    <KnowledgeGraph
      topics={[langChain, rag]}
      getBacklinks={getBacklinks}
      selectedId={null}
      onSelect={vi.fn()}
    />
  );

  expect(await screen.findByText('图谱连线加载失败，仅显示主题。')).toBeInTheDocument();
  expect(nodeButtons()).toHaveLength(2);
});

const workspaces: Workspace[] = [];

function note(topicId: string, body: string): KnowledgeNote {
  return { topicId, body, updatedAt: '' };
}

function renderPage() {
  const getKnowledgeNote = vi.fn(async (topicId: string) => note(topicId, `note ${topicId}`));
  const saveKnowledgeNote = vi.fn(async (input: SaveKnowledgeNoteInput) =>
    note(input.topicId, input.body)
  );
  const getKnowledgeBacklinks = vi.fn(async () => []);
  const onCreateTopic = vi.fn(async (input: CreateKnowledgeTopicInput) => ({
    ...makeTopic('kt-new', input.name, input.status ?? 'learning'),
    aliases: input.aliases ?? [],
    summary: input.summary ?? ''
  }));
  const onUpdateTopic = vi.fn(
    async (input: UpdateKnowledgeTopicInput) =>
      ({ ...langChain, ...input }) as unknown as KnowledgeTopic
  );
  const onDeleteTopic = vi.fn(async () => undefined);

  render(
    <KnowledgePage
      topics={[langChain, rag]}
      workspaces={workspaces}
      onOpenSidebar={vi.fn()}
      onCreateTopic={onCreateTopic}
      onUpdateTopic={onUpdateTopic}
      onDeleteTopic={onDeleteTopic}
      getKnowledgeNote={getKnowledgeNote}
      saveKnowledgeNote={saveKnowledgeNote}
      getKnowledgeBacklinks={getKnowledgeBacklinks}
    />
  );

  return { getKnowledgeBacklinks };
}

test('the graph toggle swaps the note pane for the graph and node clicks select', async () => {
  renderPage();
  expect(await screen.findByRole('textbox', { name: '知识笔记' })).toBeInTheDocument();

  const graphToggle = screen.getByRole('button', { name: '图谱' });
  expect(graphToggle).toHaveAttribute('aria-pressed', 'false');
  await userEvent.click(graphToggle);

  expect(graphToggle).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('知识图谱')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: '知识笔记' })).not.toBeInTheDocument();

  const ragNode = screen.getByRole('button', { name: '图谱主题：RAG' });
  await userEvent.click(ragNode);

  // Selection updates in place: the graph stays open, the node is highlighted.
  expect(ragNode).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('知识图谱')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '笔记' }));
  expect(await screen.findByRole('heading', { name: 'RAG' })).toBeInTheDocument();
});
