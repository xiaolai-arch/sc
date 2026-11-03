import { buildSnippet, tokenize } from '../../src/main/search/tokenize';
import {
  parseFileDocs,
  parseKnowledgeTopicDoc,
  parseWorkspaceRelPath
} from '../../src/main/search/documents';
import { serializeLongPlanFile } from '../../src/main/plans/records';
import { serializeKnowledgeTopicFile } from '../../src/main/knowledge/records';
import type { LongPlan } from '../../src/shared/plans';
import type { KnowledgeTopic } from '../../src/shared/knowledge';
import { serializeWorkspaceFile } from '../../src/main/workspace/records/workspace';
import { serializeNoteFile, type NoteRecord } from '../../src/main/workspace/records/notes';
import { serializeTaskFile, type TaskRecord } from '../../src/main/workspace/records/tasks';
import { serializeMemoryFile } from '../../src/main/workspace/records/memory';
import { serializeReviewFile } from '../../src/main/workspace/records/reviews';
import {
  serializePracticeSetFile,
  serializeMistakesFile
} from '../../src/main/practice/records';
import type { PracticeMistake, PracticeSet } from '../../src/shared/practice';

const NOTE: NoteRecord = {
  id: 'n-1',
  title: '线性代数基础',
  subject: '数学',
  tags: ['矩阵'],
  summary: '行列式与矩阵运算',
  body: '矩阵乘法不满足交换律。',
  related: [],
  source: 'user',
  created: '2026-11-01T00:00:00.000Z',
  updated: '2026-11-01T00:00:00.000Z'
};

const TASKS: TaskRecord[] = [
  {
    id: 't-1',
    title: '刷线性代数题',
    subject: '数学',
    durationMin: 40,
    materialRefs: [],
    acceptance: '完成 10 题',
    status: 'pending'
  }
];

test('tokenize lowercases latin/number runs', () => {
  expect(tokenize('MiniSearch 2026')).toEqual(expect.arrayContaining(['minisearch', '2026']));
});

test('tokenize emits CJK bigrams, not unigrams', () => {
  expect(tokenize('线性代数')).toEqual(['线性', '性代', '代数']);
  // A query bigram matches anywhere inside a document run.
  expect(tokenize('代数')).toEqual(['代数']);
});

test('tokenize keeps isolated single CJK chars as unigrams', () => {
  expect(tokenize('查 记录')).toEqual(['查', '记录']);
  expect(tokenize('一')).toEqual(['一']);
});

test('tokenize splits mixed-script text at boundaries', () => {
  const tokens = tokenize('考研English!');
  expect(tokens).toContain('考研');
  expect(tokens).toContain('english');
  expect(tokens).not.toContain('考研english');
  expect(tokenize('')).toEqual([]);
  expect(tokenize('!!!')).toEqual([]);
});

test('buildSnippet centers on the first query hit', () => {
  const text = `${'甲'.repeat(50)}关键词${'乙'.repeat(50)}`;
  const snippet = buildSnippet(text, '关键词', 40);
  expect(snippet.startsWith('…')).toBe(true);
  expect(snippet.endsWith('…')).toBe(true);
  expect(snippet).toContain('关键词');
  expect(snippet.length).toBe(42);
});

test('buildSnippet falls back to the head when nothing matches literally', () => {
  const snippet = buildSnippet('一二三四五六七八九十', 'xyz', 5);
  expect(snippet).toBe('一二三四五…');
});

test('buildSnippet handles empty text', () => {
  expect(buildSnippet('   ', '任意', 20)).toBe('');
});

test('parseWorkspaceRelPath only accepts safe workspace paths', () => {
  expect(parseWorkspaceRelPath('workspaces/kaoyan/notes/n1.md')).toEqual({
    workspaceId: 'kaoyan',
    sub: ['notes', 'n1.md']
  });
  expect(parseWorkspaceRelPath('workspaces/../evil/x.md')).toBeNull();
  expect(parseWorkspaceRelPath('workspaces/kaoyan')).toBeNull();
  expect(parseWorkspaceRelPath('reminders.md')).toBeNull();
  expect(parseWorkspaceRelPath('reviews/2026-11-01.md')).toBeNull();
});

test('parseFileDocs indexes a note by its frontmatter id', () => {
  const docs = parseFileDocs('workspaces/kaoyan/notes/n-1-线性代数基础.md', serializeNoteFile(NOTE));
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({
    docId: 'n-1',
    kind: 'note',
    title: '线性代数基础',
    path: 'workspaces/kaoyan/notes/n-1-线性代数基础.md'
  });
  expect(docs[0]?.content).toContain('矩阵乘法');
});

test('parseFileDocs keys plain notes by file name', () => {
  const docs = parseFileDocs('workspaces/kaoyan/notes/plain.md', '随手记录的想法');
  expect(docs).toHaveLength(1);
  expect(docs[0]?.docId).toBe('plain');
});

test('parseFileDocs expands task files into one doc per task', () => {
  const docs = parseFileDocs('workspaces/kaoyan/tasks/2026-11-01.md', serializeTaskFile('2026-11-01', TASKS));
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ docId: 't-1', kind: 'task', title: '刷线性代数题' });
  expect(docs[0]?.content).toContain('完成 10 题');
});

test('parseFileDocs expands memory entries', () => {
  const raw = serializeMemoryFile([{ id: 'm-1', text: '极限定义不稳', source: '复盘' }]);
  const docs = parseFileDocs('workspaces/kaoyan/memory.md', raw);
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ docId: 'm-1', kind: 'memory' });
  expect(docs[0]?.content).toContain('复盘');
});

test('parseFileDocs expands review entries with stable composite ids', () => {
  const raw = serializeReviewFile('2026-11-01', [
    { submittedAt: '2026-11-01T21:00:00.000Z', completed: '复习极限', stuck: '', tomorrow: '做题', skipped: false }
  ]);
  const docs = parseFileDocs('workspaces/kaoyan/reviews/2026-11-01.md', raw);
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ docId: '2026-11-01#0', kind: 'review' });
  expect(docs[0]?.content).toContain('复习极限');
});

test('parseFileDocs indexes practice sets and their questions', () => {
  const set: PracticeSet = {
    id: 'ps-1',
    workspaceId: 'kaoyan',
    title: '极限基础',
    subject: '数学',
    questions: [
      { id: 'q-1', prompt: 'sin x / x 的极限是？', options: ['1', '0'], answer: 0, explanation: '重要极限' }
    ]
  };
  const docs = parseFileDocs('workspaces/kaoyan/practice/sets/ps-1.md', serializePracticeSetFile(set));
  expect(docs.map((doc) => doc.kind)).toEqual(['practice-set', 'practice-question']);
  expect(docs[0]).toMatchObject({ docId: 'ps-1', title: '极限基础' });
  expect(docs[1]).toMatchObject({ docId: 'q-1' });
  expect(docs[1]?.content).toContain('重要极限');
});

test('parseFileDocs indexes practice mistakes', () => {
  const mistake: PracticeMistake = {
    id: 'pm-1',
    workspaceId: 'kaoyan',
    setId: 'ps-1',
    questionId: 'q-1',
    prompt: '极限易错题干',
    options: ['A', 'B'],
    answer: 0,
    explanation: '解析文本',
    wrongCount: 1,
    correctStreak: 0,
    priority: 1,
    intervalDays: 1,
    due: '2026-11-02',
    status: 'active',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    lastAnsweredAt: '2026-11-01T00:00:00.000Z'
  };
  const docs = parseFileDocs('workspaces/kaoyan/practice/mistakes.md', serializeMistakesFile('kaoyan', [mistake], '2026-11-01'));
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ docId: 'pm-1', kind: 'practice-mistake' });
});

test('parseFileDocs indexes the workspace profile', () => {
  const raw = serializeWorkspaceFile({
    id: 'kaoyan',
    name: '考研',
    kind: 'exam',
    color: '#0071e3',
    goal: '2027 上岸',
    description: '每天 300 分钟'
  });
  const docs = parseFileDocs('workspaces/kaoyan/workspace.md', raw);
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({ docId: 'workspace', kind: 'workspace', title: '考研' });
  expect(docs[0]?.content).toContain('2027 上岸');
});

test('parseFileDocs skips non-records and foreign paths', () => {
  // Plan files dropped into notes/ are not notes.
  expect(parseFileDocs('workspaces/kaoyan/notes/plan.md', serializeTaskFile('2026-11-01', TASKS))).toEqual([]);
  // Root-level files are vault-global, not workspace records.
  expect(parseFileDocs('reminders.md', '早间计划')).toEqual([]);
  expect(parseFileDocs('reviews/2026-11-01.md', '复盘')).toEqual([]);
  // Practice attempt logs are deliberate noise.
  expect(parseFileDocs('workspaces/kaoyan/practice/attempts/2026-11-01.md', '日志')).toEqual([]);
  // Unknown subpaths are ignored.
  expect(parseFileDocs('workspaces/kaoyan/unknown/x.md', '内容')).toEqual([]);
});

const PLAN: LongPlan = {
  id: 'lp-1',
  workspaceId: 'kaoyan',
  goal: '三个月转 Agent 开发',
  startDate: '2026-11-02',
  weeks: 1,
  weeklyHours: 10,
  generatedBy: 'agent',
  references: '岗位 JD 参考',
  knowledge: [{ name: 'LangChain', status: 'learning' }],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phases: [
    {
      id: 'ph-1',
      title: '工程底座',
      subtitle: '先跑通最小闭环',
      goal: '搭好本地环境',
      weeks: [
        {
          id: 'w1',
          number: 1,
          title: '第 1 周',
          goal: '完成第一次调用',
          startDate: '2026-11-02',
          endDate: '2026-11-08',
          days: [
            {
              id: 'w1d1',
              date: '2026-11-02',
              weekday: '周一',
              tasks: ['跑通 LLM API 调用'],
              output: '可运行的调用脚本',
              done: false
            }
          ],
          checks: [{ id: 'w1c1', text: '完成最小闭环', done: false }]
        }
      ]
    }
  ]
};

const TOPIC: KnowledgeTopic = {
  id: 'kt-1',
  name: 'LangChain',
  aliases: ['LC'],
  status: 'learning',
  summary: '编排框架',
  evidence: [
    {
      id: 'e1',
      kind: 'note',
      title: '学习笔记',
      date: '2026-11-01',
      note: 'AgentExecutor 用法'
    }
  ],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z'
};

test('parseFileDocs indexes long plans with their weeks and days', () => {
  const docs = parseFileDocs(
    'workspaces/kaoyan/plans/lp-1.md',
    serializeLongPlanFile(PLAN)
  );
  expect(docs).toHaveLength(1);
  expect(docs[0]).toMatchObject({
    docId: 'lp-1',
    kind: 'plan',
    title: '三个月转 Agent 开发',
    workspaceId: 'kaoyan',
    path: 'workspaces/kaoyan/plans/lp-1.md'
  });
  expect(docs[0]?.content).toContain('跑通 LLM API 调用');
  expect(docs[0]?.content).toContain('完成最小闭环');
  expect(docs[0]?.content).toContain('岗位 JD 参考');
});

test('parseKnowledgeTopicDoc includes the topic fields and note body', () => {
  const doc = parseKnowledgeTopicDoc(
    'knowledge/topics/kt-1.md',
    serializeKnowledgeTopicFile(TOPIC),
    '笔记正文里的独特检索词'
  );
  expect(doc).toMatchObject({
    docId: 'kt-1',
    kind: 'knowledge-topic',
    title: 'LangChain',
    workspaceId: null,
    path: 'knowledge/topics/kt-1.md'
  });
  expect(doc?.content).toContain('编排框架');
  expect(doc?.content).toContain('AgentExecutor');
  expect(doc?.content).toContain('笔记正文里的独特检索词');
});

test('parseKnowledgeTopicDoc keeps a topic workspace and rejects unsafe paths', () => {
  const scoped = parseKnowledgeTopicDoc(
    'knowledge/topics/kt-1.md',
    serializeKnowledgeTopicFile({ ...TOPIC, workspaceId: 'kaoyan' }),
    ''
  );
  expect(scoped?.workspaceId).toBe('kaoyan');
  expect(parseKnowledgeTopicDoc('knowledge/topics/../evil.md', serializeKnowledgeTopicFile(TOPIC), '')).toBeNull();
  expect(parseKnowledgeTopicDoc('knowledge/notes/kt-1.md', serializeKnowledgeTopicFile(TOPIC), '')).toBeNull();
});
