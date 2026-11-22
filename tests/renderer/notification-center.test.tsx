// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { homeGreeting } from '../../src/shared/greeting';
import type { CommitmentSummary } from '../../src/shared/notifications';
import type { Reminder } from '../../src/shared/workspace';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

type SetupOptions = {
  reminders?: Reminder[];
  commitments?: CommitmentSummary[];
  snoozedUntil?: string;
};

function setup({ reminders, commitments, snoozedUntil }: SetupOptions = {}) {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  // The prototype vault has no promise file or mute, so the test supplies the
  // exact values the main process would hand the notification center.
  api.listPendingCommitments = async () => commitments ?? [];
  if (reminders) api.getReminders = async () => reminders;
  if (snoozedUntil !== undefined) {
    const original = api.getSettings.bind(api);
    api.getSettings = async () => {
      const settings = await original();
      return { ...settings, notifications: { ...settings.notifications, snoozedUntil } };
    };
  }
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  return api;
}

async function mount() {
  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByText(homeGreeting('xiaolai', new Date()));
}

function openCenter() {
  return userEvent.click(screen.getByRole('button', { name: '打开通知中心' }));
}

/**
 * Freezes the clock so "due" has a known answer: 2026-11-22 is a Sunday and
 * the demo reminders sit at 08:00 / 21:30.
 */
function freezeAt(hour: number) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 10, 22, hour, 30, 0));
}

afterEach(() => {
  vi.useRealTimers();
});

test('the bottom bar shows 通知中心 next to 设置', async () => {
  freezeAt(6);
  setup();
  await mount();

  const bell = screen.getByRole('button', { name: '打开通知中心' });
  const settings = screen.getByRole('button', { name: '打开设置' });
  // One bottom row: the bell and the gear share a parent.
  expect(bell.parentElement).toBe(settings.parentElement);
  expect(within(bell.parentElement as HTMLElement).getByTitle('通知中心')).toBe(bell);
  // Nothing actionable yet (06:30, demo reminders later), so no dot is drawn.
  expect(bell.querySelector('span.rounded-full')).toBeNull();
});

test('renders an honest empty state when nothing needs the user', async () => {
  freezeAt(6);
  setup({ reminders: [], commitments: [] });
  await mount();
  await openCenter();

  const dialog = await screen.findByRole('dialog', { name: '通知中心' });
  expect(within(dialog).getByText('暂时没有需要处理的事')).toBeInTheDocument();
  expect(within(dialog).queryByRole('list')).not.toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: '打开通知中心' }).querySelector('span.rounded-full')
  ).toBeNull();
});

test('lists one overdue reminder and one open promise, each linking to its surface', async () => {
  freezeAt(15);
  setup({
    reminders: [{ id: 'water', time: '09:00', label: '喝水', enabled: true }],
    commitments: [
      {
        id: 'cm-1',
        text: '整理错题',
        due: '2026-11-22',
        status: 'open',
        createdAt: '2026-11-21T08:00:00.000Z'
      }
    ]
  });
  await mount();

  // Real data draws the dot.
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '打开通知中心' }).querySelector('span.rounded-full')
    ).not.toBeNull()
  );
  await openCenter();

  const dialog = await screen.findByRole('dialog', { name: '通知中心' });
  const rows = within(dialog).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(within(rows[0] as HTMLElement).getByText('整理错题')).toBeInTheDocument();
  expect(within(rows[1] as HTMLElement).getByText('提醒：喝水')).toBeInTheDocument();

  // The promise row hands the user to chat, which owns the resolve tool.
  await userEvent.click(within(rows[0] as HTMLElement).getByRole('button'));
  expect(screen.queryByRole('dialog', { name: '通知中心' })).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: '日常' })).toBeInTheDocument();

  // The reminder row leads to the reminder page that owns the actions.
  await openCenter();
  const reopened = await screen.findByRole('dialog', { name: '通知中心' });
  await userEvent.click(
    within(within(reopened).getAllByRole('listitem')[1] as HTMLElement).getByRole('button')
  );
  expect(
    await screen.findByRole('switch', { name: '喝水 提醒开关' })
  ).toBeInTheDocument();
});

test('shows the active mute with a way back', async () => {
  freezeAt(6);
  setup({ reminders: [], commitments: [], snoozedUntil: '2026-11-25' });
  await mount();
  await openCenter();

  const dialog = await screen.findByRole('dialog', { name: '通知中心' });
  expect(within(dialog).getByText('已静音至 11月25日')).toBeInTheDocument();
  // A mute alone is not an action item, so the empty line stays honest.
  expect(within(dialog).getByText('暂时没有需要处理的事')).toBeInTheDocument();

  await userEvent.click(within(dialog).getByRole('button', { name: /已静音至/ }));
  expect(
    await screen.findByRole('button', { name: '恢复提醒' })
  ).toBeInTheDocument();
});
