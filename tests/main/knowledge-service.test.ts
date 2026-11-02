import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createKnowledgeService } from '../../src/main/knowledge/create-knowledge-service';
import { parseKnowledgeNoteFile } from '../../src/main/knowledge/notes';

const dirs: string[] = [];
const NOW = new Date('2026-11-02T09:00:00.000Z');

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'asaki-knowledge-'));
  dirs.push(dir);
  return {
    dir,
    service: createKnowledgeService({ root: dir, now: () => NOW })
  };
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test('creates, filters, updates and deletes topics in the vault', async () => {
  const { service } = await setup();
  const local = await service.create({
    name: 'LangChain',
    workspaceId: 'agent',
    status: 'learning',
    level: 2,
    summary: '会调用'
  });
  const global = await service.create({ name: '番茄工作法', aliases: ['Pomodoro'] });

  expect((await service.list('agent')).map((t) => t.id).sort()).toEqual(
    [local.id, global.id].sort()
  );
  expect((await service.list('other')).map((t) => t.name)).toEqual(['番茄工作法']);
  expect((await service.get(local.id))?.level).toBe(2);

  const updated = await service.update({
    id: local.id,
    status: 'mastered',
    level: null,
    workspaceId: null
  });
  expect(updated.status).toBe('mastered');
  expect(updated.level).toBeUndefined();
  expect(updated.workspaceId).toBeUndefined();
  // A topic moved to global stays visible from every workspace.
  expect((await service.list('agent')).map((t) => t.name).sort()).toEqual(
    ['LangChain', '番茄工作法'].sort()
  );

  await service.delete(global.id);
  expect(await service.get(global.id)).toBeNull();
});

test('record creates a learning topic and appends later mentions', async () => {
  const { service } = await setup();
  const first = await service.record({ name: 'LangGraph', workspaceId: 'agent', note: '今天学了状态图' });
  expect(first.status).toBe('learning');
  expect(first.evidence.map((e) => e.kind)).toEqual(['chat']);

  const second = await service.record({ name: 'LangGraph', workspaceId: 'agent', status: 'mastered' });
  expect(second.id).toBe(first.id);
  expect(second.status).toBe('mastered');
  expect(second.evidence).toHaveLength(2);
});

test('record appends to an existing topic when the mention contains its name', async () => {
  const { service } = await setup();
  const topic = await service.record({ name: 'LangGraph', workspaceId: 'agent', note: '开始学' });

  const mentioned = await service.record({
    name: 'LangGraph 状态图',
    workspaceId: 'agent',
    note: '今天学了状态图'
  });

  expect(mentioned.id).toBe(topic.id);
  expect(mentioned.evidence).toHaveLength(2);
  expect(await service.list('agent')).toHaveLength(1);

  // A genuinely different topic still creates its own card.
  const other = await service.record({ name: 'LangChain', workspaceId: 'agent' });
  expect(other.id).not.toBe(topic.id);
  expect(await service.list('agent')).toHaveLength(2);
});

test('links a completed task once and only within workspace or global scope', async () => {
  const { service } = await setup();
  const topic = await service.create({ name: 'LangChain', workspaceId: 'agent' });
  const task = {
    id: 't1',
    workspaceId: 'agent',
    title: 'LangChain AgentExecutor 练习',
    subject: 'Agent',
    durationMin: 30,
    acceptance: '',
    status: 'done' as const
  };

  await service.linkTask(task);
  await service.linkTask(task);
  const reloaded = await service.get(topic.id);
  expect(reloaded?.evidence).toHaveLength(1);
  expect(reloaded?.evidence[0]).toMatchObject({ kind: 'task', refId: 't1', date: '2026-11-02' });

  const other = await service.create({ name: 'RAG', workspaceId: 'english' });
  await service.linkTask({ ...task, title: 'RAG 检索练习', workspaceId: 'agent' });
  expect((await service.get(other.id))?.evidence).toHaveLength(0);
});

test('links notes, reviews, and vault-wide reviews', async () => {
  const { service } = await setup();
  const topic = await service.create({ name: '向量数据库', status: 'planned' });

  await service.linkNote({
    id: 'n1',
    workspaceId: 'agent',
    title: '向量数据库选型',
    subject: '',
    tags: ['向量数据库'],
    updated: '',
    summary: '',
    body: '',
    related: []
  });
  expect((await service.get(topic.id))?.status).toBe('learning');
  expect((await service.get(topic.id))?.evidence[0]).toMatchObject({ kind: 'note', refId: 'n1' });

  await service.linkReview({
    date: '2026-11-02',
    answers: { completed: '复习了向量数据库', stuck: '向量数据库的 HNSW 参数', tomorrow: '' }
  });
  const evidence = (await service.get(topic.id))?.evidence ?? [];
  expect(evidence.some((e) => e.kind === 'review' && e.refId === '2026-11-02')).toBe(true);
  expect(evidence.some((e) => e.note?.includes('HNSW'))).toBe(true);
});

test('auto-linking never throws for missing topics or broken files', async () => {
  const { dir, service } = await setup();
  const topicsDir = join(dir, 'knowledge', 'topics');
  await mkdir(topicsDir, { recursive: true });
  await writeFile(join(topicsDir, 'kt-broken.md'), 'not: [valid', 'utf8');

  await expect(
    service.linkTask({
      id: 't1',
      workspaceId: 'agent',
      title: '无关任务',
      subject: '',
      durationMin: 10,
      acceptance: '',
      status: 'done'
    })
  ).resolves.toBeUndefined();
  // A broken file is skipped, never deleted or rewritten.
  expect(await readFile(join(topicsDir, 'kt-broken.md'), 'utf8')).toBe('not: [valid');
});

test('ignores broken topic files and rejects invalid input', async () => {
  const { dir, service } = await setup();
  const topicsDir = join(dir, 'knowledge', 'topics');
  await mkdir(topicsDir, { recursive: true });
  await writeFile(join(topicsDir, 'kt-broken.md'), 'not: [valid', 'utf8');
  expect(await service.list()).toEqual([]);
  expect(await readdir(topicsDir)).toEqual(['kt-broken.md']);
  await expect(service.create({ name: '  ' })).rejects.toThrow(/名称/);
  await expect(service.create({ name: 'X', level: 6 })).rejects.toThrow(/程度/);
  await expect(service.get('../../etc/passwd')).resolves.toBeNull();
});

test('an unsafe frontmatter id cannot redirect a write outside the vault', async () => {
  const { dir, service } = await setup();
  const created = await service.create({ name: 'LangChain' });
  const topicsDir = join(dir, 'knowledge', 'topics');
  const file = join(topicsDir, `${created.id}.md`);
  const raw = await readFile(file, 'utf8');
  await writeFile(
    file,
    raw.replace(`id: ${created.id}`, 'id: ../../escaped-by-frontmatter'),
    'utf8'
  );

  const updated = await service.update({ id: created.id, summary: '已经把基础补完了' });
  expect(updated.id).toBe(created.id);
  expect(updated.summary).toBe('已经把基础补完了');
  expect(await readdir(topicsDir)).toEqual([`${created.id}.md`]);
  await expect(readFile(join(dir, 'escaped-by-frontmatter.md'), 'utf8')).rejects.toThrow();
});

function notePath(dir: string, topicId: string): string {
  return join(dir, 'knowledge', 'notes', `${topicId}.md`);
}

test('saves and reads a note without touching the topic body', async () => {
  const { dir, service } = await setup();
  const topic = await service.create({ name: 'LangGraph' });
  const topicFile = join(dir, 'knowledge', 'topics', `${topic.id}.md`);
  const topicBefore = await readFile(topicFile, 'utf8');

  const saved = await service.saveNote({
    topicId: topic.id,
    body: '# hi\n\n[[LangChain]]'
  });
  expect(saved.body).toBe('# hi\n\n[[LangChain]]');
  expect(await service.getNote(topic.id)).toMatchObject({
    topicId: topic.id,
    body: '# hi\n\n[[LangChain]]'
  });

  const noteRaw = await readFile(notePath(dir, topic.id), 'utf8');
  expect(noteRaw).toContain('kind: knowledge-note');
  expect(noteRaw).toContain('[[LangChain]]');
  expect(await readFile(topicFile, 'utf8')).toBe(topicBefore);
});

test('keeps hand-added frontmatter keys when saving', async () => {
  const { dir, service } = await setup();
  const topic = await service.create({ name: 'LangGraph' });
  const file = notePath(dir, topic.id);
  await mkdir(join(dir, 'knowledge', 'notes'), { recursive: true });
  await writeFile(
    file,
    [
      '---',
      'type: note',
      'kind: knowledge-note',
      `topicId: ${topic.id}`,
      'title: LangGraph',
      'aliases: [LangGraph]',
      'tags: [ai]',
      'cssclass: wide',
      '---',
      'old body'
    ].join('\n'),
    'utf8'
  );

  await service.saveNote({ topicId: topic.id, body: 'new body' });
  const parsed = parseKnowledgeNoteFile(await readFile(file, 'utf8'), topic.id);
  expect(parsed.body).toBe('new body');
  expect(parsed.meta.tags).toEqual(['ai']);
  expect(parsed.meta.cssclass).toBe('wide');
});

test('accepts empty and 200000-character notes but rejects 200001', async () => {
  const { service } = await setup();
  const topic = await service.create({ name: 'LangGraph' });

  await expect(service.saveNote({ topicId: topic.id, body: '' })).resolves.toMatchObject({
    body: ''
  });
  await expect(
    service.saveNote({ topicId: topic.id, body: 'x'.repeat(200_000) })
  ).resolves.toMatchObject({ body: 'x'.repeat(200_000) });
  await expect(
    service.saveNote({ topicId: topic.id, body: 'x'.repeat(200_001) })
  ).rejects.toThrow(/200000/);
});

test('rejects saving a note to a missing topic', async () => {
  const { service } = await setup();
  await expect(service.saveNote({ topicId: 'kt-missing', body: 'x' })).rejects.toThrow(
    /知识主题不存在/
  );
});

test('deleting a topic removes its note file', async () => {
  const { dir, service } = await setup();
  const topic = await service.create({ name: 'LangGraph' });
  await service.saveNote({ topicId: topic.id, body: 'body' });

  await service.delete(topic.id);
  await expect(readFile(notePath(dir, topic.id), 'utf8')).rejects.toThrow();
});

test('renaming a topic updates note frontmatter but not its body', async () => {
  const { dir, service } = await setup();
  const topic = await service.create({ name: 'LangGraph', aliases: ['LG'] });
  await service.saveNote({ topicId: topic.id, body: 'body stays' });

  await service.update({ id: topic.id, name: 'LangGraph.js', aliases: ['LG.js'] });
  const parsed = parseKnowledgeNoteFile(await readFile(notePath(dir, topic.id), 'utf8'), topic.id);
  expect(parsed.title).toBe('LangGraph.js');
  expect(parsed.aliases).toEqual(['LG.js']);
  expect(parsed.body).toBe('body stays');
});

test('getNote returns an empty body for missing or unsafe ids', async () => {
  const { service } = await setup();
  expect(await service.getNote('kt-missing')).toEqual({
    topicId: 'kt-missing',
    body: '',
    updatedAt: ''
  });
  expect(await service.getNote('../../etc/passwd')).toMatchObject({ body: '' });
});

test('lists topics whose notes link to the target', async () => {
  const { service } = await setup();
  const target = await service.create({ name: 'LangChain' });
  const source = await service.create({ name: 'LangGraph' });
  await service.saveNote({ topicId: source.id, body: '相关 [[LangChain]]' });

  expect(await service.getBacklinks(target.id)).toEqual([
    { topicId: source.id, name: 'LangGraph' }
  ]);
});

test('ignores links inside code and ambiguous aliases', async () => {
  const { service } = await setup();
  const target = await service.create({ name: 'RAG' });
  await service.create({ name: '检索增强', aliases: ['RAG'] });
  const source = await service.create({ name: 'SourceNote' });
  await service.saveNote({ topicId: source.id, body: '`[[RAG]]`\n```\n[[RAG]]\n```' });

  expect(await service.getBacklinks(target.id)).toEqual([]);
});

test('ignores self-links and broken note files', async () => {
  const { dir, service } = await setup();
  const topic = await service.create({ name: 'LangGraph' });
  await service.saveNote({ topicId: topic.id, body: '[[LangGraph]]' });
  expect(await service.getBacklinks(topic.id)).toEqual([]);

  await mkdir(join(dir, 'knowledge', 'notes'), { recursive: true });
  await writeFile(join(dir, 'knowledge', 'notes', 'kt-broken.md'), 'not: [valid', 'utf8');
  await service.create({ name: 'LangChain' });
  expect(await service.getBacklinks(topic.id)).toEqual([]);
});
