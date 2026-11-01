// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  const titles = screen.getAllByText('思考');
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

test('marks running, failed and done tool states', () => {
  render(
    <TraceFlow
      items={[
        reasoning('r1', '正在思考的内容', true),
        tool('t1', '工具 A', 'running'),
        tool('t2', '工具 B', 'failed', '失败原因'),
        tool('t3', '工具 C', 'done')
      ]}
    />
  );

  expect(screen.getByText('正在思考的内容').className).toContain('animate-pulse');
  expect(screen.getByText('运行中…').className).toContain('animate-pulse');
  expect(screen.getByText('失败原因').className).toMatch(/#d70015|#ff7b72/);
  expect(screen.getByText('已完成')).toBeInTheDocument();
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
