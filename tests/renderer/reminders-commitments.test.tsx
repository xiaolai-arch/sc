// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommitmentsSection } from '../../src/renderer/shell/ProjectSections';
import type { CommitmentSummary } from '../../src/shared/notifications';

const TODAY = '2026-11-22';

const entry = (overrides: Partial<CommitmentSummary> = {}): CommitmentSummary => ({
  id: 'cm-1',
  text: '背完这一课的单词',
  due: '2026-11-23',
  status: 'open',
  createdAt: '2026-11-20T08:00:00.000Z',
  ...overrides
});

const base = {
  today: TODAY,
  onResolve: vi.fn(async () => entry()),
  onPrompt: vi.fn()
};

function renderSection(
  commitments: CommitmentSummary[],
  overrides: Partial<typeof base> = {}
) {
  const props = { ...base, ...overrides };
  render(<CommitmentsSection commitments={commitments} {...props} />);
  return props;
}

test('lists open promises with their original day, overdue tag and three actions', () => {
  renderSection([
    entry({ id: 'cm-past', text: '整理错题', due: '2026-11-19' }),
    entry({ id: 'cm-future', text: '做完极限基础', due: '2026-11-25' })
  ]);

  expect(screen.getByText('承诺')).toBeInTheDocument();
  expect(screen.getByText('你说过的、还开着的事。这里能改日期，也能放下。')).toBeInTheDocument();
  expect(screen.getByText('整理错题')).toBeInTheDocument();
  expect(screen.getByText('做完极限基础')).toBeInTheDocument();
  // The original day stays visible even after the promise went stale.
  expect(screen.getByText('原定 11-19 · 已过期 3 天')).toBeInTheDocument();
  expect(screen.getByText('原定 11-25')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '改期：整理错题' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '放下：整理错题' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '完成：整理错题' })).toBeInTheDocument();
  expect(screen.getByText('这是你答应的事，不是任务。')).toBeInTheDocument();
});

test('the empty state offers exactly one way to record a promise', () => {
  const props = renderSection([]);

  expect(
    screen.getByText('还没有记下的承诺。你在对话里说「我明天做 X」，阿咲才会记一条。')
  ).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: '在对话里说一件事' })).toHaveLength(1);

  fireEvent.click(screen.getByRole('button', { name: '在对话里说一件事' }));
  expect(props.onPrompt).toHaveBeenCalledWith('我明天想做：');
});

test('改期 prefills the date, saves through onResolve and closes the editor', async () => {
  const onResolve = vi.fn(async () => entry());
  renderSection([entry()], { onResolve });

  await userEvent.click(screen.getByRole('button', { name: '改期：背完这一课的单词' }));
  const input = screen.getByLabelText('新日期：背完这一课的单词') as HTMLInputElement;
  // A promise due tomorrow keeps its own day as the prefill.
  expect(input.value).toBe('2026-11-23');

  fireEvent.change(input, { target: { value: '2026-11-28' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  await waitFor(() =>
    expect(onResolve).toHaveBeenCalledWith({
      id: 'cm-1',
      action: 'reschedule',
      due: '2026-11-28'
    })
  );
  // The inline editor closes after a successful save.
  expect(screen.queryByLabelText('新日期：背完这一课的单词')).not.toBeInTheDocument();
});

test('改期 prefills today for an overdue promise and defers the past-date rule to the service', async () => {
  // The lower bound lives in commitments/service.ts, not here, so the section
  // must not keep a second copy: it submits and shows whatever the service
  // says. The one-year cap is a UX bound and stays local, next to the picker.
  const onResolve = vi
    .fn()
    .mockRejectedValueOnce(new Error('改期日期不能早于今天。'))
    .mockResolvedValue(entry());
  renderSection([entry({ text: '整理错题', due: '2026-11-19' })], { onResolve });

  await userEvent.click(screen.getByRole('button', { name: '改期：整理错题' }));
  const input = screen.getByLabelText('新日期：整理错题') as HTMLInputElement;
  expect(input.value).toBe(TODAY);

  fireEvent.change(input, { target: { value: '2026-11-20' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));

  // Delegated: the call goes out, and the service's own sentence is shown.
  await waitFor(() =>
    expect(onResolve).toHaveBeenCalledWith({
      id: 'cm-1',
      action: 'reschedule',
      due: '2026-11-20'
    })
  );
  expect(await screen.findByText('改期日期不能早于今天。')).toBeInTheDocument();
  // The editor stays open so the user can correct the date.
  expect(screen.getByLabelText('新日期：整理错题')).toBeInTheDocument();

  // Past the one-year bound is refused locally with its own sentence.
  const callsBeforeCap = onResolve.mock.calls.length;
  fireEvent.change(input, { target: { value: '2028-01-01' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  expect(screen.getByText('新日期不能超过 365 天以后。')).toBeInTheDocument();
  expect(onResolve).toHaveBeenCalledTimes(callsBeforeCap);
});

test('放下 and 完成 resolve the entry through onResolve', async () => {
  const onResolve = vi.fn(async () => entry());
  renderSection([entry()], { onResolve });

  await userEvent.click(screen.getByRole('button', { name: '放下：背完这一课的单词' }));
  await waitFor(() => expect(onResolve).toHaveBeenCalledWith({ id: 'cm-1', action: 'drop' }));

  await userEvent.click(screen.getByRole('button', { name: '完成：背完这一课的单词' }));
  await waitFor(() => expect(onResolve).toHaveBeenCalledWith({ id: 'cm-1', action: 'done' }));
});

test('a failed resolve shows the service message inline and keeps the row', async () => {
  const onResolve = vi.fn(async () => {
    throw new Error('没有找到承诺：「cm-1」。');
  });
  renderSection([entry()], { onResolve });

  await userEvent.click(screen.getByRole('button', { name: '完成：背完这一课的单词' }));

  expect(await screen.findByRole('alert')).toHaveTextContent('没有找到承诺：「cm-1」。');
  expect(screen.getByText('背完这一课的单词')).toBeInTheDocument();
});

test('a promise of a check-in-off project carries no special tag', () => {
  // A promise follows the person, not the project: the morning check asks
  // about it even when its project's check-ins are off, so the row carries no
  // tag suggesting otherwise. (The component no longer receives workspaces at
  // all — it cannot know or imply check-in state.) A promise with no workspace
  // renders the same way.
  renderSection([
    entry({ id: 'cm-off', text: '随笔里写一篇', workspaceId: 'ws-off' }),
    entry({ id: 'cm-plain', text: '普通的一条' })
  ]);

  expect(screen.queryByText('不会主动问你')).not.toBeInTheDocument();
  // The rest of each row is unchanged: original day and all three actions.
  expect(screen.getAllByText('原定 11-23')).toHaveLength(2);
  for (const text of ['随笔里写一篇', '普通的一条']) {
    expect(screen.getByRole('button', { name: `改期：${text}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `放下：${text}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `完成：${text}` })).toBeInTheDocument();
  }
});

test('resolved rows stay hidden until 显示已结束 is on, then read as history', async () => {
  renderSection([
    entry(),
    entry({
      id: 'cm-done',
      text: '给妈妈打电话',
      due: '2026-11-20',
      status: 'done',
      resolvedAt: '2026-11-21T08:00:00.000Z'
    }),
    entry({
      id: 'cm-drop',
      text: '报个班',
      due: '2026-11-19',
      status: 'dropped',
      resolvedAt: '2026-11-21T09:00:00.000Z'
    })
  ]);

  expect(screen.queryByText('给妈妈打电话')).not.toBeInTheDocument();
  expect(screen.queryByText('报个班')).not.toBeInTheDocument();

  const toggle = screen.getByRole('switch', { name: '显示已结束' });
  await userEvent.click(toggle);

  expect(screen.getByText('给妈妈打电话')).toBeInTheDocument();
  expect(screen.getByText('已完成 · 11月21日')).toBeInTheDocument();
  expect(screen.getByText('报个班')).toBeInTheDocument();
  expect(screen.getByText('已放下 · 11月21日')).toBeInTheDocument();
  // Resolved rows offer no actions; they are history, not work.
  expect(screen.queryByRole('button', { name: '完成：给妈妈打电话' })).not.toBeInTheDocument();
  // Resolved entries never carry the overdue tag even with a stale due date.
  expect(screen.queryByText(/已过期/)).not.toBeInTheDocument();

  await userEvent.click(toggle);
  expect(screen.queryByText('给妈妈打电话')).not.toBeInTheDocument();
});
