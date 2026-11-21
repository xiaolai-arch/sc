// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PracticeAttempt, PracticeConfidence } from '../../src/shared/practice';
import { CALIBRATION_WEEKS, calibration } from '../../src/renderer/shell/calibration';
import { CalibrationCard, ConfidencePicker } from '../../src/renderer/shell/CalibrationCard';

// Saturday 21 November 2026; the current Monday-based week runs 11-16..11-22,
// so the 8-week window spans 2026-09-28 .. 2026-11-22.
const today = new Date(2026, 10, 21);

function attempt(overrides: Partial<PracticeAttempt> = {}): PracticeAttempt {
  return {
    id: 'a1',
    workspaceId: 'kaoyan',
    setId: 'set-1',
    questionId: 'q1',
    choice: 0,
    correct: true,
    answeredAt: '2026-11-21T10:00',
    ...overrides
  };
}

test('counts sure and unsure attempts separately over the last 8 weeks', () => {
  const data = calibration(
    [
      attempt({ id: 's1', confidence: 'sure', correct: false }),
      attempt({ id: 's2', confidence: 'sure', correct: true }),
      attempt({ id: 's3', confidence: 'sure', correct: true }),
      attempt({ id: 'u1', confidence: 'unsure', correct: false }),
      attempt({ id: 'u2', confidence: 'unsure', correct: true })
    ],
    today
  );

  expect(data).toMatchObject({ sureTotal: 3, sureWrong: 1, unsureTotal: 2, unsureWrong: 1 });
  expect(data.hasData).toBe(true);
  expect(data.line).toBe('近 8 周：有把握的 3 题错 1 道（33%）· 不确定的 2 题错 1 道');
});

test('ignores attempts without confidence', () => {
  const data = calibration(
    [
      attempt({ id: 'plain-1', correct: false }),
      attempt({ id: 'plain-2', correct: true }),
      attempt({ id: 's1', confidence: 'sure', correct: false })
    ],
    today
  );

  // The two plain attempts are not counted anywhere.
  expect(data.sureTotal).toBe(1);
  expect(data.unsureTotal).toBe(0);
  expect(data.line).toBe('近 8 周：有把握的 1 题错 1 道（100%）');
});

test('ignores confidence-marked attempts outside the 8-week window', () => {
  const data = calibration(
    [
      attempt({ id: 'in', confidence: 'sure', correct: false, answeredAt: '2026-11-20T10:00' }),
      attempt({ id: 'day-before', confidence: 'sure', correct: false, answeredAt: '2026-09-27T10:00' }),
      attempt({ id: 'way-old', confidence: 'unsure', correct: false, answeredAt: '2026-08-01T10:00' }),
      attempt({ id: 'future', confidence: 'sure', correct: false, answeredAt: '2026-12-05T10:00' })
    ],
    today
  );

  expect(data.sureTotal).toBe(1);
  expect(data.sureWrong).toBe(1);
  expect(data.unsureTotal).toBe(0);
});

test('ignores unparseable timestamps', () => {
  const data = calibration(
    [attempt({ id: 'invalid', confidence: 'sure', correct: false, answeredAt: 'not-a-date' })],
    today
  );

  expect(data.hasData).toBe(false);
  expect(data.line).toBeNull();
});

test('no confident attempts means no line and no data at all', () => {
  const data = calibration([attempt({ id: 'plain', correct: false })], today);

  expect(data).toMatchObject({ sureTotal: 0, sureWrong: 0, unsureTotal: 0, unsureWrong: 0 });
  expect(data.hasData).toBe(false);
  expect(data.line).toBeNull();
});

test('an empty window has no data and stays at eight weeks', () => {
  expect(calibration([], today)).toMatchObject({ hasData: false, line: null });
  expect(CALIBRATION_WEEKS).toBe(8);
});

test('renders the exact line for a small fixture', () => {
  const fixture: [string, PracticeConfidence, boolean][] = [
    ['s1', 'sure', false],
    ['s2', 'sure', true],
    ['s3', 'sure', true],
    ['u1', 'unsure', false]
  ];
  render(
    <CalibrationCard
      today={today}
      attempts={fixture.map(([id, confidence, correct], index) =>
        attempt({
          id,
          confidence,
          correct,
          answeredAt: `2026-11-${String(10 + index).padStart(2, '0')}T10:00`
        })
      )}
    />
  );

  expect(screen.getByRole('heading', { name: '把握度校准' })).toBeInTheDocument();
  expect(
    screen.getByText('近 8 周：有把握的 3 题错 1 道（33%）· 不确定的 1 题错 1 道')
  ).toBeInTheDocument();
  expect(screen.getByText(/自认有把握却答错的/)).toBeInTheDocument();
});

test('renders nothing at all when no attempt carries confidence', () => {
  const view = render(
    <CalibrationCard today={today} attempts={[attempt({ correct: false })]} />
  );

  expect(view.container).toBeEmptyDOMElement();
});

test('the picker offers two exclusive marks, none selected by default', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ConfidencePicker value={undefined} onChange={onChange} />);

  const sure = screen.getByRole('button', { name: '有把握' });
  const unsure = screen.getByRole('button', { name: '不确定' });
  expect(sure).toHaveAttribute('aria-pressed', 'false');
  expect(unsure).toHaveAttribute('aria-pressed', 'false');

  await user.click(sure);
  expect(onChange).toHaveBeenLastCalledWith('sure');
  await user.click(unsure);
  expect(onChange).toHaveBeenLastCalledWith('unsure');
});

test('tapping the selected mark clears it again', async () => {
  const user = userEvent.setup();
  const onChange = vi.fn();
  render(<ConfidencePicker value="sure" onChange={onChange} />);

  const sure = screen.getByRole('button', { name: '有把握' });
  expect(sure).toHaveAttribute('aria-pressed', 'true');
  await user.click(sure);
  expect(onChange).toHaveBeenLastCalledWith(undefined);
});
