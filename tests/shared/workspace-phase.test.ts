import { EXAM_PHASES, isExamPhase } from '../../src/shared/workspace';
import {
  parseWorkspaceFile,
  serializeWorkspaceFile
} from '../../src/main/workspace/records/workspace';
import type { Workspace } from '../../src/shared/workspace';

const base: Workspace = {
  id: 'ws-exam',
  name: '考研',
  kind: 'exam',
  color: '#0071e3',
  goal: '2027 上岸',
  description: '每天四小时'
};

test('the three exam stages are the only accepted labels', () => {
  expect(EXAM_PHASES).toEqual(['基础', '强化', '冲刺']);
  for (const phase of EXAM_PHASES) expect(isExamPhase(phase)).toBe(true);
  // 预习 is the negative case the spec names; blanks and non-strings alike.
  for (const value of ['预习', '', 'BASIC', undefined, null, 0, {}, ['基础']]) {
    expect(isExamPhase(value)).toBe(false);
  }
});

test('phase and phaseAskedAt round-trip through workspace.md frontmatter (验收 24)', () => {
  const workspace: Workspace = { ...base, phase: '强化', phaseAskedAt: '2026-11-08' };
  const raw = serializeWorkspaceFile(workspace);
  const parsed = parseWorkspaceFile(raw, workspace.id);
  expect(parsed).toMatchObject({
    phase: '强化',
    phaseAskedAt: '2026-11-08',
    name: '考研',
    goal: '2027 上岸'
  });
  // The value is human-readable frontmatter, not an encoded blob.
  expect(raw).toContain('phase: 强化');
  expect(raw).toContain("phaseAskedAt: '2026-11-08'");
});

test('an absent phase writes no keys and reads as unset, byte-identical to 1.3.0', () => {
  const raw = serializeWorkspaceFile(base);
  expect(raw).not.toContain('phase');
  expect(raw).not.toContain('phaseAskedAt');
  const parsed = parseWorkspaceFile(raw, base.id);
  expect(parsed).not.toHaveProperty('phase');
  expect(parsed).not.toHaveProperty('phaseAskedAt');
});

test('a bad phase value is dropped on read and counts as unset (验收 24)', () => {
  const raw = serializeWorkspaceFile(base).replace(
    'kind: exam',
    'kind: exam\nphase: 预习'
  );
  const parsed = parseWorkspaceFile(raw, base.id);
  expect(parsed).not.toHaveProperty('phase');
});

test('an unreadable phaseAskedAt is dropped on read the same way', () => {
  const raw = serializeWorkspaceFile({ ...base, phase: '基础' }).replace(
    'phase: 基础',
    'phase: 基础\nphaseAskedAt: 下周'
  );
  const parsed = parseWorkspaceFile(raw, base.id);
  expect(parsed).toMatchObject({ phase: '基础' });
  expect(parsed).not.toHaveProperty('phaseAskedAt');
});
