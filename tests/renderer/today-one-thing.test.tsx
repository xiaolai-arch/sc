// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TodayOverview,
  type OneThingPreference,
  type OneThingStore
} from '../../src/renderer/shell/TodayOverview';
import type { Workspace, WorkspaceTask } from '../../src/shared/workspace';
import { Workspace as WorkspaceShell } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

const examWorkspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: ''
};

const TODAY = '2026-11-21';

function task(
  id: string,
  title: string,
  overrides: Partial<WorkspaceTask> = {}
): WorkspaceTask {
  return {
    id,
    workspaceId: 'ws-exam',
    title,
    subject: '数学',
    durationMin: 45,
    acceptance: '',
    status: 'pending',
    ...overrides
  };
}

const TASKS: WorkspaceTask[] = [
  task('t1', '极限基础', { status: 'in-progress', startAt: `${TODAY}T09:00` }),
  task('t2', '阅读理解', { startAt: `${TODAY}T10:30` }),
  task('t3', '408 数据结构', { durationMin: 60 })
];

/** A store whose contents survive an unmount, like localStorage does. */
function memoryStore(initial: OneThingPreference | null = null) {
  let stored = initial;
  const store: OneThingStore = {
    load: () => stored,
    save: (preference) => {
      stored = preference;
    }
  };
  return { store, peek: () => stored };
}

function renderToday(
  overrides: Partial<Parameters<typeof TodayOverview>[0]> = {}
) {
  const onToggleTask = vi.fn();
  const utils = render(
    <TodayOverview
      tasks={TASKS}
      workspaces={[examWorkspace]}
      reminders={[]}
      longPlans={[]}
      today={TODAY}
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={onToggleTask}
      onPrompt={vi.fn()}
      {...overrides}
    />
  );
  return { onToggleTask, ...utils };
}

function card() {
  return within(screen.getByRole('region', { name: '接下来' }));
}

function toggle() {
  return screen.getByRole('switch', { name: '今日只做一件' });
}

async function turnOnAndChoose(title: string) {
  await userEvent.click(toggle());
  await userEvent.click(screen.getByRole('button', { name: `只做这件：${title}` }));
}

describe('今日只做一件', () => {
  test('off by default: the whole day renders and nothing about one-thing shows', () => {
    renderToday({ oneThingStore: memoryStore().store });

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(card().getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByText(/今天只做这一件/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /只做这件/ })).not.toBeInTheDocument();
  });

  test('on + chosen: only the chosen task shows, the rest fold behind 还有 2 件（展开）', async () => {
    renderToday({ oneThingStore: memoryStore().store });

    await userEvent.click(toggle());
    // Turning the mode on alone picks nothing yet, so the day still shows.
    expect(card().getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByText(/今天只做这一件/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '只做这件：阅读理解' }));

    expect(screen.getByText('今天只做这一件。做完再选下一件。')).toBeInTheDocument();
    expect(card().getAllByRole('checkbox')).toHaveLength(1);
    expect(card().getByText('阅读理解')).toBeInTheDocument();
    expect(card().queryByText('极限基础')).not.toBeInTheDocument();
    expect(card().queryByText('408 数据结构')).not.toBeInTheDocument();

    const expand = screen.getByRole('button', { name: '还有 2 件（展开）' });
    expect(expand).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(expand);
    expect(card().getAllByRole('checkbox')).toHaveLength(3);
    expect(card().getByText('极限基础')).toBeInTheDocument();
    expect(card().getByText('408 数据结构')).toBeInTheDocument();
    expect(expand).toHaveAttribute('aria-expanded', 'true');
    expect(expand).toHaveTextContent('收起');

    await userEvent.click(expand);
    expect(card().getAllByRole('checkbox')).toHaveLength(1);
    expect(expand).toHaveTextContent('还有 2 件（展开）');
  });

  test('picking another task replaces the choice', async () => {
    const store = memoryStore();
    renderToday({ oneThingStore: store.store });

    await turnOnAndChoose('阅读理解');
    await userEvent.click(screen.getByRole('button', { name: '还有 2 件（展开）' }));
    await userEvent.click(screen.getByRole('button', { name: '只做这件：408 数据结构' }));

    expect(card().getAllByRole('checkbox')).toHaveLength(1);
    expect(card().getByText('408 数据结构')).toBeInTheDocument();
    expect(card().queryByText('阅读理解')).not.toBeInTheDocument();
    expect(store.peek()).toEqual({ enabled: true, date: TODAY, taskId: 't3' });
  });

  test('completing the chosen task shows the honest prompt and keeps the fold', async () => {
    const store = memoryStore();
    const { rerender, onToggleTask } = renderToday({ oneThingStore: store.store });

    await turnOnAndChoose('阅读理解');
    // The real shell flips the task to done; the card receives the new list.
    await userEvent.click(card().getByRole('checkbox', { name: '完成任务：阅读理解' }));
    expect(onToggleTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't2' }));

    rerender(
      <TodayOverview
        tasks={TASKS.map((entry) =>
          entry.id === 't2' ? { ...entry, status: 'done' } : entry
        )}
        workspaces={[examWorkspace]}
        reminders={[]}
        longPlans={[]}
        today={TODAY}
        oneThingStore={store.store}
        onOpenWorkspace={vi.fn()}
        onOpenSchedule={vi.fn()}
        onOpenPlan={vi.fn()}
        onOpenReminders={vi.fn()}
        onToggleTask={vi.fn()}
        onPrompt={vi.fn()}
      />
    );

    expect(screen.getByText('做完了。要不要再选一件？')).toBeInTheDocument();
    expect(screen.queryByText(/今天只做这一件/)).not.toBeInTheDocument();
    expect(card().queryByText('阅读理解')).not.toBeInTheDocument();

    // The rest stays folded until the user expands and picks.
    const expand = screen.getByRole('button', { name: '还有 2 件（展开）' });
    await userEvent.click(expand);
    expect(card().getAllByRole('checkbox')).toHaveLength(2);
    expect(card().getByText('极限基础')).toBeInTheDocument();
    expect(card().getByText('408 数据结构')).toBeInTheDocument();
  });

  test('the mode and choice survive a remount; a new local day drops the choice', async () => {
    const store = memoryStore();
    const first = renderToday({ oneThingStore: store.store });
    await turnOnAndChoose('阅读理解');
    expect(store.peek()).toEqual({ enabled: true, date: TODAY, taskId: 't2' });

    // Remount on the same day: same mode, same choice, nothing to redo.
    first.unmount();
    const second = renderToday({ oneThingStore: store.store });
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(card().getAllByRole('checkbox')).toHaveLength(1);
    expect(card().getByText('阅读理解')).toBeInTheDocument();
    second.unmount();

    // A new local day keeps the toggle but forgets the choice. Undated tasks,
    // so nothing is filtered out by the day change itself.
    const undated = TASKS.map(({ startAt: _startAt, ...entry }) => entry);
    renderToday({ today: '2026-11-22', tasks: undated, oneThingStore: store.store });
    expect(toggle()).toHaveAttribute('aria-checked', 'true');
    expect(card().getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByText(/今天只做这一件/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /还有 .* 件（展开）/ })).not.toBeInTheDocument();
  });

  test('turning the mode off restores the full day and forgets the choice', async () => {
    const store = memoryStore();
    renderToday({ oneThingStore: store.store });
    await turnOnAndChoose('阅读理解');

    await userEvent.click(toggle());

    expect(toggle()).toHaveAttribute('aria-checked', 'false');
    expect(card().getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.queryByText(/今天只做这一件/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /只做这件/ })).not.toBeInTheDocument();
    expect(store.peek()).toEqual({ enabled: false, date: TODAY, taskId: null });
  });
});

describe('workspace shell wiring', () => {
  function setup() {
    localStorage.clear();
    const api = createMockApi(localStorage, { streamPace: 0.05 });
    window.studyCoach = api;
    window.studyCoachPrototype = { reset: vi.fn() };
    const utils = render(<WorkspaceShell hasApiKey={false} onRefresh={vi.fn()} />);
    return { api, ...utils };
  }

  function nav() {
    return within(screen.getByRole('navigation', { name: '主导航' }));
  }

  test('the mode persists under the lightweight-prefs key and survives a restart', async () => {
    const first = setup();
    await screen.findByRole('region', { name: '接下来' });
    await userEvent.click(nav().getByRole('button', { name: '今日' }));

    await userEvent.click(await screen.findByRole('switch', { name: '今日只做一件' }));
    await userEvent.click(screen.getByRole('button', { name: '只做这件：极限与连续' }));

    const stored = localStorage.getItem('asaki:today-one-thing');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored as string) as OneThingPreference;
    expect(parsed.enabled).toBe(true);
    expect(typeof parsed.taskId).toBe('string');
    expect(parsed.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(screen.getByText('今天只做这一件。做完再选下一件。')).toBeInTheDocument();
    first.unmount();

    // A restart: a fresh mini-web loads the same localStorage profile.
    const api = createMockApi(localStorage, { streamPace: 0.05 });
    window.studyCoach = api;
    window.studyCoachPrototype = { reset: vi.fn() };
    render(<WorkspaceShell hasApiKey={false} onRefresh={vi.fn()} />);
    await screen.findByRole('region', { name: '接下来' });
    await userEvent.click(nav().getByRole('button', { name: '今日' }));

    expect(await screen.findByRole('switch', { name: '今日只做一件' })).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getByText('今天只做这一件。做完再选下一件。')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: '接下来' })).getAllByRole('checkbox')
    ).toHaveLength(1);
  });

  test('the compact chat-home card never offers the mode', async () => {
    setup();
    await screen.findByRole('region', { name: '接下来' });

    expect(screen.queryByRole('switch', { name: '今日只做一件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /只做这件/ })).not.toBeInTheDocument();
    expect(localStorage.getItem('asaki:today-one-thing')).toBeNull();
  });
});
