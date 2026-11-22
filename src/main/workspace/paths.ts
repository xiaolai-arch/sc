import { join } from 'node:path';
import { isLocalDate, isLocalDateTime } from '../../shared/date';

/**
 * Vault layout (Obsidian-readable markdown + YAML frontmatter):
 *
 *   <root>/workspaces/<id>/workspace.md      workspace profile
 *   <root>/workspaces/<id>/tasks/YYYY-MM-DD.md  daily task lists
 *   <root>/workspaces/<id>/notes/*.md        freeform notes
 *   <root>/workspaces/<id>/plans/*.md        long-term phase/week/day plans
 *   <root>/workspaces/<id>/memory.md         butler memory log
 *   <root>/workspaces/<id>/reviews/YYYY-MM-DD.md  per-workspace reviews
 *   <root>/reviews/YYYY-MM-DD.md             vault-wide reviews
 *   <root>/knowledge/topics/*.md             knowledge topics (global + per workspace)
 *   <root>/knowledge/notes/*.md              user-authored note per knowledge topic
 *   <root>/reminders.md                      reminders are vault-global
 *   <root>/profile.md                        personal profile (vault-global)
 *   <root>/commitments.md                    promises in the user's own words
 *   <root>/week-availability.md              days of a week the user said are packed
 *
 * Frontmatter is the machine-readable source of truth; the markdown body is a
 * human-friendly rendering that may be edited freely in Obsidian.
 */

// Unicode letters/numbers keep Obsidian-style CJK folder ids readable while
// still rejecting `/`, `\`, `.`, whitespace, and anything else that could
// escape the vault root.
const SAFE_SEGMENT = /^[\p{L}\p{N}_][\p{L}\p{N}_-]*$/u;

export function assertSafeSegment(value: string, label: string): string {
  if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

/**
 * True only for a real calendar date written exactly as YYYY-MM-DD.
 *
 * Delegates to the shared strict check, so a day the `Date` constructor would
 * roll over (`2026-02-30` parses as March 2, not NaN) is refused instead of
 * being written to the vault as a file date.
 */
export function assertIsoDate(value: string, label: string): string {
  if (!isLocalDate(value)) {
    throw new Error(`Invalid ${label}: expected a YYYY-MM-DD date`);
  }
  return value;
}

export function assertLocalDateTime(value: string, label: string): string {
  if (!isLocalDateTime(value)) {
    throw new Error(`Invalid ${label}: expected a YYYY-MM-DDTHH:mm local time`);
  }
  assertIsoDate(value.slice(0, 10), label);
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

export function plansDir(root: string, workspaceId: string): string {
  return join(workspaceDir(root, workspaceId), 'plans');
}

export function planFile(root: string, workspaceId: string, planId: string): string {
  return join(plansDir(root, workspaceId), `${planId}.md`);
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

/** Vault-wide personal profile (not tied to one workspace). */
export function profileFile(root: string): string {
  return join(root, 'profile.md');
}

/**
 * Promises the user made in their own words. Vault-global because a promise
 * does not have to belong to a project (its `workspaceId` is optional).
 */
export function commitmentsFile(root: string): string {
  return join(root, 'commitments.md');
}

/**
 * Which days of one week the user said are especially full. Vault-global like
 * `commitments.md`: the packed days constrain every project's daily and
 * long-term plans, not just one workspace.
 */
export function weekAvailabilityFile(root: string): string {
  return join(root, 'week-availability.md');
}

export function knowledgeDir(root: string): string {
  return join(root, 'knowledge');
}

export function knowledgeTopicsDir(root: string): string {
  return join(knowledgeDir(root), 'topics');
}

export function knowledgeTopicFile(root: string, topicId: string): string {
  return join(knowledgeTopicsDir(root), `${topicId}.md`);
}

export function knowledgeNotesDir(root: string): string {
  return join(knowledgeDir(root), 'notes');
}

export function knowledgeNoteFile(root: string, topicId: string): string {
  return join(knowledgeNotesDir(root), `${topicId}.md`);
}
