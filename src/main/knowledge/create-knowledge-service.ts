import { promises as fs } from 'node:fs';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeBacklink,
  KnowledgeEvidence,
  KnowledgeNote,
  KnowledgeService,
  KnowledgeStatus,
  KnowledgeTopic,
  LinkKnowledgeReviewInput,
  RecordKnowledgeInput,
  SaveKnowledgeNoteInput,
  UpdateKnowledgeTopicInput
} from '../../shared/knowledge';
import {
  KNOWLEDGE_NOTE_CONFLICT_MESSAGE,
  MAX_KNOWLEDGE_NOTE_LENGTH,
  resolveKnowledgeLink,
  topicMatches,
  wikiLinkTargets
} from '../../shared/knowledge';
import type { WorkspaceNote, WorkspaceTask } from '../../shared/workspace';
import { formatLocalDate } from '../../shared/date';
import {
  knowledgeNoteRevision,
  parseKnowledgeNoteFile,
  serializeKnowledgeNoteFile
} from './notes';
import { isKnowledgeStatus } from './records';
import { parseKnowledgeTopicFile, serializeKnowledgeTopicFile } from './records';
import {
  createMutex,
  listMarkdownFiles,
  readFileOrNull,
  writeFileAtomic
} from '../workspace/fs-utils';
import { newId } from '../workspace/ids';
import {
  assertSafeSegment,
  knowledgeNoteFile,
  knowledgeTopicFile,
  knowledgeTopicsDir
} from '../workspace/paths';

const MAX_NAME_LENGTH = 60;
const MAX_ALIASES = 8;
const MAX_ALIAS_LENGTH = 40;
const MAX_SUMMARY_LENGTH = 400;
const MAX_EVIDENCE = 50;

export interface KnowledgeServiceOptions {
  /** Vault root (the directory holding `knowledge/`). */
  root: string;
  now?: () => Date;
}

function requireName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new Error('知识主题名称不能为空。');
  if (name.length > MAX_NAME_LENGTH) {
    throw new Error(`知识主题名称不能超过 ${MAX_NAME_LENGTH} 字。`);
  }
  return name;
}

function normalizeStatus(value: unknown, fallback: KnowledgeStatus): KnowledgeStatus {
  if (value === undefined) return fallback;
  if (!isKnowledgeStatus(value)) throw new Error('知识主题状态无效。');
  return value;
}

function normalizeLevel(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error('掌握程度必须在 1 到 5 之间。');
  }
  return value;
}

function normalizeAliases(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('知识主题别名无效。');
  const aliases: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string') throw new Error('知识主题别名无效。');
    const alias = entry.trim();
    if (!alias) continue;
    if (alias.length > MAX_ALIAS_LENGTH) {
      throw new Error(`别名不能超过 ${MAX_ALIAS_LENGTH} 字。`);
    }
    const key = alias.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
  }
  if (aliases.length > MAX_ALIASES) {
    throw new Error(`别名最多 ${MAX_ALIASES} 个。`);
  }
  return aliases;
}

function normalizeSummary(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw new Error('知识主题摘要无效。');
  const summary = value.trim();
  return summary.length > MAX_SUMMARY_LENGTH
    ? summary.slice(0, MAX_SUMMARY_LENGTH)
    : summary;
}

function normalizeWorkspace(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('所属工作区无效。');
  const workspaceId = value.trim();
  if (!workspaceId) return undefined;
  return assertSafeSegment(workspaceId, 'workspace id');
}

function isSafeTopicId(value: string): boolean {
  try {
    assertSafeSegment(value, 'knowledge topic id');
    return true;
  } catch {
    return false;
  }
}

/**
 * Vault-backed knowledge topics. Each topic lives in
 * `knowledge/topics/<id>.md`; frontmatter is authoritative and the body is an
 * Obsidian-friendly evidence timeline. Owned evidence appends never throw.
 */
export function createKnowledgeService(options: KnowledgeServiceOptions): KnowledgeService {
  const vaultRoot = options.root;
  const now = options.now ?? (() => new Date());
  const runExclusively = createMutex();

  async function readTopic(topicId: string): Promise<KnowledgeTopic | null> {
    if (!isSafeTopicId(topicId)) return null;
    const raw = await readFileOrNull(knowledgeTopicFile(vaultRoot, topicId));
    return raw === null ? null : parseKnowledgeTopicFile(raw, topicId);
  }

  async function readNote(topicId: string): Promise<KnowledgeNote> {
    if (!isSafeTopicId(topicId)) return { topicId, body: '', updatedAt: '', revision: '' };
    const raw = await readFileOrNull(knowledgeNoteFile(vaultRoot, topicId));
    if (raw === null) return { topicId, body: '', updatedAt: '', revision: '' };
    const note = parseKnowledgeNoteFile(raw, topicId);
    return {
      topicId,
      body: note.body,
      updatedAt: note.updatedAt,
      revision: knowledgeNoteRevision(note.body)
    };
  }

  /**
   * Topics whose notes link to `topicId`. Links that are ambiguous (two topics
   * share the term) or point at the topic itself are skipped.
   */
  async function readBacklinks(topicId: string): Promise<KnowledgeBacklink[]> {
    if (!isSafeTopicId(topicId)) return [];
    const target = await readTopic(topicId);
    if (target === null) return [];
    const topics = await listTopics();
    const seen = new Set<string>();
    const backlinks: KnowledgeBacklink[] = [];
    for (const source of topics) {
      if (source.id === target.id || seen.has(source.id)) continue;
      try {
        const note = await readNote(source.id);
        const links = wikiLinkTargets(note.body);
        if (
          links.some((linkTarget) => resolveKnowledgeLink(topics, linkTarget)?.id === target.id)
        ) {
          seen.add(source.id);
          backlinks.push({ topicId: source.id, name: source.name });
        }
      } catch {
        // A broken note must not hide every other backlink.
      }
    }
    return backlinks.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  }

  /** Best-effort: keep a note's frontmatter in step with a renamed topic. */
  async function syncNoteMeta(topic: KnowledgeTopic): Promise<void> {
    try {
      const file = knowledgeNoteFile(vaultRoot, topic.id);
      const raw = await readFileOrNull(file);
      if (raw === null) return;
      const note = parseKnowledgeNoteFile(raw, topic.id);
      await writeFileAtomic(
        file,
        serializeKnowledgeNoteFile({
          ...note,
          title: topic.name,
          aliases: topic.aliases
        })
      );
    } catch {
      // The topic update is the user's write; note sync is cosmetic.
    }
  }

  async function writeTopic(topic: KnowledgeTopic): Promise<KnowledgeTopic> {
    assertSafeSegment(topic.id, 'knowledge topic id');
    await writeFileAtomic(
      knowledgeTopicFile(vaultRoot, topic.id),
      serializeKnowledgeTopicFile(topic)
    );
    return topic;
  }

  async function listTopics(workspaceId?: string): Promise<KnowledgeTopic[]> {
    const topics: KnowledgeTopic[] = [];
    for (const fileName of await listMarkdownFiles(knowledgeTopicsDir(vaultRoot))) {
      const fallbackId = fileName.replace(/\.md$/, '');
      const raw = await readFileOrNull(`${knowledgeTopicsDir(vaultRoot)}/${fileName}`);
      if (raw === null) continue;
      const topic = parseKnowledgeTopicFile(raw, fallbackId);
      if (topic === null) continue;
      if (
        workspaceId !== undefined &&
        topic.workspaceId !== undefined &&
        topic.workspaceId !== workspaceId
      ) {
        continue;
      }
      topics.push(topic);
    }
    return topics.sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name, 'zh')
    );
  }

  function today(): string {
    return formatLocalDate(now());
  }

  /**
   * Adds evidence, deduping by `kind + refId` when a refId exists. A later
   * mention of the same source only enriches its note. `planned` topics start
   * learning the moment they gain evidence.
   */
  function appendEvidence(topic: KnowledgeTopic, evidence: KnowledgeEvidence): KnowledgeTopic {
    if (evidence.refId) {
      const index = topic.evidence.findIndex(
        (entry) => entry.kind === evidence.kind && entry.refId === evidence.refId
      );
      if (index >= 0) {
        const existing = topic.evidence[index];
        if (!evidence.note || existing.note === evidence.note) return topic;
        const next = [...topic.evidence];
        next[index] = { ...existing, note: evidence.note };
        return { ...topic, evidence: next, updatedAt: now().toISOString() };
      }
    }
    return {
      ...topic,
      evidence: [...topic.evidence, evidence].slice(-MAX_EVIDENCE),
      status: topic.status === 'planned' ? 'learning' : topic.status,
      updatedAt: now().toISOString()
    };
  }

  /** Best-effort linking: a broken vault never breaks the caller's write. */
  async function linkMatchedText(
    workspaceId: string | undefined,
    text: string,
    base: Omit<KnowledgeEvidence, 'id' | 'date'>
  ): Promise<void> {
    try {
      const scope = normalizeWorkspace(workspaceId);
      await runExclusively(async () => {
        const topics = await listTopics(scope);
        for (const topic of topics) {
          if (!topicMatches(text, topic)) continue;
          const current = await readTopic(topic.id);
          if (current === null) continue;
          const next = appendEvidence(current, { id: newId('kev'), ...base, date: today() });
          if (next !== current) await writeTopic(next);
        }
      });
    } catch {
      // Auto-linking is additive metadata; never fail the source write.
    }
  }

  function normalizeTerm(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function matchesExactName(topic: KnowledgeTopic, name: string): boolean {
    const needle = normalizeTerm(name);
    return [topic.name, ...topic.aliases].some((term) => normalizeTerm(term) === needle);
  }

  /**
   * The longest name/alias of the topic that appears in `text`. Models often
   * mention a topic with extra words ("LangGraph 状态图"), which must enrich
   * the existing card instead of creating a near-duplicate one.
   */
  function matchedTermLength(topic: KnowledgeTopic, text: string): number {
    let longest = 0;
    for (const term of [topic.name, ...topic.aliases]) {
      if (!normalizeTerm(term)) continue;
      if (topicMatches(text, { ...topic, name: term, aliases: [] })) {
        longest = Math.max(longest, normalizeTerm(term).length);
      }
    }
    return longest;
  }

  function findMentionedTopic(
    topics: KnowledgeTopic[],
    name: string
  ): KnowledgeTopic | undefined {
    const exact = topics.find((topic) => matchesExactName(topic, name));
    if (exact !== undefined) return exact;
    let best: KnowledgeTopic | undefined;
    let bestLength = 0;
    for (const topic of topics) {
      const length = matchedTermLength(topic, name);
      if (length > bestLength) {
        best = topic;
        bestLength = length;
      }
    }
    return best;
  }

  return {
    list: listTopics,

    async get(topicId: string): Promise<KnowledgeTopic | null> {
      return readTopic(topicId);
    },

    getNote: readNote,

    getBacklinks: readBacklinks,

    async saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote> {
      const topicId = typeof input?.topicId === 'string' ? input.topicId.trim() : '';
      if (!isSafeTopicId(topicId)) throw new Error('知识主题 ID 无效。');
      if (typeof input?.body !== 'string') throw new Error('笔记内容无效。');
      if (input.body.length > MAX_KNOWLEDGE_NOTE_LENGTH) {
        throw new Error(`笔记不能超过 ${MAX_KNOWLEDGE_NOTE_LENGTH} 字。`);
      }
      return runExclusively(async () => {
        const topic = await readTopic(topicId);
        if (topic === null) throw new Error('知识主题不存在。');
        const existingRaw = await readFileOrNull(knowledgeNoteFile(vaultRoot, topicId));
        const existing =
          existingRaw === null ? null : parseKnowledgeNoteFile(existingRaw, topicId);
        const currentRevision =
          existing === null ? '' : knowledgeNoteRevision(existing.body);
        if (
          input.expectedRevision !== undefined &&
          !input.force &&
          input.expectedRevision !== currentRevision
        ) {
          throw new Error(KNOWLEDGE_NOTE_CONFLICT_MESSAGE);
        }
        const updatedAt = now().toISOString();
        await writeFileAtomic(
          knowledgeNoteFile(vaultRoot, topicId),
          serializeKnowledgeNoteFile({
            topicId,
            title: topic.name,
            aliases: topic.aliases,
            body: input.body,
            updatedAt,
            meta: existing?.meta ?? { type: 'note' as const, source: 'user' as const }
          })
        );
        return {
          topicId,
          body: input.body,
          updatedAt,
          revision: knowledgeNoteRevision(input.body)
        };
      });
    },

    async create(input: CreateKnowledgeTopicInput): Promise<KnowledgeTopic> {
      const name = requireName(input?.name);
      const timestamp = now().toISOString();
      const level = normalizeLevel(input?.level);
      const workspaceId = normalizeWorkspace(input?.workspaceId);
      const topic: KnowledgeTopic = {
        id: newId('kt'),
        name,
        aliases: normalizeAliases(input?.aliases),
        status: normalizeStatus(input?.status, 'learning'),
        ...(level !== undefined ? { level } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        summary: normalizeSummary(input?.summary),
        evidence: [],
        createdAt: timestamp,
        updatedAt: timestamp
      };
      return runExclusively(() => writeTopic(topic));
    },

    async update(input: UpdateKnowledgeTopicInput): Promise<KnowledgeTopic> {
      const id = typeof input?.id === 'string' ? input.id.trim() : '';
      if (!id) throw new Error('知识主题 ID 无效。');
      return runExclusively(async () => {
        const current = await readTopic(id);
        if (current === null) throw new Error('知识主题不存在。');
        const next: KnowledgeTopic = {
          ...current,
          // Write back to the file that was read, never to a crafted id.
          id,
          ...(input.name !== undefined ? { name: requireName(input.name) } : {}),
          ...(input.aliases !== undefined
            ? { aliases: normalizeAliases(input.aliases) }
            : {}),
          ...(input.status !== undefined
            ? { status: normalizeStatus(input.status, current.status) }
            : {}),
          summary:
            input.summary !== undefined
              ? normalizeSummary(input.summary)
              : current.summary,
          updatedAt: now().toISOString()
        };
        if (input.level === null) {
          delete next.level;
        } else if (input.level !== undefined) {
          next.level = normalizeLevel(input.level);
        }
        if (input.workspaceId === null) {
          delete next.workspaceId;
        } else if (input.workspaceId !== undefined) {
          const workspaceId = normalizeWorkspace(input.workspaceId);
          if (workspaceId) next.workspaceId = workspaceId;
          else delete next.workspaceId;
        }
        const renamed =
          next.name !== current.name ||
          next.aliases.length !== current.aliases.length ||
          next.aliases.some((alias, index) => alias !== current.aliases[index]);
        const written = await writeTopic(next);
        if (renamed) await syncNoteMeta(written);
        return written;
      });
    },

    async delete(topicId: string): Promise<void> {
      if (!isSafeTopicId(topicId)) return;
      await runExclusively(async () => {
        const file = knowledgeTopicFile(vaultRoot, topicId);
        const raw = await readFileOrNull(file);
        if (raw === null) return;
        await fs.rm(file, { force: true });
        try {
          await fs.rm(knowledgeNoteFile(vaultRoot, topicId), { force: true });
        } catch {
          // An unremovable note file must not resurrect a deleted topic.
        }
      });
    },

    async record(input: RecordKnowledgeInput): Promise<KnowledgeTopic> {
      const name = requireName(input?.name);
      const status =
        input?.status !== undefined ? normalizeStatus(input.status, 'learning') : undefined;
      const level = normalizeLevel(input?.level);
      const workspaceId = normalizeWorkspace(input?.workspaceId);
      const note = typeof input?.note === 'string' ? input.note.trim() : '';
      return runExclusively(async () => {
        const topics = await listTopics(workspaceId);
        const existing = findMentionedTopic(topics, name);
        const timestamp = now().toISOString();
        const evidence: KnowledgeEvidence = {
          id: newId('kev'),
          kind: 'chat',
          title: note || '对话记录',
          date: today()
        };
        if (existing !== undefined) {
          const current = await readTopic(existing.id);
          if (current !== null) {
            const withEvidence = appendEvidence(current, evidence);
            const next: KnowledgeTopic = {
              ...withEvidence,
              ...(status !== undefined ? { status } : {}),
              ...(level !== undefined ? { level } : {}),
              updatedAt: timestamp
            };
            return writeTopic(next);
          }
        }
        const topic: KnowledgeTopic = {
          id: newId('kt'),
          name,
          aliases: [],
          status: status ?? 'learning',
          ...(level !== undefined ? { level } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          summary: note,
          evidence: [evidence],
          createdAt: timestamp,
          updatedAt: timestamp
        };
        return writeTopic(topic);
      });
    },

    async linkTask(task: WorkspaceTask): Promise<void> {
      await linkMatchedText(task.workspaceId, `${task.title} ${task.subject}`, {
        kind: 'task',
        refId: task.id,
        title: task.title
      });
    },

    async linkNote(note: WorkspaceNote): Promise<void> {
      await linkMatchedText(note.workspaceId, `${note.title} ${note.tags.join(' ')}`, {
        kind: 'note',
        refId: note.id,
        title: note.title
      });
    },

    async linkReview(input: LinkKnowledgeReviewInput): Promise<void> {
      try {
        const workspaceId = normalizeWorkspace(input?.workspaceId);
        const date =
          typeof input?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)
            ? input.date
            : today();
        const completed = input?.answers?.completed ?? '';
        const stuck = input?.answers?.stuck ?? '';
        await runExclusively(async () => {
          const topics = await listTopics(workspaceId);
          for (const topic of topics) {
            const matchedCompleted = topicMatches(completed, topic);
            const matchedStuck = topicMatches(stuck, topic);
            if (!matchedCompleted && !matchedStuck) continue;
            const current = await readTopic(topic.id);
            if (current === null) continue;
            const next = appendEvidence(current, {
              id: newId('kev'),
              kind: 'review',
              refId: date,
              title: `复盘 ${date}`,
              date,
              ...(matchedStuck ? { note: stuck.trim() } : {})
            });
            if (next !== current) await writeTopic(next);
          }
        });
      } catch {
        // Reviews are written for their own sake; linking is best-effort.
      }
    }
  };
}
