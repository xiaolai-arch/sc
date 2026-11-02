import { gatherContext } from '../../src/main/butler/context';
import type { KnowledgeService, KnowledgeTopic } from '../../src/shared/knowledge';

const NOW = new Date('2026-11-02T12:00:00.000Z');

function topic(overrides: Partial<KnowledgeTopic> = {}): KnowledgeTopic {
  return {
    id: 'kt-1',
    name: 'LangChain',
    aliases: [],
    status: 'mastered',
    level: 4,
    summary: '会搭 AgentExecutor 和自定义 tool',
    evidence: [],
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides
  };
}

function knowledgeService(overrides: Partial<KnowledgeService>): KnowledgeService {
  return {
    list: async () => [topic()],
    getNote: async (topicId: string) => ({ topicId, body: '', updatedAt: '' }),
    ...overrides
  } as unknown as KnowledgeService;
}

test('attaches a clipped note excerpt to each active topic', async () => {
  const context = await gatherContext(
    null,
    { message: '今天学什么' },
    NOW,
    knowledgeService({
      getNote: async (topicId: string) => ({
        topicId,
        body: '# LangChain\n\n自定义 tool 已经跑通，RAG 还没做过。',
        updatedAt: '2026-11-01T10:00:00.000Z'
      })
    })
  );

  expect(context.knowledge).toHaveLength(1);
  expect(context.knowledge[0]?.noteExcerpt).toBe(
    'LangChain 自定义 tool 已经跑通，RAG 还没做过。'
  );
});

test('clips long note excerpts before they reach the prompt', async () => {
  const context = await gatherContext(
    null,
    { message: '今天学什么' },
    NOW,
    knowledgeService({
      getNote: async (topicId: string) => ({
        topicId,
        body: 'x'.repeat(600),
        updatedAt: ''
      })
    })
  );

  const excerpt = context.knowledge[0]?.noteExcerpt ?? '';
  expect(excerpt.endsWith('…')).toBe(true);
  expect(excerpt.length).toBeLessThanOrEqual(241);
});

test('a note that cannot be read leaves the topic in the context', async () => {
  const context = await gatherContext(
    null,
    { message: '今天学什么' },
    NOW,
    knowledgeService({
      getNote: async () => {
        throw new Error('note is unreadable');
      }
    })
  );

  expect(context.knowledge).toHaveLength(1);
  expect(context.knowledge[0]?.name).toBe('LangChain');
  expect(context.knowledge[0]?.noteExcerpt).toBeUndefined();
});

test('does not read notes for topics beyond the detail limit', async () => {
  const topics = Array.from({ length: 10 }, (_, index) =>
    topic({ id: `kt-${index}`, name: `主题 ${index}` })
  );
  const getNote = vi.fn(async (topicId: string) => ({
    topicId,
    body: '笔记',
    updatedAt: ''
  }));

  const context = await gatherContext(
    null,
    { message: '今天学什么' },
    NOW,
    knowledgeService({ list: async () => topics, getNote })
  );

  expect(context.knowledge).toHaveLength(10);
  expect(getNote).toHaveBeenCalledTimes(8);
});
