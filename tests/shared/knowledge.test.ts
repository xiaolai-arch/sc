import {
  isActiveKnowledgeTopic,
  parseWikiLink,
  resolveKnowledgeLink,
  topicMatches,
  wikiLinkTargets,
  type KnowledgeTopic
} from '../../src/shared/knowledge';

function topic(overrides: Partial<KnowledgeTopic> = {}): KnowledgeTopic {
  return {
    id: 'kt-1',
    name: 'Java',
    aliases: [],
    status: 'learning',
    summary: '',
    evidence: [],
    createdAt: '',
    updatedAt: '',
    ...overrides
  };
}

test('matches CJK substrings and Latin word boundaries', () => {
  expect(topicMatches('今天复习 Java 集合', topic())).toBe(true);
  expect(topicMatches('学 JavaScript 的闭包', topic())).toBe(false);
  expect(
    topicMatches('LangChain 的 AgentExecutor', topic({ name: 'LangChain', aliases: ['LC'] }))
  ).toBe(true);
  expect(topicMatches('练了 lc 一小时', topic({ name: 'LangChain', aliases: ['LC'] }))).toBe(true);
});

test('only mastered and learning topics are active', () => {
  expect(isActiveKnowledgeTopic(topic({ status: 'mastered' }))).toBe(true);
  expect(isActiveKnowledgeTopic(topic({ status: 'learning' }))).toBe(true);
  expect(isActiveKnowledgeTopic(topic({ status: 'planned' }))).toBe(false);
  expect(isActiveKnowledgeTopic(topic({ status: 'paused' }))).toBe(false);
});

test('extracts wiki link targets and ignores code', () => {
  const text =
    'A [[LangGraph]] B [[LangChain|LC]]\n\n`[[Inline]]`\n\n```md\n[[Fenced]]\n```\n';
  expect(wikiLinkTargets(text)).toEqual(['LangGraph', 'LangChain']);
});

test('parses display labels and rejects malformed tokens', () => {
  expect(parseWikiLink('[[LangChain|LC]]')).toEqual({ target: 'LangChain', label: 'LC' });
  expect(parseWikiLink('[[ LangGraph ]]')).toEqual({ target: 'LangGraph', label: 'LangGraph' });
  expect(parseWikiLink('[[|blank]]')).toBeNull();
  expect(parseWikiLink('[[]]')).toBeNull();
  expect(parseWikiLink('[[   ]]')).toBeNull();
});

test('resolves only a unique name or alias, ignoring case and spacing', () => {
  const topics = [
    topic({ id: 'kt-1', name: 'LangChain' }),
    topic({ id: 'kt-2', name: 'Lang Graph', aliases: ['LangGraph'] })
  ];
  expect(resolveKnowledgeLink(topics, '  langgraph ')?.id).toBe('kt-2');
  expect(resolveKnowledgeLink(topics, 'LC')).toBeNull();
});

test('treats duplicate names or aliases as ambiguous', () => {
  const topics = [
    topic({ id: 'kt-1', name: 'RAG' }),
    topic({ id: 'kt-2', name: '检索增强', aliases: ['RAG'] })
  ];
  expect(resolveKnowledgeLink(topics, 'rag')).toBeNull();
});
