import type { NoteMeta } from '../../../shared/types';
import type { WorkspaceNote } from '../../../shared/workspace';
import { parseNote, serializeNote } from '../../vault/note';
import { asString, asStringArray } from './coerce';

export type NoteSource = 'user' | 'agent' | 'imported';

/** A note as stored in `workspaces/<id>/notes/*.md`. */
export type NoteRecord = {
  id: string;
  title: string;
  subject: string;
  tags: string[];
  summary: string;
  body: string;
  related: string[];
  source: NoteSource;
  created: string;
  updated: string;
};

/**
 * Parses a note file. Returns null for files that are not notes (e.g. a task
 * plan dropped into the folder). Notes without valid frontmatter are treated as
 * plain user notes, keyed by their file name.
 */
export function parseNoteFile(raw: string, fallbackId: string, fallbackDate: string): NoteRecord | null {
  const { meta, body } = parseNote(raw);
  if (meta.type !== 'note') return null;
  const source: NoteSource = meta.source === 'agent' || meta.source === 'imported' ? meta.source : 'user';
  return {
    id: asString(meta.id) ?? fallbackId,
    title: asString(meta.title) ?? fallbackId,
    subject: asString(meta.subject) ?? '',
    tags: asStringArray(meta.tags),
    summary: asString(meta.summary) ?? '',
    body: body.replace(/\n$/, ''),
    related: asStringArray(meta.related),
    source,
    created: asString(meta.created) ?? fallbackDate,
    updated: asString(meta.updated) ?? fallbackDate
  };
}

export function serializeNoteFile(record: NoteRecord): string {
  const meta: NoteMeta = {
    type: 'note',
    source: record.source,
    id: record.id,
    title: record.title,
    subject: record.subject,
    tags: record.tags,
    summary: record.summary,
    related: record.related,
    created: record.created,
    updated: record.updated
  };
  // Trailing newline is added on write and stripped on read so bodies round-trip exactly.
  return serializeNote(meta, `${record.body}\n`);
}

export function toWorkspaceNote(record: NoteRecord, workspaceId: string, vaultPath: string): WorkspaceNote {
  return {
    id: record.id,
    workspaceId,
    title: record.title,
    subject: record.subject,
    tags: record.tags,
    updated: record.updated,
    summary: record.summary,
    body: record.body,
    related: record.related,
    path: vaultPath
  };
}
