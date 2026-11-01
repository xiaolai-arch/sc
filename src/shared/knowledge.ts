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
}

/** Renderer-facing knowledge contract over IPC. */
export interface KnowledgeApi {
  listKnowledgeTopics(workspaceId?: string): Promise<KnowledgeTopic[]>;
  createKnowledgeTopic(input: CreateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  updateKnowledgeTopic(input: UpdateKnowledgeTopicInput): Promise<KnowledgeTopic>;
  deleteKnowledgeTopic(id: string): Promise<void>;
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

/** Planned and paused topics stay out of prompts until the user moves them. */
export function isActiveKnowledgeTopic(topic: KnowledgeTopic): boolean {
  return topic.status === 'mastered' || topic.status === 'learning';
}
