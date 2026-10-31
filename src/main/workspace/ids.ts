import { randomUUID } from 'node:crypto';

/** Short, path-safe id with a type prefix, e.g. `t-a1b2c3d4`. */
export function newId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * Human-friendly filename segment: keep letters/numbers (including CJK),
 * collapse everything else to hyphens. Never returns an empty string and never
 * contains `.`, `/`, or `\\` so it cannot form a traversal path.
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : fallback;
}

/** First free `<slug>.md` name in `existing` (case-insensitive), suffixing -2, -3, … */
export function uniqueFileName(slug: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  if (!taken.has(`${slug}.md`)) return `${slug}.md`;
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${slug}-${index}.md`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${slug}-${randomUUID().slice(0, 4)}.md`;
}
