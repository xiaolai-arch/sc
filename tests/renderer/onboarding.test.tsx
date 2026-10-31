// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Onboarding } from '../../src/renderer/onboarding/Onboarding';

test('submits a valid exam profile', async () => {
  const complete = vi.fn().mockResolvedValue(undefined);
  window.studyCoach = { completeOnboarding: complete } as never;
  render(<Onboarding />);
  fireEvent.change(screen.getByLabelText('考试日期'), { target: { value: '2027-12-18' } });
  await userEvent.type(screen.getByLabelText('考试科目（逗号分隔）'), '数学一,英语一,政治');
  await userEvent.clear(screen.getByLabelText('每天可用分钟数'));
  await userEvent.type(screen.getByLabelText('每天可用分钟数'), '300');
  await userEvent.click(screen.getByRole('button', { name: '生成我的学习计划' }));
  expect(complete).toHaveBeenCalledWith(expect.objectContaining({ dailyMinutes: 300, examDate: '2027-12-18' }));
});
