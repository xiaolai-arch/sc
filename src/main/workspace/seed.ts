import { formatLocalDate } from '../../shared/date';
import type { Workspace } from '../../shared/workspace';
import { listMarkdownFiles, pathExists, writeFileAtomic } from './fs-utils';
import { slugify, uniqueFileName } from './ids';
import {
  memoryFile,
  notesDir,
  remindersFile,
  taskFile,
  workspaceFile,
  workspacesDir
} from './paths';
import { serializeMemoryFile, type MemoryEntry } from './records/memory';
import { serializeNoteFile, type NoteRecord } from './records/notes';
import { serializeRemindersFile } from './records/reminders';
import { serializeTaskFile, type TaskRecord } from './records/tasks';
import { serializeWorkspaceFile } from './records/workspace';
import {
  SEED_MEMORY,
  SEED_NOTES,
  SEED_REMINDERS,
  SEED_TASKS,
  SEED_WORKSPACES,
  seedBlocksToBody
} from './seed-data';

/**
 * Creates the demo vault on first launch. Runs only when `workspaces/` does not
 * exist yet, so an existing vault (including one where the user deleted every
 * workspace) is never overwritten.
 */
export async function ensureSeeded(root: string): Promise<void> {
  if (await pathExists(workspacesDir(root))) return;

  const now = new Date().toISOString();
  const today = formatLocalDate(new Date());

  for (const seed of SEED_WORKSPACES) {
    const workspace: Workspace = { ...seed, updatedAt: seed.createdAt };
    await writeFileAtomic(workspaceFile(root, seed.id), serializeWorkspaceFile(workspace));
  }

  const tasksByWorkspace = new Map<string, TaskRecord[]>();
  for (const seed of SEED_TASKS) {
    const record: TaskRecord = {
      id: seed.id,
      title: seed.title,
      subject: seed.subject,
      durationMin: seed.durationMin,
      materialRefs: [],
      acceptance: seed.acceptance,
      status: seed.status,
      created: now,
      updated: now
    };
    const bucket = tasksByWorkspace.get(seed.workspaceId) ?? [];
    bucket.push(record);
    tasksByWorkspace.set(seed.workspaceId, bucket);
  }
  for (const [workspaceId, records] of tasksByWorkspace) {
    await writeFileAtomic(taskFile(root, workspaceId, today), serializeTaskFile(today, records));
  }

  const notesByWorkspace = new Map<string, { name: string; record: NoteRecord }[]>();
  for (const seed of SEED_NOTES) {
    const record: NoteRecord = {
      id: seed.id,
      title: seed.title,
      subject: seed.subject,
      tags: [...seed.tags],
      summary: seed.summary,
      body: seedBlocksToBody(seed.blocks),
      related: [...seed.related],
      source: 'user',
      created: seed.updated,
      updated: seed.updated
    };
    const bucket = notesByWorkspace.get(seed.workspaceId) ?? [];
    bucket.push({ name: `${seed.id}-${slugify(seed.title, 'note')}.md`, record });
    notesByWorkspace.set(seed.workspaceId, bucket);
  }
  for (const [workspaceId, notes] of notesByWorkspace) {
    // Seed note names are unique by construction; uniquify defensively anyway.
    const names = await listMarkdownFiles(notesDir(root, workspaceId));
    for (const note of notes) {
      const name = uniqueFileName(note.name.replace(/\.md$/, ''), names);
      names.push(name);
      await writeFileAtomic(`${notesDir(root, workspaceId)}/${name}`, serializeNoteFile(note.record));
    }
  }

  const memoryByWorkspace = new Map<string, MemoryEntry[]>();
  for (const seed of SEED_MEMORY) {
    const bucket = memoryByWorkspace.get(seed.workspaceId) ?? [];
    bucket.push({ ...seed });
    memoryByWorkspace.set(seed.workspaceId, bucket);
  }
  for (const [workspaceId, entries] of memoryByWorkspace) {
    await writeFileAtomic(memoryFile(root, workspaceId), serializeMemoryFile(entries));
  }

  // Reminders are vault-global; only seed them when the file is absent so a
  // half-deleted vault keeps the user's customized reminder list.
  if (!(await pathExists(remindersFile(root)))) {
    await writeFileAtomic(remindersFile(root), serializeRemindersFile(SEED_REMINDERS));
  }
}
