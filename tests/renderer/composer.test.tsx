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

test('clears the sent text before the send resolves', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const onSend = vi.fn(() => gate.then(() => true));
  const onTextChange = vi.fn();
  render(
    <Composer
      modelLabel="test-model"
      text="第一条消息"
      onTextChange={onTextChange}
      onSend={onSend}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  expect(onTextChange).toHaveBeenCalledWith('');

  // Text typed after clicking send must survive the promise resolving.
  onTextChange.mockClear();
  release();
  await waitFor(() => expect(onSend).toHaveBeenCalled());
  expect(onTextChange).not.toHaveBeenCalled();
});

test('puts the draft back when the message was never stored', async () => {
  const onSend = vi.fn(async () => false);
  const onTextChange = vi.fn();
  render(
    <Composer
      modelLabel="test-model"
      text="这句话不能丢"
      onTextChange={onTextChange}
      onSend={onSend}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await waitFor(() => expect(onTextChange).toHaveBeenLastCalledWith('这句话不能丢'));
});

test('shows the active permission mode and switches it', () => {
  const onPermissionsChange = vi.fn();
  render(
    <Composer
      modelLabel="test-model"
      text=""
      onTextChange={() => undefined}
      onSend={() => undefined}
      permissions={{ web: true, write: true, shell: false }}
      onPermissionsChange={onPermissionsChange}
    />
  );

  const trigger = screen.getByRole('button', { name: '对话权限' });
  expect(trigger).toHaveTextContent('工作区内修改');

  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('radio', { name: /完全权限/ }));

  expect(onPermissionsChange).toHaveBeenCalledWith({ web: true, write: true, shell: true });
});

test('marks the stored mode as checked in the selector', () => {
  render(
    <Composer
      modelLabel="test-model"
      text=""
      onTextChange={() => undefined}
      onSend={() => undefined}
      permissions={{ web: true, write: false, shell: false }}
      onPermissionsChange={() => undefined}
    />
  );

  expect(screen.getByRole('button', { name: '对话权限' })).toHaveTextContent('仅可查看');

  fireEvent.click(screen.getByRole('button', { name: '对话权限' }));
  expect(screen.getByRole('radio', { name: /仅可查看/ })).toHaveAttribute(
    'aria-checked',
    'true'
  );
  expect(screen.getByRole('radio', { name: /工作区内修改/ })).toHaveAttribute(
    'aria-checked',
    'false'
  );
});

test('renders staged attachments and removes one', () => {
  const onAttachmentsChange = vi.fn();
  render(
    <Composer
      modelLabel="test-model"
      text=""
      onTextChange={() => undefined}
      onSend={() => undefined}
      attachments={[
        { name: '笔记.md', mediaType: 'text/markdown', size: 10, kind: 'text', data: 'x' },
        { name: 'screen.png', mediaType: 'image/png', size: 10, kind: 'image', data: 'y' }
      ]}
      onAttachmentsChange={onAttachmentsChange}
    />
  );

  expect(screen.getByText('笔记.md')).toBeInTheDocument();
  expect(screen.getByText('图片 · screen.png')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '移除附件 笔记.md' }));

  expect(onAttachmentsChange).toHaveBeenCalledWith([
    { name: 'screen.png', mediaType: 'image/png', size: 10, kind: 'image', data: 'y' }
  ]);
});
