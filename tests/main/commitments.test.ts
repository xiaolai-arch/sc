import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCommitmentService } from '../../src/main/commitments/service';
import {
  MAX_COMMITMENT_TEXT,
  parseCommitmentsFile,
  resolveCommitmentDue,
  serializeCommitmentsFile,
  type Commitment
} from '../../src/main/commitments/records';
import { commitmentsFile } from '../../src/main/workspace/paths';

const NOW = new Date('2026-11-22T09:00:00');

async function withVault(
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'asaki-commitments-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const sample: Commitment[] = [
  {
    id: 'cm-1',
    text: '做完极限基础',
    due: '2026-11-23',
    status: 'open',
    createdAt: '2026-11-22T08:00:00.000Z'
  },
  {
    id: 'cm-2',
    text: '写完论文',
    due: '2026-11-20',
    status: 'done',
    createdAt: '2026-11-19T08:00:00.000Z',
    resolvedAt: '2026-11-21T08:00:00.000Z',
    workspaceId: 'ws-exam'
  }
];

test('a serialized file round-trips byte-identically', () => {
  const raw = serializeCommitmentsFile(sample);
  const parsed = parseCommitmentsFile(raw);
  expect(parsed).toEqual(sample);
  expect(serializeCommitmentsFile(parsed)).toBe(raw);
});

test('reading and re-writing a legacy file changes nothing', async () => {
  await withVault(async (root) => {
    const raw = serializeCommitmentsFile(sample);
    await writeFile(commitmentsFile(root), raw, 'utf8');

    const service = createCommitmentService({ root, now: () => NOW });
    // A pure read must not touch the file at all.
    expect(await service.list()).toEqual(sample);
    expect(await readFile(commitmentsFile(root), 'utf8')).toBe(raw);

    // Resolving then rewriting keeps the untouched entry byte-for-byte.
    const created = await service.create({ text: '读一章英语', due: '2026-11-24' });
    const reread = parseCommitmentsFile(await readFile(commitmentsFile(root), 'utf8'));
    expect(reread.slice(0, 2)).toEqual(sample);
    expect(reread[2]).toMatchObject({ id: created.id, text: '读一章英语', due: '2026-11-24' });
  });
});

test('parse is tolerant: a bad entry is skipped, the rest survive', () => {
  const raw = [
    '---',
    'type: log',
    'source: user',
    'kind: commitments',
    'items:',
    '  - id: cm-ok',
    '    text: 可读的一条',
    "    due: '2026-11-23'",
    '    status: open',
    "    createdAt: '2026-11-22T08:00:00.000Z'",
    '  - id: cm-no-date',
    '    text: 少了日期',
    '    status: open',
    '  - id: cm-bad-status',
    '    text: 状态不认识',
    "    due: '2026-11-23'",
    '    status: maybe',
    '  - just a string',
    '---',
    '正文'
  ].join('\n');

  expect(parseCommitmentsFile(raw)).toEqual([
    {
      id: 'cm-ok',
      text: '可读的一条',
      due: '2026-11-23',
      status: 'open',
      createdAt: '2026-11-22T08:00:00.000Z'
    }
  ]);
});

test('an unrelated or empty file reads as no commitments', () => {
  expect(parseCommitmentsFile('')).toEqual([]);
  expect(parseCommitmentsFile('---\ntype: note\n---\n随手记')).toEqual([]);
});

test('create defaults due to tomorrow and records created status open', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const created = await service.create({ text: '明天背 20 个单词' });
    expect(created).toMatchObject({
      text: '明天背 20 个单词',
      due: '2026-11-23',
      status: 'open',
      createdAt: NOW.toISOString()
    });
    expect(created.id).toMatch(/^cm-/);
    expect(created.resolvedAt).toBeUndefined();
  });
});

test('create keeps an explicit due and an optional workspace', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const created = await service.create({
      text: '这周内写完论文',
      due: '这周内',
      workspaceId: 'ws-exam'
    });
    // 2026-11-22 is a Sunday, so "这周内" is that same day.
    expect(created.due).toBe('2026-11-22');
    expect(created.workspaceId).toBe('ws-exam');
  });
});

test('create rejects empty text and text over 200 chars', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    await expect(service.create({ text: '   ' })).rejects.toThrow('承诺内容不能为空');
    await expect(
      service.create({ text: '长'.repeat(MAX_COMMITMENT_TEXT + 1) })
    ).rejects.toThrow(`承诺内容不能超过 ${MAX_COMMITMENT_TEXT} 字`);
    // Exactly 200 is accepted.
    const ok = await service.create({ text: '长'.repeat(MAX_COMMITMENT_TEXT) });
    expect(ok.text).toHaveLength(MAX_COMMITMENT_TEXT);
  });
});

test('resolve done and dropped stamp resolvedAt and close the promise', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const a = await service.create({ text: '做完极限基础' });
    const b = await service.create({ text: '读完一章' });

    const done = await service.resolve({ id: a.id, outcome: 'done' });
    expect(done.status).toBe('done');
    expect(done.resolvedAt).toBe(NOW.toISOString());

    const dropped = await service.resolve({ id: b.id, outcome: 'dropped' });
    expect(dropped.status).toBe('dropped');
    expect(dropped.resolvedAt).toBe(NOW.toISOString());

    expect(await service.pending('2026-12-31')).toEqual([]);
  });
});

test('resolve newDue moves the promise without closing it', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const a = await service.create({ text: '做极限基础', due: '2026-11-22' });

    const moved = await service.resolve({ id: a.id, newDue: '2026-11-23' });
    expect(moved).toMatchObject({ status: 'open', due: '2026-11-23' });
    expect(moved.resolvedAt).toBeUndefined();
    expect(await service.pending('2026-11-22')).toEqual([]);
    expect(await service.pending('2026-11-23')).toEqual([moved]);
  });
});

test('resolve matches by text and rejects an unknown id in Chinese', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    await service.create({ text: '背单词' });

    const byText = await service.resolve({ text: '背单词', outcome: 'done' });
    expect(byText.status).toBe('done');

    await expect(
      service.resolve({ id: 'cm-nope', outcome: 'done' })
    ).rejects.toThrow('没有找到承诺：「cm-nope」');
  });
});

test('resolve rejects an unknown outcome and a malformed date', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const a = await service.create({ text: '背单词' });
    await expect(
      service.resolve({ id: a.id, outcome: 'maybe' as unknown as 'done' })
    ).rejects.toThrow('outcome 只能是 done 或 dropped');
    await expect(service.resolve({ id: a.id, newDue: '明天' })).rejects.toThrow(
      '新日期必须是 YYYY-MM-DD'
    );
    await expect(service.resolve({ id: a.id })).rejects.toThrow('请提供 outcome');
  });
});

test('pending returns only open promises due on or before the day, oldest first', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    await service.create({ text: '早', due: '2026-11-20' });
    await service.create({ text: '中', due: '2026-11-22' });
    await service.create({ text: '晚', due: '2026-11-25' });

    const due = await service.pending('2026-11-22');
    expect(due.map((entry) => entry.text)).toEqual(['早', '中']);
  });
});

test('listSummaries returns the display projection, open by due then createdAt', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    // Created out of due order on purpose: the projection sorts, not the file.
    const late = await service.create({
      text: '背完这一课的单词',
      due: '2026-11-25',
      workspaceId: 'ws-exam'
    });
    const early = await service.create({ text: '做完极限基础', due: '2026-11-23' });

    const summaries = await service.listSummaries();
    expect(summaries.map((entry) => entry.id)).toEqual([early.id, late.id]);
    // Same due date falls back to createdAt, so insertion order holds.
    const tieA = await service.create({ text: '同日的一条', due: '2026-11-23' });
    const tied = await service.listSummaries();
    expect(tied.map((entry) => entry.id)).toEqual([early.id, tieA.id, late.id]);

    // The projection carries exactly the display fields; no file internals.
    expect(summaries[0]).toEqual({
      id: early.id,
      text: '做完极限基础',
      due: '2026-11-23',
      status: 'open',
      createdAt: early.createdAt
    });
    // Optional fields appear only when the record has them.
    expect(tied[2]).toMatchObject({ workspaceId: 'ws-exam' });
    expect(summaries[0].resolvedAt).toBeUndefined();
  });
});

test('listSummaries omits resolved by default and appends them when asked', async () => {
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const kept = await service.create({ text: '还在做的一件', due: '2026-11-24' });
    const doneEarly = await service.create({ text: '早先做完的一件', due: '2026-11-20' });
    const doneLate = await service.create({ text: '刚做完的一件', due: '2026-11-21' });
    // Close them in the opposite order of their resolvedAt stamps.
    await service.resolve({ id: doneLate.id, outcome: 'done' });
    const later = new Date('2026-11-22T15:00:00');
    const laterService = createCommitmentService({ root, now: () => later });
    await laterService.resolve({ id: doneEarly.id, outcome: 'dropped' });

    const openOnly = await service.listSummaries();
    expect(openOnly.map((entry) => entry.id)).toEqual([kept.id]);

    const withResolved = await service.listSummaries({ includeResolved: true });
    expect(withResolved.map((entry) => entry.id)).toEqual([
      kept.id,
      // Most recently resolved first: doneEarly (dropped later) before doneLate.
      doneEarly.id,
      doneLate.id
    ]);
    expect(withResolved[1]).toMatchObject({ status: 'dropped', resolvedAt: later.toISOString() });
    expect(withResolved[2]).toMatchObject({ status: 'done', resolvedAt: NOW.toISOString() });
  });
});

test('resolve refuses to move a promise into the past, change or not', async () => {
  // The service is the one authority for "not before today": the reminders
  // page, the IPC channel and the butler tool all reach the vault through it,
  // so nothing can put a promise back in the past behind the UI's back.
  await withVault(async (root) => {
    const service = createCommitmentService({ root, now: () => NOW });
    const overdue = await service.create({ text: '整理错题', due: '2026-11-19' });

    // Yesterday and even further back are refused with one sentence.
    await expect(
      service.resolve({ id: overdue.id, newDue: '2026-11-21' })
    ).rejects.toThrow('改期日期不能早于今天。');
    await expect(
      service.resolve({ id: overdue.id, newDue: '2026-01-01' })
    ).rejects.toThrow('改期日期不能早于今天。');
    // Keeping the stale `due` unchanged is still a move into the past.
    await expect(
      service.resolve({ id: overdue.id, newDue: overdue.due })
    ).rejects.toThrow('改期日期不能早于今天。');
    // Nothing was written: the entry keeps its original day and stays open.
    expect(await service.list()).toEqual([overdue]);

    // Today itself is allowed — the bound is inclusive.
    const todayMoved = await service.resolve({ id: overdue.id, newDue: '2026-11-22' });
    expect(todayMoved).toMatchObject({ due: '2026-11-22', status: 'open' });
    // Closing a promise is not a reschedule, so it is unaffected.
    const closed = await service.resolve({ id: overdue.id, outcome: 'dropped' });
    expect(closed.status).toBe('dropped');
  });
});

test('resolveCommitmentDue maps the phrasings the user actually says', () => {
  // 2026-11-22 is a Sunday; 2026-11-23 a Monday.
  const sunday = new Date('2026-11-22T09:00:00');
  expect(resolveCommitmentDue('2026-12-01', sunday)).toBe('2026-12-01');
  expect(resolveCommitmentDue('今天', sunday)).toBe('2026-11-22');
  expect(resolveCommitmentDue('明天', sunday)).toBe('2026-11-23');
  expect(resolveCommitmentDue('后天', sunday)).toBe('2026-11-24');
  // 这周内 on a Sunday is that same Sunday.
  expect(resolveCommitmentDue('这周内', sunday)).toBe('2026-11-22');
  // 下周 on a Sunday ends the next Sunday.
  expect(resolveCommitmentDue('下周内', sunday)).toBe('2026-11-29');
  // 这周内 mid-week ends on that week's Sunday.
  const friday = new Date('2026-11-27T09:00:00');
  expect(resolveCommitmentDue('这周内', friday)).toBe('2026-11-29');
  // Anything unreadable is refused rather than guessed.
  expect(resolveCommitmentDue('尽快', sunday)).toBeUndefined();
  expect(resolveCommitmentDue('2026-13-40', sunday)).toBeUndefined();
});
