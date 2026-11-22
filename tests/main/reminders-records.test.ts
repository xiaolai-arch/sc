import {
  parseRemindersFile,
  serializeRemindersFile
} from '../../src/main/workspace/records/reminders';

test('doneAt accepts only a real YYYY-MM-DD local day', () => {
  const withDoneAt = serializeRemindersFile([
    {
      id: 'water',
      time: '12:00',
      label: '喝水',
      enabled: true,
      state: 'done',
      doneAt: '2026-10-31'
    }
  ]);
  expect(parseRemindersFile(withDoneAt)[0]).toMatchObject({
    state: 'done',
    doneAt: '2026-10-31'
  });

  // Hand-edited junk drops the field instead of failing the whole reminder:
  // a wrong word, a timestamp shape, or an impossible date all read as absent.
  const junk = [
    '---',
    'type: plan',
    'source: user',
    'items:',
    '  - id: water',
    '    time: "12:00"',
    '    label: 喝水',
    '    enabled: true',
    '    state: done',
    '    doneAt: 昨天',
    '  - id: gym',
    '    time: "07:00"',
    '    label: 跑步',
    '    enabled: true',
    '    state: done',
    "    doneAt: '2026-13-40'",
    '  - id: nap',
    '    time: "13:00"',
    '    label: 午休',
    '    enabled: true',
    '    state: done',
    "    doneAt: '2026-10-31T12:00'",
    '---',
    '# 提醒',
    ''
  ].join('\n');
  expect(parseRemindersFile(junk)).toEqual([
    { id: 'water', time: '12:00', label: '喝水', enabled: true, state: 'done' },
    { id: 'gym', time: '07:00', label: '跑步', enabled: true, state: 'done' },
    { id: 'nap', time: '13:00', label: '午休', enabled: true, state: 'done' }
  ]);
});

test('an old file without doneAt round-trips byte-identically', () => {
  // The key is written only when a real completion day exists, so every
  // pre-iter30 file re-serializes to exactly the same bytes (acceptance 19).
  const legacy = serializeRemindersFile([
    { id: 'water', time: '12:00', label: '喝水', enabled: true, state: 'done' },
    { id: 'gym', time: '07:00', label: '跑步', enabled: true, days: [1, 3] }
  ]);
  expect(legacy).not.toContain('doneAt');
  expect(serializeRemindersFile(parseRemindersFile(legacy))).toBe(legacy);

  const bare = serializeRemindersFile([
    { id: 'water', time: '12:00', label: '喝水', enabled: true }
  ]);
  expect(bare).not.toContain('doneAt');
  expect(serializeRemindersFile(parseRemindersFile(bare))).toBe(bare);
});
