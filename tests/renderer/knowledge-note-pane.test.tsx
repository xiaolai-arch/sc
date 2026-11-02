// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { KnowledgeNote, KnowledgeTopic } from '../../src/shared/knowledge';
import { KnowledgeNotePane } from '../../src/renderer/shell/KnowledgeNotePane';

function topic(overrides: Partial<KnowledgeTopic> & Pick<KnowledgeTopic, 'id' | 'name'>): KnowledgeTopic {
  return {
    aliases: [],
    status: 'learning',
    summary: '',
    evidence: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  };
}

const langGraph = topic({
  id: 'kt-2',
  name: 'LangGraph',
  level: 3,
  summary: '状态图',
  evidence: [
    { id: 'e1', kind: 'task', title: '状态图练习', date: '2026-11-01' },
    { id: 'e2', kind: 'review', title: '复盘', date: '2026-10-28' }
  ]
});
const langChain = topic({ id: 'kt-1', name: 'LangChain', status: 'mastered' });

function note(topicId: string, body: string): KnowledgeNote {
  return { topicId, body, updatedAt: '' };
}

function setup(options: {
  getNote?: (topicId: string) => Promise<KnowledgeNote>;
  saveNote?: (input: { topicId: string; body: string }) => Promise<KnowledgeNote>;
  getBacklinks?: (topicId: string) => Promise<{ topicId: string; name: string }[]>;
} = {}) {
  const getNote = vi.fn(options.getNote ?? (async () => note('kt-2', '# LangGraph\n\n正文')));
  const saveNote = vi.fn(
    options.saveNote ??
      (async (input: { topicId: string; body: string }) => note(input.topicId, input.body))
  );
  const getBacklinks = vi.fn(
    options.getBacklinks ?? (async () => [{ topicId: 'kt-1', name: 'LangChain' }])
  );
  const onOpenTopic = vi.fn();
  const onEdit = vi.fn();
  const onDelete = vi.fn();

  render(
    <KnowledgeNotePane
      topic={langGraph}
      topics={[langChain, langGraph]}
      workspaceLabel="全局"
      getNote={getNote}
      saveNote={saveNote}
      getBacklinks={getBacklinks}
      onOpenTopic={onOpenTopic}
      onEdit={onEdit}
      onDelete={onDelete}
    />
  );

  return { getNote, saveNote, getBacklinks, onOpenTopic, onEdit, onDelete };
}

test('loads the note and switches between edit and preview', async () => {
  setup();

  const textarea = await screen.findByRole('textbox', { name: '知识笔记' });
  expect(textarea).toHaveValue('# LangGraph\n\n正文');

  await userEvent.click(screen.getByRole('button', { name: '预览' }));

  expect(screen.queryByRole('textbox', { name: '知识笔记' })).not.toBeInTheDocument();
  expect(screen.getByText('正文')).toBeInTheDocument();
});

test('saves on Cmd+S and shows the saved status', async () => {
  const { saveNote } = setup();

  const textarea = await screen.findByRole('textbox', { name: '知识笔记' });
  await userEvent.clear(textarea);
  await userEvent.type(textarea, '新内容');

  await userEvent.keyboard('{Meta>}s{/Meta}');

  await waitFor(() =>
    expect(saveNote).toHaveBeenCalledWith({ topicId: 'kt-2', body: '新内容' })
  );
  expect(await screen.findByText('已保存')).toBeInTheDocument();
});

test('opens a resolved wiki link and renders unresolved ones inert', async () => {
  const { onOpenTopic } = setup({
    getNote: async () => note('kt-2', '[[LangChain]] [[Missing]]'),
    // No backlinks here, so the only link to LangChain is the one in the preview.
    getBacklinks: async () => []
  });

  await screen.findByRole('textbox', { name: '知识笔记' });
  await userEvent.click(screen.getByRole('button', { name: '预览' }));

  await userEvent.click(screen.getByRole('button', { name: '打开知识主题 LangChain' }));
  expect(onOpenTopic).toHaveBeenCalledWith('kt-1');

  expect(screen.getByText('Missing')).toHaveAttribute('title', '没有这个知识点');
  expect(screen.queryByRole('button', { name: /Missing/ })).not.toBeInTheDocument();
});

test('renders evidence and backlinks and opens a backlink target', async () => {
  const { onOpenTopic } = setup({ getNote: async () => note('kt-2', '') });

  await screen.findByRole('textbox', { name: '知识笔记' });
  expect(screen.getByText('证据 2 条')).toBeInTheDocument();
  expect(screen.getByText(/状态图练习/)).toBeInTheDocument();
  expect(await screen.findByText('反向链接 1 条')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '打开知识主题 LangChain' }));
  expect(onOpenTopic).toHaveBeenCalledWith('kt-1');
});

test('shows an empty-note hint in preview', async () => {
  setup({ getNote: async () => note('kt-2', '') });

  await screen.findByRole('textbox', { name: '知识笔记' });
  await userEvent.click(screen.getByRole('button', { name: '预览' }));

  expect(screen.getByText('还没有笔记。点「编辑」开始写。')).toBeInTheDocument();
});

test('shows a save error with retry', async () => {
  const saveNote = vi
    .fn()
    .mockRejectedValueOnce(new Error('disk full'))
    .mockImplementation(async (input: { topicId: string; body: string }) =>
      note(input.topicId, input.body)
    );
  setup({ saveNote });

  const textarea = await screen.findByRole('textbox', { name: '知识笔记' });
  await userEvent.clear(textarea);
  await userEvent.type(textarea, '草稿');
  await userEvent.keyboard('{Meta>}s{/Meta}');

  expect(await screen.findByText('保存失败')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '重试保存' }));

  expect(await screen.findByText('已保存')).toBeInTheDocument();
});

test('shows a load error with retry while keeping the topic header', async () => {
  const getNote = vi
    .fn()
    .mockRejectedValueOnce(new Error('missing'))
    .mockResolvedValue(note('kt-2', '恢复了'));
  setup({ getNote });

  expect(await screen.findByText('笔记加载失败。')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'LangGraph' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '重试加载' }));

  expect(await screen.findByRole('textbox', { name: '知识笔记' })).toHaveValue('恢复了');
});
