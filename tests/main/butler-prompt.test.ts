import { BUTLER_SYSTEM_PROMPT, buildSystemPrompt } from '../../src/main/butler/prompt';

test('guides the butler to save and plan after a weekly review', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('周复盘');
  expect(BUTLER_SYSTEM_PROMPT).toContain(
    '先用 save_review 保存这次复盘，再调用 plan_workspace 为下周生成任务'
  );
  expect(BUTLER_SYSTEM_PROMPT).toContain('工具失败时如实说明');
});

test('buildSystemPrompt keeps the weekly guidance alongside context', () => {
  const prompt = buildSystemPrompt({
    now: new Date('2026-11-01T12:00:00.000Z'),
    workspaces: [],
    tasks: [],
    memory: [],
    contextError: false
  });

  expect(prompt).toContain('周复盘');
  expect(prompt).toContain('save_review');
  expect(prompt).toContain('plan_workspace');
});

test('includes workspace and task ids so check-ins can call project tools', () => {
  const prompt = buildSystemPrompt({
    now: new Date('2026-11-01T12:00:00.000Z'),
    workspaces: [
      {
        id: 'kaoyan',
        name: '考研',
        kind: 'exam',
        color: '#0071e3',
        goal: '上岸',
        description: ''
      }
    ],
    tasks: [
      {
        id: 't-1',
        workspaceId: 'kaoyan',
        title: '极限',
        subject: '数学',
        durationMin: 45,
        acceptance: '完成 10 题',
        status: 'pending'
      }
    ],
    memory: [],
    contextError: false
  });

  expect(prompt).toContain('ID：kaoyan');
  expect(prompt).toContain('ID：t-1');
});
