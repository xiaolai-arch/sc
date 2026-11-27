// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  dueRevisitTopics,
  examWholePaperHint,
  TodayOverview
} from '../../src/renderer/shell/TodayOverview';
import {
  EXAM_WRITING_APPENDIX,
  ReviewRecords,
  REVIEW_OPENING_PROMPT,
  reviewOpeningPrompt,
  type ExamWritingStore
} from '../../src/renderer/shell/ReviewRecords';
import { examWindowDaysLeft } from '../../src/shared/workspace';
import type { ReviewRecord } from '../../src/shared/ipc';
import type { KnowledgeTopic } from '../../src/shared/knowledge';
import type { Workspace, WorkspaceKind } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: ''
};

/** The exam from `workspace`, counting down to a date N whole days ahead. */
function examWithDays(days: number, kind: WorkspaceKind = 'exam'): Workspace {
  const target = new Date(2026, 10, 21 + days); // local-date arithmetic, no TZ
  const pad = (value: number) => String(value).padStart(2, '0');
  const targetDate = `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(
    target.getDate()
  )}`;
  return { ...workspace, kind, targetDate };
}

function knowledgeTopic(
  overrides: Partial<KnowledgeTopic> & Pick<KnowledgeTopic, 'id' | 'name'>
): KnowledgeTopic {
  return {
    aliases: [],
    status: 'learning',
    summary: '',
    evidence: [],
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

function renderOverview(revisits: Parameters<typeof TodayOverview>[0]['revisits']) {
  const onPrompt = vi.fn();
  render(
    <TodayOverview
      tasks={[]}
      workspaces={[workspace]}
      reminders={[]}
      longPlans={[]}
      today="2026-11-21"
      revisits={revisits}
      compact
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={onPrompt}
    />
  );
  return { onPrompt };
}

/** Page-form Today page (non-compact) with one workspace under test. */
function renderTodayPage(workspaces: Workspace[]) {
  return render(
    <TodayOverview
      tasks={[]}
      workspaces={workspaces}
      reminders={[]}
      longPlans={[]}
      today="2026-11-21"
      onOpenSidebar={vi.fn()}
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={vi.fn()}
    />
  );
}

test('a due topic gets one revisit line and the quiz button targets it', async () => {
  const { onPrompt } = renderOverview([{ topicId: 'kt-1', name: 'LangChain' }]);

  expect(
    screen.getByText('今天是「LangChain」的回访日：让阿咲抽 3 道？')
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '抽 3 道复习「LangChain」' }));
  expect(onPrompt).toHaveBeenCalledTimes(1);
  expect(onPrompt).toHaveBeenCalledWith('考考我「LangChain」，出 3 道题');
});

test('no due topics means no revisit line', () => {
  renderOverview([]);

  expect(screen.queryByText(/回访日/)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /抽 3 道/ })).not.toBeInTheDocument();
});

test('dueRevisitTopics keeps due and overdue topics, drops the rest', () => {
  const topics = [
    knowledgeTopic({ id: 'kt-future', name: '级数', revisitDue: '2026-11-25' }),
    knowledgeTopic({ id: 'kt-overdue', name: '积分', revisitDue: '2026-11-19' }),
    knowledgeTopic({ id: 'kt-due', name: '极限', revisitDue: '2026-11-21' }),
    knowledgeTopic({ id: 'kt-none', name: '向量' })
  ];

  expect(dueRevisitTopics(topics, '2026-11-21')).toEqual([
    { topicId: 'kt-overdue', name: '积分' },
    { topicId: 'kt-due', name: '极限' }
  ]);
  expect(dueRevisitTopics([], '2026-11-21')).toEqual([]);
});

describe('examWindowDaysLeft (pre-exam window boundaries)', () => {
  test('days 0 and 14 are inside the window, 15 and -1 are outside', () => {
    expect(examWindowDaysLeft(examWithDays(0), '2026-11-21')).toBe(0);
    expect(examWindowDaysLeft(examWithDays(14), '2026-11-21')).toBe(14);
    expect(examWindowDaysLeft(examWithDays(15), '2026-11-21')).toBeNull();
    expect(examWindowDaysLeft(examWithDays(-1), '2026-11-21')).toBeNull();
  });

  test('only exam projects count; missing projects and target dates stay silent', () => {
    expect(examWindowDaysLeft(examWithDays(4, 'study'), '2026-11-21')).toBeNull();
    expect(examWindowDaysLeft(examWithDays(4, 'project'), '2026-11-21')).toBeNull();
    expect(examWindowDaysLeft(examWithDays(4, 'life'), '2026-11-21')).toBeNull();
    expect(
      examWindowDaysLeft({ ...workspace, targetDate: undefined }, '2026-11-21')
    ).toBeNull();
    expect(examWindowDaysLeft(null, '2026-11-21')).toBeNull();
  });
});

describe('examWholePaperHint (the line under the countdown)', () => {
  test('inside the window it is one neutral sentence pointing at 学习 → 练习集', () => {
    expect(examWholePaperHint(examWithDays(4), '2026-11-21')).toBe(
      '距考试还有 4 天——适合来一次整卷模拟（学习 → 练习集）。'
    );
    expect(examWholePaperHint(examWithDays(5), 'study-day')).toBeNull();
  });
});

describe('the Today page whole-paper hint line (acceptance 26)', () => {
  test('exam inside the window: the hint appears under the countdown, in the same neutral gray', () => {
    renderTodayPage([examWithDays(4)]);

    expect(
      screen.getByText('距考试还有 4 天——适合来一次整卷模拟（学习 → 练习集）。')
    ).toBeInTheDocument();
    // The countdown line above it is untouched.
    expect(
      screen.getByRole('status', { name: '目标倒计时' })
    ).toHaveTextContent('距离目标 2026-11-25 还有 4 天');
    // Neutral styling: the exact same gray as the countdown line, no alarm red.
    const hint = screen.getByText(
      '距考试还有 4 天——适合来一次整卷模拟（学习 → 练习集）。'
    );
    expect(hint.className).toContain('text-gray-500');
    expect(hint.className).toMatch(/text-gray-500 dark:text-\[#8e8e93\]/);
  });

  test('window edges: day 0 and day 14 show it, day 15 and a passed date do not', () => {
    let unmount = renderTodayPage([examWithDays(0)]).unmount;
    expect(screen.getByText('距考试还有 0 天——适合来一次整卷模拟（学习 → 练习集）。')).toBeInTheDocument();
    unmount();

    unmount = renderTodayPage([examWithDays(14)]).unmount;
    expect(screen.getByText('距考试还有 14 天——适合来一次整卷模拟（学习 → 练习集）。')).toBeInTheDocument();
    unmount();

    unmount = renderTodayPage([examWithDays(15)]).unmount;
    expect(screen.queryByText(/整卷模拟/)).not.toBeInTheDocument();
    unmount();

    renderTodayPage([examWithDays(-1)]);
    expect(screen.queryByText(/整卷模拟/)).not.toBeInTheDocument();
  });

  test('a non-exam countdown project never earns the hint', () => {
    renderTodayPage([examWithDays(4, 'study')]);

    expect(
      screen.getByRole('status', { name: '目标倒计时' })
    ).toHaveTextContent('距离目标 2026-11-25 还有 4 天');
    expect(screen.queryByText(/整卷模拟/)).not.toBeInTheDocument();
  });

  test('the compact chat-home card has no countdown and therefore no hint', () => {
    render(
      <TodayOverview
        compact
        tasks={[]}
        workspaces={[examWithDays(4)]}
        reminders={[]}
        longPlans={[]}
        today="2026-11-21"
        onOpenWorkspace={vi.fn()}
        onOpenSchedule={vi.fn()}
        onOpenPlan={vi.fn()}
        onOpenReminders={vi.fn()}
        onToggleTask={vi.fn()}
        onPrompt={vi.fn()}
      />
    );

    expect(screen.queryByText(/整卷模拟/)).not.toBeInTheDocument();
  });
});

describe('the one-time pre-exam writing ask (acceptance 28/29/30)', () => {
  /** A fake ExamWritingStore over a visible map, so tests can clear it. */
  function fakeStore(): ExamWritingStore & { map: Map<string, string> } {
    const map = new Map<string, string>();
    return {
      map,
      load: (targetDate) => map.get(targetDate) ?? null,
      save: (targetDate, sentOn) => {
        map.set(targetDate, sentOn);
      }
    };
  }

  function reviewOf(workspaceId?: string): ReviewRecord {
    return {
      date: '2026-11-15',
      submittedAt: '2026-11-15T21:30:00',
      ...(workspaceId ? { workspaceId } : {}),
      completed: '完成数学 10 题',
      stuck: '极限定义',
      tomorrow: '复盘错题'
    };
  }

  function renderRecords(options?: {
    workspace?: Workspace | null;
    workspaces?: Workspace[];
    reviews?: ReviewRecord[];
    today?: string;
    store?: ExamWritingStore;
  }) {
    const onPrompt = vi.fn();
    render(
      <ReviewRecords
        workspaces={options?.workspaces ?? [examWithDays(4)]}
        workspace={options?.workspace ?? null}
        reviews={options?.reviews ?? []}
        today={options?.today ?? '2026-11-21'}
        {...(options?.store ? { examWritingStore: options.store } : {})}
        onPrompt={onPrompt}
      />
    );
    return { onPrompt };
  }

  test('first click inside the window appends the sentence and writes the marker', async () => {
    const store = fakeStore();
    const { onPrompt } = renderRecords({ workspace: examWithDays(4), store });

    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));

    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith(
      '我们开始今天复盘 先花两分钟写下你现在最担心考试的一件事，写完我们继续复盘。'
    );
    // Send-and-mark: one key per target date, value = the send day.
    expect(store.map.get('2026-11-25')).toBe('2026-11-21');
  });

  test('second click for the same target date is byte-identical to the baseline', async () => {
    const store = fakeStore();
    const { onPrompt } = renderRecords({ workspace: examWithDays(4), store });

    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));
    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));

    expect(onPrompt).toHaveBeenCalledTimes(2);
    expect(onPrompt).toHaveBeenLastCalledWith(REVIEW_OPENING_PROMPT);
    expect(onPrompt).toHaveBeenLastCalledWith('我们开始今天复盘');
    expect(store.map.get('2026-11-25')).toBe('2026-11-21');
  });

  test('clearing the store makes the ask appear again, and nothing else changes', async () => {
    const store = fakeStore();
    const { onPrompt } = renderRecords({ workspace: examWithDays(4), store });

    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));
    store.map.clear(); // 清空本地标记
    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));

    expect(onPrompt).toHaveBeenLastCalledWith(
      `我们开始今天复盘 ${EXAM_WRITING_APPENDIX}`
    );
    expect(onPrompt).toHaveBeenCalledTimes(2); // still just one message per click
  });

  test('outside the window the opening stays byte-identical and no marker is written', async () => {
    for (const outside of [
      examWithDays(4, 'study'), // not an exam
      examWithDays(15), // countdown > 14
      examWithDays(-1) // target date passed
    ]) {
      const store = fakeStore();
      const onPrompt = vi.fn();
      const { unmount } = render(
        <ReviewRecords
          workspaces={[outside]}
          workspace={outside}
          reviews={[reviewOf(outside.id)]}
          today="2026-11-21"
          examWritingStore={store}
          onPrompt={onPrompt}
        />
      );

      await userEvent.click(screen.getByRole('button', { name: '开始复盘' }));

      expect(onPrompt).toHaveBeenCalledTimes(1);
      expect(onPrompt).toHaveBeenCalledWith('我们开始今天复盘');
      expect(store.map.size).toBe(0);
      unmount();
    }
  });

  test('on 全部项目 the countdown project carries the window', async () => {
    const store = fakeStore();
    const { onPrompt } = renderRecords({
      workspace: null, // 全部项目
      workspaces: [examWithDays(4)],
      store
    });

    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));

    expect(onPrompt).toHaveBeenCalledWith(
      '我们开始今天复盘 先花两分钟写下你现在最担心考试的一件事，写完我们继续复盘。'
    );
    expect(store.map.get('2026-11-25')).toBe('2026-11-21');
  });

  test('without an injected store the ask is off: baseline opening, feature purely opt-in', async () => {
    const { onPrompt } = renderRecords({ workspace: examWithDays(4) });

    await userEvent.click(screen.getByRole('button', { name: '开始今天复盘' }));

    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith('我们开始今天复盘');
  });

  test('the writing sentence rides inside the one opening message — no new field or outlet', () => {
    // Acceptance 29: the sentence is part of the very message that already
    // flows to the butler (and from there through the untouched save_review
    // pipeline). It is a string suffix, not a separate payload: the pure
    // builder returns exactly one string, and the component hands that single
    // string to its only output channel, onPrompt.
    const withAsk = reviewOpeningPrompt({
      workspace: examWithDays(4),
      today: '2026-11-21',
      askedOn: null
    });
    expect(typeof withAsk).toBe('string');
    expect(withAsk).toBe(
      `${REVIEW_OPENING_PROMPT} ${EXAM_WRITING_APPENDIX}`
    );
    // A marker already set (or any non-window project) yields the baseline:
    // no residual payload, no second message, nothing to analyze.
    expect(
      reviewOpeningPrompt({
        workspace: examWithDays(4),
        today: '2026-11-21',
        askedOn: '2026-11-21'
      })
    ).toBe('我们开始今天复盘');
    expect(
      reviewOpeningPrompt({
        workspace: examWithDays(4, 'project'),
        today: '2026-11-21',
        askedOn: null
      })
    ).toBe('我们开始今天复盘');
  });
});
