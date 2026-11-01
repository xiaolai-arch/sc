import type { LongPlanSource } from '../../shared/plans';
import type { ModelClient } from '../agent/model-client';
import { extractJson } from '../planning/parse';

const MAX_SOURCES = 8;
const MAX_FACTS = 12;
const MAX_TITLE_LENGTH = 120;
const MAX_FACT_LENGTH = 200;
const MAX_REFERENCE_LENGTH = 2000;
const MODEL_MAX_TOKENS = 2_000;
const MODEL_TEMPERATURE = 0.2;

export interface ResearchTopicInput {
  goal: string;
  weeks: number;
  weeklyHours: number;
  notes?: string;
  references?: string;
}

export interface ResearchResult {
  sources: LongPlanSource[];
  facts: string[];
}

const EMPTY_RESEARCH: ResearchResult = { sources: [], facts: [] };

const RESEARCH_SYSTEM_PROMPT = `你是阿咲的调研助手。你要为一份长期学习计划查找可核实的依据。
规则：
- 优先使用你可用的网页搜索/网页读取工具，查找目标领域的最新课程大纲、官方文档和岗位要求。
- 只输出一个 JSON 对象，不要 Markdown 或解释：{"sources":[{"title":"来源标题","url":"https://..."}],"facts":["可核实的要点"]}
- sources 只列出你实际检索或访问过的页面，禁止编造 URL；title 用页面原标题。
- facts 写具体、可执行的事实（工具版本、章节结构、岗位要求），最多 12 条，不要泛泛而谈。
- 如果无法联网，返回 {"sources":[],"facts":[]}，不要用记忆冒充检索结果。`;

function clip(value: string, maxLength: number): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

export function buildResearchPrompt(input: ResearchTopicInput): {
  system: string;
  user: string;
} {
  const references = input.references?.trim();
  const lines = [
    `学习目标：${clip(input.goal, 300)}`,
    `计划时长：${input.weeks} 周，每周约 ${input.weeklyHours} 小时`,
    input.notes?.trim() ? `背景：${clip(input.notes, MAX_REFERENCE_LENGTH)}` : null,
    references ? `用户已有资料（可作为检索线索）：${clip(references, MAX_REFERENCE_LENGTH)}` : null,
    '请检索与这个目标相关的课程结构、官方文档和岗位要求，只输出 JSON。'
  ];
  return {
    system: RESEARCH_SYSTEM_PROMPT,
    user: lines.filter((line): line is string => line !== null).join('\n')
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function httpUrl(value: unknown): URL | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function coerceSources(value: unknown): LongPlanSource[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const sources: LongPlanSource[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (record === null) continue;
    const url = httpUrl(record.url);
    if (url === null || seen.has(url.href)) continue;
    seen.add(url.href);
    const title =
      typeof record.title === 'string' && record.title.trim()
        ? clip(record.title, MAX_TITLE_LENGTH)
        : url.hostname;
    sources.push({ title, url: url.href });
    if (sources.length >= MAX_SOURCES) break;
  }
  return sources;
}

function coerceFacts(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const facts: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const fact = clip(entry, MAX_FACT_LENGTH);
    if (fact && !facts.includes(fact)) facts.push(fact);
    if (facts.length >= MAX_FACTS) break;
  }
  return facts;
}

/**
 * Strictly reads the research reply. A model that answers from memory cannot
 * smuggle in sources: only http(s) links survive, and malformed output reads
 * as "nothing found" so the plan is never labelled as web-grounded by accident.
 */
export function parseResearchReply(text: string): ResearchResult {
  const json = extractJson(text);
  if (json === null) return EMPTY_RESEARCH;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return EMPTY_RESEARCH;
  }
  const record = asRecord(parsed);
  if (record === null) return EMPTY_RESEARCH;
  return {
    sources: coerceSources(record.sources),
    facts: coerceFacts(record.facts)
  };
}

/** Runs the optional web research pass; any failure means "no sources". */
export async function researchPlanTopic(
  input: ResearchTopicInput,
  modelClient: ModelClient | null
): Promise<ResearchResult> {
  if (modelClient === null) return EMPTY_RESEARCH;
  try {
    const prompt = buildResearchPrompt(input);
    const response = await modelClient.complete({
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ],
      temperature: MODEL_TEMPERATURE,
      maxTokens: MODEL_MAX_TOKENS,
      webTools: true
    });
    return parseResearchReply(response.text);
  } catch {
    return EMPTY_RESEARCH;
  }
}
