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
    knowledge: [],
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
    knowledge: [],
    contextError: false
  });

  expect(prompt).toContain('ID：kaoyan');
  expect(prompt).toContain('ID：t-1');
});

test('shows pinned start times and teaches the butler to reschedule', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('startAt');
  expect(BUTLER_SYSTEM_PROMPT).toContain('update_task');

  const prompt = buildSystemPrompt({
    now: new Date('2026-11-01T12:00:00.000Z'),
    workspaces: [],
    tasks: [
      {
        id: 't-1',
        workspaceId: 'kaoyan',
        title: '极限',
        subject: '数学',
        durationMin: 45,
        acceptance: '完成 10 题',
        status: 'pending',
        startAt: '2026-11-01T09:00'
      }
    ],
    memory: [],
    knowledge: [],
    contextError: false
  });

  expect(prompt).toContain('09:00 开始');
});

test('renders mastered and learning topics from the knowledge base', () => {
  const topic = (name: string, status: 'mastered' | 'learning') => ({
    id: `kt-${name}`,
    name,
    aliases: [],
    status,
    summary: '',
    evidence: [
      {
        id: `kev-${name}`,
        kind: 'task' as const,
        title: '完成任务',
        date: '2026-11-01'
      }
    ],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  });

  const prompt = buildSystemPrompt({
    now: new Date('2026-11-02T12:00:00.000Z'),
    workspaces: [],
    tasks: [],
    memory: [],
    knowledge: [
      topic('LangChain', 'mastered'),
      topic('LangGraph', 'learning')
    ],
    contextError: false
  });

  expect(prompt).toContain('已掌握：LangChain');
  expect(prompt).toContain('正在学：LangGraph');
  expect(prompt).toContain('最近证据：');
});
