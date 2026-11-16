import type { ButlerReference } from '../../shared/butler-stream';
import {
  activeProfileEntries,
  PROFILE_CATEGORY_LABELS,
  type ProfileEntry
} from '../../shared/profile';
import type { SearchService } from '../../shared/search';

/** Also the number of profile entries the system prompt renders. */
export const MAX_PROFILE_REFERENCES = 6;
const MAX_SEARCH_REFERENCES = 4;
const MAX_REFERENCE_TITLE = 60;
/** Search snippets become tooltips; keep them from carrying a whole page. */
const MAX_REFERENCE_DETAIL = 200;

function clip(text: string, maxLength: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

/**
 * Profile entries shape every answer, so the ones actually loaded into the
 * prompt are always listed as references (confirmed first).
 */
export function profileReferences(entries: readonly ProfileEntry[]): ButlerReference[] {
  return activeProfileEntries(entries)
    .slice(0, MAX_PROFILE_REFERENCES)
    .map((entry) => ({
      id: entry.id,
      kind: 'profile',
      title: clip(entry.text, MAX_REFERENCE_TITLE),
      detail: `${PROFILE_CATEGORY_LABELS[entry.category]} · ${
        entry.confidence === 'confirmed' ? '你提供' : '待确认'
      }`
    }));
}

export interface CollectReferencesInput {
  profile: readonly ProfileEntry[];
  /** Lazily provided so retrieval never starts the vault watcher on its own. */
  getSearch?: (() => SearchService | null) | null;
  query: string;
  workspaceId?: string;
  limit?: number;
}

/**
 * Builds the "本次参考" list for one turn: stable profile facts plus the
 * vault records MiniSearch ranked for the user's question. Retrieval is
 * best-effort — a search failure must not block the answer.
 */
export async function collectReferences(
  input: CollectReferencesInput
): Promise<ButlerReference[]> {
  const references = profileReferences(input.profile);
  const query = input.query.trim();
  if (query.length === 0 || !input.getSearch) return references;
  let results;
  try {
    const search = input.getSearch();
    if (search === null) return references;
    results = input.workspaceId
      ? await search.search(input.workspaceId, query, MAX_SEARCH_REFERENCES)
      : await search.searchAll(query, MAX_SEARCH_REFERENCES);
  } catch {
    return references;
  }
  const seen = new Set(references.map((entry) => `${entry.kind}:${entry.id}`));
  for (const result of results) {
    const key = `${result.kind}:${result.docId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    references.push({
      id: result.docId,
      kind: result.kind,
      title: clip(result.title, MAX_REFERENCE_TITLE),
      ...(result.snippet ? { detail: clip(result.snippet, MAX_REFERENCE_DETAIL) } : {}),
      ...(result.workspaceId ? { workspaceId: result.workspaceId } : {}),
      path: result.path
    });
  }
  return references.slice(0, input.limit ?? MAX_PROFILE_REFERENCES + MAX_SEARCH_REFERENCES);
}
