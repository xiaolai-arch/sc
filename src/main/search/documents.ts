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
import { parseLongPlanFile } from '../plans/records';
import { parseKnowledgeTopicFile } from '../knowledge/records';
import type { LongPlan } from '../../shared/plans';
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
  /** Owning workspace; null for vault-global knowledge topics. */
  workspaceId: string | null;
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

function planSearchText(plan: LongPlan): string {
  const parts: string[] = [plan.goal, plan.references ?? ''];
  for (const source of plan.sources ?? []) parts.push(source.title);
  for (const topic of plan.knowledge ?? []) parts.push(topic.name);
  for (const phase of plan.phases) {
    parts.push(phase.title, phase.subtitle, phase.goal);
    for (const week of phase.weeks) {
      parts.push(week.title, week.goal);
      for (const check of week.checks) parts.push(check.text);
      for (const day of week.days) parts.push(...day.tasks, day.output);
    }
  }
  return parts.join(' ');
}

/**
 * Validates a vault-global knowledge path. Topic and note files are keyed by
 * their filename id, so a hand-edited frontmatter id can never redirect a read.
 */
function parseKnowledgeRelPath(
  relPath: string,
  dir: 'topics' | 'notes'
): { topicId: string } | null {
  const segments = relPath.split('/');
  if (segments.length !== 3 || segments[0] !== 'knowledge' || segments[1] !== dir) {
    return null;
  }
  const fileName = segments[2] as string;
  if (!fileName.endsWith('.md')) return null;
  const topicId = fileName.slice(0, -3);
  try {
    assertSafeSegment(topicId, 'knowledge topic id');
  } catch {
    return null;
  }
  return { topicId };
}

export function parseKnowledgeTopicRelPath(relPath: string): { topicId: string } | null {
  return parseKnowledgeRelPath(relPath, 'topics');
}

export function parseKnowledgeNoteRelPath(relPath: string): { topicId: string } | null {
  return parseKnowledgeRelPath(relPath, 'notes');
}

/**
 * A knowledge topic and its note are one search result: the note body belongs
 * to the topic, so searching either one opens the same note.
 */
export function parseKnowledgeTopicDoc(
  relPath: string,
  raw: string,
  noteBody: string
): IndexedDoc | null {
  const parsed = parseKnowledgeTopicRelPath(relPath);
  if (parsed === null) return null;
  const topic = parseKnowledgeTopicFile(raw, parsed.topicId);
  if (topic === null) return null;
  const content = [
    topic.name,
    topic.aliases.join(' '),
    topic.summary,
    ...topic.evidence.map((entry) => `${entry.title} ${entry.note ?? ''}`),
    noteBody
  ].join(' ');
  return {
    docId: parsed.topicId,
    kind: 'knowledge-topic',
    title: topic.name,
    content,
    path: relPath,
    workspaceId: topic.workspaceId ?? null
  };
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
    docs.push({ docId, kind, title, content, path: relPath, workspaceId });
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

  if (head === 'plans' && second !== undefined && second.endsWith('.md')) {
    const plan = parseLongPlanFile(raw, dateFromFileName(second));
    if (plan === null) return [];
    push(plan.id, 'plan', plan.goal, planSearchText(plan));
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
