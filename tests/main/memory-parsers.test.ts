import { parseNote } from '../../src/main/vault/note';
import { buildProfile } from '../../src/main/memory/profile';
import {
  KIND_LABELS,
  isMemoryKind,
  parseMemoryRecords,
  serializeMemoryRecords
} from '../../src/main/memory/records';
import {
  parseModelItems,
  synthesizeByRules,
  synthesizeByModel
} from '../../src/main/memory/synthesize';
import type { MemoryKind, MemoryRecord } from '../../src/shared/memory';

function record(
  id: string,
  text: string,
  kind: MemoryKind,
  createdAt: string,
  source = 'review:2026-10-31'
): MemoryRecord {
  return { id, workspaceId: 'ws-a', text, kind, source, createdAt };
}

describe('memory/records parse rules', () => {
  test('reads frontmatter items into workspace-scoped records', () => {
    const raw = serializeMemoryRecords([
      record('m-1', '极限定义还不稳', 'weakness', '2026-10-20T21:00:00.000Z'),
      record('m-2', '晚间刷题效率更高', 'preference', '2026-10-21T21:00:00.000Z')
    ]);

    expect(parseMemoryRecords(raw, 'ws-a')).toEqual([
      record('m-1', '极限定义还不稳', 'weakness', '2026-10-20T21:00:00.000Z'),
      record('m-2', '晚间刷题效率更高', 'preference', '2026-10-21T21:00:00.000Z')
    ]);
  });

  test('a hand-edited file without kind reads every entry back as a fact', () => {
    const raw = [
      '---',
      'type: log',
      'source: agent',
      'items:',
      '  - id: legacy-1',
      '    text: 手写的旧记忆',
      '    source: review:2026-10-01',
      '    createdAt: 2026-10-01T21:00:00.000Z',
      '---',
      '# 记忆',
      ''
    ].join('\n');

    // An unquoted YAML timestamp parses as a Date, and note.ts normalizes
    // dates to their UTC calendar day — the entry still reads, just date-only.
    expect(parseMemoryRecords(raw, 'ws-a')).toEqual([
      {
        id: 'legacy-1',
        workspaceId: 'ws-a',
        text: '手写的旧记忆',
        source: 'review:2026-10-01',
        createdAt: '2026-10-01',
        kind: 'fact'
      }
    ]);
  });

  test('an unknown kind degrades to fact instead of throwing', () => {
    const raw = [
      '---',
      'type: log',
      'items:',
      '  - id: m-1',
      '    text: 奇怪的种类',
      '    kind: mystery',
      '    source: manual',
      '---',
      '# 记忆',
      ''
    ].join('\n');

    expect(parseMemoryRecords(raw, 'ws-a')).toEqual([
      expect.objectContaining({ id: 'm-1', text: '奇怪的种类', kind: 'fact' })
    ]);
  });

  test('a hand-edited file tolerates broken entries: missing ids/texts drop, not throw', () => {
    const raw = [
      '---',
      'type: log',
      'items:',
      '  - id: keep-me',
      '    text: 保留这条',
      '    kind: plan',
      '    source: manual',
      '  - text: 没有 id 的条目',
      '  - id: no-text',
      '  - just a string',
      '  - null',
      '---',
      '# 记忆',
      ''
    ].join('\n');

    expect(parseMemoryRecords(raw, 'ws-a').map((entry) => entry.id)).toEqual(['keep-me']);
  });

  test('a file with no frontmatter items is an empty log', () => {
    expect(parseMemoryRecords('# 随手记\n\n- 一条正文记录\n', 'ws-a')).toEqual([]);
    expect(parseMemoryRecords('---\ntype: log\nitems: []\n---\n# 记忆\n', 'ws-a')).toEqual([]);
    expect(parseMemoryRecords('---\ntype: log\nitems: not-a-list\n---\n# 记忆\n', 'ws-a')).toEqual(
      []
    );
  });

  test('serialize(parse(serialize(x))) is byte-identical to serialize(x)', () => {
    const entries = [
      record('m-1', '中值定理掌握不牢', 'weakness', '2026-10-20T21:00:00.000Z'),
      record('m-2', '偏好纸质笔记', 'preference', '2026-10-21T21:00:00.000Z'),
      record('m-3', '坚持晨读', 'strength', '2026-10-22T21:00:00.000Z', 'manual'),
      // Legacy entry with no createdAt survives the trip too.
      { id: 'legacy-1', workspaceId: 'ws-a', text: '旧记录', kind: 'fact' as const, source: '' }
    ];
    const once = serializeMemoryRecords(entries);

    const twice = serializeMemoryRecords(parseMemoryRecords(once, 'ws-a'));

    expect(twice).toBe(once);
    // The body keeps log order and label spelling.
    expect(once).toContain('- 【薄弱】中值定理掌握不牢（来源：review:2026-10-31）');
    expect(once).toContain('- 【记录】旧记录（来源：）');
  });

  test('every kind has a body label and is recognized by isMemoryKind', () => {
    for (const kind of Object.keys(KIND_LABELS) as MemoryKind[]) {
      expect(isMemoryKind(kind)).toBe(true);
    }
    expect(isMemoryKind('mystery')).toBe(false);
    expect(isMemoryKind(undefined)).toBe(false);
  });
});

describe('memory/profile build rules', () => {
  const now = new Date('2026-11-01T12:00:00.000Z');

  test('buckets by kind newest first and merges duplicate texts', () => {
    const profile = buildProfile(
      [
        record('m1', '极限定义还不稳', 'weakness', '2026-10-20T21:00:00.000Z'),
        record('m2', '极限定义还不稳', 'weakness', '2026-10-25T21:00:00.000Z'),
        record('m3', '英语阅读速度偏慢', 'weakness', '2026-10-29T21:00:00.000Z'),
        record('m4', '外刊表达积累有效', 'strength', '2026-10-28T21:00:00.000Z'),
        record('m5', '晚间学习效率更高', 'preference', '2026-10-27T21:00:00.000Z'),
        record('m6', '明早练两篇阅读', 'plan', '2026-10-30T21:00:00.000Z')
      ],
      now,
      'ws-a'
    );

    expect(profile.weaknesses).toEqual(['英语阅读速度偏慢', '极限定义还不稳']);
    expect(profile.strengths).toEqual(['外刊表达积累有效']);
    expect(profile.preferences).toEqual(['晚间学习效率更高']);
    expect(profile.plans).toEqual(['明早练两篇阅读']);
    expect(profile.memoryCount).toBe(6);
    expect(profile.firstAt).toBe('2026-10-20T21:00:00.000Z');
    expect(profile.lastAt).toBe('2026-10-30T21:00:00.000Z');
    expect(profile.generatedAt).toBe('2026-11-01T12:00:00.000Z');
  });

  test('recent dedupes across kinds and each bucket keeps its five newest', () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      record(`m${index + 1}`, `薄弱点 ${index + 1}`, 'weakness', `2026-10-2${index + 1}T21:00:00.000Z`)
    );
    items.push(record('m-dup', '薄弱点 7', 'strength', '2026-10-31T21:00:00.000Z'));
    items.push(record('m-plan', '薄弱点 3', 'plan', '2026-10-30T21:00:00.000Z'));

    const profile = buildProfile(items, now);

    expect(profile.weaknesses).toEqual(['薄弱点 7', '薄弱点 6', '薄弱点 5', '薄弱点 4', '薄弱点 3']);
    // recent spans every kind newest first, so the newer duplicates of
    // 「薄弱点 7」and 「薄弱点 3」claim those texts before the weakness bucket.
    expect(profile.recent).toEqual(['薄弱点 7', '薄弱点 3', '薄弱点 6', '薄弱点 5', '薄弱点 4']);
  });

  test('facts stay out of the summary but count toward recent', () => {
    const profile = buildProfile(
      [record('m1', '只记一笔', 'fact', '2026-10-29T21:00:00.000Z')],
      now,
      'ws-a'
    );

    expect(profile.weaknesses).toEqual([]);
    expect(profile.recent).toEqual(['只记一笔']);
    expect(profile.summary).toBe('共 1 条记忆。');
  });

  test('an empty list is explicit and carries no timestamps', () => {
    const profile = buildProfile([], now, 'ws-a');

    expect(profile.summary).toBe('暂无记忆，画像待积累。');
    expect(profile.firstAt).toBeUndefined();
    expect(profile.lastAt).toBeUndefined();
    expect(profile.recent).toEqual([]);
  });

  test('summary lists at most three per bucket in weaknesses, preferences, strengths order', () => {
    const profile = buildProfile(
      [
        record('w1', '弱一', 'weakness', '2026-10-25T21:00:00.000Z'),
        record('w2', '弱二', 'weakness', '2026-10-26T21:00:00.000Z'),
        record('w3', '弱三', 'weakness', '2026-10-27T21:00:00.000Z'),
        record('w4', '弱四', 'weakness', '2026-10-28T21:00:00.000Z'),
        record('p1', '偏好一', 'preference', '2026-10-28T21:00:00.000Z'),
        record('s1', '优势一', 'strength', '2026-10-28T21:00:00.000Z')
      ],
      now
    );

    expect(profile.summary).toBe(
      '共 6 条记忆。薄弱点：弱四、弱三、弱二。偏好：偏好一。优势：优势一。'
    );
  });
});

describe('memory/synthesize parse rules', () => {
  test('rule summaries keep only non-empty answers, stuck first, capped at three', () => {
    expect(synthesizeByRules({ completed: '  ', stuck: '', tomorrow: '精听一篇' })).toEqual([
      { text: '精听一篇', kind: 'plan' }
    ]);
    expect(
      synthesizeByRules({ completed: '完成卷子', stuck: '中值定理卡住', tomorrow: '专项练' })
    ).toEqual([
      { text: '中值定理卡住', kind: 'weakness' },
      { text: '完成卷子', kind: 'strength' },
      { text: '专项练', kind: 'plan' }
    ]);
  });

  test('rule summaries collapse whitespace and truncate at 200 characters', () => {
    const long = `a ${'b'.repeat(300)}`;
    const [item] = synthesizeByRules({ completed: '', stuck: `  太\n\n多   空格  ${long}`, tomorrow: '' });

    expect(item?.text.startsWith('太 多 空格 a ')).toBe(true);
    expect(item?.text.endsWith('…')).toBe(true);
    expect(item?.text).toHaveLength(201);
  });

  test('parses fenced JSON with prose around it', () => {
    expect(
      parseModelItems(
        '好的：\n```json\n{"items":[{"text":"坚持晨读","kind":"strength"}]}\n```\n希望有帮助。'
      )
    ).toEqual([{ text: '坚持晨读', kind: 'strength' }]);
  });

  test('falls back to the outermost brace span without fences', () => {
    expect(
      parseModelItems('结果 {"items":[{"text":"晚间效率高","kind":"preference"}]} 以上。')
    ).toEqual([{ text: '晚间效率高', kind: 'preference' }]);
  });

  test('unknown kinds become fact and blank texts are dropped', () => {
    expect(
      parseModelItems(
        JSON.stringify({
          items: [
            { text: '三', kind: 'mystery' },
            { text: '   ', kind: 'plan' },
            { text: '四', kind: 'plan' }
          ]
        })
      )
    ).toEqual([
      { text: '三', kind: 'fact' },
      { text: '四', kind: 'plan' }
    ]);
  });

  test('caps model output at three items', () => {
    expect(
      parseModelItems(
        JSON.stringify({
          items: [
            { text: '一', kind: 'weakness' },
            { text: '二', kind: 'strength' },
            { text: '三', kind: 'plan' },
            { text: '四', kind: 'fact' }
          ]
        })
      )?.map((item) => item.text)
    ).toEqual(['一', '二', '三']);
  });

  test('prose, empty items and invalid JSON all return null', () => {
    expect(parseModelItems('今天天气不错。')).toBeNull();
    expect(parseModelItems('{"items":[]}')).toBeNull();
    expect(parseModelItems('```json\n{"items": [broken\n```')).toBeNull();
    expect(parseModelItems('{"items":"not-a-list"}')).toBeNull();
  });

  test('the model path parses its text and returns null on failure', async () => {
    const source = {
      workspaceName: '考研',
      workspaceGoal: '上岸',
      date: '2026-11-01',
      answers: { completed: '做完两套卷子', stuck: '', tomorrow: '' }
    };
    const reply = (text: string) => ({
      complete: async () => ({ text, usage: { inputTokens: 1, outputTokens: 1 } })
    });

    await expect(
      synthesizeByModel(reply('{"items":[{"text":"状态不错","kind":"strength"}]}'), source)
    ).resolves.toEqual([{ text: '状态不错', kind: 'strength' }]);

    await expect(synthesizeByModel(reply('不太想回答'), source)).resolves.toBeNull();
    await expect(
      synthesizeByModel(
        { complete: async () => Promise.reject(new Error('down')) },
        source
      )
    ).resolves.toBeNull();
  });

  test('an aborted model call throws AbortError instead of falling back', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      synthesizeByModel(
        { complete: async () => ({ text: '{}', usage: { inputTokens: 1, outputTokens: 1 } }) },
        {
          workspaceName: '考研',
          workspaceGoal: '',
          date: '2026-11-01',
          answers: { completed: 'a', stuck: '', tomorrow: '' }
        },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

test('parseNote keeps the generated body readable by the memory parser', () => {
  const raw = serializeMemoryRecords([record('m-1', '坚持晨读', 'strength', '2026-10-22T21:00:00.000Z')]);

  expect(parseNote(raw).body).toContain('- 【优势】坚持晨读（来源：review:2026-10-31）');
});
