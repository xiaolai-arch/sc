// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PracticeMistake, SubmitAnswerResult } from '../../src/shared/practice';
import { MistakeReviewDialog } from '../../src/renderer/shell/MistakeReviewDialog';
import { MistakeBook } from '../../src/renderer/shell/PracticePanels';
import { Workspace } from '../../src/renderer/shell/Workspace';
import { createMockApi } from '../../web/mock-api';

function mistake(index: number): PracticeMistake {
  return {
    id: `pm${index}`,
    workspaceId: 'kaoyan',
    setId: 'ps1',
    questionId: `q${index}`,
    prompt: `错题 ${index}`,
    options: ['错误选项', '正确选项'],
    answer: 1,
    explanation: '因为如此。',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-02',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
}

function resultFor(entry: PracticeMistake): SubmitAnswerResult {
  return {
    questionId: entry.questionId,
    setId: entry.setId,
    workspaceId: entry.workspaceId,
    choice: 1,
    correct: true,
    answer: 1,
    explanation: entry.explanation,
    attempt: {
      id: 'pa1',
      workspaceId: entry.workspaceId,
      setId: entry.setId,
      questionId: entry.questionId,
      choice: 1,
      correct: true,
      answeredAt: '2026-11-02T09:00:00.000Z'
    },
    mistake: { ...entry, correctStreak: 1, priority: 0 },
    due: '2026-11-03'
  };
}

test('answers a queued mistake and advances to the next one', async () => {
  const onReview = vi.fn(async (input) => resultFor(mistake(input.mistakeId === 'pm1' ? 1 : 2)));
  const onClose = vi.fn();
  render(
    <MistakeReviewDialog
      open
      queue={[mistake(1), mistake(2)]}
      onReview={onReview}
      onResolve={vi.fn()}
      onClose={onClose}
    />
  );

  expect(screen.getByText('错题 1')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'B. 正确选项' }));
  await userEvent.click(screen.getByRole('button', { name: '检查答案' }));

  expect(await screen.findByText('回答正确')).toBeInTheDocument();
  expect(screen.getByText('下次复习 2026-11-03')).toBeInTheDocument();
  expect(onReview).toHaveBeenCalledWith({ mistakeId: 'pm1', choice: 1 });

  await userEvent.click(screen.getByRole('button', { name: '下一题' }));
  expect(screen.getByText('错题 2')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'B. 正确选项' }));
  await userEvent.click(screen.getByRole('button', { name: '检查答案' }));
  await screen.findByText('回答正确');
  await userEvent.click(screen.getByRole('button', { name: '完成' }));
  expect(onClose).toHaveBeenCalled();
});

test('marks a mistake mastered without answering', async () => {
  const onResolve = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(
    <MistakeReviewDialog
      open
      queue={[mistake(1)]}
      onReview={vi.fn()}
      onResolve={onResolve}
      onClose={onClose}
    />
  );

  await userEvent.click(screen.getByRole('button', { name: '标记已掌握' }));

  await waitFor(() => expect(onResolve).toHaveBeenCalledWith({ mistakeId: 'pm1', resolved: true }));
  expect(onClose).toHaveBeenCalled();
});

test('lists mistakes with review actions and due markers', async () => {
  const onReview = vi.fn();
  const onResolve = vi.fn();
  render(
    <MistakeBook
      mistakes={[mistake(1), mistake(2)]}
      dueIds={new Set(['pm1'])}
      onReview={onReview}
      onResolve={onResolve}
    />
  );

  expect(screen.getByText('今天到期 1 道')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '复习错题：错题 2' }));
  expect(onReview).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm2' }));
  await userEvent.click(screen.getByRole('button', { name: '标记已掌握：错题 1' }));
  expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ id: 'pm1' }));
});

test('reviews a real mistake from the practice panel and records the answer', async () => {
  localStorage.clear();
  const api = createMockApi(localStorage, { streamPace: 0.05 });
  window.studyCoach = api;
  window.studyCoachPrototype = { reset: vi.fn() };
  const set = await api.getPracticeSet('ps1');
  const question = set!.questions[0]!;
  await api.submitPracticeAnswer({ questionId: question.id, choice: 0 });
  expect((await api.getPracticeMistakes('kaoyan'))[0]?.correctStreak).toBe(0);

  render(<Workspace hasApiKey={false} onRefresh={vi.fn()} />);
  await screen.findByRole('button', { name: '全部工作区' });
  await userEvent.click(screen.getByRole('button', { name: '全部工作区' }));
  await userEvent.click(await screen.findByRole('button', { name: '练习' }));

  await userEvent.click(
    await screen.findByRole('button', { name: `复习错题：${question.prompt}` })
  );
  const dialog = await screen.findByRole('dialog', { name: '复习错题' });
  await userEvent.click(
    within(dialog).getByRole('button', { name: `B. ${question.options[1]}` })
  );
  await userEvent.click(within(dialog).getByRole('button', { name: '检查答案' }));

  expect(await within(dialog).findByText('回答正确')).toBeInTheDocument();
  expect((await api.getPracticeMistakes('kaoyan'))[0]).toMatchObject({
    correctStreak: 1,
    status: 'active'
  });

  await userEvent.click(within(dialog).getByRole('button', { name: '完成' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: '复习错题' })).not.toBeInTheDocument()
  );
});
