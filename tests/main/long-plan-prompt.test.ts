import { buildLongPlanPrompt } from '../../src/main/plans/prompt';
import type { Workspace } from '../../src/shared/workspace';

const workspace: Workspace = {
  id: 'ws-agent',
  name: '学习 Agent',
  kind: 'study',
  color: '#34c759',
  goal: '转行做 Agent',
  description: ''
};

function promptForLongPlan() {
  return buildLongPlanPrompt({
    input: {
      workspaceId: workspace.id,
      goal: '系统学习 AI Agent',
      weeks: 6,
      weeklyHours: 10,
      startDate: '2026-11-21'
    },
    workspace
  });
}

test('the long-plan prompt asks for demonstrable checks that gate the next phase', () => {
  const prompt = promptForLongPlan();

  // 2-4 checks per phase rather than a weekly quota.
  expect(prompt.system).toContain('每个阶段合计 2-4 条验收项');
  expect(prompt.system).not.toContain('每周有 3-6 条 checks');
  // Checks must be something the learner can show, with worked examples.
  expect(prompt.system).toContain('必须能当场演示');
  expect(prompt.system).toContain('能不看笔记复述……');
  expect(prompt.system).toContain('独立完成 3 道……');
  // Phase progression is acceptance-driven, not calendar-driven.
  expect(prompt.system).toContain('阶段推进看验收');
  expect(prompt.system).toContain('前一阶段的所有验收项完成后，下一阶段才算开始');
  expect(prompt.system).toContain('不要按日期把用户推进到下一阶段');
  // The JSON shape is unchanged: checks still live on weeks.
  expect(prompt.system).toContain('"checks":["验收项"]');
});

test('the long-plan user prompt keeps its existing framing', () => {
  const prompt = promptForLongPlan();

  expect(prompt.user).toContain('总周数：6');
  expect(prompt.user).toContain('每周投入：约 10 小时');
  expect(prompt.user).toContain('请按以上时长制定 6 周的完整计划，只输出 JSON。');
});

test('stored busy days add exactly one avoid-these-days line', () => {
  const prompt = buildLongPlanPrompt({
    input: {
      workspaceId: workspace.id,
      goal: '系统学习 AI Agent',
      weeks: 6,
      weeklyHours: 10,
      startDate: '2026-11-21'
    },
    workspace,
    busyDates: ['2026-11-24', '2026-11-26']
  });

  expect(prompt.user).toContain(
    '用户说这些天会特别满，不要把新内容排在这些天（挪到相邻的日子）：2026-11-24、2026-11-26'
  );
  // The line appears once, right after the start date.
  expect(prompt.user.split('不要把新内容排在这些天')).toHaveLength(2);
  expect(prompt.user.indexOf('不要把新内容排在这些天')).toBeGreaterThan(
    prompt.user.indexOf('起始日期：')
  );
});

test('without busy dates the long-plan prompt keeps its previous bytes', () => {
  const withField = buildLongPlanPrompt({
    input: {
      workspaceId: workspace.id,
      goal: '系统学习 AI Agent',
      weeks: 6,
      weeklyHours: 10,
      startDate: '2026-11-21'
    },
    workspace,
    busyDates: []
  });
  expect(withField.user).not.toContain('特别满');
  expect(withField.user).toBe(promptForLongPlan().user);
});