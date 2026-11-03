import { promises as fs } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import MiniSearch from 'minisearch';
import {
  DEFAULT_SEARCH_LIMIT,
  SEARCH_SNIPPET_LENGTH,
  type SearchResult,
  type SearchService
} from '../../shared/search';
import type { WorkspaceService } from '../../shared/workspace';
import { parseKnowledgeNoteFile } from '../knowledge/notes';
import { createMutex } from '../workspace/fs-utils';
import {
  assertSafeSegment,
  knowledgeNoteFile,
  knowledgeTopicFile,
  knowledgeTopicsDir,
  workspaceDir
} from '../workspace/paths';
import {
  parseFileDocs,
  parseKnowledgeNoteRelPath,
  parseKnowledgeTopicDoc,
  parseKnowledgeTopicRelPath,
  parseWorkspaceRelPath,
  type IndexedDoc
} from './documents';
import { buildSnippet, tokenize } from './tokenize';
import {
  createChokidarWatcher,
  hasHiddenSegment,
  type VaultWatcher,
  type VaultWatcherHandlers,
  type WatcherFactory
} from './watcher';

export interface SearchServiceOptions {
  workspaceService: WorkspaceService;
  /** Absolute path of the vault root; only files under it are ever indexed. */
  vaultRoot: string;
  /** Debounce window (ms) coalescing watcher bursts. Default 100. */
  debounceMs?: number;
  /** Watcher injection point for tests. Defaults to chokidar on the vault root. */
  watcherFactory?: WatcherFactory;
}

type MiniDoc = { id: string; title: string; content: string };

type SearchIndex = {
  mini: MiniSearch<MiniDoc>;
  docs: Map<string, IndexedDoc>;
};

/** Which documents were produced from one vault file (for incremental removal). */
type PathDocs = { scopeId: string; docIds: string[] };

/** Vault-global records (knowledge topics) share one index. */
const GLOBAL_SCOPE = '';

function newSearchIndex(): SearchIndex {
  return {
    mini: new MiniSearch<MiniDoc>({
      fields: ['title', 'content'],
      tokenize,
      searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 3 } }
    }),
    docs: new Map()
  };
}

/**
 * Vault-backed full-text search over `workspaces/<id>/` records. The index is
 * rebuilt from disk at startup (which also triggers standard vault seeding via
 * `workspaceService.listWorkspaces()`), then kept fresh by a debounced file
 * watcher. Every indexed path is validated to stay under the vault root, and
 * symlinked entries are skipped, so nothing outside the vault is ever indexed.
 */
export function createSearchService(options: SearchServiceOptions): SearchService {
  const vaultRoot = resolve(options.vaultRoot);
  const workspaceService = options.workspaceService;
  const debounceMs = options.debounceMs ?? 100;
  const watcherFactory = options.watcherFactory ?? createChokidarWatcher;

  const indexes = new Map<string, SearchIndex>();
  const docsByPath = new Map<string, PathDocs>();
  const runExclusively = createMutex();
  let dirtyPaths = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let watcher: VaultWatcher | null = null;
  let disposed = false;

  /** Vault-relative posix path, or null when `absPath` escapes the vault root. */
  function relUnderRoot(absPath: string): string | null {
    const rel = relative(vaultRoot, absPath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
    return rel.split(sep).join('/');
  }

  function discardDoc(scopeId: string, docId: string): void {
    const index = indexes.get(scopeId);
    if (index === undefined) return;
    if (!index.docs.has(docId)) return;
    index.mini.discard(docId);
    index.docs.delete(docId);
  }

  function removeDocsForPath(absPath: string): void {
    const entry = docsByPath.get(absPath);
    if (entry === undefined) return;
    for (const docId of entry.docIds) discardDoc(entry.scopeId, docId);
    docsByPath.delete(absPath);
  }

  function removeDocsUnder(absDir: string): void {
    const prefix = absDir.endsWith(sep) ? absDir : `${absDir}${sep}`;
    for (const [path, entry] of [...docsByPath]) {
      if (path === absDir || path.startsWith(prefix)) {
        for (const docId of entry.docIds) discardDoc(entry.scopeId, docId);
        docsByPath.delete(path);
      }
    }
  }

  /** Recursive `.md` listing that skips dotfiles and symlinks. */
  async function walkMdFiles(absDir: string): Promise<string[]> {
    const files: string[] = [];
    let entries;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return files;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      // dirent stats are lstat-based: symlinked files and dirs are skipped so
      // nothing outside the vault (or looping back into it) is indexed.
      if (entry.isSymbolicLink()) continue;
      const absPath = join(absDir, entry.name);
      if (entry.isDirectory()) {
        files.push(...(await walkMdFiles(absPath)));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(absPath);
      }
    }
    return files.sort();
  }

  async function rescanDirectory(absDir: string): Promise<void> {
    if (relUnderRoot(absDir) === null) return;
    removeDocsUnder(resolve(absDir));
    for (const file of await walkMdFiles(resolve(absDir))) {
      await indexFile(file);
    }
  }

  /** Adds one file's documents, replacing any previous version of the same ids. */
  function addDocs(abs: string, docs: IndexedDoc[]): void {
    if (docs.length === 0) return;
    const scopeId = docs[0]!.workspaceId ?? GLOBAL_SCOPE;
    const index = indexes.get(scopeId) ?? newSearchIndex();
    indexes.set(scopeId, index);
    for (const doc of docs) {
      // A duplicate record id in the same scope would otherwise corrupt the
      // MiniSearch id set; discard the previous version first (last writer wins).
      if (index.docs.has(doc.docId)) index.mini.discard(doc.docId);
      index.mini.add({ id: doc.docId, title: doc.title, content: doc.content });
      index.docs.set(doc.docId, doc);
    }
    docsByPath.set(abs, { scopeId, docIds: docs.map((doc) => doc.docId) });
  }

  async function indexFile(absPath: string): Promise<void> {
    const abs = resolve(absPath);
    removeDocsForPath(abs);
    const rel = relUnderRoot(abs);
    if (rel === null || hasHiddenSegment(rel) || !abs.endsWith('.md')) return;

    const knowledge = parseKnowledgeTopicRelPath(rel);
    if (knowledge !== null) {
      let stat;
      try {
        stat = await fs.lstat(abs);
      } catch {
        return; // vanished between event and read
      }
      if (!stat.isFile()) return;
      const raw = await fs.readFile(abs, 'utf8').catch(() => null);
      if (raw === null) return;
      const noteRaw = await fs
        .readFile(knowledgeNoteFile(vaultRoot, knowledge.topicId), 'utf8')
        .catch(() => null);
      const noteBody =
        noteRaw === null ? '' : parseKnowledgeNoteFile(noteRaw, knowledge.topicId).body;
      const doc = parseKnowledgeTopicDoc(rel, raw, noteBody);
      if (doc !== null) addDocs(abs, [doc]);
      return;
    }

    // Notes are indexed through their topic, which owns the search result.
    if (parseKnowledgeNoteRelPath(rel) !== null) return;
    if (parseWorkspaceRelPath(rel) === null) return;

    let stat;
    try {
      stat = await fs.lstat(abs);
    } catch {
      return; // vanished between event and read
    }
    if (!stat.isFile()) return;
    const raw = await fs.readFile(abs, 'utf8').catch(() => null);
    if (raw === null) return;
    addDocs(abs, parseFileDocs(rel, raw));
  }

  /** Applies one watcher event: index the file, or drop docs for removals/dirs. */
  async function applyEventPath(absPath: string): Promise<void> {
    const abs = resolve(absPath);
    const rel = relUnderRoot(abs);
    if (rel === null) return;

    // A note change (including deletion) re-indexes its topic, which owns the
    // search result. Directory-wide note events rescan every topic.
    const note = parseKnowledgeNoteRelPath(rel);
    if (note !== null) {
      await indexFile(knowledgeTopicFile(vaultRoot, note.topicId));
      return;
    }
    if (rel === 'knowledge/notes') {
      await rescanDirectory(knowledgeTopicsDir(vaultRoot));
      return;
    }

    let stat = null;
    try {
      stat = await fs.lstat(abs);
    } catch {
      stat = null;
    }
    if (stat !== null && stat.isFile()) {
      await indexFile(abs);
      return;
    }
    if (stat !== null && stat.isDirectory()) {
      await rescanDirectory(abs);
      return;
    }
    // Missing or a symlink (possibly pointing outside the vault): drop whatever
    // this path used to contribute.
    removeDocsUnder(abs);
    removeDocsForPath(abs);
  }

  function scheduleFlush(): void {
    if (disposed || debounceTimer !== null) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const batch = dirtyPaths;
      dirtyPaths = new Set();
      void runExclusively(async () => {
        if (disposed) return;
        for (const absPath of batch) {
          try {
            await applyEventPath(absPath);
          } catch {
            // One unreadable path must not block the rest of the batch.
          }
        }
      });
    }, debounceMs);
  }

  const handlers: VaultWatcherHandlers = {
    onFileEvent: (_event, absPath) => {
      if (disposed || typeof absPath !== 'string' || absPath.length === 0) return;
      if (relUnderRoot(resolve(absPath)) === null) return;
      dirtyPaths.add(resolve(absPath));
      scheduleFlush();
    },
    onError: (error) => {
      console.error('[search] vault watcher error:', error);
    }
  };

  /** Full re-scan of every workspace directory. */
  async function rebuild(): Promise<void> {
    await runExclusively(async () => {
      indexes.clear();
      docsByPath.clear();
      // listWorkspaces() both enumerates valid workspace ids and triggers the
      // standard vault seeding on a fresh vault.
      const workspaces = await workspaceService.listWorkspaces().catch(() => []);
      for (const workspace of workspaces) {
        await rescanDirectory(workspaceDir(vaultRoot, workspace.id));
      }
      await rescanDirectory(knowledgeTopicsDir(vaultRoot));
    });
  }

  const ready = (async () => {
    try {
      await fs.mkdir(vaultRoot, { recursive: true });
      // The watcher starts before the scan so events racing with the initial
      // index build are debounced and re-applied (idempotently) afterwards.
      watcher = await watcherFactory(vaultRoot, handlers);
      await rebuild();
    } catch (error) {
      console.error('[search] failed to initialize search index:', error);
    }
  })();

  return {
    async search(workspaceId: string, query: string, limit?: number): Promise<SearchResult[]> {
      await ready;
      const id = assertSafeSegment(workspaceId, 'workspace id');
      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (trimmed.length === 0) return [];
      const max = limit ?? DEFAULT_SEARCH_LIMIT;
      if (!Number.isFinite(max) || max <= 0) return [];
      const index = indexes.get(id);
      if (index === undefined) return [];
      const results: SearchResult[] = [];
      for (const hit of index.mini.search(trimmed)) {
        const doc = index.docs.get(hit.id);
        if (doc === undefined) continue; // discarded during an incremental update
        results.push({
          workspaceId: id,
          docId: doc.docId,
          kind: doc.kind,
          title: doc.title,
          snippet: buildSnippet(`${doc.title} ${doc.content}`, trimmed, SEARCH_SNIPPET_LENGTH),
          score: hit.score,
          path: doc.path
        });
        if (results.length >= max) break;
      }
      return results;
    },

    async searchAll(query: string, limit?: number): Promise<SearchResult[]> {
      await ready;
      const trimmed = typeof query === 'string' ? query.trim() : '';
      if (trimmed.length === 0) return [];
      const max = limit ?? DEFAULT_SEARCH_LIMIT;
      if (!Number.isFinite(max) || max <= 0) return [];
      const results: SearchResult[] = [];
      for (const index of indexes.values()) {
        for (const hit of index.mini.search(trimmed)) {
          const doc = index.docs.get(hit.id);
          if (doc === undefined) continue;
          results.push({
            workspaceId: doc.workspaceId,
            docId: doc.docId,
            kind: doc.kind,
            title: doc.title,
            snippet: buildSnippet(`${doc.title} ${doc.content}`, trimmed, SEARCH_SNIPPET_LENGTH),
            score: hit.score,
            path: doc.path
          });
        }
      }
      results.sort((a, b) => b.score - a.score);
      return results.slice(0, max);
    },

    rebuild,

    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      dirtyPaths = new Set();
      const closing = watcher === null ? undefined : watcher.close().catch(() => undefined);
      // Wait behind any in-flight event batch so dispose means "no more work".
      await runExclusively(async () => {
        indexes.clear();
        docsByPath.clear();
      });
      await closing;
    }
  };
}
