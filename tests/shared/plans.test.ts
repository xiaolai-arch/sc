import {
  currentPlanWeek,
  findPlanWeek,
  phaseProgress,
  planBasis,
  planProgress,
  planMonthDay,
  planWeekday,
  weekProgress,
  type LongPlan,
  type LongPlanWeek
} from '../../src/shared/plans';

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
    value.getDate()
  ).padStart(2, '0')}`;
}

function week(
  number: number,
  startDate: string,
  done: boolean,
  checksDone: boolean
): LongPlanWeek {
  return {
    id: `w${number}`,
    number,
    title: `第 ${number} 周`,
    goal: '',
    startDate,
    endDate: addDays(startDate, 6),
    days: [
      { id: `w${number}d1`, date: startDate, weekday: '周日', tasks: ['任务'], output: '产出', done }
    ],
    checks: [{ id: `w${number}c1`, text: '验收', done: checksDone }]
  };
}

const plan: LongPlan = {
  id: 'lp-1',
  workspaceId: 'agent',
  goal: '学会 Agent',
  startDate: '2026-11-01',
  weeks: 3,
  weeklyHours: 10,
  generatedBy: 'agent',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phases: [
    {
      id: 'ph-1',
      title: '阶段一',
      subtitle: '',
      goal: '',
      weeks: [week(1, '2026-11-01', true, true), week(2, '2026-11-08', false, false)]
    },
    {
      id: 'ph-2',
      title: '阶段二',
      subtitle: '',
      goal: '',
      weeks: [week(3, '2026-11-15', false, true)]
    }
  ]
};

test('counts day rows and acceptance checks in overall progress', () => {
  expect(planProgress(plan)).toEqual({ total: 6, done: 3, percent: 50 });
});

test('reports week and phase progress independently', () => {
  expect(weekProgress(plan.phases[0]!.weeks[0]!)).toEqual({ total: 2, done: 2, percent: 100 });
  expect(weekProgress(plan.phases[0]!.weeks[1]!)).toEqual({ total: 2, done: 0, percent: 0 });
  expect(phaseProgress(plan.phases[0]!)).toEqual({ total: 4, done: 2, percent: 50 });
});

test('finds a week by id and reports the week containing today', () => {
  expect(findPlanWeek(plan, 'w2')?.week.number).toBe(2);
  expect(findPlanWeek(plan, 'missing')).toBeNull();
  expect(currentPlanWeek(plan, '2026-11-09')?.id).toBe('w2');
  expect(currentPlanWeek(plan, '2026-11-01')?.id).toBe('w1');
});

test('clamps the current week to the plan range', () => {
  expect(currentPlanWeek(plan, '2026-10-01')?.id).toBe('w1');
  expect(currentPlanWeek(plan, '2027-01-01')?.id).toBe('w3');
});

test('derives the basis from web sources, user references, or the model alone', () => {
  expect(planBasis(plan)).toBe('model');
  expect(planBasis({ ...plan, references: '  课程大纲  ' })).toBe('references');
  expect(
    planBasis({
      ...plan,
      references: '课程大纲',
      sources: [{ title: '官方文档', url: 'https://docs.example.com/agents' }]
    })
  ).toBe('web');
});

test('formats weekday and short dates without drifting across time zones', () => {
  expect(planWeekday('2026-11-01')).toBe('周日');
  expect(planWeekday('2026-11-02')).toBe('周一');
  expect(planMonthDay('2026-11-02')).toBe('11/2');
});
