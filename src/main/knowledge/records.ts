import type {
  KnowledgeEvidence,
  KnowledgeEvidenceKind,
  KnowledgeStatus,
  KnowledgeTopic
} from '../../shared/knowledge';
import type { NoteMeta } from '../../shared/types';
import { parseNote, serializeNote } from '../vault/note';
import { assertSafeSegment } from '../workspace/paths';
import { asRecord, asString, asStringArray } from '../workspace/records/coerce';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly KnowledgeStatus[] = ['planned', 'learning', 'mastered', 'paused'];
const EVIDENCE_KINDS: readonly KnowledgeEvidenceKind[] = [
  'task',
  'note',
  'review',
  'chat',
  'manual'
];
const MAX_EVIDENCE = 50;

export function isKnowledgeStatus(value: unknown): value is KnowledgeStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

function isIsoDate(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    ISO_DATE.test(value) &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  );
}

function coerceEvidence(value: unknown, fallbackId: string): KnowledgeEvidence | null {
  const record = asRecord(value);
  if (record === null) return null;
  const kind = asString(record.kind);
  if (!kind || !(EVIDENCE_KINDS as readonly string[]).includes(kind)) return null;
  const title = asString(record.title)?.trim();
  const date = asString(record.date);
  if (!title || !isIsoDate(date)) return null;
  const refId = asString(record.refId)?.trim();
  const note = asString(record.note)?.trim();
  return {
    id: asString(record.id) ?? fallbackId,
    kind: kind as KnowledgeEvidenceKind,
    title,
    date,
    ...(refId ? { refId } : {}),
    ...(note ? { note } : {})
  };
}

/**
 * The filename is the topic's identity on disk. A hand-edited frontmatter id
 * is only trusted when it is a safe path segment; otherwise it falls back to
 * the filename so a crafted id can never redirect a later write.
 */
function topicIdFromMeta(value: unknown, fallbackId: string): string {
  if (typeof value !== 'string') return fallbackId;
  try {
    return assertSafeSegment(value, 'knowledge topic id');
  } catch {
    return fallbackId;
  }
}

/** Reads a `kind: knowledge-topic` file; returns null for anything else. */
export function parseKnowledgeTopicFile(
  raw: string,
  fallbackId: string
): KnowledgeTopic | null {
  const { meta } = parseNote(raw);
  if (meta.kind !== 'knowledge-topic') return null;
  const id = topicIdFromMeta(meta.id, fallbackId);
  const name = asString(meta.name)?.trim();
  if (!name) return null;
  const status = isKnowledgeStatus(meta.status) ? meta.status : 'learning';
  const level =
    typeof meta.level === 'number' && Number.isInteger(meta.level) && meta.level >= 1 && meta.level <= 5
      ? meta.level
      : undefined;
  const workspaceId = asString(meta.workspaceId)?.trim();
  const aliases = asStringArray(meta.aliases)
    .map((alias) => alias.trim())
    .filter(Boolean)
    .slice(0, 8);
  const evidence = Array.isArray(meta.evidence)
    ? meta.evidence
        .map((entry, index) => coerceEvidence(entry, `${id}e${index + 1}`))
        .filter((entry): entry is KnowledgeEvidence => entry !== null)
        .slice(-MAX_EVIDENCE)
    : [];
  return {
    id,
    name,
    aliases,
    status,
    ...(level !== undefined ? { level } : {}),
    ...(workspaceId ? { workspaceId } : {}),
    summary: asString(meta.summary) ?? '',
    evidence,
    createdAt: asString(meta.created) ?? '',
    updatedAt: asString(meta.updated) ?? ''
  };
}

export function serializeKnowledgeTopicFile(topic: KnowledgeTopic): string {
  const meta: NoteMeta = {
    type: 'note',
    source: 'user',
    kind: 'knowledge-topic',
    id: topic.id,
    name: topic.name,
    aliases: [...topic.aliases],
    status: topic.status,
    ...(topic.level !== undefined ? { level: topic.level } : {}),
    ...(topic.workspaceId ? { workspaceId: topic.workspaceId } : {}),
    summary: topic.summary,
    evidence: topic.evidence.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      ...(entry.refId ? { refId: entry.refId } : {}),
      title: entry.title,
      date: entry.date,
      ...(entry.note ? { note: entry.note } : {})
    })),
    created: topic.createdAt,
    updated: topic.updatedAt
  };

  const lines: string[] = [`# ${topic.name}`, ''];
  if (topic.summary) lines.push(topic.summary, '');
  lines.push('## 证据');
  if (topic.evidence.length === 0) {
    lines.push('还没有证据。');
  } else {
    for (const entry of topic.evidence) {
      const note = entry.note ? ` — ${entry.note}` : '';
      lines.push(`- ${entry.date} · ${entry.title}${note}`);
    }
  }
  lines.push('');
  return serializeNote(meta, lines.join('\n'));
}
