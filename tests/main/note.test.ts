import { parseNote, serializeNote } from '../../src/main/vault/note';

test('parses frontmatter and body', () => {
  const note = parseNote('---\ntype: plan\ndate: 2026-10-31\nsource: agent\n---\n# 计划\n\n- 任务');
  expect(note.meta.type).toBe('plan');
  expect(note.meta.source).toBe('agent');
  expect(note.body).toContain('# 计划');
});

test('defaults missing frontmatter to a user note', () => {
  const note = parseNote('# 随手记\n内容');
  expect(note.meta).toEqual({ type: 'note', source: 'user' });
  expect(note.body).toBe('# 随手记\n内容');
});

test('does not throw on malformed YAML', () => {
  const raw = '---\ntype: [unclosed\n---\n正文';
  expect(() => parseNote(raw)).not.toThrow();
  expect(parseNote(raw).meta.type).toBe('note');
  expect(parseNote(raw).body).toContain('正文');
});

test('round-trips Chinese content', () => {
  const raw = serializeNote({ type: 'note', tags: ['数学'], source: 'agent' }, '# 极限\n\n定义：……');
  const parsed = parseNote(raw);
  expect(parsed.meta.tags).toEqual(['数学']);
  expect(parsed.body).toBe('# 极限\n\n定义：……');
});

test('treats an unknown note type as malformed and keeps the body', () => {
  const note = parseNote('---\ntype: diary\n---\n正文');
  expect(note.meta).toEqual({ type: 'note', source: 'user' });
  expect(note.body).toBe('正文');
});

test('treats non-object frontmatter as malformed and keeps the body', () => {
  const note = parseNote('---\njust a string\n---\n正文');
  expect(note.meta).toEqual({ type: 'note', source: 'user' });
  expect(note.body).toBe('正文');
});
