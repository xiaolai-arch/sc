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

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeDates(value: unknown): unknown {
  if (value instanceof Date) {
    return formatUtcDate(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeDates(entry));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeDates(entry)])
    );
  }
  return value;
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stripUndefined(entry));
  }
  if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) {
        result[key] = stripUndefined(entry);
      }
    }
    return result;
  }
  return value;
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
    const data = normalizeDates(parsed.data);
    return isNoteMeta(data)
      ? { meta: data, body: parsed.content }
      : { meta: defaultMeta(), body: parsed.content };
  } catch {
    return { meta: defaultMeta(), body: bodyWithoutFrontmatter(raw) };
  }
}

export function serializeNote(meta: NoteMeta, body: string): string {
  const cleaned = stripUndefined(meta) as NoteMeta;
  const frontmatter = matter.stringify({ content: '' }, cleaned).replace(/\n$/, '');
  return `${frontmatter}${body}`;
}
