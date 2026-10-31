import type { NoteMeta, ReviewAnswers } from '../../../shared/types';
import { parseNote, serializeNote } from '../../vault/note';
import { asBoolean, asRecord, asString } from './coerce';

export type ReviewEntry = ReviewAnswers & {
  submittedAt: string;
  workspaceId?: string;
};

export function parseReviewFile(raw: string): ReviewEntry[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.entries)) return [];
  const entries: ReviewEntry[] = [];
  for (const value of meta.entries) {
    const record = asRecord(value);
    if (record === null) continue;
    const submittedAt = asString(record.submittedAt);
    if (!submittedAt) continue;
    entries.push({
      submittedAt,
      workspaceId: asString(record.workspaceId),
      completed: asString(record.completed) ?? '',
      stuck: asString(record.stuck) ?? '',
      tomorrow: asString(record.tomorrow) ?? '',
      skipped: asBoolean(record.skipped, false)
    });
  }
  return entries;
}

/**
 * Reviews append to the day's file instead of overwriting it — earlier
 * submissions (and Obsidian edits to the body) are never lost.
 */
export function serializeReviewFile(date: string, entries: readonly ReviewEntry[]): string {
  const meta: NoteMeta = {
    type: 'log',
    source: 'user',
    kind: 'review',
    date,
    entries: entries.map((entry) => ({ ...entry }))
  };
  const sections = entries.map((entry, index) => {
    const header = `## 第 ${index + 1} 次复盘（${entry.submittedAt}）`;
    return [
      header,
      '',
      `**完成了什么**：${entry.completed}`,
      '',
      `**卡在哪里**：${entry.stuck}`,
      '',
      `**明天做什么**：${entry.tomorrow}`,
      ''
    ].join('\n');
  });
  const body = [`# ${date} 复盘`, '', ...sections].join('\n');
  return serializeNote(meta, body);
}
