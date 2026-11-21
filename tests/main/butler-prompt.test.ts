import { BUTLER_SYSTEM_PROMPT, buildSystemPrompt } from '../../src/main/butler/prompt';

test('guides the butler to save and plan after a weekly review', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('周复盘');
  expect(BUTLER_SYSTEM_PROMPT).toContain(
    '先用 save_review 保存这次复盘，再调用 plan_workspace 为下周生成任务'
  );
  expect(BUTLER_SYSTEM_PROMPT).toContain('工具失败时如实说明');
});

test('teaches the butler to quiz users through create_practice_set', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('考考我');
  expect(BUTLER_SYSTEM_PROMPT).toContain('create_practice_set');
  expect(BUTLER_SYSTEM_PROMPT).toContain('不出用户没学过的内容');
  expect(BUTLER_SYSTEM_PROMPT).toContain('去学习页作答');
});

test('switches between worked examples and problem-first teaching by mastery', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('get_practice_overview');
  expect(BUTLER_SYSTEM_PROMPT).toContain('示例先行');
  expect(BUTLER_SYSTEM_PROMPT).toContain('worked example');
  expect(BUTLER_SYSTEM_PROMPT).toContain('先练后讲');
  expect(BUTLER_SYSTEM_PROMPT).toContain('练习数据不可用');
});

test('teaches the Socratic explanation loop with recitation and knowledge updates', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('引导问题');
  expect(BUTLER_SYSTEM_PROMPT).toContain('直接告诉我');
  expect(BUTLER_SYSTEM_PROMPT).toContain('复述');
  expect(BUTLER_SYSTEM_PROMPT).toContain('record_knowledge');
});

test('bridges a taught topic to a scheduled revisit without asking', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('schedule_revisit');
  // Do it, then say so — never ask permission first.
  expect(BUTLER_SYSTEM_PROMPT).toContain('不要问「要不要我明天考你」');
  expect(BUTLER_SYSTEM_PROMPT).toContain('直接安排再说');
  // At most one topic per turn, and only when the learner actually engaged.
  expect(BUTLER_SYSTEM_PROMPT).toContain('一次只安排一个主题');
  expect(BUTLER_SYSTEM_PROMPT).toContain('只是读完没有参与的主题不要安排');
  // Scheduling requires engagement, not passive reading.
  expect(BUTLER_SYSTEM_PROMPT).toContain('回答了引导问题');
  expect(BUTLER_SYSTEM_PROMPT).toContain('复述到位');
});

test('frames long-term goals beyond exams', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain(
    '（例如考研、学英语、健身、读书、推进一个项目）'
  );
});

test('buildSystemPrompt keeps the weekly guidance alongside context', () => {
  const prompt = buildSystemPrompt({
    now: new Date('2026-11-01T12:00:00.000Z'),
    workspaces: [],
    tasks: [],
    memory: [],
    profile: [],
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
    profile: [],
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
    profile: [],
    knowledge: [],
    contextError: false
  });

  expect(prompt).toContain('09:00 开始');
});

test('renders knowledge summaries, levels and note excerpts for grounding', () => {
  const prompt = buildSystemPrompt({
    now: new Date('2026-11-02T12:00:00.000Z'),
    workspaces: [],
    tasks: [],
    memory: [],
    profile: [],
    knowledge: [
      {
        id: 'kt-lc',
        name: 'LangChain',
        aliases: [],
        status: 'mastered',
        level: 4,
        summary: '会搭 AgentExecutor 和自定义 tool',
        noteExcerpt: '自定义 tool 已经跑通，RAG 还没做过。',
        evidence: [],
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-01T00:00:00.000Z'
      }
    ],
    contextError: false
  });

  expect(prompt).toContain('已掌握：LangChain');
  expect(prompt).toContain('L4');
  expect(prompt).toContain('会搭 AgentExecutor 和自定义 tool');
  expect(prompt).toContain('自定义 tool 已经跑通，RAG 还没做过。');
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
    profile: [],
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
