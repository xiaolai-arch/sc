import {
  isActiveKnowledgeTopic,
  topicMatches,
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
