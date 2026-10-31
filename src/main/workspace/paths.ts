import { join } from 'node:path';

/**
 * Vault layout (Obsidian-readable markdown + YAML frontmatter):
 *
 *   <root>/workspaces/<id>/workspace.md      workspace profile
 *   <root>/workspaces/<id>/tasks/YYYY-MM-DD.md  daily task lists
 *   <root>/workspaces/<id>/notes/*.md        freeform notes
 *   <root>/workspaces/<id>/memory.md         butler memory log
 *   <root>/workspaces/<id>/reviews/YYYY-MM-DD.md  per-workspace reviews
 *   <root>/reviews/YYYY-MM-DD.md             vault-wide reviews
 *   <root>/reminders.md                      reminders are vault-global
 *
 * Frontmatter is the machine-readable source of truth; the markdown body is a
 * human-friendly rendering that may be edited freely in Obsidian.
 */

// Unicode letters/numbers keep Obsidian-style CJK folder ids readable while
// still rejecting `/`, `\`, `.`, whitespace, and anything else that could
// escape the vault root.
const SAFE_SEGMENT = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function assertSafeSegment(value: string, label: string): string {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

export function assertIsoDate(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    !ISO_DATE.test(value) ||
    Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
  ) {
    throw new Error(`Invalid ${label}: expected a YYYY-MM-DD date`);
  }
  return value;
}

export const WORKSPACES_DIR = 'workspaces';

export function workspacesDir(root: string): string {
  return join(root, WORKSPACES_DIR);
}

export function workspaceDir(root: string, workspaceId: string): string {
  return join(workspacesDir(root), workspaceId);
}

export function workspaceFile(root: string, workspaceId: string): string {
  return join(workspaceDir(root, workspaceId), 'workspace.md');
}

export function tasksDir(root: string, workspaceId: string): string {
  return join(workspaceDir(root, workspaceId), 'tasks');
}

export function taskFile(root: string, workspaceId: string, date: string): string {
  return join(tasksDir(root, workspaceId), `${date}.md`);
}

export function notesDir(root: string, workspaceId: string): string {
  return join(workspaceDir(root, workspaceId), 'notes');
}

export function memoryFile(root: string, workspaceId: string): string {
  return join(workspaceDir(root, workspaceId), 'memory.md');
}

export function reviewsDir(root: string, workspaceId?: string): string {
  return workspaceId === undefined
    ? join(root, 'reviews')
    : join(workspaceDir(root, workspaceId), 'reviews');
}

export function reviewFile(root: string, workspaceId: string | undefined, date: string): string {
  return join(reviewsDir(root, workspaceId), `${date}.md`);
}

export function remindersFile(root: string): string {
  return join(root, 'reminders.md');
}
