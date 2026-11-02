import type { ReviewAnswers } from './types';
import type { WorkspaceNote, WorkspaceTask } from './workspace';

/**
 * The knowledge base is ASAKI's durable picture of what the user has learned.
 * A topic is one subject with a mastery status and the evidence behind it;
 * files live under `knowledge/topics/` in the vault with YAML frontmatter.
 */

export type KnowledgeStatus = 'planned' | 'learning' | 'mastered' | 'paused';

export type KnowledgeEvidenceKind = 'task' | 'note' | 'review' | 'chat' | 'manual';

export interface KnowledgeEvidence {
  id: string;
  kind: KnowledgeEvidenceKind;
  /** Source record id (task/note); reviews use the date. Absent for chat. */
  refId?: string;
  title: string;
  /** Local date YYYY-MM-DD. */
  date: string;
  note?: string;
}

export interface KnowledgeTopic {
  id: string;
  name: string;
  aliases: string[];
  status: KnowledgeStatus;
  /** 1–5 self-rated mastery; absent when not set. */
  level?: number;
  /** Absent means the topic applies to every workspace. */
  workspaceId?: string;
  summary: string;
  evidence: KnowledgeEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeTopicInput {
  name: string;
  aliases?: string[];
  /** Defaults to `learning`. */
  status?: KnowledgeStatus;
  level?: number;
  workspaceId?: string;
  summary?: string;
}

export interface UpdateKnowledgeTopicInput {
  id: string;
  name?: string;
  aliases?: string[];
  status?: KnowledgeStatus;
  /** null clears the level. */
  level?: number | null;
  /** null makes the topic global. */
  workspaceId?: string | null;
  summary?: string;
}

export interface RecordKnowledgeInput {
  name: string;
  /** New topics default to `learning`. */
  status?: KnowledgeStatus;
  level?: number;
  note?: string;
  /** Absent means a global topic. */
  workspaceId?: string;
}

/** One user-authored markdown note per topic, stored under `knowledge/notes/`. */
export interface KnowledgeNote {
  topicId: string;
  body: string;
  /** Empty when the note has never been saved. */
  updatedAt: string;
}

export interface SaveKnowledgeNoteInput {
  topicId: string;
  body: string;
}

export interface KnowledgeBacklink {
  topicId: string;
  name: string;
}

export const MAX_KNOWLEDGE_NOTE_LENGTH = 200_000;

/** Parsed `[[target]]` / `[[target|label]]` token. */
export interface WikiLink {
  target: string;
  label: string;
}

export interface LinkKnowledgeReviewInput {
  /** Absent means a vault-wide review, matched against every topic. */
  workspaceId?: string;
  date: string;
  answers: ReviewAnswers;
}

/** Main-process contract: vault-backed or test implementation. */
export interface KnowledgeService {
  list(workspaceId?: string): Promise<KnowledgeTopic[]>;
  get(id: string): Promise<KnowledgeTopic | null>;
  create(input: CreateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  update(input: UpdateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  delete(id: string): Promise<void>;
  record(input: RecordKnowledgeInput): Promise<KnowledgeTopic>;
  linkTask(task: WorkspaceTask): Promise<void>;
  linkNote(note: WorkspaceNote): Promise<void>;
  linkReview(input: LinkKnowledgeReviewInput): Promise<void>;
  getNote(topicId: string): Promise<KnowledgeNote>;
  saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
}

/** Renderer-facing knowledge contract over IPC. */
export interface KnowledgeApi {
  listKnowledgeTopics(workspaceId?: string): Promise<KnowledgeTopic[]>;
  createKnowledgeTopic(input: CreateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  updateKnowledgeTopic(input: UpdateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  deleteKnowledgeTopic(id: string): Promise<void>;
  getKnowledgeNote(topicId: string): Promise<KnowledgeNote>;
  saveKnowledgeNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getKnowledgeBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
}

const CJK = /[㐀-鿿぀-ヿ가-힯]/;

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function termMatches(text: string, term: string): boolean {
  const needle = normalize(term);
  if (!needle) return false;
  if (CJK.test(needle)) return text.includes(needle);
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(text);
}

/**
 * True when the text mentions the topic by name or alias. Latin terms require
 * word boundaries so `Java` never matches `JavaScript`; CJK terms are matched
 * as substrings because Chinese text has no word separators.
 */
export function topicMatches(text: string, topic: KnowledgeTopic): boolean {
  const haystack = normalize(text);
  if (!haystack) return false;
  return [topic.name, ...topic.aliases].some((term) => termMatches(haystack, term));
}

export function normalizeKnowledgeTerm(value: string): string {
  return normalize(value);
}

const WIKI_LINK_TOKEN = /^\[\[([^\]\n|]+)(?:\|([^\]\n]*))?\]\]$/;

/** Parses a complete `[[target]]` or `[[target|label]]` token. */
export function parseWikiLink(token: string): WikiLink | null {
  const match = WIKI_LINK_TOKEN.exec(token);
  if (!match) return null;
  const target = (match[1] ?? '').trim();
  if (!target) return null;
  const label = (match[2] ?? target).trim() || target;
  return { target, label };
}

/** Removes fenced code blocks and inline code so code can't create backlinks. */
function withoutCode(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const kept: string[] = [];
  let inFence = false;
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inFence = !inFence;
      kept.push('');
      continue;
    }
    kept.push(inFence ? '' : line);
  }
  return kept.join('\n').replace(/`[^`\n]*`/g, '');
}

/** Wiki-link targets in source order, excluding code. */
export function wikiLinkTargets(text: string): string[] {
  const targets: string[] = [];
  for (const match of withoutCode(text).matchAll(/\[\[[^\]\n]+\]\]/g)) {
    const link = parseWikiLink(match[0]);
    if (link) targets.push(link.target);
  }
  return targets;
}

/**
 * Resolves a wiki-link target to a topic by exact name or alias. Duplicate
 * names are ambiguous and resolve to nothing so links never jump at random.
 */
export function resolveKnowledgeLink(
  topics: KnowledgeTopic[],
  target: string
): KnowledgeTopic | null {
  const needle = normalizeKnowledgeTerm(target);
  if (!needle) return null;
  const matches = topics.filter((topic) =>
    [topic.name, ...topic.aliases].some(
      (term) => normalizeKnowledgeTerm(term) === needle
    )
  );
  return matches.length === 1 ? matches[0]! : null;
}

/** Planned and paused topics stay out of prompts until the user moves them. */
export function isActiveKnowledgeTopic(topic: KnowledgeTopic): boolean {
  return topic.status === 'mastered' || topic.status === 'learning';
}
