// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewDialog } from '../../src/renderer/review/ReviewDialog';
import { TodayPage } from '../../src/renderer/today/TodayPage';

test('submits review answers', async () => {
  const submit = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { submitReview: submit } as never;
  render(<ReviewDialog date="2026-10-31" onClose={() => {}} />);
  await userEvent.type(screen.getByLabelText('今天完成了什么？'), '数学');
  await userEvent.type(screen.getByLabelText('卡在哪里？'), '极限');
  await userEvent.type(screen.getByLabelText('明天想怎么调整？'), '先复习');
  await userEvent.click(screen.getByRole('button', { name: '保存复盘' }));
  expect(submit).toHaveBeenCalledWith({
    date: '2026-10-31',
    answers: { completed: '数学', stuck: '极限', tomorrow: '先复习' }
  });
});

test('opens the review dialog from the today page', async () => {
  window.studyCoach = {
    getTodayPlan: vi.fn().mockResolvedValue({ date: '2026-10-31', generatedBy: 'template', tasks: [] }),
    submitReview: vi.fn()
  } as never;
  render(<TodayPage />);
  await userEvent.click(await screen.findByRole('button', { name: '复盘' }));
  expect(screen.getByLabelText('今天完成了什么？')).toBeInTheDocument();
});

test('focuses the first field and closes on escape', async () => {
  const onClose = vi.fn();
  render(<ReviewDialog date="2026-10-31" onClose={onClose} />);
  expect(screen.getByLabelText('今天完成了什么？')).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalled();
});
