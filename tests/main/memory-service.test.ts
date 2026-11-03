import { promises as fs } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeModelClient } from '../../src/main/agent/model-client';
import { createMemoryService } from '../../src/main/memory/create-memory-service';
import { createWorkspaceService } from '../../src/main/workspace/create-workspace-service';
import { parseNote } from '../../src/main/vault/note';
import type { WorkspaceService } from '../../src/shared/workspace';
import type { ReviewAnswers } from '../../src/shared/types';

let root: string;
let workspaceService: WorkspaceService;
let workspaceId: string;

function answers(completed: string, stuck: string, tomorrow: string): ReviewAnswers {
  return { completed, stuck, tomorrow };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-service-'));
  workspaceService = createWorkspaceService(root);
  const workspace = await workspaceService.createWorkspace({
    name: 'Memory Tests',
    kind: 'study',
    goal: '通过期末考试',
    description: ''
  });
  workspaceId = workspace.id;
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('synthesizeFromReview with a model', () => {
  test('turns review answers into traceable memory items', async () => {
    const model = new FakeModelClient([
      JSON.stringify({
        items: [
          { text: '中值定理掌握不牢', kind: 'weakness' },
          { text: '晚间刷题效率更高', kind: 'preference' }
        ]
      })
    ]);
    const service = createMemoryService({ root, modelClient: model });

    const result = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-01',
      answers: answers('做完两套卷子', '中值定理总卡住', '专项练中值定理')
    });

    expect(result.generatedBy).toBe('model');
    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(item.workspaceId).toBe(workspaceId);
      expect(item.source).toBe('review:2026-11-01');
      expect(item.id).toMatch(/^m-/);
    }
    expect(result.items.map((item) => item.text)).toEqual([
      '中值定理掌握不牢',
      '晚间刷题效率更高'
    ]);

    // The prompt carries the review day and the raw answers it was built from.
    const userPrompt = model.calls[0]?.messages[1]?.content ?? '';
    expect(userPrompt).toContain('2026-11-01');
    expect(userPrompt).toContain('中值定理总卡住');
  });

  test('accepts fenced JSON with prose around it', async () => {
    const model = new FakeModelClient([
      '好的，这是整理结果：\n```json\n{"items":[{"text":"坚持晨读","kind":"strength"}]}\n```\n希望有帮助。'
    ]);
    const service = createMemoryService({ root, modelClient: model });

    const result = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-02',
      answers: answers('晨读 20 分钟', '', '')
    });

    expect(result.generatedBy).toBe('model');
    expect(result.items[0]).toMatchObject({ text: '坚持晨读', kind: 'strength' });
  });

  test('caps model output at three items and defaults unknown kinds to fact', async () => {
    const model = new FakeModelClient([
      JSON.stringify({
        items: [
          { text: '一', kind: 'weakness' },
          { text: '二', kind: 'strength' },
          { text: '三', kind: 'mystery' },
          { text: '四', kind: 'plan' },
          { text: '', kind: 'plan' }
        ]
      })
    ]);
    const service = createMemoryService({ root, modelClient: model });

    const result = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-03',
      answers: answers('a', 'b', 'c')
    });

    expect(result.items.map((item) => [item.text, item.kind])).toEqual([
      ['一', 'weakness'],
      ['二', 'strength'],
      ['三', 'fact']
    ]);
  });

  test('falls back to rule summaries when the model returns prose', async () => {
    const model = new FakeModelClient(['今天天气不错，不太想回答。']);
    const service = createMemoryService({ root, modelClient: model });

    const result = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-04',
      answers: answers('背完单词列表', '听力跟不上语速', '精听一篇')
    });

    expect(result.generatedBy).toBe('rules');
    expect(result.items.map((item) => [item.text, item.kind])).toEqual([
      ['听力跟不上语速', 'weakness'],
      ['背完单词列表', 'strength'],
      ['精听一篇', 'plan']
    ]);
  });

  test('falls back to rule summaries when the model call fails', async () => {
    const model = new FakeModelClient([new Error('network down')]);
    const service = createMemoryService({ root, modelClient: model });

    const result = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-05',
      answers: answers('', '线代秩的概念混乱', '')
    });

    expect(result.generatedBy).toBe('rules');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      text: '线代秩的概念混乱',
      kind: 'weakness',
      source: 'review:2026-11-05'
    });
  });
});

test('does not write memory when the turn is aborted during synthesis', async () => {
  const controller = new AbortController();
  const model = {
    complete: async () => {
      controller.abort();
      return {
        text: JSON.stringify({ items: [{ text: '应被丢弃', kind: 'fact' }] }),
        usage: { inputTokens: 1, outputTokens: 1 }
      };
    }
  };
  const service = createMemoryService({ root, modelClient: model });

  await expect(
    service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-01',
      answers: answers('完成数学', '极限', '复盘'),
      signal: controller.signal
    })
  ).rejects.toMatchObject({ name: 'AbortError' });

  expect(await service.list(workspaceId)).toHaveLength(0);
});

describe('synthesizeFromReview without a model', () => {
  test('uses deterministic rule summaries', async () => {
    const service = createMemoryService({ root });

    const result = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-06',
      answers: answers('整理了错题本', '概率公式记混', '重推公式')
    });

    expect(result.generatedBy).toBe('rules');
    expect(result.items.map((item) => item.kind)).toEqual([
      'weakness',
      'strength',
      'plan'
    ]);
    expect(result.items.every((item) => item.source === 'review:2026-11-06')).toBe(true);
  });

  test('produces no items for an empty or skipped review', async () => {
    const service = createMemoryService({ root });

    const empty = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-07',
      answers: answers('', '', '')
    });
    expect(empty.items).toEqual([]);

    const skipped = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-07',
      answers: { ...answers('做了一点', '', ''), skipped: true }
    });
    expect(skipped.items).toEqual([]);
    await expect(fs.access(join(root, 'workspaces', workspaceId, 'memory.md'))).rejects.toThrow();
  });
});

describe('vault persistence', () => {
  test('items survive a fresh service instance and stay workspace-service readable', async () => {
    const first = createMemoryService({ root });
    await first.synthesizeFromReview({
      workspaceId,
      date: '2026-11-08',
      answers: answers('刷完第 3 章', '泰勒展开不熟', '补展开式推导')
    });

    const second = createMemoryService({ root });
    const items = await second.list(workspaceId);
    expect(items).toHaveLength(3);
    expect(items.every((item) => item.source === 'review:2026-11-08')).toBe(true);

    // Same records through the existing WorkspaceService contract (file order).
    const viaWorkspace = await workspaceService.getMemory(workspaceId);
    expect([...viaWorkspace.map((item) => item.text)].sort()).toEqual(
      [...items.map((item) => item.text)].sort()
    );
  });

  test('memory.md stays Obsidian-readable markdown with frontmatter items', async () => {
    const service = createMemoryService({ root });
    await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-09',
      answers: answers('背完词组', '', '练口语')
    });

    const raw = await fs.readFile(
      join(root, 'workspaces', workspaceId, 'memory.md'),
      'utf8'
    );
    expect(raw.startsWith('---\n')).toBe(true);
    const { meta, body } = parseNote(raw);
    expect(meta.type).toBe('log');
    expect(Array.isArray(meta.items)).toBe(true);
    expect(body).toContain('# 记忆');
    expect(body).toContain('【优势】背完词组');
    expect(body).toContain('来源：review:2026-11-09');
  });

  test('appending never drops existing (seeded) entries', async () => {
    const service = createMemoryService({ root });
    const before = await service.list('kaoyan');
    expect(before.length).toBeGreaterThanOrEqual(2);

    await service.synthesizeFromReview({
      workspaceId: 'kaoyan',
      date: '2026-11-10',
      answers: answers('', '积分换元总出错', '')
    });

    const after = await service.list('kaoyan');
    expect(after).toHaveLength(before.length + 1);
    expect(after.map((item) => item.text)).toContain('极限定义还不稳，建议先复习再做新题。');
  });

  test('re-synthesizing the same review does not duplicate items', async () => {
    const service = createMemoryService({ root });
    const input = {
      workspaceId,
      date: '2026-11-11',
      answers: answers('完成一套真题', '作文结构乱', '背模板')
    };
    await service.synthesizeFromReview(input);
    const again = await service.synthesizeFromReview(input);

    expect(again.items).toEqual([]);
    expect(await service.list(workspaceId)).toHaveLength(3);
  });
});

describe('workspace filtering', () => {
  test('list() scopes to one workspace and spans all workspaces without a filter', async () => {
    const service = createMemoryService({ root });
    await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-12',
      answers: answers('整理笔记', '', '')
    });

    const scoped = await service.list(workspaceId);
    expect(scoped).toHaveLength(1);
    expect(scoped.every((item) => item.workspaceId === workspaceId)).toBe(true);

    // Seed workspaces keep their own memory; the unfiltered list sees both.
    const kaoyan = await service.list('kaoyan');
    expect(kaoyan.every((item) => item.workspaceId === 'kaoyan')).toBe(true);
    expect(kaoyan.map((item) => item.text)).toContain('英语阅读速度偏慢，先练长难句主干。');

    const all = await service.list();
    expect(all.length).toBe(scoped.length + kaoyan.length + (await service.list('english')).length + (await service.list('project')).length + (await service.list('life')).length);
  });
});

describe('updateRecord and deleteRecord', () => {
  test('updates text and kind while preserving traceability', async () => {
    const service = createMemoryService({ root });
    const { items } = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-16',
      answers: answers('完成两套卷子', '中值定理总卡住', '专项练中值定理')
    });
    const target = items.find((item) => item.kind === 'weakness');
    expect(target).toBeDefined();

    const updated = await service.updateRecord!({
      workspaceId,
      id: target!.id,
      text: '  中值定理已掌握  ',
      kind: 'strength'
    });

    expect(updated).toMatchObject({
      id: target!.id,
      workspaceId,
      source: target!.source,
      createdAt: target!.createdAt,
      text: '中值定理已掌握',
      kind: 'strength'
    });

    const reopened = createMemoryService({ root });
    const persisted = (await reopened.list(workspaceId)).find((item) => item.id === target!.id);
    expect(persisted).toMatchObject({ text: '中值定理已掌握', kind: 'strength' });
  });

  test('rejects empty text, bad kinds, unknown records and unsafe ids', async () => {
    const service = createMemoryService({ root });
    const { items } = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-17',
      answers: answers('a', 'b', 'c')
    });
    const target = items[0]!;

    await expect(
      service.updateRecord!({ workspaceId, id: target.id, text: '   ' })
    ).rejects.toThrow(/text/i);
    await expect(
      service.updateRecord!({ workspaceId, id: target.id, kind: 'mystery' as never })
    ).rejects.toThrow(/kind/i);
    await expect(
      service.updateRecord!({ workspaceId, id: 'm-missing' })
    ).rejects.toThrow(/记忆不存在/);
    await expect(
      service.updateRecord!({ workspaceId: '../evil', id: target.id })
    ).rejects.toThrow(/Invalid workspace id/);
    await expect(
      service.updateRecord!({ workspaceId, id: ' ' })
    ).rejects.toThrow(/id/i);
  });

  test('deletes records and rewrites valid frontmatter when the list empties', async () => {
    const service = createMemoryService({ root });
    const { items } = await service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-18',
      answers: answers('完成一套卷子', '线代秩的概念混乱', '')
    });
    expect(items).toHaveLength(2);

    await service.deleteRecord!({ workspaceId, id: items[0]!.id });
    const remaining = await service.list(workspaceId);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(items[1]!.id);

    await service.deleteRecord!({ workspaceId, id: remaining[0]!.id });
    expect(await service.list(workspaceId)).toEqual([]);

    const raw = await fs.readFile(join(root, 'workspaces', workspaceId, 'memory.md'), 'utf8');
    expect(raw.startsWith('---\n')).toBe(true);
    const { meta } = parseNote(raw);
    expect(meta.items).toEqual([]);
    expect(await createMemoryService({ root }).list(workspaceId)).toEqual([]);

    await expect(
      service.deleteRecord!({ workspaceId, id: 'm-missing' })
    ).rejects.toThrow(/记忆不存在/);
    await expect(
      service.deleteRecord!({ workspaceId: '../evil', id: 'x' })
    ).rejects.toThrow(/Invalid workspace id/);
  });
});

describe('path and input safety', () => {
  test('rejects workspace ids that could escape the vault', async () => {
    const service = createMemoryService({ root });
    await expect(service.list('../evil')).rejects.toThrow('Invalid workspace id');
    await expect(service.list('a/b')).rejects.toThrow('Invalid workspace id');
    await expect(
      service.synthesizeFromReview({
        workspaceId: '../evil',
        date: '2026-11-13',
        answers: answers('x', '', '')
      })
    ).rejects.toThrow('Invalid workspace id');
    // Nothing was created outside workspaces/.
    await expect(fs.access(join(root, 'evil'))).rejects.toThrow();
    await expect(fs.access(join(root, '..', 'evil'))).rejects.toThrow();
  });

  test('rejects malformed review dates', async () => {
    const service = createMemoryService({ root });
    await expect(
      service.synthesizeFromReview({
        workspaceId,
        date: '../evil',
        answers: answers('x', '', '')
      })
    ).rejects.toThrow('Invalid review date');
    await expect(
      service.synthesizeFromReview({
        workspaceId,
        date: '2026-11-1',
        answers: answers('x', '', '')
      })
    ).rejects.toThrow('Invalid review date');
  });

  test('rejects unknown workspaces without creating anything', async () => {
    const service = createMemoryService({ root });
    await expect(
      service.synthesizeFromReview({
        workspaceId: 'ghost',
        date: '2026-11-14',
        answers: answers('x', '', '')
      })
    ).rejects.toThrow('Workspace not found: ghost');
    await expect(fs.access(join(root, 'workspaces', 'ghost'))).rejects.toThrow();
  });

  test('requires answers', async () => {
    const service = createMemoryService({ root });
    await expect(
      service.synthesizeFromReview({
        workspaceId,
        date: '2026-11-15',
        answers: undefined as unknown as ReviewAnswers
      })
    ).rejects.toThrow('Review answers are required');
  });
});

test('refuses to overwrite a memory.md whose entries cannot be parsed', async () => {
  const service = createMemoryService({ root });
  const file = join(root, 'workspaces', workspaceId, 'memory.md');
  const original = '---\ntype: log\nitems: [broken\n---\n# 记忆\n\n- 【薄弱】旧记录（来源：review:2026-10-30）\n';
  await fs.writeFile(file, original, 'utf8');

  await expect(
    service.synthesizeFromReview({
      workspaceId,
      date: '2026-11-01',
      answers: answers('完成数学 10 题', '极限定义', '复习错题')
    })
  ).rejects.toThrow(/无法识别/);

  expect(await fs.readFile(file, 'utf8')).toBe(original);
});

test('adds a hand-written memory and persists it to the vault', async () => {
  const service = createMemoryService({ root });
  const created = await service.createRecord?.({
    workspaceId,
    text: '  更喜欢早上学数学  ',
    kind: 'preference'
  });
  expect(created).toMatchObject({
    workspaceId,
    text: '更喜欢早上学数学',
    kind: 'preference',
    source: 'manual'
  });
  expect(created?.createdAt).toBeTruthy();

  const listed = await service.list(workspaceId);
  expect(listed.some((record) => record.id === created?.id)).toBe(true);

  const fresh = createMemoryService({ root });
  expect((await fresh.list(workspaceId)).map((record) => record.text)).toContain(
    '更喜欢早上学数学'
  );

  await expect(
    service.createRecord?.({ workspaceId, text: '   ', kind: 'fact' })
  ).rejects.toThrow(/text/i);
  await expect(
    service.createRecord?.({ workspaceId: 'missing', text: 'x', kind: 'fact' })
  ).rejects.toThrow(/not found/i);
});
