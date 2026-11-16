// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { TraceFlow } from '../../src/renderer/shell/TraceFlow';
import { stepsToTrace } from '../../src/renderer/shell/trace';
import type { ChatTraceItem } from '../../src/renderer/shell/types';

function reasoning(id: string, text: string, streaming = false): ChatTraceItem {
  return { kind: 'reasoning', id, text, streaming };
}

function tool(
  id: string,
  label: string,
  status: 'running' | 'done' | 'failed',
  detail?: string
): ChatTraceItem {
  return {
    kind: 'tool',
    id,
    name: id,
    label,
    status,
    ...(detail ? { detail } : {})
  };
}

test('renders reasoning and tool rows in order with summaries', () => {
  render(
    <TraceFlow
      items={[
        reasoning('r1', '先看今天的任务。\n再排优先级。'),
        tool('t1', '写入笔记', 'done', '已写入笔记'),
        reasoning('r2', '补充说明。')
      ]}
    />
  );

  const titles = screen.getAllByText('思考过程');
  expect(titles).toHaveLength(2);
  const toolTitle = screen.getByText('写入笔记');
  expect(titles[0]!.compareDocumentPosition(toolTitle)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  expect(toolTitle.compareDocumentPosition(titles[1]!)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING
  );
  expect(screen.getByText('先看今天的任务。')).toBeInTheDocument();
  expect(screen.getByText('已写入笔记')).toBeInTheDocument();
});

test('expands reasoning content and toggles with the keyboard', async () => {
  const user = userEvent.setup();
  render(<TraceFlow items={[reasoning('r1', '完整思考内容 **加粗**')]} />);

  const row = screen.getByRole('button', { name: /思考/ });
  expect(row).toHaveAttribute('aria-expanded', 'false');

  await user.click(row);
  expect(row).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/完整思考内容/)).toBeInTheDocument();

  await user.keyboard('{Enter}');
  expect(row).toHaveAttribute('aria-expanded', 'false');

  row.focus();
  await user.keyboard(' ');
  expect(row).toHaveAttribute('aria-expanded', 'true');
});

test('keeps the thinking chain open while it streams, with elapsed seconds', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-11-15T09:00:00.000Z'));
    const streaming: ChatTraceItem = {
      kind: 'reasoning',
      id: 'r1',
      text: '正在思考的内容',
      streaming: true,
      startedAt: Date.now() - 4_000
    };
    render(<TraceFlow items={[streaming]} />);

    expect(screen.getByText('正在思考的内容')).toBeInTheDocument();
    expect(screen.getByText('4s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /思考过程/ })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  } finally {
    vi.useRealTimers();
  }
});

test('keeps the thinking clock across a remount instead of restarting at 0', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(20_000);
    const item: ChatTraceItem = {
      kind: 'reasoning',
      id: 'r1',
      text: '思考内容',
      streaming: true,
      startedAt: 5_000
    };
    const first = render(<TraceFlow items={[item]} />);
    expect(screen.getByText('15s')).toBeInTheDocument();
    first.unmount();

    // Navigating away and back must not reset the clock.
    vi.setSystemTime(25_000);
    render(<TraceFlow items={[item]} />);
    expect(screen.getByText('20s')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('follows the newest reasoning while it streams, and stops when scrolled up', () => {
  const base: ChatTraceItem = {
    kind: 'reasoning',
    id: 'r1',
    text: '第一段思考',
    streaming: true,
    startedAt: Date.now()
  };
  const { rerender } = render(<TraceFlow items={[base]} />);

  const panel = screen.getByText('第一段思考').closest('div[class*="max-h-"]');
  expect(panel).not.toBeNull();
  const node = panel as HTMLDivElement;
  Object.defineProperty(node, 'scrollHeight', { value: 900, configurable: true });
  Object.defineProperty(node, 'clientHeight', { value: 300, configurable: true });
  node.scrollTop = 0;

  // A reader who scrolled up keeps their position.
  fireEvent.scroll(node);
  rerender(<TraceFlow items={[{ ...base, text: '第一段思考\n第二段思考' }]} />);
  expect(node.scrollTop).toBe(0);

  // Back at the bottom, the next chunk is followed again.
  node.scrollTop = 600;
  fireEvent.scroll(node);
  rerender(
    <TraceFlow items={[{ ...base, text: '第一段思考\n第二段思考\n第三段思考' }]} />
  );
  expect(node.scrollTop).toBe(900);
});

test('marks running, failed and done tool states', () => {
  render(
    <TraceFlow
      items={[
        tool('t1', '工具 A', 'running'),
        tool('t2', '工具 B', 'failed', '失败原因'),
        tool('t3', '工具 C', 'done')
      ]}
    />
  );

  expect(screen.getByText('运行中…').className).toContain('animate-pulse');
  expect(screen.getByText('失败原因').className).toMatch(/#d70015|#ff7b72/);
  expect(screen.getByText('已完成')).toBeInTheDocument();
});

test('folds a finished chain and shows its duration', async () => {
  const user = userEvent.setup();
  render(
    <TraceFlow
      items={[
        {
          kind: 'reasoning',
          id: 'r1',
          text: '第一行摘要\n隐藏的完整推理',
          streaming: false,
          startedAt: 1_000,
          endedAt: 13_000
        }
      ]}
    />
  );

  const header = screen.getByRole('button', { name: /思考过程/ });
  expect(header).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByText('12 秒')).toBeInTheDocument();
  expect(screen.queryByText(/隐藏的完整推理/)).not.toBeInTheDocument();

  await user.click(header);
  expect(header).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/隐藏的完整推理/)).toBeInTheDocument();
});

test('does not make rows without detail expandable', () => {
  render(<TraceFlow items={[tool('t1', '工具 A', 'done')]} />);

  expect(screen.getByText('工具 A')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /工具 A/ })).not.toBeInTheDocument();
});

test('renders nothing for an empty trace', () => {
  const { container } = render(<TraceFlow items={[]} />);
  expect(container).toBeEmptyDOMElement();
});

test('maps persisted steps to tool rows', () => {
  expect(
    stepsToTrace([
      {
        id: 's1',
        name: 'write_note',
        label: '写入笔记',
        status: 'done',
        detail: 'ok'
      }
    ])
  ).toEqual([
    {
      kind: 'tool',
      id: 's1',
      name: 'write_note',
      label: '写入笔记',
      status: 'done',
      detail: 'ok'
    }
  ]);
});

test('shows a live placeholder before reasoning text arrives', () => {
  render(<TraceFlow items={[reasoning('r1', '', true)]} />);

  expect(screen.getByText(/正在思考…/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /思考/ })).not.toBeInTheDocument();
});
