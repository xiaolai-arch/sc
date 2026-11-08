// @vitest-environment jsdom
import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Select, type SelectChangeEvent } from '../../src/renderer/ui/Select';

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

test('scrolls the highlighted option into view while navigating', async () => {
  const user = userEvent.setup();
  const scrollIntoView = vi.fn();
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: scrollIntoView
  });
  try {
    render(<Harness />);
    trigger().focus();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');

    const highlighted = screen.getByRole('option', { name: '选项 B' });
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.instances.at(-1)).toBe(highlighted);
  } finally {
    Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
  }
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

test('reads options wrapped in fragments', async () => {
  const user = userEvent.setup();
  render(
    <Select aria-label="片段选项" value="b">
      <>
        <option value="a">选项 A</option>
        <option value="b">选项 B</option>
      </>
    </Select>
  );
  const fragmentTrigger = screen.getByRole('combobox', { name: '片段选项' });
  expect(fragmentTrigger).toHaveTextContent('选项 B');

  await user.click(fragmentTrigger);
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    '选项 A',
    '选项 B'
  ]);
});

test('shows the first enabled option when value is omitted', async () => {
  const user = userEvent.setup();
  render(
    <Select aria-label="默认选项">
      <option value="a" disabled>
        选项 A
      </option>
      <option value="b">选项 B</option>
    </Select>
  );
  const defaultTrigger = screen.getByRole('combobox', { name: '默认选项' });
  // Native <select> falls back to the first selectable option.
  expect(defaultTrigger).toHaveTextContent('选项 B');

  await user.click(defaultTrigger);
  expect(screen.getByRole('option', { name: '选项 B' })).toHaveAttribute(
    'aria-selected',
    'true'
  );
  expect(screen.getByRole('option', { name: '选项 A' })).toHaveAttribute(
    'aria-selected',
    'false'
  );
});

test('reports the chosen value through the documented change contract', async () => {
  const user = userEvent.setup();
  const handler = vi.fn();
  render(
    <Select aria-label="事件选项" value="a" name="choice" onChange={handler}>
      <option value="a">选项 A</option>
      <option value="b">选项 B</option>
    </Select>
  );
  const eventTrigger = screen.getByRole('combobox', { name: '事件选项' });
  await user.click(eventTrigger);
  await user.click(screen.getByRole('option', { name: '选项 B' }));

  const event = handler.mock.calls[0]?.[0] as SelectChangeEvent;
  expect(event.target).toEqual({ value: 'b', name: 'choice' });
  expect(event.currentTarget).toBe(event.target);
});

test('owns the portalled listbox while it is open', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const combobox = trigger();
  expect(combobox).not.toHaveAttribute('aria-owns');

  await user.click(combobox);
  const menu = screen.getByRole('listbox');
  expect(combobox).toHaveAttribute('aria-controls', menu.id);
  // aria-activedescendant references a portalled option; ownership makes it
  // reachable for screen readers.
  expect(combobox).toHaveAttribute('aria-owns', menu.id);

  await user.keyboard('{Escape}');
  expect(combobox).not.toHaveAttribute('aria-owns');
});
