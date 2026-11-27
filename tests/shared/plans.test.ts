import {
  currentPlanWeek,
  findPlanWeek,
  phaseGate,
  phaseProgress,
  planBasis,
  planElapsedDays,
  planProgress,
  planMonthDay,
  planWeekday,
  suggestedRecalibrateHours,
  weekProgress,
  type LongPlan,
  type LongPlanPhase,
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

function gatePhase(id: string, checksDone: boolean[]): LongPlanPhase {
  return {
    id,
    title: id,
    subtitle: '',
    goal: '',
    weeks: [
      {
        id: `${id}-w1`,
        number: 1,
        title: '',
        goal: '',
        startDate: '2026-11-01',
        endDate: '2026-11-07',
        days: [],
        checks: checksDone.map((done, index) => ({
          id: `${id}-c${index}`,
          text: '验收',
          done
        }))
      }
    ]
  };
}

function gatePlan(...phases: LongPlanPhase[]): LongPlan {
  return { ...plan, phases };
}

test('phase 0 is always open, even with every check unchecked', () => {
  const plan = gatePlan(gatePhase('ph-1', [false, false]));

  expect(phaseGate(plan, 0)).toEqual({ state: 'open', remaining: 0, total: 0 });
});

test('a phase is done once all of its own checks are checked', () => {
  const plan = gatePlan(gatePhase('ph-1', [true, true]));

  expect(phaseGate(plan, 0)).toEqual({ state: 'done', remaining: 0, total: 0 });
});

test('a later phase locks while any earlier check is unchecked', () => {
  const plan = gatePlan(gatePhase('ph-1', [true, false]), gatePhase('ph-2', [true]));

  expect(phaseGate(plan, 1)).toEqual({ state: 'locked', remaining: 1, total: 2 });
});

test('a later phase is done once earlier and its own checks are all checked', () => {
  const plan = gatePlan(gatePhase('ph-1', [true, true]), gatePhase('ph-2', [true]));

  expect(phaseGate(plan, 1)).toEqual({ state: 'done', remaining: 0, total: 2 });
});

test('a later phase opens once every earlier check is done but its own are not', () => {
  const plan = gatePlan(gatePhase('ph-1', [true, true]), gatePhase('ph-2', [false]));

  expect(phaseGate(plan, 1)).toEqual({ state: 'open', remaining: 0, total: 2 });
});

test('a phase with no checks never blocks later phases', () => {
  const plan = gatePlan(gatePhase('ph-1', []), gatePhase('ph-2', [false]));

  expect(phaseGate(plan, 0)).toEqual({ state: 'open', remaining: 0, total: 0 });
  // Phase 1 has nothing to master, so it is open rather than done — and it
  // adds no prerequisite for phase 2.
  expect(phaseGate(plan, 1)).toEqual({ state: 'open', remaining: 0, total: 0 });
});

test('an empty middle phase contributes no prerequisite to later phases', () => {
  const plan = gatePlan(gatePhase('ph-1', [true]), gatePhase('ph-2', []), gatePhase('ph-3', [false]));

  expect(phaseGate(plan, 2)).toEqual({ state: 'open', remaining: 0, total: 1 });
});

test('remaining counts every unchecked check across all earlier phases', () => {
  const plan = gatePlan(
    gatePhase('ph-1', [false, false]),
    gatePhase('ph-2', [false]),
    gatePhase('ph-3', [false])
  );

  expect(phaseGate(plan, 2)).toEqual({ state: 'locked', remaining: 3, total: 3 });
});

test('unknown phase indexes report an empty open gate', () => {
  const plan = gatePlan(gatePhase('ph-1', [false]));

  expect(phaseGate(plan, -1)).toEqual({ state: 'open', remaining: 0, total: 0 });
  expect(phaseGate(plan, 9)).toEqual({ state: 'open', remaining: 0, total: 0 });
});

test('formats weekday and short dates without drifting across time zones', () => {
  expect(planWeekday('2026-11-01')).toBe('周日');
  expect(planWeekday('2026-11-02')).toBe('周一');
  expect(planMonthDay('2026-11-02')).toBe('11/2');
});

// --- planElapsedDays / suggestedRecalibrateHours ---
test('clamps elapsed plan days to the plan span', () => {
  // plan: starts 2026-11-01, 3 weeks (21 days).
  expect(planElapsedDays(plan, '2026-10-25')).toBe(0);
  expect(planElapsedDays(plan, '2026-11-08')).toBe(7);
  expect(planElapsedDays(plan, '2027-02-01')).toBe(21);
});

test('the first seven days suggest the plan’s own weekly hours', () => {
  // 3 days in, and even before the start date (elapsed clamps to 0).
  expect(suggestedRecalibrateHours(plan, '2026-11-04')).toBe(10);
  expect(suggestedRecalibrateHours(plan, '2026-10-25')).toBe(10);
  // Day 6 is still inside the no-history window; day 7 is not.
  expect(suggestedRecalibrateHours(plan, '2026-11-07')).toBe(10);
});

test('after a week the default scales by actual pace over expected pace', () => {
  // plan progress: 50%. Day 7 of 21 → expected 1/3 → 10 × 0.5 / (1/3) = 15.
  expect(suggestedRecalibrateHours(plan, '2026-11-08')).toBe(15);
  // Day 14 of 21 → expected 2/3 → 10 × 0.5 / (2/3) = 7.5 → 8.
  expect(suggestedRecalibrateHours(plan, '2026-11-15')).toBe(8);
});

test('elapsed beyond the plan length stops growing the expected pace', () => {
  // Capped at 21 days → expected 1 → 10 × 0.5 = 5.
  expect(suggestedRecalibrateHours(plan, '2027-02-01')).toBe(5);
});

test('a plan with no items has no pace to scale from', () => {
  const empty: LongPlan = { ...plan, phases: [] };
  expect(planProgress(empty).total).toBe(0);
  expect(suggestedRecalibrateHours(empty, '2026-11-15')).toBe(10);
});

test('clamps the suggestion to the input range of 1 to 80 hours', () => {
  // Zero progress → 0 hours → floored to 1.
  const untouched = gatePlan(
    gatePhase('ph-1', [false]),
    gatePhase('ph-2', [false])
  );
  expect(planProgress(untouched).percent).toBe(0);
  expect(suggestedRecalibrateHours({ ...plan, phases: untouched.phases }, '2026-11-15')).toBe(1);

  // Finishing everything in two of sixteen weeks → 80 × 1 / 0.125 = 640 → 80.
  const sprint: LongPlan = {
    ...plan,
    weeklyHours: 80,
    weeks: 16,
    phases: [
      {
        id: 'ph-sprint',
        title: '冲刺',
        subtitle: '',
        goal: '',
        weeks: [week(1, '2026-11-01', true, true)]
      }
    ]
  };
  expect(planProgress(sprint).percent).toBe(100);
  expect(suggestedRecalibrateHours(sprint, '2026-11-15')).toBe(80);
});
