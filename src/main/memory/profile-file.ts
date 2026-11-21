import type { NoteMeta } from '../../shared/types';
import {
  isProfileCategory,
  isProfileConfidence,
  isProfileSource,
  isProfileStatus,
  PROFILE_CATEGORY_LABELS,
  PROFILE_CATEGORY_ORDER,
  PROFILE_HISTORY_LIMIT,
  type ProfileEntry,
  type ProfileHistoryEntry
} from '../../shared/profile';
import { parseNote, serializeNote } from '../vault/note';
import { asRecord, asString } from '../workspace/records/coerce';

/**
 * Reads the replaced values of one entry. Absent or unreadable history stays
 * absent so a legacy `profile.md` is never rewritten just to add the field;
 * hand-added overflow beyond the cap is dropped.
 */
function coerceHistory(value: unknown): ProfileHistoryEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const records: ProfileHistoryEntry[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (record === null) continue;
    const text = asString(record.text);
    if (!text) continue;
    records.push({
      text,
      origin: asString(record.origin) ?? '',
      // An unknown provenance must not be promoted to a model-authored fact,
      // mirroring the rule for the entry itself.
      source: isProfileSource(record.source) ? record.source : 'user',
      replacedAt: asString(record.replacedAt) ?? ''
    });
  }
  const capped = records.slice(0, PROFILE_HISTORY_LIMIT);
  return capped.length > 0 ? capped : undefined;
}

function coerceEntry(value: unknown): ProfileEntry | null {
  const record = asRecord(value);
  if (record === null) return null;
  const id = asString(record.id);
  const text = asString(record.text);
  if (!id || !text) return null;
  const category = isProfileCategory(record.category) ? record.category : 'identity';
  const createdAt = asString(record.createdAt) ?? '';
  const history = coerceHistory(record.history);
  return {
    id,
    category,
    text,
    // Hand-edited files default to "the user said it": an unknown provenance
    // must never be promoted to a model-authored fact.
    source: isProfileSource(record.source) ? record.source : 'user',
    confidence: isProfileConfidence(record.confidence) ? record.confidence : 'confirmed',
    status: isProfileStatus(record.status) ? record.status : 'active',
    origin: asString(record.origin) ?? '',
    createdAt,
    updatedAt: asString(record.updatedAt) ?? createdAt,
    ...(history ? { history } : {})
  };
}

/** Parses `profile.md`; entries that fail validation are dropped, not fatal. */
export function parseProfileFile(raw: string): ProfileEntry[] {
  return parseProfileFileDetailed(raw).entries;
}

/**
 * Like `parseProfileFile`, but keeps the raw items that could not be read so a
 * write can put them back instead of silently deleting a hand-edited entry.
 */
export function parseProfileFileDetailed(raw: string): {
  entries: ProfileEntry[];
  invalid: unknown[];
} {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.items)) return { entries: [], invalid: [] };
  const entries: ProfileEntry[] = [];
  const invalid: unknown[] = [];
  for (const item of meta.items) {
    const entry = coerceEntry(item);
    if (entry) entries.push(entry);
    else invalid.push(item);
  }
  return { entries, invalid };
}

/** One compact body line per replaced value; dates use the ISO `YYYY-MM-DD`. */
function historyBodyLines(entry: ProfileEntry): string[] {
  if (!entry.history || entry.history.length === 0) return [];
  return entry.history.slice(0, PROFILE_HISTORY_LIMIT).map((record) => {
    const origin = record.origin ? `${record.origin} · ` : '';
    return `  - 原：${record.text}（${origin}${record.replacedAt.slice(0, 10)} 替换）`;
  });
}

export function serializeProfileFile(
  entries: readonly ProfileEntry[],
  invalidItems: readonly unknown[] = []
): string {
  const meta: NoteMeta = {
    type: 'profile',
    source: 'user',
    items: [...entries.map((entry) => ({ ...entry })), ...invalidItems]
  };
  const sections: string[] = ['# 个人档案', ''];
  for (const category of PROFILE_CATEGORY_ORDER) {
    const items = entries.filter((entry) => entry.category === category);
    if (items.length === 0) continue;
    sections.push(`## ${PROFILE_CATEGORY_LABELS[category]}`, '');
    for (const entry of items) {
      const status = entry.status === 'expired' ? '（已过期）' : '';
      const candidate = entry.confidence === 'candidate' ? '（待确认）' : '';
      const origin = entry.origin ? `（来源：${entry.origin}）` : '';
      sections.push(`- ${entry.text}${status}${candidate}${origin}`, ...historyBodyLines(entry));
    }
    sections.push('');
  }
  return serializeNote(meta, sections.join('\n'));
}
