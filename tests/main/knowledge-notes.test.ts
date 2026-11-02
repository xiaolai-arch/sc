import matter from 'gray-matter';
import {
  parseKnowledgeNoteFile,
  serializeKnowledgeNoteFile
} from '../../src/main/knowledge/notes';

test('reads the body verbatim and preserves unknown frontmatter keys', () => {
  const raw = [
    '---',
    'type: note',
    'kind: knowledge-note',
    'topicId: kt-1',
    'title: LangGraph',
    'aliases: [LangGraph]',
    'tags: [ai]',
    'cssclass: wide',
    '---',
    '',
    'line one',
    'line two',
    ''
  ].join('\n');
  const file = parseKnowledgeNoteFile(raw, 'kt-1');
  expect(file.body).toBe('\nline one\nline two\n');

  const out = serializeKnowledgeNoteFile({
    ...file,
    title: 'LangGraph.js',
    aliases: ['LangGraph.js', 'LG'],
    updatedAt: '2026-11-02T10:00:00.000Z'
  });
  const parsed = matter(out);
  expect(parsed.content).toBe('\nline one\nline two\n');
  expect(parsed.data.tags).toEqual(['ai']);
  expect(parsed.data.cssclass).toBe('wide');
  expect(parsed.data.title).toBe('LangGraph.js');
  expect(parsed.data.aliases).toEqual(['LangGraph.js', 'LG']);
});

test('reads hand-written notes without type or kind', () => {
  const file = parseKnowledgeNoteFile('---\ntags: [x]\n---\nbody only', 'kt-9');
  expect(file.topicId).toBe('kt-9');
  expect(file.body).toBe('body only');
  expect(file.meta.tags).toEqual(['x']);
});

test('ignores a forged topicId in frontmatter', () => {
  const file = parseKnowledgeNoteFile(
    '---\nkind: knowledge-note\ntopicId: ../../x\n---\nbody',
    'kt-1'
  );
  expect(file.topicId).toBe('kt-1');
});

test('falls back to plain content when the frontmatter cannot be parsed', () => {
  const raw = '---\nfoo: [unclosed\n---\nbody survives';
  const file = parseKnowledgeNoteFile(raw, 'kt-2');
  expect(file.topicId).toBe('kt-2');
  expect(file.body).toContain('body survives');
  expect(file.meta.type).toBe('note');
});
