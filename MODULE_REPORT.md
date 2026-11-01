# Module 5 Report — search-watcher (Wave 2 item 5)

**Date:** 2026-11-01 · **Branch:** `xiaolai/v1-search-watcher` (base `feat/v1-completion` @ `8836fae`)

## Scope

Vault-backed full-text search over `workspaces/<id>/` records: MiniSearch index
built per workspace at startup, kept fresh by a debounced chokidar watcher on
the vault root. Public result types live in `src/shared/search.ts` so Wave 2
ui-wiring can consume them over IPC later. No changes outside
`src/main/search/**`, `src/shared/search.ts`, `tests/main/search-*.test.ts`.

## Commits

1. `feat(search): add vault-backed search service with MiniSearch index and chokidar watcher`
   - `src/shared/search.ts` — `SearchResult` (`{ workspaceId, docId, kind, title, snippet, score, path }`), `SearchResultKind`, `SearchService` (`search` / `rebuild` / `dispose`), `DEFAULT_SEARCH_LIMIT`.
   - `src/main/search/tokenize.ts` — CJK-aware tokenizer (bigrams + isolated unigrams) and snippet builder.
   - `src/main/search/documents.ts` — pure vault-file → searchable-docs mapping reusing the existing workspace/practice record parsers.
   - `src/main/search/watcher.ts` — `VaultWatcher` contract + chokidar factory (`ignoreInitial`, `followSymlinks: false`, dotfile `ignored`, `awaitWriteFinish`).
   - `src/main/search/search-service.ts` — `createSearchService({ workspaceService, vaultRoot, debounceMs?, watcherFactory? })`; per-workspace MiniSearch indexes, path→docs map, debounced event batches serialized through the shared vault mutex, `rebuild()` full rescan, `dispose()`.
2. `test(search): cover tokenizer, documents, service and watcher flows`
   - `tests/main/search-documents.test.ts` (12) — tokenizer, snippet, per-record-type parsing, foreign/unsafe path rejection.
   - `tests/main/search-service.test.ts` (14) — seeded-vault search across kinds, workspace scoping, limits/empty/invalid ids, incremental add/change/unlink/unlinkDir/addDir via an injected fake watcher, `rebuild()` cold changes, practice/review indexing, root-escape + symlink + hidden-dir + non-markdown safety, fresh-vault bootstrap + watcher-error resilience, dispose semantics.
   - `tests/main/search-watcher.test.ts` (2) — real chokidar integration (add/change/unlink) with 20 ms debounce; watchers always disposed, nothing leaks.
3. `docs(search): add module 5 report` — this file.

## Tests

- Targeted: `npx vitest run tests/main/search-*.test.ts` — 33 passed.
- `npm run typecheck` — clean (node + web projects).
- `npm test` — **297 passed / 40 files** (no regressions).
- `npm run build` — clean (main/preload/renderer), chokidar + minisearch bundle fine.
- No network, no real API keys; watcher tests use `fs` temp dirs, short debounce, and dispose in `afterEach`.

## Design notes

- **Kinds indexed:** `workspace`, `note`, `task` (one doc per task record), `memory` (per entry), `review` (per entry, composite docId `<date>#<index>`), `practice-set`, `practice-question`, `practice-mistake`. Practice **attempt logs are deliberately skipped** — timestamp/verdict lines only, pure noise for search.
- **CJK search:** MiniSearch's default tokenizer would make a whole Chinese sentence one term. Custom tokenizer emits CJK bigrams (isolated single chars stay unigrams), so mid-word queries like "代数" match "线性代数" without single-char noise; single-char queries still work via prefix matching against bigrams. Latin runs are lowercased terms; `prefix` + `fuzzy: 0.2` + title boost 3 in search options.
- **Incremental updates:** every indexed path remembers which docIds it produced; add/change re-indexes that file (discard old docs first), unlink removes them, dir events remove-under or rescan the subtree. Event batches are debounced (`debounceMs`, default 100) and serialized through `createMutex()` so they never interleave with `rebuild()`. Atomic vault writes (`.tmp` rename) never produce half-indexed docs; editor-style non-atomic writes are settled by chokidar `awaitWriteFinish`.
- **Path safety:** only `.md` files whose vault-relative path is `workspaces/<safe-id>/…` are indexed; dotfile segments are skipped; the scan and every event path are checked against the vault root (`relative()` escape check); symlinks are never followed (`followSymlinks: false` + dirent/lstat `isSymbolicLink` skips + event paths rejected when `lstat` says non-file). Vault-global files (`reminders.md`, root `reviews/`) are not workspace records and are not indexed.
- **Startup:** `createSearchService` starts the watcher before the initial scan (racing events are debounced and idempotent), and `listWorkspaces()` doubles as the standard vault-seeding trigger; `search()` awaits init, so it never sees a half-built index.

## Risks / follow-ups

- **IPC/UI wiring intentionally omitted** (owned by Wave 2 ui-wiring): nothing calls `createSearchService` in `src/main/context.ts`/`ipc.ts` yet, and `dispose()` is not yet hooked to app quit — wiring modules should construct it next to the other vault services and dispose on `will-quit`.
- MiniSearch `discard` marks postings stale until lazy cleanup/vacuum; with per-file re-indexing on a personal-scale vault this is negligible memory-wise.
- Review docIds (`<date>#<index>`) shift if entries are ever deleted mid-file (reviews are append-only today, so stable in practice).
- The real-chokidar tests rely on OS file events (macOS FSEvents in CI dev; inotify on Linux CI) with 4 s `vi.waitFor` budgets — if a sandboxed CI denies file watching, those two tests are the ones to mark retries on; the fake-watcher suite covers the logic deterministically either way.
