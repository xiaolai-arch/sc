import {
  buildCheckInTemplate,
  pendingPhaseAsk,
  PHASE_ACCEPTANCE_QUESTIONS,
  phaseAcceptanceQuestion,
  WEEK_AVAILABILITY_QUESTION,
  type CheckInTemplateInput
} from '../../src/main/check-ins/prompt';
import type { ButlerContext } from '../../src/main/butler/context';
import type { ExamPhase, Workspace } from '../../src/shared/workspace';

const DATE = '2026-11-08';

const exam: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#ef4444',
  goal: '2027 上岸',
  description: ''
};

const context: ButlerContext = {
  now: new Date(`${DATE}T20:00:00`),
  workspaces: [exam],
  tasks: [],
  memory: [],
  profile: [],
  knowledge: [],
  contextError: false
};

const WEEKLY_BASE =
  '周日好。花三分钟回顾一下这一周：完成了什么，卡在哪里，下周最重要的一件事是什么？说完我来帮你整理，并排下周的计划。';

function weekly(extra: Partial<CheckInTemplateInput> = {}): string {
  return buildCheckInTemplate({
    context,
    trigger: 'weekly',
    date: DATE,
    ...extra
  });
}

// --- 验收 25: the three questions, word for word ----------------------------

test('each stage carries its exact acceptance question (验收 25)', () => {
  // Restated here verbatim from the spec so a wording drift in prompt.ts fails.
  expect(PHASE_ACCEPTANCE_QUESTIONS['基础']).toBe(
    '基础阶段收尾时可以这样验收：不翻书，能用 2-3 句话概括每章的核心主题吗？要不要现在就试一章？'
  );
  expect(PHASE_ACCEPTANCE_QUESTIONS['强化']).toBe(
    '强化阶段收尾时可以这样验收：用一套近年真题限时练一遍吗？我帮你记各题型的用时和正确率，结果都在本周复盘里。'
  );
  expect(PHASE_ACCEPTANCE_QUESTIONS['冲刺']).toBe(
    '冲刺阶段收尾时可以这样验收：对照错题记录，检查所有错题对应的知识点都掌握了吗？要打开错题本一起过一遍吗？'
  );
});

test('phaseAcceptanceQuestion speaks once per stage and is empty otherwise', () => {
  const phases: ExamPhase[] = ['基础', '强化', '冲刺'];
  for (const phase of phases) {
    expect(phaseAcceptanceQuestion(phase, undefined)).toBe(PHASE_ACCEPTANCE_QUESTIONS[phase]);
    // Already asked for this stage: silent.
    expect(phaseAcceptanceQuestion(phase, '2026-11-01')).toBe('');
  }
  // No stage chosen: silent.
  expect(phaseAcceptanceQuestion(undefined, undefined)).toBe('');
  expect(phaseAcceptanceQuestion(undefined, '2026-11-01')).toBe('');
});

test('the weekly template ends with the stage question, before the availability ask (验收 25)', () => {
  const template = weekly({ phaseAsk: PHASE_ACCEPTANCE_QUESTIONS['基础'] });
  expect(template).toBe(
    `${WEEKLY_BASE}\n${PHASE_ACCEPTANCE_QUESTIONS['基础']}\n${WEEK_AVAILABILITY_QUESTION}`
  );
  // Exactly once, and the stage question outranks the general availability ask
  // for the last-but-one slot.
  expect(template.split(PHASE_ACCEPTANCE_QUESTIONS['基础'])).toHaveLength(2);
});

test('the stage question and the scope sentence stack in a fixed order', () => {
  const SCOPE = '（从本周起，积压任务不计入完成率分母）';
  const template = weekly({
    weeklyScopeNote: SCOPE,
    phaseAsk: PHASE_ACCEPTANCE_QUESTIONS['冲刺']
  });
  expect(template).toBe(
    `${WEEKLY_BASE}\n${SCOPE}\n${PHASE_ACCEPTANCE_QUESTIONS['冲刺']}\n${WEEK_AVAILABILITY_QUESTION}`
  );
});

// --- 验收 27: no stage / no exam stays byte-identical -----------------------

test('an absent phaseAsk keeps the weekly template byte-identical (验收 27)', () => {
  expect(weekly()).toBe(weekly({ phaseAsk: '' }));
  expect(weekly()).toBe(`${WEEKLY_BASE}\n${WEEK_AVAILABILITY_QUESTION}`);
});

test('the stage question never enters the morning, evening or behind templates (验收 27)', () => {
  const ask = PHASE_ACCEPTANCE_QUESTIONS['基础'];
  for (const trigger of ['morning', 'evening', 'behind'] as const) {
    expect(
      buildCheckInTemplate({ context, trigger, date: DATE, phaseAsk: ask })
    ).toBe(buildCheckInTemplate({ context, trigger, date: DATE }));
  }
});

test('a non-exam project and an exam project without a stage speak nothing (验收 27)', () => {  // Neither the context nor the template takes a phase: the caller must pass
  // '' for both, so a project with no stage can never gain a sentence.
  const study: Workspace = { ...exam, id: 'ws-study', kind: 'study' };
  const studyContext: ButlerContext = { ...context, workspaces: [study] };
  const base = buildCheckInTemplate({ context: studyContext, trigger: 'weekly', date: DATE });
  expect(base).toBe(`${WEEKLY_BASE}\n${WEEK_AVAILABILITY_QUESTION}`);
  expect(base).not.toContain('阶段收尾时');
});

// --- pendingPhaseAsk: which project (if any) speaks this Sunday --------------

test('pendingPhaseAsk picks the first exam project with an unasked stage', () => {
  expect(
    pendingPhaseAsk([
      { id: 'a', kind: 'exam', phase: '基础' },
      { id: 'b', kind: 'exam', phase: '强化' }
    ])
  ).toEqual({ workspaceId: 'a', phase: '基础' });
});

test('pendingPhaseAsk skips projects without a stage, non-exam kinds, and asked stages', () => {
  expect(
    pendingPhaseAsk([
      { id: 'no-stage', kind: 'exam' },
      { id: 'study-with-a-stage', kind: 'study', phase: '强化' },
      { id: 'asked', kind: 'exam', phase: '基础', phaseAskedAt: '2026-11-08' },
      { id: 'next', kind: 'exam', phase: '冲刺' }
    ])
  ).toEqual({ workspaceId: 'next', phase: '冲刺' });
});

test('pendingPhaseAsk is null when nothing is pending, so the review stays silent', () => {
  expect(pendingPhaseAsk([])).toBeNull();
  expect(pendingPhaseAsk([{ id: 'a', kind: 'exam' }])).toBeNull();
  expect(
    pendingPhaseAsk([{ id: 'a', kind: 'exam', phase: '基础', phaseAskedAt: '2026-11-08' }])
  ).toBeNull();
});
