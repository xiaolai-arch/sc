import { FakeModelClient } from '../../src/main/agent/model-client';
import { parseResearchReply, researchPlanTopic } from '../../src/main/plans/research';

const reply = JSON.stringify({
  sources: [
    { title: 'Anthropic Agent 文档', url: 'https://docs.example.com/agents' },
    { title: 'OpenAI Agent 指南', url: 'https://platform.example.com/guides/agents' },
    { title: '不是网页', url: 'ftp://example.com/file' },
    { title: '重复来源', url: 'https://docs.example.com/agents' }
  ],
  facts: ['工具调用需要结构化参数', '评测集应先于优化建立']
});

test('keeps only http(s) sources, drops duplicates, and reads facts', () => {
  const result = parseResearchReply(reply);
  expect(result.sources.map((source) => source.url)).toEqual([
    'https://docs.example.com/agents',
    'https://platform.example.com/guides/agents'
  ]);
  expect(result.sources[0]?.title).toBe('Anthropic Agent 文档');
  expect(result.facts).toEqual(['工具调用需要结构化参数', '评测集应先于优化建立']);
});

test('returns empty research for prose or malformed JSON', () => {
  expect(parseResearchReply('我查了一下，建议先学 Python。')).toEqual({
    sources: [],
    facts: []
  });
  expect(parseResearchReply('```json\n{"sources": [')).toEqual({ sources: [], facts: [] });
  expect(parseResearchReply('{"sources":[{"title":"x","url":"javascript:alert(1)"}]}')).toEqual({
    sources: [],
    facts: []
  });
});

test('caps sources at 8 and facts at 12', () => {
  const many = JSON.stringify({
    sources: Array.from({ length: 12 }, (_value, index) => ({
      title: `来源 ${index + 1}`,
      url: `https://example.com/${index + 1}`
    })),
    facts: Array.from({ length: 20 }, (_value, index) => `要点 ${index + 1}`)
  });
  const result = parseResearchReply(many);
  expect(result.sources).toHaveLength(8);
  expect(result.facts).toHaveLength(12);
});

test('asks the model with web tools and returns its sources', async () => {
  const client = new FakeModelClient([reply]);
  const result = await researchPlanTopic(
    { goal: '系统学习 AI Agent', weeks: 12, weeklyHours: 15 },
    client
  );

  expect(result.sources).toHaveLength(2);
  expect(client.calls).toHaveLength(1);
  expect(client.calls[0]?.webTools).toBe(true);
  expect(client.calls[0]?.messages[1]?.content).toContain('系统学习 AI Agent');
});

test('degrades to empty research when the model fails or is missing', async () => {
  const failing = new FakeModelClient([new Error('offline')]);
  expect(
    await researchPlanTopic({ goal: '学 Agent', weeks: 4, weeklyHours: 10 }, failing)
  ).toEqual({ sources: [], facts: [] });
  expect(
    await researchPlanTopic({ goal: '学 Agent', weeks: 4, weeklyHours: 10 }, null)
  ).toEqual({ sources: [], facts: [] });
});
