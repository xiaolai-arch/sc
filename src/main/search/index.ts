export { createSearchService, type SearchServiceOptions } from './search-service';
export {
  createChokidarWatcher,
  hasHiddenSegment,
  type VaultFileEvent,
  type VaultWatcher,
  type VaultWatcherHandlers,
  type WatcherFactory
} from './watcher';
export { tokenize, buildSnippet } from './tokenize';
export { parseFileDocs, parseWorkspaceRelPath, type IndexedDoc } from './documents';
