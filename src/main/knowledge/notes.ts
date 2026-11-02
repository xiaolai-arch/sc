import { createHash } from 'node:crypto';
import matter from 'gray-matter';
import type { NoteMeta } from '../../shared/types';
import { parseNote, serializeNote } from '../vault/note';
import { asRecord, asString, asStringArray } from '../workspace/records/coerce';

/**
 * A per-topic markdown note. The file body is user-authored and must survive
 * every write byte-for-byte; frontmatter belongs to the app but may carry
 * extra keys added in Obsidian, so the raw meta travels with the record.
 */
export interface KnowledgeNoteFile {
  topicId: string;
  title: string;
  aliases: string[];
  body: string;
  updatedAt: string;
  meta: NoteMeta;
}

function baseMeta(): NoteMeta {
  return { type: 'note', source: 'user' };
}

/**
 * Reads a note file. The path id is authoritative; a hand-edited `topicId`
 * in frontmatter is ignored so it can never redirect a later write.
 */
export function parseKnowledgeNoteFile(raw: string, fallbackTopicId: string): KnowledgeNoteFile {
  let meta: NoteMeta;
  let body: string;
  try {
    const parsed = matter(raw, {});
    meta = { ...(asRecord(parsed.data) ?? {}), ...baseMeta() };
    body = parsed.content;
  } catch {
    const parsed = parseNote(raw);
    meta = { ...parsed.meta, ...baseMeta() };
    body = parsed.body;
  }
  return {
    topicId: fallbackTopicId,
    title: asString(meta.title)?.trim() ?? '',
    aliases: asStringArray(meta.aliases)
      .map((alias) => alias.trim())
      .filter(Boolean),
    body,
    updatedAt: asString(meta.updated) ?? '',
    meta
  };
}

/**
 * Identifies the note body for conflict detection. Frontmatter is excluded so
 * an Obsidian edit that only touches tags or aliases never blocks a body save.
 */
export function knowledgeNoteRevision(body: string): string {
  return createHash('sha256').update(body, 'utf8').digest('hex');
}

/** Writes the app-owned fields over the original meta, keeping unknown keys. */
export function serializeKnowledgeNoteFile(file: KnowledgeNoteFile): string {
  const meta: NoteMeta = {
    ...file.meta,
    type: 'note',
    source: 'user',
    kind: 'knowledge-note',
    topicId: file.topicId,
    title: file.title,
    aliases: [...file.aliases],
    updated: file.updatedAt
  };
  return serializeNote(meta, file.body);
}
