import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryService } from '../../src/main/memory/create-memory-service';
import { serializeWorkspaceFile } from '../../src/main/workspace/records/workspace';
import { writeFileAtomic } from '../../src/main/workspace/fs-utils';
import { serializeNote } from '../../src/main/vault/note';
import type { NoteMeta } from '../../src/shared/types';
import type { MemoryRecord } from '../../src/shared/memory';

let root: string;
const fixedNow = new Date('2026-11-01T12:00:00.000Z');

type SeedItem = Pick<MemoryRecord, 'id' | 'text' | 'kind' | 'source' | 'createdAt'>;

function record(
  id: string,
  text: string,
  kind: SeedItem['kind'],
  createdAt: string,
  source = 'review:2026-10-31'
): SeedItem {
  return { id, text, kind, createdAt, source };
}

async function writeWorkspace(id: string): Promise<void> {
  await writeFileAtomic(
    join(root, 'workspaces', id, 'workspace.md'),
    serializeWorkspaceFile({
      id,
      name: id,
      kind: 'study',
      color: '#0071e3',
      goal: '',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  );
}

/** Writes memory.md; `stripKind` simulates entries written before kinds existed. */
async function writeMemory(
  workspaceId: string,
  items: readonly SeedItem[],
  options: { stripKind?: boolean } = {}
): Promise<void> {
  const meta: NoteMeta = {
    type: 'log',
    source: 'agent',
    items: options.stripKind
      ? items.map((item) => ({
          id: item.id,
          text: item.text,
          source: item.source,
          createdAt: item.createdAt
        }))
      : items.map((item) => ({ ...item }))
  };
  await writeFileAtomic(
    join(root, 'workspaces', workspaceId, 'memory.md'),
    serializeNote(meta, '# 记忆\n')
  );
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-profile-'));
  await writeWorkspace('ws-a');
  await writeWorkspace('ws-b');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test('aggregates buckets by kind, newest first, deduplicated', async () => {
  await writeMemory('ws-a', [
    record('m1', '极限定义还不稳', 'weakness', '2026-10-20T21:00:00.000Z'),
    record('m2', '英语阅读速度偏慢', 'weakness', '2026-10-29T21:00:00.000Z'),
    record('m3', '极限定义还不稳', 'weakness', '2026-10-25T21:00:00.000Z'),
    record('m4', '外刊表达积累有效', 'strength', '2026-10-28T21:00:00.000Z'),
    record('m5', '晚间学习效率更高', 'preference', '2026-10-27T21:00:00.000Z'),
    record('m6', '明早练两篇阅读', 'plan', '2026-10-30T21:00:00.000Z')
  ]);
  const service = createMemoryService({ root, now: () => fixedNow });

  const profile = await service.getProfile('ws-a');

  expect(profile.workspaceId).toBe('ws-a');
  expect(profile.memoryCount).toBe(6);
  expect(profile.weaknesses).toEqual(['英语阅读速度偏慢', '极限定义还不稳']);
  expect(profile.strengths).toEqual(['外刊表达积累有效']);
  expect(profile.preferences).toEqual(['晚间学习效率更高']);
  expect(profile.plans).toEqual(['明早练两篇阅读']);
  expect(profile.recent[0]).toBe('明早练两篇阅读');
  expect(profile.firstAt).toBe('2026-10-20T21:00:00.000Z');
  expect(profile.lastAt).toBe('2026-10-30T21:00:00.000Z');
  expect(profile.generatedAt).toBe('2026-11-01T12:00:00.000Z');
});

test('summary names the weaknesses, preferences and strengths', async () => {
  await writeMemory('ws-a', [
    record('m1', '中值定理不熟', 'weakness', '2026-10-29T21:00:00.000Z'),
    record('m2', '偏好纸质笔记', 'preference', '2026-10-28T21:00:00.000Z'),
    record('m3', '单词量稳步提升', 'strength', '2026-10-27T21:00:00.000Z')
  ]);
  const service = createMemoryService({ root, now: () => fixedNow });

  const profile = await service.getProfile('ws-a');

  expect(profile.summary).toBe(
    '共 3 条记忆。薄弱点：中值定理不熟。偏好：偏好纸质笔记。优势：单词量稳步提升。'
  );
});

test('an empty profile is explicit about having nothing yet', async () => {
  const service = createMemoryService({ root, now: () => fixedNow });

  const profile = await service.getProfile('ws-a');

  expect(profile.memoryCount).toBe(0);
  expect(profile.summary).toBe('暂无记忆，画像待积累。');
  expect(profile.weaknesses).toEqual([]);
  expect(profile.firstAt).toBeUndefined();
});

test('without a filter the profile spans every workspace', async () => {
  await writeMemory('ws-a', [record('m1', '数学错题反复出', 'weakness', '2026-10-29T21:00:00.000Z')]);
  await writeMemory('ws-b', [record('m2', '口语练习有效', 'strength', '2026-10-30T21:00:00.000Z')]);
  const service = createMemoryService({ root, now: () => fixedNow });

  const profile = await service.getProfile();

  expect(profile.workspaceId).toBeUndefined();
  expect(profile.memoryCount).toBe(2);
  expect(profile.weaknesses).toEqual(['数学错题反复出']);
  expect(profile.strengths).toEqual(['口语练习有效']);
});

test('entries written before kinds existed count as facts', async () => {
  await writeMemory(
    'ws-a',
    [record('legacy-1', '手写的旧记忆', 'weakness', '2026-10-01T21:00:00.000Z')],
    { stripKind: true }
  );
  const service = createMemoryService({ root, now: () => fixedNow });

  const profile = await service.getProfile('ws-a');

  expect(profile.memoryCount).toBe(1);
  expect(profile.weaknesses).toEqual([]);
  expect(profile.recent).toEqual(['手写的旧记忆']);
});

test('each bucket keeps at most the five newest entries', async () => {
  await writeMemory(
    'ws-a',
    Array.from({ length: 7 }, (_, index) =>
      record(`m${index + 1}`, `薄弱点 ${index + 1}`, 'weakness', `2026-10-2${index + 1}T21:00:00.000Z`)
    )
  );
  const service = createMemoryService({ root, now: () => fixedNow });

  const profile = await service.getProfile('ws-a');

  expect(profile.memoryCount).toBe(7);
  expect(profile.weaknesses).toHaveLength(5);
  expect(profile.weaknesses[0]).toBe('薄弱点 7');
  expect(profile.weaknesses[4]).toBe('薄弱点 3');
});
