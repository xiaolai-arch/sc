// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  TodayOverview,
  todayQuizOffer
} from '../../src/renderer/shell/TodayOverview';
import type { PracticeAttempt, PracticeMistake } from '../../src/shared/practice';
import type { Workspace } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: ''
};

const TODAY = '2026-11-21';

function mistake(index: number, due: string): PracticeMistake {
  return {
    id: `pm${index}`,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: `q${index}`,
    prompt: `错题 ${index}`,
    options: ['A', 'B'],
    answer: 0,
    explanation: '',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due,
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
}

function attempt(id: string, answeredAt: string, correct: boolean): PracticeAttempt {
  return {
    id,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: 'q1',
    choice: correct ? 1 : 0,
    correct,
    answeredAt
  };
}

/** A batch of attempts inside the current 8-week window with the given accuracy. */
function recentAttempts(correct: number, wrong: number): PracticeAttempt[] {
  const attempts: PracticeAttempt[] = [];
  for (let index = 0; index < correct; index += 1) {
    attempts.push(attempt(`pa-c${index}`, '2026-11-20T09:00:00.000Z', true));
  }
  for (let index = 0; index < wrong; index += 1) {
    attempts.push(attempt(`pa-w${index}`, '2026-11-19T09:00:00.000Z', false));
  }
  return attempts;
}

describe('todayQuizOffer (attempts + mistakes → offer)', () => {
  test('a weak 8-week record with enough volume becomes a low-accuracy offer', () => {
    const offer = todayQuizOffer(recentAttempts(4, 6), [], TODAY, null);

    expect(offer).toEqual({
      reason: 'low-accuracy',
      text: '最近 8 周正确率 40%，做 3 道找找手感？'
    });
  });

  test('a healthy record stays silent', () => {
    expect(todayQuizOffer(recentAttempts(8, 2), [], TODAY, null)).toBeNull();
  });

  test('a low accuracy on too few recent answers stays silent', () => {
    expect(todayQuizOffer(recentAttempts(1, 3), [], TODAY, null)).toBeNull();
  });

  test('attempts older than the 8-week window do not feed the offer', () => {
    const stale = [
      attempt('pa-old1', '2026-09-10T09:00:00.000Z', false),
      attempt('pa-old2', '2026-09-11T09:00:00.000Z', false),
      attempt('pa-old3', '2026-09-12T09:00:00.000Z', false)
    ];
    expect(todayQuizOffer(stale, [], TODAY, null)).toBeNull();
  });

  test('due mistakes win over a weak record and name the real count', () => {
    const offer = todayQuizOffer(
      recentAttempts(3, 7),
      [mistake(1, '2026-11-21'), mistake(2, '2026-11-20'), mistake(3, '2026-11-15')],
      TODAY,
      null
    );

    expect(offer).toEqual({
      reason: 'due-mistakes',
      text: '你有 3 道到期错题，抽 5 分钟做 3 道？'
    });
  });

  test('an offer shown today is cooled down; yesterday it comes back', () => {
    const mistakes = [mistake(1, TODAY), mistake(2, TODAY), mistake(3, TODAY)];

    expect(todayQuizOffer([], mistakes, TODAY, TODAY)).toBeNull();
    expect(todayQuizOffer([], mistakes, TODAY, '2026-11-20')?.reason).toBe('due-mistakes');
  });
});

function renderOverview(
  overrides: Partial<Parameters<typeof TodayOverview>[0]> = {}
) {
  const onPrompt = vi.fn();
  const { container } = render(
    <TodayOverview
      tasks={[]}
      workspaces={[workspace]}
      reminders={[]}
      longPlans={[]}
      today={TODAY}
      compact
      onOpenWorkspace={vi.fn()}
      onOpenSchedule={vi.fn()}
      onOpenPlan={vi.fn()}
      onOpenReminders={vi.fn()}
      onToggleTask={vi.fn()}
      onPrompt={onPrompt}
      {...overrides}
    />
  );
  return { onPrompt, container };
}

describe('the today card renders the quiz offer', () => {
  test('the offer line and its one button send the exact quiz prompt', async () => {
    const { onPrompt } = renderOverview({
      quizOffer: { reason: 'due-mistakes', text: '你有 4 道到期错题，抽 5 分钟做 3 道？' }
    });

    expect(
      screen.getByText('你有 4 道到期错题，抽 5 分钟做 3 道？')
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '开始 3 道' }));
    expect(onPrompt).toHaveBeenCalledTimes(1);
    expect(onPrompt).toHaveBeenCalledWith('考考我，出 3 道题');
  });

  test('no offer means no offer button', () => {
    renderOverview();

    expect(screen.queryByRole('button', { name: '开始 3 道' })).not.toBeInTheDocument();
    expect(screen.queryByText(/到期错题|找找手感/)).not.toBeInTheDocument();
  });

  test('the revisit line stays ahead of the quiz offer when both show', () => {
    const { container } = renderOverview({
      revisits: [{ topicId: 'kt-1', name: 'LangChain' }],
      quizOffer: { reason: 'due-mistakes', text: '你有 3 道到期错题，抽 5 分钟做 3 道？' }
    });

    expect(screen.getByText('今天是「LangChain」的回访日：让阿咲抽 3 道？')).toBeInTheDocument();
    expect(screen.getByText('你有 3 道到期错题，抽 5 分钟做 3 道？')).toBeInTheDocument();
    // Both lines render; the revisit answers "what was taught", the offer
    // answers "what the data says", and the revisit is read first.
    const text = container.textContent ?? '';
    expect(text.indexOf('LangChain')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('LangChain')).toBeLessThan(text.indexOf('到期错题'));
    expect(screen.getByRole('button', { name: '抽 3 道复习「LangChain」' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '开始 3 道' })).toBeInTheDocument();
  });

  test('the offer renders even when there is nothing to revisit', () => {
    renderOverview({
      quizOffer: { reason: 'low-accuracy', text: '最近 8 周正确率 52%，做 3 道找找手感？' }
    });

    expect(screen.queryByText(/回访日/)).not.toBeInTheDocument();
    expect(
      screen.getByText('最近 8 周正确率 52%，做 3 道找找手感？')
    ).toBeInTheDocument();
  });
});
