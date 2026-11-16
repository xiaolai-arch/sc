import { buildTemplatePlan } from '../../src/shared/plan-template';
import type { Workspace } from '../../src/shared/workspace';

const guokaoWorkspace: Workspace = {
  id: 'w-guokao',
  name: '2027 国考',
  kind: 'exam',
  color: '#0071e3',
  goal: '行测 75+、申论 65+',
  description: ''
};

const genericWorkspace: Workspace = {
  id: 'w-english',
  name: '英语',
  kind: 'study',
  color: '#34c759',
  goal: '系统提升英语',
  description: ''
};

function allTasks(generated: ReturnType<typeof buildTemplatePlan>): string {
  return generated.phases
    .flatMap((phase) => phase.weeks)
    .flatMap((week) => week.days)
    .flatMap((day) => day.tasks)
    .join('\n');
}

test('a civil-service goal gets 行测/申论 subject phases instead of the generic ones', () => {
  const generated = buildTemplatePlan({
    workspace: guokaoWorkspace,
    goal: '2027 国考上岸：行测 75+、申论 65+',
    startDate: '2026-11-16',
    weeks: 12,
    weeklyHours: 12
  });

  expect(generated.generatedBy).toBe('template');
  const titles = generated.phases.map((phase) => phase.title).join(' ');
  expect(titles).toContain('行测 + 申论基础');
  expect(titles).toContain('专项强化');
  expect(titles).toContain('套题冲刺');

  const tasks = allTasks(generated);
  expect(tasks).toContain('资料分析');
  expect(tasks).toContain('申论');
  expect(tasks).toContain('整卷模考');
  expect(tasks).not.toContain('项目交付');

  expect(generated.phases.flatMap((phase) => phase.weeks)).toHaveLength(12);
});

test('a non-exam goal keeps the previous template structure', () => {
  const generated = buildTemplatePlan({
    workspace: genericWorkspace,
    goal: '系统提升英语',
    startDate: '2026-11-16',
    weeks: 12,
    weeklyHours: 8
  });

  expect(generated.phases.map((phase) => phase.title)).toEqual([
    '阶段一：建立基础',
    '阶段二：动手实践',
    '阶段三：项目冲刺'
  ]);
});

test('a 3-4 week civil-service plan splits into 基础 + 强化', () => {
  const generated = buildTemplatePlan({
    workspace: guokaoWorkspace,
    goal: '省考备考',
    startDate: '2026-11-16',
    weeks: 3,
    weeklyHours: 8
  });

  expect(generated.phases.map((phase) => phase.title)).toEqual([
    '阶段一：行测 + 申论基础',
    '阶段二：专项强化'
  ]);
  expect(generated.phases.flatMap((phase) => phase.weeks)).toHaveLength(3);
});

test('a 1-2 week civil-service plan is a single foundation phase', () => {
  const generated = buildTemplatePlan({
    workspace: guokaoWorkspace,
    goal: '国考冲刺',
    startDate: '2026-11-16',
    weeks: 2,
    weeklyHours: 10
  });

  expect(generated.phases).toHaveLength(1);
  expect(generated.phases[0]!.title).toContain('行测 + 申论基础');
  expect(generated.phases.flatMap((phase) => phase.weeks)).toHaveLength(2);
  expect(generated.phases[0]!.weeks[0]!.days).toHaveLength(7);
});
