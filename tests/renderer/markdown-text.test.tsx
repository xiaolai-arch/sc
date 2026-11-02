// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MarkdownText } from '../../src/renderer/shell/MarkdownText';

function renderText(text: string) {
  return render(<MarkdownText text={text} />);
}

test('renders bold, italic, inline code and links', () => {
  renderText('**加粗** 和 *斜体* 以及 `npm test` 和 [示例](https://example.com)');

  expect(screen.getByText('加粗').tagName).toBe('STRONG');
  expect(screen.getByText('斜体').tagName).toBe('EM');
  expect(screen.getByText('npm test').tagName).toBe('CODE');
  const link = screen.getByRole('link', { name: '示例' });
  expect(link).toHaveAttribute('href', 'https://example.com');
});

test('renders unordered and ordered lists', () => {
  renderText('- 第一项\n- 第二项\n\n1. 甲\n2. 乙');

  const lists = screen.getAllByRole('list');
  expect(lists).toHaveLength(2);
  expect(lists[0]!.tagName).toBe('UL');
  expect(lists[1]!.tagName).toBe('OL');
  expect(screen.getAllByRole('listitem')).toHaveLength(4);
});

test('renders headings and paragraphs', () => {
  renderText('# 一级标题\n\n正文第一段');

  expect(screen.getByText('一级标题')).toBeInTheDocument();
  expect(screen.getByText('正文第一段')).toBeInTheDocument();
});

test('renders fenced code blocks with language labels and copies the code', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText }
  });
  renderText('```ts\nconst a = 1;\n```');

  expect(screen.getByText('ts')).toBeInTheDocument();
  expect(screen.getByText('const a = 1;')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '复制' }));
  expect(writeText).toHaveBeenCalledWith('const a = 1;');
  expect(await screen.findByRole('button', { name: '已复制' })).toBeInTheDocument();
});

test('does not crash on unclosed bold or fences', () => {
  const { unmount } = renderText('未闭合 **加粗');
  expect(screen.getByText(/未闭合/)).toBeInTheDocument();
  unmount();

  renderText('```js\nconst a = 1');
  expect(screen.getByText('js')).toBeInTheDocument();
  expect(screen.getByText('const a = 1')).toBeInTheDocument();
});

test('parses growing streamed text without duplicate-key warnings', () => {
  const errors: unknown[] = [];
  const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    errors.push(args);
  });
  const chunks = ['**加', '**加粗', '**加粗**\n\n`code', '**加粗**\n\n`code`'];
  const { rerender } = render(<MarkdownText text={chunks[0]!} />);
  for (const chunk of chunks.slice(1)) {
    rerender(<MarkdownText text={chunk} />);
  }

  expect(screen.getByText('加粗').tagName).toBe('STRONG');
  expect(screen.getByText('code').tagName).toBe('CODE');
  expect(errors.filter((entry) => String(entry).includes('same key'))).toEqual([]);
  spy.mockRestore();
});

test('renders wiki links as buttons when a resolver is provided', async () => {
  const onWikiLink = vi.fn();
  render(
    <MarkdownText
      text="相关 [[LangChain|LC]] 和 [[Missing]]"
      resolveWikiLink={(target) => (target === 'LangChain' ? { id: 'kt-1' } : null)}
      onWikiLink={onWikiLink}
    />
  );
  await userEvent.click(screen.getByRole('button', { name: '打开知识主题 LangChain' }));
  expect(onWikiLink).toHaveBeenCalledWith('kt-1');
  expect(screen.getByText('Missing')).toHaveAttribute('title', '没有这个知识点');
  expect(screen.queryByRole('button', { name: /Missing/ })).not.toBeInTheDocument();
});

test('keeps wiki syntax literal without a resolver', () => {
  renderText('相关 [[LangChain]]');
  expect(screen.getByText('相关 [[LangChain]]')).toBeInTheDocument();
});

test('does not parse wiki links inside code', () => {
  render(
    <MarkdownText
      text={'`[[A]]`\n\n```\n[[B]]\n```'}
      resolveWikiLink={() => ({ id: 'x' })}
      onWikiLink={vi.fn()}
    />
  );
  // The code block's copy button is expected; a wiki-link button is not.
  expect(screen.queryByRole('button', { name: /打开知识主题/ })).not.toBeInTheDocument();
});
