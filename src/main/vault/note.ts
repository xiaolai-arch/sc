import matter from 'gray-matter';
import type { NoteMeta, NoteType } from '../../shared/types';

const NOTE_TYPES: readonly NoteType[] = [
  'note',
  'mistake',
  'plan',
  'log',
  'qa',
  'profile',
  'material'
];

function defaultMeta(): NoteMeta {
  return { type: 'note', source: 'user' };
}

function isNoteMeta(value: unknown): value is NoteMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const { type } = value as Record<string, unknown>;
  return typeof type === 'string' && (NOTE_TYPES as readonly string[]).includes(type);
}

function bodyWithoutFrontmatter(raw: string): string {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') {
    return raw;
  }
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      return lines.slice(i + 1).join('\n');
    }
  }
  return raw;
}

export function parseNote(raw: string): { meta: NoteMeta; body: string } {
  try {
    // Passing options disables gray-matter's module-level cache, which would
    // otherwise return a half-parsed file for content that previously threw.
    const parsed = matter(raw, {});
    return isNoteMeta(parsed.data)
      ? { meta: parsed.data, body: parsed.content }
      : { meta: defaultMeta(), body: parsed.content };
  } catch {
    return { meta: defaultMeta(), body: bodyWithoutFrontmatter(raw) };
  }
}

export function serializeNote(meta: NoteMeta, body: string): string {
  const frontmatter = matter.stringify({ content: '' }, meta).replace(/\n$/, '');
  return `${frontmatter}${body}`;
}
