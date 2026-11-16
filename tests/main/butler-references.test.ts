import { collectReferences, profileReferences } from '../../src/main/butler/references';
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
