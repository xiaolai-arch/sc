import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSearchService } from '../../src/main/search';
import type { SearchService } from '../../src/shared/search';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';

/**
 * Integration test with the real chokidar watcher: proves the default factory
 * (options like followSymlinks: false, ignoreInitial, awaitWriteFinish) feeds
 * the index. Uses a short debounce and always disposes, so no watcher leaks.
 */

let root: string;
let service: SearchService;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'search-watcher-'));
  const ws = createWorkspaceService(root);
  await ws.listWorkspaces(); // seed the demo vault before watching
  service = createSearchService({
    workspaceService: ws,
    vaultRoot: root,
    debounceMs: 20
  });
});

afterEach(async () => {
  await service.dispose();
  await rm(root, { recursive: true, force: true });
});

test('indexes files added after startup via the real watcher', async () => {
  // Readiness barrier: the initial scan (and watcher start) has completed.
  expect((await service.search('kaoyan', '极限')).length).toBeGreaterThan(0);

  const ws = createWorkspaceService(root);
  const note = await ws.createNote({
    workspaceId: 'kaoyan',
    title: '实时监听笔记',
    subject: '检索',
    body: 'watcher 落盘后应自动进入索引'
  });
  await vi.waitFor(
    async () => {
      const hits = await service.search('kaoyan', '实时监听');
      expect(hits.some((hit) => hit.docId === note.id)).toBe(true);
    },
    { timeout: 4000, interval: 25 }
  );
});

test('applies change and unlink events for hand-written files', async () => {
  expect((await service.search('kaoyan', '极限')).length).toBeGreaterThan(0);

  const noteFile = join(root, 'workspaces', 'kaoyan', 'notes', 'handwritten.md');
  await fs.writeFile(
    noteFile,
    [
      '---',
      "type: note",
      'id: hand-1',
      'title: 手写笔记',
      '---',
      '',
      '初版手写内容'
    ].join('\n'),
    'utf8'
  );
  await vi.waitFor(
    async () => {
      expect((await service.search('kaoyan', '手写笔记')).some((hit) => hit.docId === 'hand-1')).toBe(true);
    },
    { timeout: 4000, interval: 25 }
  );

  await fs.writeFile(
    noteFile,
    [
      '---',
      "type: note",
      'id: hand-1',
      'title: 手写笔记修订',
      '---',
      '',
      '修订后的手写内容'
    ].join('\n'),
    'utf8'
  );
  await vi.waitFor(
    async () => {
      const stale = await service.search('kaoyan', '初版');
      const fresh = await service.search('kaoyan', '修订后的');
      expect(stale.some((hit) => hit.docId === 'hand-1')).toBe(false);
      expect(fresh.some((hit) => hit.docId === 'hand-1')).toBe(true);
    },
    { timeout: 4000, interval: 25 }
  );

  await fs.rm(noteFile);
  await vi.waitFor(
    async () => {
      expect(await service.search('kaoyan', '修订后的')).toEqual([]);
    },
    { timeout: 4000, interval: 25 }
  );
});
