import type { NoteMeta } from '../../../shared/types';
import type { MemoryItem } from '../../../shared/workspace';
import { parseNote, serializeNote } from '../../vault/note';
import { asRecord, asString } from './coerce';

export type MemoryEntry = {
  id: string;
  text: string;
  source: string;
  createdAt?: string;
};

function coerceEntry(value: unknown): MemoryEntry | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const text = asString(record.text);
  if (!id || !text) return null;
  return {
    id,
    text,
    source: asString(record.source) ?? '',
    createdAt: asString(record.createdAt)
  };
}

export function parseMemoryFile(raw: string): MemoryEntry[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.items)) return [];
  return meta.items
    .map(coerceEntry)
    .filter((entry): entry is MemoryEntry => entry !== null);
}

export function serializeMemoryFile(entries: readonly MemoryEntry[]): string {
  const meta: NoteMeta = {
    type: 'log',
    source: 'agent',
    items: entries.map((entry) => ({ ...entry }))
  };
  const lines = entries.map((entry) => `- ${entry.text}（来源：${entry.source}）`);
  const body = ['# 记忆', '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}

export function toMemoryItem(entry: MemoryEntry, workspaceId: string): MemoryItem {
  return {
    id: entry.id,
    workspaceId,
    text: entry.text,
    source: entry.source,
    createdAt: entry.createdAt
  };
}
