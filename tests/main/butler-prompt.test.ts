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

test('diagnoses a new topic before choosing the teaching mode', () => {
  // At most two concrete diagnostic questions, never a survey.
  expect(BUTLER_SYSTEM_PROMPT).toContain('问 1-2 个有具体答案的问题');
  expect(BUTLER_SYSTEM_PROMPT).toContain('你学到哪一步了？');
  expect(BUTLER_SYSTEM_PROMPT).toContain('诊断最多连续 2 个');
  expect(BUTLER_SYSTEM_PROMPT).toContain(
    '不要发问卷（如「你的学习目标、基础、时间安排分别是什么？」）'
  );
  // The answer drives 示例先行 / 先练后讲 and the choice is named back.
  expect(BUTLER_SYSTEM_PROMPT).toContain('新主题的诊断回答决定选哪种');
  expect(BUTLER_SYSTEM_PROMPT).toContain('点明选择');
  expect(BUTLER_SYSTEM_PROMPT).toContain('你刚说卡在 X，那我先示范一道再看你做');
  // Unclear answer -> state an assumption and continue, no interrogation.
  expect(BUTLER_SYSTEM_PROMPT).toContain('说明一个假设');
  expect(BUTLER_SYSTEM_PROMPT).toContain('那我按零基础讲');
  expect(BUTLER_SYSTEM_PROMPT).toContain('不要追问');
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

test('teaches the promise-only commitment rule with both tools', () => {
  expect(BUTLER_SYSTEM_PROMPT).toContain('record_commitment');
  expect(BUTLER_SYSTEM_PROMPT).toContain('resolve_commitment');
  expect(BUTLER_SYSTEM_PROMPT).toContain('当用户用自己话说出具体承诺');
  expect(BUTLER_SYSTEM_PROMPT).toContain('不要替用户承诺');
  expect(BUTLER_SYSTEM_PROMPT).toContain('不要安排用户没说过的事');
});

test('renders the open-promise section bounded at three entries', () => {
  const commitment = (id: string, text: string, due: string) => ({
    id,
    text,
    due,
    status: 'open' as const,
    createdAt: '2026-11-20T08:00:00.000Z'
  });
  const prompt = buildSystemPrompt({
    now: new Date('2026-11-22T12:00:00.000Z'),
    workspaces: [],
    tasks: [],
    memory: [],
    profile: [],
    knowledge: [],
    commitments: [
      commitment('cm-1', '背完这一课的单词', '2026-11-20'),
      commitment('cm-2', '做完极限基础', '2026-11-21'),
      commitment('cm-3', '给妈妈打电话', '2026-11-22'),
      commitment('cm-4', '写完周记', '2026-11-23')
    ],
    contextError: false
  });

  // Header, then one line per promise in the fixed format.
  expect(prompt).toContain('未结案承诺（用户亲口答应的事，不是任务）：');
  expect(prompt).toContain('- 「背完这一课的单词」（原定 11-20）');
  expect(prompt).toContain('- 「做完极限基础」（原定 11-21）');
  expect(prompt).toContain('- 「给妈妈打电话」（原定 11-22）');
  // The fourth promise is an honest count, never silently dropped.
  expect(prompt).toContain('还有 1 条未列出。');
  expect(prompt).not.toContain('写完周记');

  // Over-long text is clipped inside the same line format.
  const long = buildSystemPrompt({
    now: new Date('2026-11-22T12:00:00.000Z'),
    workspaces: [],
    tasks: [],
    memory: [],
    profile: [],
    knowledge: [],
    commitments: [commitment('cm-long', '长'.repeat(200), '2026-11-22')],
    contextError: false
  });
  expect(long).toContain(`- 「${'长'.repeat(119)}…」（原定 11-22）`);
});

test('an empty or absent commitment list leaves the prompt byte-identical', () => {
  const context = {
    now: new Date('2026-11-22T12:00:00.000Z'),
    workspaces: [
      {
        id: 'kaoyan',
        name: '考研',
        kind: 'exam' as const,
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
        status: 'pending' as const
      }
    ],
    memory: [],
    profile: [],
    knowledge: [],
    contextError: false
  };

  const baseline = buildSystemPrompt(context);
  expect(baseline).not.toContain('未结案承诺');
  // The service always fills `commitments: []` on an empty vault; that must
  // not change a single byte for users with no promises recorded.
  expect(buildSystemPrompt({ ...context, commitments: [] })).toBe(baseline);
});

test('replies to 「我卡住了」 with exactly one smallest next action', () => {
  // One action, not a plan: the stuck signal is about starting, not knowing.
  expect(BUTLER_SYSTEM_PROMPT).toContain('只回一个最小的下一步动作');
  // Concrete and startable right now: it must fit in two minutes.
  expect(BUTLER_SYSTEM_PROMPT).toContain('2 分钟内能做完');
  expect(BUTLER_SYSTEM_PROMPT).toContain('先把文档打开');
  expect(BUTLER_SYSTEM_PROMPT).toContain('把杯子放进水槽');
  // No explanation, no list, no interrogation, no pep talk, no tools.
  expect(BUTLER_SYSTEM_PROMPT).toContain('不解释、不列清单、不追问原因、不打气，也不调用工具');
});

test('shrinks once more when the user is still stuck, and plans only on request', () => {
  // Repeating 「还是卡着」 shrinks the action instead of re-explaining.
  expect(BUTLER_SYSTEM_PROMPT).toContain('把动作再缩小一格');
  expect(BUTLER_SYSTEM_PROMPT).toContain('不要重复解释');
  // Asking for the whole arrangement steps back to normal planning.
  expect(BUTLER_SYSTEM_PROMPT).toContain('给我整个安排');
  expect(BUTLER_SYSTEM_PROMPT).toContain('恢复正常规划');
  // The only case a task is added: the user asks for it, through create_task.
  expect(BUTLER_SYSTEM_PROMPT).toContain('这一步只是聊天里的句子');
  expect(BUTLER_SYSTEM_PROMPT).toContain('除非用户明确让你把它记成任务（才调用 create_task）');
  expect(BUTLER_SYSTEM_PROMPT).toContain('否则不要新建任务');
});
