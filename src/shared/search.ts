/**
 * Vault-wide search.
 *
 * The search index is an in-memory projection of the vault (MiniSearch), kept
 * fresh by a file watcher on the vault root. Results are plain data so the
 * renderer can consume them over IPC without importing main-process modules.
 */

/** Record types that live under `workspaces/<id>/` and are searchable. */
export type SearchResultKind =
  | 'workspace'
  | 'note'
  | 'task'
  | 'memory'
  | 'review'
  | 'practice-set'
  | 'practice-question'
  | 'practice-mistake';

export interface SearchResult {
  workspaceId: string;
  /** Record id within the workspace (task id, note id, question id, …). */
  docId: string;
  kind: SearchResultKind;
  title: string;
  /** Short excerpt of the matched text around the first query hit. */
  snippet: string;
  /** Relevance score from the index; higher is better. */
  score: number;
  /** Vault-relative posix path of the source file, e.g. `workspaces/kaoyan/notes/x.md`. */
  path: string;
}

export interface SearchService {
  search(workspaceId: string, query: string, limit?: number): Promise<SearchResult[]>;
  /** Re-scans the whole vault (cold start, or after suspected missed events). */
  rebuild(): Promise<void>;
  /** Stops the watcher and drops the index. */
  dispose(): Promise<void>;
}

export const DEFAULT_SEARCH_LIMIT = 20;

/** Maximum characters of a result snippet. */
export const SEARCH_SNIPPET_LENGTH = 120;
