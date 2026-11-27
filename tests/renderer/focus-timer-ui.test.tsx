// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { FocusTimer } from '../../src/renderer/shell/FocusTimer';
import { startFocusSession } from '../../src/renderer/shell/focus-timer';

const session = startFocusSession(1, { id: 't1', title: '极限' }, 1_000);

function renderTimer(overrides: Partial<Parameters<typeof FocusTimer>[0]> = {}) {
  const onAbandon = vi.fn();
  const onRestoreContinue = vi.fn();
  const onRestoreDismiss = vi.fn();
  render(
    <FocusTimer
      session={null}
      notice={null}
      restore={null}
      canStart={false}
      onStartDefault={vi.fn()}
      onPause={vi.fn()}
      onResume={vi.fn()}
      onReset={vi.fn()}
      onRestoreContinue={onRestoreContinue}
      onRestoreDismiss={onRestoreDismiss}
      onAbandon={onAbandon}
      {...overrides}
    />
  );
  return { onAbandon, onRestoreContinue, onRestoreDismiss };
}

describe('FocusTimer restore prompt (iter33 P2b①)', () => {
  test('shows the snapshot label once with 继续/不要了, no timer yet', async () => {
    const user = userEvent.setup();
    const { onRestoreContinue, onRestoreDismiss } = renderTimer({
      restore: { label: '上次专注还剩 10 分钟，继续？' }
    });

    expect(screen.getByText('上次专注还剩 10 分钟，继续？')).not.toBeNull();
    // No clock while only the prompt is up: nothing runs until the user clicks.
    expect(screen.queryByText('00:00')).toBeNull();

    await user.click(screen.getByRole('button', { name: '继续' }));
    expect(onRestoreContinue).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '不要了' }));
    expect(onRestoreDismiss).toHaveBeenCalledTimes(1);
  });

  test('an active session hides the restore prompt', () => {
    renderTimer({ session, restore: { label: '上次专注还剩 10 分钟，继续？' } });
    expect(screen.queryByText('上次专注还剩 10 分钟，继续？')).toBeNull();
  });
});

describe('FocusTimer abandon flow (iter33 P2b②)', () => {
  test('放弃 opens the one-line ask; 保存并放弃 forwards the typed step', async () => {
    const user = userEvent.setup();
    const { onAbandon } = renderTimer({ session });
    expect(screen.queryByRole('form', { name: '放弃专注' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '放弃' }));
    const input = screen.getByRole('textbox', { name: '下一步' });
    await user.type(input, '先把例题抄一遍');
    await user.click(screen.getByRole('button', { name: '保存并放弃' }));

    expect(onAbandon).toHaveBeenCalledWith('先把例题抄一遍');
    // The ask closes afterwards.
    expect(screen.queryByRole('textbox', { name: '下一步' })).toBeNull();
  });

  test('直接放弃 skips the write (null), and so does an empty line', async () => {
    const user = userEvent.setup();
    const { onAbandon } = renderTimer({ session });

    await user.click(screen.getByRole('button', { name: '放弃' }));
    await user.click(screen.getByRole('button', { name: '直接放弃' }));
    expect(onAbandon).toHaveBeenCalledWith(null);

    // Re-open: an untouched (empty) input skips the write too.
    await user.click(screen.getByRole('button', { name: '放弃' }));
    await user.click(screen.getByRole('button', { name: '保存并放弃' }));
    expect(onAbandon).toHaveBeenLastCalledWith(null);
  });

  test('the ask closes when the session ends', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <FocusTimer
        session={session}
        notice={null}
        restore={null}
        canStart={false}
        onStartDefault={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onReset={vi.fn()}
        onRestoreContinue={vi.fn()}
        onRestoreDismiss={vi.fn()}
        onAbandon={vi.fn()}
      />
    );
    await user.click(screen.getByRole('button', { name: '放弃' }));
    expect(screen.getByRole('textbox', { name: '下一步' })).not.toBeNull();

    rerender(
      <FocusTimer
        session={null}
        notice={null}
        restore={null}
        canStart={false}
        onStartDefault={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onReset={vi.fn()}
        onRestoreContinue={vi.fn()}
        onRestoreDismiss={vi.fn()}
        onAbandon={vi.fn()}
      />
    );
    expect(screen.queryByRole('textbox', { name: '下一步' })).toBeNull();
  });
});
