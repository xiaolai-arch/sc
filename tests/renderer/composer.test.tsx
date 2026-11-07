// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Composer } from '../../src/renderer/shell/Composer';

function setup() {
  const onSend = vi.fn();
  const onTextChange = vi.fn();
  render(
    <Composer
      modelLabel="test-model"
      text="帮我看看今天的计划"
      onTextChange={onTextChange}
      onSend={onSend}
    />
  );
  return { onSend, onTextChange };
}

test('does not send on the Enter that confirms an IME candidate', async () => {
  const { onSend } = setup();
  const box = screen.getByLabelText('向阿咲提问');

  fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
  expect(onSend).not.toHaveBeenCalled();

  fireEvent.keyDown(box, { key: 'Enter' });
  await waitFor(() => expect(onSend).toHaveBeenCalledWith('帮我看看今天的计划'));
});

test('does not advertise controls that are not implemented', () => {
  setup();
  expect(screen.queryByRole('button', { name: '添加附件' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /计划模式/ })).not.toBeInTheDocument();
});
