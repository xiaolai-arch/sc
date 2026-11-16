import {
  AGENT_PERMISSION_MODES,
  modeToPermissions,
  normalizePermissions,
  permissionsToMode
} from '../../src/shared/attachments';

test('maps each mode to the permissions the agent receives', () => {
  expect(modeToPermissions('readonly')).toEqual({ web: true, write: false, shell: false });
  expect(modeToPermissions('workspace')).toEqual({ web: true, write: true, shell: false });
  expect(modeToPermissions('full')).toEqual({ web: true, write: true, shell: true });
});

test('round-trips every selectable mode', () => {
  for (const entry of AGENT_PERMISSION_MODES) {
    expect(permissionsToMode(modeToPermissions(entry.mode))).toBe(entry.mode);
  }
});

test('collapses stored permission combinations to the closest mode', () => {
  expect(permissionsToMode({ web: false, write: false, shell: false })).toBe('readonly');
  expect(permissionsToMode({ web: false, write: true, shell: false })).toBe('workspace');
  expect(permissionsToMode({ web: false, write: true, shell: true })).toBe('full');
});

test('normalizePermissions defaults to the workspace mode for a missing object', () => {
  expect(normalizePermissions(undefined)).toEqual(modeToPermissions('workspace'));
  expect(normalizePermissions(null)).toEqual(modeToPermissions('workspace'));
  expect(normalizePermissions('x')).toEqual(modeToPermissions('workspace'));
});

test('normalizePermissions fails closed on malformed fields', () => {
  expect(normalizePermissions({ shell: 'yes' })).toEqual({
    web: true,
    write: false,
    shell: false
  });
  expect(normalizePermissions({ web: false, write: true })).toEqual({
    web: false,
    write: true,
    shell: false
  });
});

test('shell implies write so the mode round-trip cannot widen access', () => {
  const normalized = normalizePermissions({ write: false, shell: true });
  expect(normalized).toEqual({ web: true, write: true, shell: true });
  expect(permissionsToMode(normalized)).toBe('full');
});
