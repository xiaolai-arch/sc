import {
  buildReferencesPrompt,
  buildSystemPrompt,
  BUTLER_SYSTEM_PROMPT
} from '../../src/main/butler/prompt';
import { collectReferences, profileReferences } from '../../src/main/butler/references';
import type { ButlerReference } from '../../src/shared/butler-stream';
import { formatChineseDate } from '../../src/shared/date';
import type { ProfileEntry } from '../../src/shared/profile';
import type { SearchResult, SearchService } from '../../src/shared/search';

const profile: ProfileEntry[] = [
  {
    id: 'p1',
    category: 'constraints',
    text: '工作日每天只能安排 1 小时',
    source: 'user',
    confidence: 'confirmed',
    status: 'active',
    origin: '手动添加',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z'
  },
  {
    id: 'p2',
    category: 'abilities',
    text: '数学基础不错',
    source: 'model',
    confidence: 'candidate',
    status: 'active',
    origin: '对话',
    createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z'
  },
  {
    id: 'p3',
    category: 'identity',
    text: '已经换工作了',
    source: 'user',
    confidence: 'confirmed',
    status: 'expired',
    origin: '手动添加',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z'
  }
];

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    workspaceId: 'ws-1',
    docId: 'n1',
    kind: 'note',
    title: '极限笔记',
    snippet: '等价无穷小',
    score: 1,
    path: 'workspaces/ws-1/notes/n1.md',
    ...overrides
  };
}

test('lists active profile facts first and marks candidates', () => {
  const references = profileReferences(profile);
  expect(references.map((entry) => entry.id)).toEqual(['p1', 'p2']);
  expect(references.find((entry) => entry.id === 'p2')?.detail).toContain('待确认');
  expect(references.some((entry) => entry.id === 'p3')).toBe(false);
});

test('adds the records search ranked for this question without duplicates', async () => {
  const searchAll = vi.fn().mockResolvedValue([
    result({ docId: 'n1' }),
    result({ docId: 't1', kind: 'task', title: '极限错题二刷' })
  ]);
  const search: SearchService = {
    search: vi.fn(),
    searchAll,
    rebuild: vi.fn(),
    dispose: vi.fn()
  };

  const references = await collectReferences({
    profile,
    getSearch: () => search,
    query: '极限怎么复习',
    limit: 10
  });

  expect(searchAll).toHaveBeenCalledWith('极限怎么复习', 4);
  expect(references.map((entry) => `${entry.kind}:${entry.id}`)).toEqual([
    'profile:p1',
    'profile:p2',
    'note:n1',
    'task:t1'
  ]);
  expect(references.at(-1)?.workspaceId).toBe('ws-1');
});

test('a search failure never blocks the answer', async () => {
  const search = {
    search: vi.fn(),
    searchAll: vi.fn().mockRejectedValue(new Error('index offline')),
    rebuild: vi.fn(),
    dispose: vi.fn()
  } as unknown as SearchService;

  const references = await collectReferences({
    profile,
    getSearch: () => search,
    query: '极限'
  });
  expect(references.map((entry) => entry.id)).toEqual(['p1', 'p2']);
});

const EMPTY_CONTEXT = {
  now: new Date(2026, 10, 21, 9, 0, 0),
  workspaces: [],
  tasks: [],
  memory: [],
  profile: [],
  knowledge: [],
  contextError: false
};

/** The exact prompt this context produced before retrieval fed the model. */
const PRE_CHANGE_PROMPT =
  `${BUTLER_SYSTEM_PROMPT}\n\n## 当前上下文\n` +
  `今天：2026-11-21（${formatChineseDate('2026-11-21')}）\n` +
  '任务：暂无记录。';

test('without references the system prompt is identical to the pre-change prompt', () => {
  expect(buildSystemPrompt(EMPTY_CONTEXT)).toBe(PRE_CHANGE_PROMPT);
  expect(buildSystemPrompt(EMPTY_CONTEXT, [])).toBe(PRE_CHANGE_PROMPT);
  expect(buildReferencesPrompt([])).toBe('');
});

test('renders the shown references in order with truncation', () => {
  const longSnippet = '笔记正文'.repeat(100);
  const references: ButlerReference[] = [
    { id: 'n1', kind: 'note', title: '极限笔记', detail: '等价无穷小替换' },
    { id: 't1', kind: 'task', title: '极限错题二刷', detail: longSnippet }
  ];

  const prompt = buildSystemPrompt(EMPTY_CONTEXT, references);

  expect(prompt).toContain('## 本次检索');
  const noteAt = prompt.indexOf('[笔记] 极限笔记：等价无穷小替换');
  const taskAt = prompt.indexOf('[任务] 极限错题二刷');
  expect(noteAt).toBeGreaterThan(-1);
  expect(taskAt).toBeGreaterThan(noteAt);
  // The whole note body is never pasted: the detail is cut at its cap.
  expect(prompt).not.toContain(longSnippet);
  const taskLine = prompt.split('\n').find((line) => line.startsWith('- [任务]'));
  expect(taskLine).toBeDefined();
  const detail = taskLine!.slice(taskLine!.indexOf('：') + 1);
  expect(detail.endsWith('…')).toBe(true);
  expect(Array.from(detail)).toHaveLength(200);
});

test('bounds the 本次检索 section by item count and character budget', () => {
  const references: ButlerReference[] = Array.from({ length: 20 }, (_, index) => ({
    id: `n${index}`,
    kind: 'note' as const,
    title: `标题${index}`,
    detail: '说明'.repeat(120)
  }));

  const prompt = buildSystemPrompt(EMPTY_CONTEXT, references);
  const section = prompt.slice(prompt.indexOf('## 本次检索'));
  const lines = section.split('\n').filter((line) => line.startsWith('- ['));

  expect(lines.length).toBeLessThanOrEqual(10);
  expect(lines.length).toBeLessThan(references.length);
  expect(lines.join('\n').length).toBeLessThanOrEqual(1_200);
});

test('a reference without text adds no empty heading', () => {
  const references: ButlerReference[] = [{ id: 'x1', kind: 'note', title: '  ', detail: '' }];

  expect(buildReferencesPrompt(references)).toBe('');
  expect(buildSystemPrompt(EMPTY_CONTEXT, references)).toBe(PRE_CHANGE_PROMPT);
});
