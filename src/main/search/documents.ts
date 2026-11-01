import { assertSafeSegment } from '../workspace/paths';
import { parseMemoryFile } from '../workspace/records/memory';
import { parseNoteFile } from '../workspace/records/notes';
import { parseReviewFile } from '../workspace/records/reviews';
import { parseTaskFile } from '../workspace/records/tasks';
import { parseWorkspaceFile } from '../workspace/records/workspace';
import {
  parseMistakesFile,
  parsePracticeSetFile
} from '../practice/records';
import type { SearchResultKind } from '../../shared/search';

/** One searchable record extracted from a vault file. */
export type IndexedDoc = {
  docId: string;
  kind: SearchResultKind;
  title: string;
  /** Flattened searchable text (body + metadata). */
  content: string;
  /** Vault-relative posix path of the source file. */
  path: string;
};

/**
 * Classifies a vault-relative path as workspace content:
 * `workspaces/<id>/...` with a path-safe id. Vault-global files (`reminders.md`,
 * root `reviews/`) are not workspace records and are not indexed.
 */
export function parseWorkspaceRelPath(
  relPath: string
): { workspaceId: string; sub: string[] } | null {
  const segments = relPath.split('/').filter((segment) => segment.length > 0);
  if (segments.length < 3 || segments[0] !== 'workspaces') return null;
  const workspaceId = segments[1] as string;
  try {
    assertSafeSegment(workspaceId, 'workspace id');
  } catch {
    return null;
  }
  return { workspaceId, sub: segments.slice(2) };
}

function truncate(text: string, maxLength: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

function dateFromFileName(fileName: string): string {
  return fileName.replace(/\.md$/, '');
}

/**
 * Parses one vault markdown file into its searchable documents. Files that are
 * not workspace records (or that fail to parse) produce no documents. Practice
 * attempt logs are deliberately skipped — they only contain timestamps and
 * verdicts, so they would only add noise to results.
 */
export function parseFileDocs(relPath: string, raw: string): IndexedDoc[] {
  const parsed = parseWorkspaceRelPath(relPath);
  if (parsed === null) return [];
  const { workspaceId, sub } = parsed;
  const [head, second] = sub;
  const docs: IndexedDoc[] = [];
  const push = (docId: string, kind: SearchResultKind, title: string, content: string): void => {
    docs.push({ docId, kind, title, content, path: relPath });
  };

  // `workspaces/<id>/workspace.md` — the workspace profile itself.
  if (sub.length === 1 && head === 'workspace.md') {
    const workspace = parseWorkspaceFile(raw, workspaceId);
    if (workspace === null) return [];
    push('workspace', 'workspace', workspace.name, [
      workspace.name,
      workspace.kind,
      workspace.goal,
      workspace.description
    ].join(' '));
    return docs;
  }

  if (head === undefined) return [];

  if (head === 'tasks' && second !== undefined && second.endsWith('.md')) {
    for (const task of parseTaskFile(raw)) {
      push(task.id, 'task', task.title, [task.title, task.subject, task.acceptance].join(' '));
    }
    return docs;
  }

  if (head === 'notes' && second !== undefined && second.endsWith('.md')) {
    const fallbackId = dateFromFileName(second);
    const record = parseNoteFile(raw, fallbackId, new Date().toISOString());
    if (record === null) return [];
    push(record.id, 'note', record.title, [
      record.title,
      record.subject,
      record.tags.join(' '),
      record.summary,
      record.body
    ].join(' '));
    return docs;
  }

  if (sub.length === 1 && head === 'memory.md') {
    for (const entry of parseMemoryFile(raw)) {
      push(entry.id, 'memory', truncate(entry.text, 60), [entry.text, entry.source].join(' '));
    }
    return docs;
  }

  if (head === 'reviews' && second !== undefined && second.endsWith('.md')) {
    const date = dateFromFileName(second);
    parseReviewFile(raw).forEach((entry, index) => {
      push(
        `${date}#${index}`,
        'review',
        `复盘 ${date}`,
        [entry.completed, entry.stuck, entry.tomorrow].join(' ')
      );
    });
    return docs;
  }

  if (head === 'practice') {
    if (sub.length === 3 && second === 'sets' && (sub[2] as string).endsWith('.md')) {
      const setId = dateFromFileName(sub[2] as string);
      const set = parsePracticeSetFile(raw, workspaceId, setId);
      if (set === null) return [];
      const questionText = set.questions
        .map((question) => `${question.prompt} ${question.explanation}`)
        .join(' ');
      push(set.id, 'practice-set', set.title, [set.title, set.subject, questionText].join(' '));
      for (const question of set.questions) {
        push(
          question.id,
          'practice-question',
          truncate(question.prompt, 80),
          [question.prompt, question.options.join(' '), question.explanation].join(' ')
        );
      }
      return docs;
    }
    if (sub.length === 2 && second === 'mistakes.md') {
      for (const mistake of parseMistakesFile(raw)) {
        push(
          mistake.id,
          'practice-mistake',
          truncate(mistake.prompt, 80),
          [mistake.prompt, mistake.explanation].join(' ')
        );
      }
      return docs;
    }
  }

  return docs;
}
