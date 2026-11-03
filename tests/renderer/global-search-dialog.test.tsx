// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GlobalSearchDialog } from '../../src/renderer/shell/GlobalSearchDialog';
import type { ConversationSummary } from '../../src/shared/conversations';
import type { SearchResult } from '../../src/shared/search';
import type { Workspace } from '../../src/shared/workspace';

const WORKSPACES: Workspace[] = [
  {
    id: 'project',
    name: 'Agent 开发',
    kind: 'project',
    color: '#0071e3',
    goal: '转 Agent',
    description: '',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  }
];

const NOTE: SearchResult = {
  workspaceId: 'project',
  docId: 'n-1',
  kind: 'note',
  title: '矩阵笔记',
  snippet: '矩阵乘法不满足交换律',
  score: 3,
  path: 'workspaces/project/notes/n-1.md'
};

const KNOWLEDGE: SearchResult = {
  workspaceId: null,
  docId: 'kt-1',
  kind: 'knowledge-topic',
  title: 'LangChain',
  snippet: 'AgentExecutor 用法',
  score: 2.5,
  path: 'knowledge/topics/kt-1.md'
};

const CONVERSATION: ConversationSummary = {
  id: 'c-1',
  title: '旧对话：极限',
  kind: 'chat',
  workspaceId: 'project',
  updatedAt: '2026-11-01T00:00:00.000Z',
  preview: '今天数学卡在极限'
};

function setup(overrides: Partial<Parameters<typeof GlobalSearchDialog>[0]> = {}) {
  const onClose = vi.fn();
  const onSearchConversations = vi.fn().mockResolvedValue([CONVERSATION]);
  const onSearchAll = vi.fn().mockResolvedValue([NOTE, KNOWLEDGE]);
  const onSelectConversation = vi.fn();
  const onSelectResult = vi.fn();
  render(
    <GlobalSearchDialog
      open
      workspaces={WORKSPACES}
      onClose={onClose}
      onSearchConversations={onSearchConversations}
      onSearchAll={onSearchAll}
      onSelectConversation={onSelectConversation}
      onSelectResult={onSelectResult}
      {...overrides}
    />
  );
  return {
    onClose,
    onSearchConversations,
    onSearchAll,
    onSelectConversation,
    onSelectResult
  };
}

test('searches conversations and the vault after a debounce', async () => {
  const { onSearchAll, onSearchConversations } = setup();
  const input = screen.getByLabelText('搜索全部内容');
  expect(screen.getByText(/搜索对话、笔记、任务/)).toBeInTheDocument();
  expect(input).toHaveFocus();

  await userEvent.type(input, '矩阵');
  expect(onSearchAll).not.toHaveBeenCalled();

  expect(await screen.findByText('矩阵笔记')).toBeInTheDocument();
  expect(await screen.findByText('旧对话：极限')).toBeInTheDocument();
  expect(screen.getByText('LangChain')).toBeInTheDocument();
  expect(onSearchAll).toHaveBeenCalledWith('矩阵');
  expect(onSearchConversations).toHaveBeenCalledWith('矩阵');
  expect(screen.getByText('笔记')).toBeInTheDocument();
  expect(screen.getAllByText('知识库').length).toBeGreaterThan(0);
  expect(screen.getAllByText('Agent 开发').length).toBeGreaterThan(0);
});

test('opens a conversation with Enter and a vault result by click', async () => {
  const { onSelectConversation, onSelectResult } = setup();
  const input = screen.getByLabelText('搜索全部内容');
  await userEvent.type(input, '矩阵');
  await screen.findByText('旧对话：极限');

  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSelectConversation).toHaveBeenCalledWith('c-1');

  await userEvent.click(screen.getByText('矩阵笔记'));
  expect(onSelectResult).toHaveBeenCalledWith(NOTE);
});

test('moves the active result with arrow keys', async () => {
  const { onSelectResult } = setup();
  const input = screen.getByLabelText('搜索全部内容');
  await userEvent.type(input, '矩阵');
  await screen.findByText('旧对话：极限');

  // conversation → note → knowledge
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onSelectResult).toHaveBeenCalledWith(KNOWLEDGE);
});

test('keeps an empty state and skips the search for blank queries', async () => {
  const { onSearchAll, onSearchConversations } = setup({
    onSearchConversations: vi.fn().mockResolvedValue([]),
    onSearchAll: vi.fn().mockResolvedValue([])
  });
  const input = screen.getByLabelText('搜索全部内容');
  await userEvent.type(input, '   ');
  expect(onSearchAll).not.toHaveBeenCalled();
  expect(onSearchConversations).not.toHaveBeenCalled();

  fireEvent.change(input, { target: { value: '不存在' } });
  expect(await screen.findByText('没有找到相关内容。')).toBeInTheDocument();
});

test('shows the remaining results when one source fails', async () => {
  setup({ onSearchConversations: vi.fn().mockRejectedValue(new Error('offline')) });
  const input = screen.getByLabelText('搜索全部内容');
  await userEvent.type(input, '矩阵');
  expect(await screen.findByText('矩阵笔记')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('closes with Escape', async () => {
  const { onClose } = setup();
  await waitFor(() => expect(screen.getByLabelText('搜索全部内容')).toHaveFocus());
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onClose).toHaveBeenCalled();
});
