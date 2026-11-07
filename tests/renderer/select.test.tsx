// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select } from '../../src/renderer/ui/Select';

function Harness({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('a');
  return (
    <Select
      aria-label="示例选项"
      value={value}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
    >
      <option value="a">选项 A</option>
      <option value="b">选项 B</option>
      <option value="c">选项 C</option>
    </Select>
  );
}

function trigger() {
  return screen.getByRole('combobox', { name: '示例选项' });
}

test('renders the selected label and picks an option from a popup menu', async () => {
  const user = userEvent.setup();
  render(<Harness />);

  expect(trigger()).toHaveTextContent('选项 A');
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');

  await user.click(trigger());
  expect(trigger()).toHaveAttribute('aria-expanded', 'true');
  const menu = screen.getByRole('listbox');
  expect(menu).toBeInTheDocument();
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    '选项 A',
    '选项 B',
    '选项 C'
  ]);

  await user.click(screen.getByRole('option', { name: '选项 B' }));
  expect(trigger()).toHaveTextContent('选项 B');
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('supports keyboard navigation and Escape without changing the value', async () => {
  const user = userEvent.setup();
  const outsideKeyDown = vi.fn();
  document.addEventListener('keydown', outsideKeyDown);
  render(<Harness />);

  trigger().focus();
  await user.keyboard('{ArrowDown}');
  expect(trigger()).toHaveAttribute('aria-expanded', 'true');

  await user.keyboard('{ArrowDown}');
  await user.keyboard('{Enter}');
  expect(trigger()).toHaveTextContent('选项 B');

  outsideKeyDown.mockClear();
  await user.keyboard('{ArrowDown}');
  outsideKeyDown.mockClear();
  await user.keyboard('{Escape}');
  expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  expect(trigger()).toHaveTextContent('选项 B');
  // A dropdown inside a dialog must close itself, not the dialog.
  expect(outsideKeyDown).not.toHaveBeenCalled();

  document.removeEventListener('keydown', outsideKeyDown);
});

test('closes when clicking outside', async () => {
  const user = userEvent.setup();
  render(
    <>
      <Harness />
      <button type="button">外面</button>
    </>
  );

  await user.click(trigger());
  expect(screen.getByRole('listbox')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: '外面' }));
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
});

test('does not open while disabled', async () => {
  const user = userEvent.setup();
  render(<Harness disabled />);

  expect(trigger()).toBeDisabled();
  await user.click(trigger());
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
