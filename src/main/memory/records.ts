import type { NoteMeta } from '../../shared/types';
import type { MemoryKind, MemoryRecord } from '../../shared/memory';
import { parseNote, serializeNote } from '../vault/note';
import { asRecord, asString } from '../workspace/records/coerce';

export const KIND_LABELS: Record<MemoryKind, string> = {
  weakness: '薄弱',
  strength: '优势',
  preference: '偏好',
  plan: '计划',
  fact: '记录'
};

const KINDS: readonly MemoryKind[] = [
  'weakness',
  'strength',
  'preference',
  'plan',
  'fact'
];

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

function coerceRecord(workspaceId: string, value: unknown): MemoryRecord | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const text = asString(record.text);
  if (!id || !text) return null;
  return {
    id,
    workspaceId,
    text,
    source: asString(record.source) ?? '',
    createdAt: asString(record.createdAt),
    // Entries written before kinds existed (seed data, older vaults) are plain facts.
    kind: isMemoryKind(record.kind) ? record.kind : 'fact'
  };
}

/**
 * Parses `workspaces/<id>/memory.md`. Frontmatter `items` is the machine-readable
 * source of truth; entries without a `kind` (legacy/seed/hand-edited) read back
 * as `fact`.
 */
export function parseMemoryRecords(raw: string, workspaceId: string): MemoryRecord[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.items)) return [];
  return meta.items
    .map((value) => coerceRecord(workspaceId, value))
    .filter((entry): entry is MemoryRecord => entry !== null);
}

/**
 * Serializes the full entry list back to `memory.md`. Existing entries are never
 * dropped or reordered — callers only append, so the body keeps its log order.
 */
export function serializeMemoryRecords(entries: readonly MemoryRecord[]): string {
  const meta: NoteMeta = {
    type: 'log',
    source: 'agent',
    items: entries.map((entry) => ({
      id: entry.id,
      text: entry.text,
      kind: entry.kind,
      source: entry.source,
      createdAt: entry.createdAt
    }))
  };
  const lines = entries.map(
    (entry) => `- 【${KIND_LABELS[entry.kind]}】${entry.text}（来源：${entry.source}）`
  );
  const body = ['# 记忆', '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}
