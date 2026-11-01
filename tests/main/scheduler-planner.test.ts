import type { ButlerService } from '../../src/shared/workspace';
import {
  buildTodayPlanPrompt,
  createTodayPlanPlanner,
  parseTodayPlanReply
} from '../../src/main/scheduler/planner';

describe('butler-backed today-plan planner', () => {
  test('parses fenced JSON and normalizes tasks', () => {
    const plan = parseTodayPlanReply(
      [
        '好的，这是计划：',
        '```json',
        JSON.stringify({
          tasks: [
            {
              title: ' 极限刷题 ',
              subject: '数学',
              durationMin: 45,
              acceptance: '完成 10 题',
              materialRefs: ['note-1', 42]
            },
            { title: '', subject: '英语', durationMin: 20 },
            { title: '背单词', subject: '英语', durationMin: 0 }
          ]
        }),
        '```'
      ].join('\n'),
      '2026-10-31'
    );

    expect(plan).not.toBeNull();
    expect(plan?.date).toBe('2026-10-31');
    expect(plan?.generatedBy).toBe('agent');
    expect(plan?.tasks).toHaveLength(1);
    expect(plan?.tasks[0]).toMatchObject({
      title: '极限刷题',
      subject: '数学',
      durationMin: 45,
      acceptance: '完成 10 题',
      materialRefs: ['note-1'],
      status: 'pending'
    });
    expect(plan?.tasks[0]?.id).toEqual(expect.any(String));
  });

  test('accepts a bare JSON array and rejects prose', () => {
    const plan = parseTodayPlanReply(
      '[{"title":"阅读","subject":"英语","durationMin":"30"}]',
      '2026-10-31'
    );
    expect(plan?.tasks[0]).toMatchObject({
      title: '阅读',
      subject: '英语',
      durationMin: 30,
      acceptance: '完成任务并记录结果'
    });

    expect(parseTodayPlanReply('今天先做数学吧。', '2026-10-31')).toBeNull();
    expect(parseTodayPlanReply('{"tasks":[]}', '2026-10-31')).toBeNull();
    expect(parseTodayPlanReply('{"tasks":[{"title":1}]}', '2026-10-31')).toBeNull();
  });

  test('sends the structured prompt through the butler contract', async () => {
    const messages: string[] = [];
    const butler: ButlerService = {
      async send(input) {
        messages.push(input.message);
        return {
          text: JSON.stringify({
            tasks: [{ title: '做真题', subject: '数学', durationMin: 60, acceptance: '一套' }]
          })
        };
      },
      async stream() {
        throw new Error('stream is not used by the planner');
      }
    };

    const planner = createTodayPlanPlanner({ butler });
    const plan = await planner.plan('2026-10-31', {
      examDate: '2027-12-18',
      subjects: [{ name: '数学' }, { name: '英语' }],
      dailyMinutes: 120,
      currentLevel: '基础一般'
    });

    expect(plan?.generatedBy).toBe('agent');
    expect(plan?.tasks[0]?.title).toBe('做真题');
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('2026-10-31');
    expect(messages[0]).toContain('数学、英语');
    expect(messages[0]).toContain('120 分钟');
    expect(messages[0]).toContain('只输出一个 JSON 对象');
  });

  test('falls back cleanly when the butler throws', async () => {
    const planner = createTodayPlanPlanner({
      butler: {
        async send() {
          throw new Error('model unavailable');
        },
        async stream() {
          throw new Error('stream is not used by the planner');
        }
      }
    });
    await expect(planner.plan('2026-10-31', null)).resolves.toBeNull();
  });

  test('prompt includes a safe default when there is no profile', () => {
    const prompt = buildTodayPlanPrompt('2026-10-31', null);
    expect(prompt).toContain('学习');
    expect(prompt).toContain('120 分钟');
  });
});
