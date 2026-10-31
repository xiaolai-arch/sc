import type { LearnerProfile, MemoryKind, MemoryRecord } from '../../shared/memory';

/** How many entries each profile bucket keeps (newest first). */
const BUCKET_LIMIT = 5;
const SUMMARY_LIMIT = 3;

function byNewestFirst(a: MemoryRecord, b: MemoryRecord): number {
  return (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || b.id.localeCompare(a.id);
}

function dedupeNewestFirst(items: readonly MemoryRecord[], limit: number): string[] {
  const seen = new Set<string>();
  const texts: string[] = [];
  for (const item of items) {
    if (seen.has(item.text)) continue;
    seen.add(item.text);
    texts.push(item.text);
    if (texts.length === limit) break;
  }
  return texts;
}

function bucket(items: readonly MemoryRecord[], kind: MemoryKind): MemoryRecord[] {
  return items.filter((item) => item.kind === kind).sort(byNewestFirst);
}

function joinList(texts: readonly string[]): string {
  return texts.join('、');
}

/**
 * Aggregates memory into a deterministic learner profile. No model involved:
 * the butler prompt needs something stable and cheap to rebuild on every call.
 */
export function buildProfile(
  items: readonly MemoryRecord[],
  now: Date,
  workspaceId?: string
): LearnerProfile {
  const sorted = [...items].sort(byNewestFirst);
  const profile: LearnerProfile = {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    memoryCount: sorted.length,
    strengths: dedupeNewestFirst(bucket(sorted, 'strength'), BUCKET_LIMIT),
    weaknesses: dedupeNewestFirst(bucket(sorted, 'weakness'), BUCKET_LIMIT),
    preferences: dedupeNewestFirst(bucket(sorted, 'preference'), BUCKET_LIMIT),
    plans: dedupeNewestFirst(bucket(sorted, 'plan'), BUCKET_LIMIT),
    recent: dedupeNewestFirst(sorted, BUCKET_LIMIT),
    summary: '',
    generatedAt: now.toISOString()
  };

  if (sorted.length === 0) {
    profile.summary = '暂无记忆，画像待积累。';
    return profile;
  }

  profile.firstAt = sorted[sorted.length - 1]?.createdAt;
  profile.lastAt = sorted[0]?.createdAt;

  const parts = [`共 ${sorted.length} 条记忆`];
  if (profile.weaknesses.length > 0) {
    parts.push(`薄弱点：${joinList(profile.weaknesses.slice(0, SUMMARY_LIMIT))}`);
  }
  if (profile.preferences.length > 0) {
    parts.push(`偏好：${joinList(profile.preferences.slice(0, SUMMARY_LIMIT))}`);
  }
  if (profile.strengths.length > 0) {
    parts.push(`优势：${joinList(profile.strengths.slice(0, SUMMARY_LIMIT))}`);
  }
  profile.summary = `${parts.join('。')}。`;
  return profile;
}
