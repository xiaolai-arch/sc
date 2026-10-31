// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { Badge } from '../../src/renderer/ui/Badge';
import { Button } from '../../src/renderer/ui/Button';
import { Card } from '../../src/renderer/ui/Card';
import { Input } from '../../src/renderer/ui/Input';
import { Progress } from '../../src/renderer/ui/Progress';

const forbidden = ['bg-gradient-to-r', 'bg-gradient-to-br', 'shadow-2xl', 'shadow-inner', 'border-2', 'border-4'];

function expectNoForbidden(element: HTMLElement) {
  for (const token of forbidden) expect(element.className).not.toContain(token);
}

test('primary button carries the Apple Style button tokens', () => {
  render(<Button>开始</Button>);
  const button = screen.getByRole('button', { name: '开始' });
  for (const token of ['rounded-full', 'font-medium', 'transition-all', 'duration-300', 'bg-[#0071e3]', 'text-white', 'active:scale-[0.98]', 'hover:opacity-80']) {
    expect(button.className).toContain(token);
  }
  expectNoForbidden(button);
});

test('card, input and progress use the required tokens', () => {
  render(
    <Card data-testid="card">
      <Input aria-label="模型名称" defaultValue="claude-sonnet-5-5" />
      <Progress value={1} max={2} label="今日进度" />
    </Card>
  );
  const card = screen.getByTestId('card');
  for (const token of ['bg-white', 'rounded-2xl', 'shadow-sm']) expect(card.className).toContain(token);
  expectNoForbidden(card);
  const input = screen.getByLabelText('模型名称');
  for (const token of ['bg-[#f5f5f7]', 'rounded-xl', 'text-[#1d1d1f]', 'focus:outline-none', 'focus:ring-2', 'focus:ring-[#0071e3]/30', 'transition-all']) {
    expect(input.className).toContain(token);
  }
  expectNoForbidden(input);
  const progress = screen.getByRole('progressbar', { name: '今日进度' });
  expect(progress).toHaveAttribute('aria-valuenow', '1');
  expect(progress).toHaveAttribute('aria-valuemax', '2');
});

test('badge variants stay inside the restrained palette', () => {
  render(<Badge tone="green">已完成</Badge>);
  const badge = screen.getByText('已完成');
  expect(badge.className).toContain('rounded-full');
  expect(badge.className).toContain('bg-[#34c759]/10');
  expect(badge.className).toContain('text-[#1d1d1f]');
  expectNoForbidden(badge);
});

test('danger and placeholder tokens stay contrast-safe', () => {
  render(
    <>
      <Button variant="danger">删除</Button>
      <Input aria-label="带占位符" placeholder="请输入" />
    </>
  );
  const danger = screen.getByRole('button', { name: '删除' });
  expect(danger.className).toContain('bg-[#d70015]');
  expect(danger.className).toContain('text-white');
  expectNoForbidden(danger);

  const input = screen.getByLabelText('带占位符');
  expect(input.className).toContain('placeholder:text-gray-600');
  expect(input.className).toContain('motion-reduce:transition-none');
});
