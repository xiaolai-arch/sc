import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDefaultAppState } from '../../src/main/context';
import { createDefaultSettings } from '../../src/main/settings/defaults';
import { SettingsService } from '../../src/main/settings/settings-service';
import { JsonStateStore } from '../../src/main/state-store';

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'study-coach-settings-'));
}

function memorySettings() {
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => createDefaultAppState('/tmp/study-vault')
  });
  return { state, service: new SettingsService(state) };
}

test('returns documented defaults', async () => {
  const { service } = memorySettings();
  const settings = await service.get();
  expect(settings).toEqual({
    displayName: 'xiaolai',
    vaultPath: '/tmp/study-vault',
    provider: { kind: 'local-cli', agent: 'codex', command: 'codex' },
    notifications: {
      enabled: true,
      morning: '08:00',
      evening: '21:30',
      weekly: '20:00',
      weeklyEnabled: true,
      behindSchedule: '20:30',
      behindScheduleEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:30'
    },
    budget: { proactiveSessionsPerDay: 4, dailyTokens: 200000 },
    launchAtLogin: false
  });
  expect(JSON.stringify(settings)).not.toContain('apiKey');
});

test('merges nested settings and persists them across store instances', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const firstStore = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/vault-a')
    });
    const first = new SettingsService(firstStore);
    const updated = await first.update({
      vaultPath: '/tmp/vault-b',
      provider: { kind: 'ollama', baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen3' },
      notifications: { morning: '07:15', enabled: false } as never,
      budget: { dailyTokens: 1000 } as never,
      launchAtLogin: true
    });
    expect(updated.vaultPath).toBe('/tmp/vault-b');
    expect(updated.notifications).toEqual({
      enabled: false,
      morning: '07:15',
      evening: '21:30',
      weekly: '20:00',
      weeklyEnabled: true,
      behindSchedule: '20:30',
      behindScheduleEnabled: true,
      dndStart: '23:00',
      dndEnd: '07:30'
    });
    expect(updated.budget).toEqual({ proactiveSessionsPerDay: 4, dailyTokens: 1000 });

    const secondStore = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/ignored')
    });
    const second = new SettingsService(secondStore);
    expect(await second.get()).toEqual(updated);

    const raw = await readFile(filePath, 'utf8');
    expect(raw).toContain('qwen3');
    expect(raw).not.toContain('sk-');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects invalid settings patches without mutating stored values', async () => {
  const { service } = memorySettings();
  await expect(service.update({ budget: { dailyTokens: -1 } as never })).rejects.toThrow(
    '预算数值必须是非负整数。'
  );
  await expect(service.update({ notifications: { morning: '7:00' } } as never)).rejects.toThrow(
    '提醒时间格式必须为 HH:MM。'
  );
  await expect(service.update({ provider: { kind: 'anthropic' } } as never)).rejects.toThrow(
    '模型名称不能为空。'
  );
  await expect(service.update({ provider: { kind: 'magic', model: 'x' } } as never)).rejects.toThrow(
    '模型 provider 类型无效。'
  );
  await expect(service.update({ vaultPath: '   ' } as never)).rejects.toThrow('Vault 路径不能为空。');
  await expect(service.update({ launchAtLogin: 'yes' } as never)).rejects.toThrow(
    '启动设置必须是布尔值。'
  );
  await expect(service.update(null as never)).rejects.toThrow('设置参数无效。');
  expect((await service.get()).vaultPath).toBe('/tmp/study-vault');
});

test('validates and persists the weekly review settings', async () => {
  const { service } = memorySettings();

  await expect(
    service.update({ notifications: { weekly: '7:00' } as never })
  ).rejects.toThrow('提醒时间格式必须为 HH:MM。');
  await expect(
    service.update({ notifications: { weeklyEnabled: 'yes' } as never })
  ).rejects.toThrow(/布尔值/);

  const updated = await service.update({
    notifications: { weekly: '19:30', weeklyEnabled: false } as never
  });
  expect(updated.notifications).toMatchObject({ weekly: '19:30', weeklyEnabled: false });
});

test('validates local CLI effort and keeps configs without effort readable', async () => {
  const { service } = memorySettings();

  const withEffort = await service.update({
    provider: {
      kind: 'local-cli',
      agent: 'codex',
      command: 'codex',
      model: 'gpt-x',
      effort: 'high',
      nativeTools: true
    }
  });
  expect(withEffort.provider).toEqual({
    kind: 'local-cli',
    agent: 'codex',
    command: 'codex',
    model: 'gpt-x',
    effort: 'high',
    nativeTools: true
  });

  await expect(
    service.update({
      provider: { kind: 'local-cli', agent: 'codex', effort: 'max' } as never
    })
  ).rejects.toThrow(/推理强度/);

  const plain = await service.update({
    provider: { kind: 'local-cli', agent: 'claude', command: 'claude' }
  });
  expect(plain.provider).toEqual({ kind: 'local-cli', agent: 'claude', command: 'claude' });
});

test('validates and persists the behind-schedule reminder settings', async () => {
  const { service } = memorySettings();

  await expect(
    service.update({ notifications: { behindSchedule: '8:30' } as never })
  ).rejects.toThrow('提醒时间格式必须为 HH:MM。');
  await expect(
    service.update({ notifications: { behindScheduleEnabled: 'yes' } as never })
  ).rejects.toThrow(/落后提醒开关/);

  const updated = await service.update({
    notifications: { behindSchedule: '19:45', behindScheduleEnabled: false } as never
  });
  expect(updated.notifications).toMatchObject({
    behindSchedule: '19:45',
    behindScheduleEnabled: false
  });
  // Round-trips through the state document.
  expect(await service.get()).toEqual(updated);
});

test('fills behind-schedule defaults for settings written before the feature', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const {
    behindSchedule: _time,
    behindScheduleEnabled: _on,
    weekly: _weekly,
    weeklyEnabled: _weeklyEnabled,
    ...oldNotifications
  } = defaults.notifications;
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: { ...defaults, notifications: oldNotifications as never }
    })
  });
  const service = new SettingsService(state);

  expect((await service.get()).notifications).toMatchObject({
    behindSchedule: '20:30',
    behindScheduleEnabled: true
  });
});

test('accepts non-negative token prices and rejects invalid ones', async () => {
  const { service } = memorySettings();

  const updated = await service.update({
    budget: { inputPricePerMillion: 2, outputPricePerMillion: 8 } as never
  });
  expect(updated.budget).toEqual({
    proactiveSessionsPerDay: 4,
    dailyTokens: 200000,
    inputPricePerMillion: 2,
    outputPricePerMillion: 8
  });

  await expect(
    service.update({ budget: { inputPricePerMillion: -1 } as never })
  ).rejects.toThrow(/单价/);
  await expect(
    service.update({ budget: { outputPricePerMillion: Number.NaN } as never })
  ).rejects.toThrow(/单价/);
  await expect(
    service.update({ budget: { inputPricePerMillion: '2' } as never })
  ).rejects.toThrow(/单价/);
});

test('validates and clears the snoozed date', async () => {
  const { service } = memorySettings();

  await expect(
    service.update({ notifications: { snoozedUntil: '2026-11-1' } as never })
  ).rejects.toThrow(/YYYY-MM-DD/);

  const set = await service.update({
    notifications: { snoozedUntil: '2026-11-02' } as never
  });
  expect(set.notifications.snoozedUntil).toBe('2026-11-02');

  const cleared = await service.update({
    notifications: { snoozedUntil: '' } as never
  });
  expect(cleared.notifications.snoozedUntil).toBe('');
});

test('tracks the pending mute resume and clears it like the snooze', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/resume-vault')
    });
    const service = new SettingsService(store);

    // Absent until a resume is pending.
    expect((await service.get()).notifications.resumedFrom).toBeUndefined();
    const set = await service.update({
      notifications: { resumedFrom: '2026-11-20' } as never
    });
    expect(set.notifications.resumedFrom).toBe('2026-11-20');
    expect(await readFile(filePath, 'utf8')).toContain('"resumedFrom": "2026-11-20"');

    // '' clears the pending resume; the key leaves the file entirely.
    const cleared = await service.update({
      notifications: { resumedFrom: '' } as never
    });
    expect(cleared.notifications.resumedFrom).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).not.toContain('resumedFrom');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the early-resume mute end lives and dies with resumedFrom', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/early-resume-vault')
    });
    const service = new SettingsService(store);

    // Written together on an early manual resume.
    const set = await service.update({
      notifications: {
        resumedFrom: '2026-11-02',
        resumedFromMuteEnd: '2026-11-09'
      } as never
    });
    expect(set.notifications.resumedFrom).toBe('2026-11-02');
    expect(set.notifications.resumedFromMuteEnd).toBe('2026-11-09');
    expect(await readFile(filePath, 'utf8')).toContain('"resumedFromMuteEnd": "2026-11-09"');

    // Clearing `resumedFrom` alone also drops the mute end, so the carrier can
    // never outlive its resume and become a future fake sentence.
    const cleared = await service.update({
      notifications: { resumedFrom: '' } as never
    });
    expect(cleared.notifications.resumedFrom).toBeUndefined();
    expect(cleared.notifications.resumedFromMuteEnd).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).not.toContain('resumedFrom');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an early-resume mute end without a pending resume is dropped on read', async () => {
  const defaults = createDefaultSettings('/tmp/orphan-mute-end');
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: {
        ...defaults,
        notifications: {
          ...defaults.notifications,
          resumedFromMuteEnd: '2026-11-09'
        } as never
      }
    })
  });
  const service = new SettingsService(state);
  expect((await service.get()).notifications.resumedFromMuteEnd).toBeUndefined();
});

test('rejects a malformed mute end without mutating stored values', async () => {
  const { service } = memorySettings();
  await expect(
    service.update({ notifications: { resumedFromMuteEnd: '2026-11-9' } as never })
  ).rejects.toThrow('恢复前静音日期格式必须为 YYYY-MM-DD。');
  await expect(
    service.update({ notifications: { resumedFromMuteEnd: 7 } as never })
  ).rejects.toThrow('恢复前静音日期格式无效。');
  expect((await service.get()).notifications.resumedFromMuteEnd).toBeUndefined();
});

test('rejects a malformed resumedFrom without mutating stored values', async () => {
  const { service } = memorySettings();
  await expect(
    service.update({ notifications: { resumedFrom: '2026-11-1' } as never })
  ).rejects.toThrow('恢复日期格式必须为 YYYY-MM-DD。');
  await expect(
    service.update({ notifications: { resumedFrom: 7 } as never })
  ).rejects.toThrow('恢复日期格式无效。');
  expect((await service.get()).notifications.resumedFrom).toBeUndefined();
});

test('a malformed stored resumedFrom is dropped on read', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: {
        ...defaults,
        notifications: { ...defaults.notifications, resumedFrom: '上周' } as never
      }
    })
  });
  const service = new SettingsService(state);
  expect((await service.get()).notifications.resumedFrom).toBeUndefined();
});

test('legacy settings without resumedFrom round-trip byte-identically', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const defaults = createDefaultSettings('/tmp/legacy-resume-vault');
    const legacy = `${JSON.stringify({ onboarded: true, settings: defaults }, null, 2)}\n`;
    await writeFile(filePath, legacy, 'utf8');

    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/ignored')
    });
    const service = new SettingsService(store);
    expect((await service.get()).notifications.resumedFrom).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).toBe(legacy);

    // A save of an unrelated notification setting still does not introduce it.
    await service.update({ notifications: { morning: '07:15' } as never });
    expect(await readFile(filePath, 'utf8')).not.toContain('resumedFrom');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('saves a trimmed display name and rejects a blank one', async () => {
  const { service } = memorySettings();

  const updated = await service.update({ displayName: '  小林  ' });
  expect(updated.displayName).toBe('小林');
  expect((await service.get()).displayName).toBe('小林');

  await expect(service.update({ displayName: '   ' })).rejects.toThrow('称呼不能为空。');
});

test('fills a display name for settings written before the feature existed', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const { displayName: _displayName, ...oldSettings } = defaults;
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({ onboarded: true, settings: oldSettings as never })
  });
  const service = new SettingsService(state);

  expect((await service.get()).displayName).toBe('xiaolai');
});

test('fills weekly defaults for settings written before the feature existed', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const { weekly: _weekly, weeklyEnabled: _weeklyEnabled, ...oldNotifications } =
    defaults.notifications;
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: {
        ...defaults,
        notifications: oldNotifications as never
      }
    })
  });
  const service = new SettingsService(state);

  const loaded = await service.get();
  expect(loaded.notifications).toMatchObject({ weekly: '20:00', weeklyEnabled: true });

  const updated = await service.update({ notifications: { morning: '07:15' } as never });
  expect(updated.notifications).toMatchObject({
    morning: '07:15',
    weekly: '20:00',
    weeklyEnabled: true
  });
});

test('serializes strictMastery only when it is true', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/strict-vault')
    });
    const service = new SettingsService(store);

    // Absent by default: nothing about the flag reaches the document.
    expect((await service.get()).strictMastery).toBeUndefined();
    const on = await service.update({ strictMastery: true });
    expect(on.strictMastery).toBe(true);
    expect(await readFile(filePath, 'utf8')).toContain('"strictMastery": true');

    // Turning it off removes the key entirely rather than writing `false`.
    const off = await service.update({ strictMastery: false });
    expect(off.strictMastery).toBeUndefined();
    const raw = await readFile(filePath, 'utf8');
    expect(raw).not.toContain('strictMastery');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('legacy settings without strictMastery round-trip byte-identically', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const defaults = createDefaultSettings('/tmp/legacy-vault');
    const legacy = `${JSON.stringify({ onboarded: true, settings: defaults }, null, 2)}\n`;
    await writeFile(filePath, legacy, 'utf8');

    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/ignored')
    });
    const service = new SettingsService(store);
    // A read must not introduce the key.
    expect((await service.get()).strictMastery).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).toBe(legacy);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects a non-boolean strictMastery', async () => {
  const { service } = memorySettings();
  await expect(service.update({ strictMastery: 'yes' } as never)).rejects.toThrow(
    '严格掌握设置必须是布尔值。'
  );
  expect((await service.get()).strictMastery).toBeUndefined();
});

test('trims the accountability name and rejects one that is too long or multiline', async () => {
  const { service } = memorySettings();

  const saved = await service.update({ accountabilityName: '  小林  ' });
  expect(saved.accountabilityName).toBe('小林');
  expect((await service.get()).accountabilityName).toBe('小林');

  // 20 characters are fine; a 21st is rejected with a Chinese message.
  const twenty = await service.update({ accountabilityName: '一二三四五六七八九十一二三四五六七八九十' });
  expect([...(twenty.accountabilityName ?? '')]).toHaveLength(20);
  await expect(
    service.update({ accountabilityName: '一二三四五六七八九十一二三四五六七八九十一' })
  ).rejects.toThrow('问责对象不能超过 20 字。');

  await expect(
    service.update({ accountabilityName: '小林\n小王' } as never)
  ).rejects.toThrow('问责对象不能包含换行。');
  await expect(
    service.update({ accountabilityName: 42 } as never)
  ).rejects.toThrow('问责对象必须是文本。');

  // A rejected patch never reaches the store.
  expect((await service.get()).accountabilityName).toBe('一二三四五六七八九十一二三四五六七八九十');
});

test('clearing the accountability name removes the key entirely', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/name-vault')
    });
    const service = new SettingsService(store);

    expect((await service.get()).accountabilityName).toBeUndefined();
    const set = await service.update({ accountabilityName: '小林' });
    expect(set.accountabilityName).toBe('小林');
    expect(await readFile(filePath, 'utf8')).toContain('"accountabilityName": "小林"');

    for (const clear of ['', '   ']) {
      const cleared = await service.update({ accountabilityName: clear });
      expect(cleared.accountabilityName).toBeUndefined();
      expect(await readFile(filePath, 'utf8')).not.toContain('accountabilityName');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('legacy settings without an accountability name round-trip byte-identically', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const defaults = createDefaultSettings('/tmp/legacy-name-vault');
    const legacy = `${JSON.stringify({ onboarded: true, settings: defaults }, null, 2)}\n`;
    await writeFile(filePath, legacy, 'utf8');

    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/ignored')
    });
    const service = new SettingsService(store);
    expect((await service.get()).accountabilityName).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).toBe(legacy);

    // A save of an unrelated setting still does not introduce the key.
    await service.update({ notifications: { morning: '07:15' } as never });
    expect(await readFile(filePath, 'utf8')).not.toContain('accountabilityName');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a malformed stored accountability name reads as off', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: { ...defaults, accountabilityName: '小林\n小王' } as never
    })
  });
  const service = new SettingsService(state);
  expect((await service.get()).accountabilityName).toBeUndefined();
});

// --- the backup block --------------------------------------------------------

test('backup is absent by default and legacy files round-trip byte-identically', async () => {
  const { service } = memorySettings();
  // A fresh install has no backup block at all.
  expect((await service.get()).backup).toBeUndefined();

  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const defaults = createDefaultSettings('/tmp/legacy-vault');
    const legacy = `${JSON.stringify({ onboarded: true, settings: defaults }, null, 2)}\n`;
    await writeFile(filePath, legacy, 'utf8');

    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/ignored')
    });
    const service = new SettingsService(store);
    expect((await service.get()).backup).toBeUndefined();
    // A read must not introduce the block.
    expect(await readFile(filePath, 'utf8')).toBe(legacy);

    // A save of an unrelated setting still does not introduce it.
    await service.update({ notifications: { morning: '07:15' } as never });
    const after = await readFile(filePath, 'utf8');
    expect(after).not.toContain('backup');
    expect(after).not.toBe(legacy); // morning changed
    expect(after).toBe(
      legacy.replace('"morning": "08:00"', '"morning": "07:15"')
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('serializes the age line toggle only when it is on', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/toggle-vault')
    });
    const service = new SettingsService(store);

    const on = await service.update({ backup: { ageLineEnabled: true } });
    expect(on.backup).toEqual({ ageLineEnabled: true });
    expect(await readFile(filePath, 'utf8')).toContain('"ageLineEnabled": true');

    // Turning it off removes the key, and with nothing else in the block the
    // whole block disappears instead of serializing `false`.
    const off = await service.update({ backup: { ageLineEnabled: false } });
    expect(off.backup).toBeUndefined();
    expect(await readFile(filePath, 'utf8')).not.toContain('backup');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects invalid backup patches without mutating stored values', async () => {
  const { service } = memorySettings();
  await expect(
    service.update({ backup: { ageLineEnabled: 'yes' } as never })
  ).rejects.toThrow('备份年龄行开关必须是布尔值。');
  await expect(
    service.update({ backup: { lastBackupAt: '2026-11-02 14:30:00' } as never })
  ).rejects.toThrow('备份时间格式无效。');
  await expect(
    service.update({ backup: { lastBackupAt: '2026-02-30T14:30:00' } as never })
  ).rejects.toThrow('备份时间格式无效。');
  await expect(
    service.update({ backup: { lastBackupPath: 'relative/path' } as never })
  ).rejects.toThrow('备份路径必须是绝对路径。');
  await expect(
    service.update({ backup: { lastBackupOutcome: 'cancelled' } as never })
  ).rejects.toThrow('备份结果无效。');
  await expect(service.update({ backup: 'junk' } as never)).rejects.toThrow(
    '备份设置格式无效。'
  );
  expect((await service.get()).backup).toBeUndefined();
});

test('merges backup patches field-by-field', async () => {
  const { service } = memorySettings();
  // The export flow's write.
  const recorded = await service.update({
    backup: {
      lastBackupAt: '2026-11-02T14:30:00',
      lastBackupPath: 'D:/backups/study-coach-backup-2026-11-02-1430',
      lastBackupOutcome: 'ok'
    }
  });
  expect(recorded.backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:00',
    lastBackupPath: 'D:/backups/study-coach-backup-2026-11-02-1430',
    lastBackupOutcome: 'ok'
  });

  // The page's toggle must not erase the recorded facts.
  const toggled = await service.update({ backup: { ageLineEnabled: true } });
  expect(toggled.backup).toEqual({
    ageLineEnabled: true,
    lastBackupAt: '2026-11-02T14:30:00',
    lastBackupPath: 'D:/backups/study-coach-backup-2026-11-02-1430',
    lastBackupOutcome: 'ok'
  });

  // And a later export write must not erase the toggle. A failure writes only
  // the outcome, so the previous success's time and path survive.
  const failed = await service.update({ backup: { lastBackupOutcome: 'failed' } });
  expect(failed.backup).toEqual({
    ageLineEnabled: true,
    lastBackupAt: '2026-11-02T14:30:00',
    lastBackupPath: 'D:/backups/study-coach-backup-2026-11-02-1430',
    lastBackupOutcome: 'failed'
  });
  // Round-trips through the state document.
  expect(await service.get()).toEqual(failed);
});

test('a malformed stored backup block is dropped key-by-key on read', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: {
        ...defaults,
        backup: {
          ageLineEnabled: 'yes',
          lastBackupAt: '2026-02-30T14:30:00',
          lastBackupPath: 'nope',
          lastBackupOutcome: 'cancelled'
        } as never
      }
    })
  });
  const service = new SettingsService(state);
  // Nothing valid survives, so the whole block reads as absent.
  expect((await service.get()).backup).toBeUndefined();

  // A partly valid block keeps only its valid keys.
  const mixed = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: {
        ...defaults,
        backup: { lastBackupAt: '2026-11-02T14:30:00', lastBackupPath: 7 } as never
      }
    })
  });
  const mixedService = new SettingsService(mixed);
  expect((await mixedService.get()).backup).toEqual({
    lastBackupAt: '2026-11-02T14:30:00'
  });
});

// --- the P1 auto-backup keys ---------------------------------------------------

test('auto-backup keys serialize only when valid, off is never written', async () => {
  const { service } = memorySettings();
  // 默认关: enabling is the only serialized state of the switch.
  const on = await service.update({ backup: { autoEnabled: true, autoBackupAsked: true } });
  expect(on.backup).toEqual({ autoEnabled: true, autoBackupAsked: true });

  // 「暂不」 leaves autoEnabled absent; the asked flag alone serializes.
  const declined = await service.update({ backup: { autoEnabled: false } });
  expect(declined.backup).toEqual({ autoBackupAsked: true });

  // The interval serializes only as 1|7|30; anything else reads as the default.
  const withInterval = await service.update({ backup: { autoIntervalDays: 30 } });
  expect(withInterval.backup).toMatchObject({ autoIntervalDays: 30 });
});

test('autoDestination must be absolute to enter settings; empty string clears it', async () => {
  const { service } = memorySettings();
  const saved = await service.update({ backup: { autoDestination: 'D:/backups' } });
  expect(saved.backup).toEqual({ autoDestination: 'D:/backups' });

  const cleared = await service.update({ backup: { autoDestination: '' } });
  expect(cleared.backup).toBeUndefined();

  await expect(
    service.update({ backup: { autoDestination: 'relative/path' } })
  ).rejects.toThrow('自动备份目录必须是绝对路径。');
});

test('the auto-backup patch rejects wrong shapes without half-writing', async () => {
  const { service } = memorySettings();
  await service.update({ backup: { autoEnabled: true, autoDestination: 'D:/backups' } });
  await expect(
    service.update({ backup: { autoEnabled: 'on' } as never })
  ).rejects.toThrow('自动备份开关必须是布尔值。');
  await expect(
    service.update({ backup: { autoBackupAsked: 1 } as never })
  ).rejects.toThrow('自动备份询问状态必须是布尔值。');
  await expect(
    service.update({ backup: { autoIntervalDays: 5 } as never })
  ).rejects.toThrow('自动备份间隔必须是 1、7 或 30 天。');
  await expect(
    service.update({ backup: { autoDestination: 42 } as never })
  ).rejects.toThrow('自动备份目录必须是绝对路径。');
  // Nothing was half-written.
  expect((await service.get()).backup).toEqual({
    autoEnabled: true,
    autoDestination: 'D:/backups'
  });
});

test('lastBackupError persists, clears on an empty patch, and reads as one trimmed line', async () => {
  const { service } = memorySettings();
  const failed = await service.update({
    backup: { lastBackupOutcome: 'failed', lastBackupError: '  磁盘空间不足  ' }
  });
  // Trimmed on the way in: the three-layer copy quotes it verbatim.
  expect(failed.backup).toEqual({
    lastBackupOutcome: 'failed',
    lastBackupError: '磁盘空间不足'
  });

  // The weekly review's clear is an empty patch value.
  const cleared = await service.update({ backup: { lastBackupError: '' } });
  expect(cleared.backup).toEqual({ lastBackupOutcome: 'failed' });

  await expect(
    service.update({ backup: { lastBackupError: '两行\n原因' } })
  ).rejects.toThrow('备份失败原因不能包含换行。');
  await expect(
    service.update({ backup: { lastBackupError: 7 } as never })
  ).rejects.toThrow('备份失败原因必须是文本。');
});

test('a junk stored auto-backup key is dropped on read, key by key', async () => {
  const defaults = createDefaultSettings('/tmp/old-vault');
  const state = new JsonStateStore({
    filePath: null,
    createDefault: () => ({
      onboarded: true,
      settings: {
        ...defaults,
        backup: {
          autoEnabled: 'yes',
          autoBackupAsked: 'no',
          autoIntervalDays: 5,
          autoDestination: 'nope',
          lastBackupError: '两行\n原因',
          lastBackupAt: '2026-11-02T14:30:00'
        } as never
      }
    })
  });
  const service = new SettingsService(state);
  // Only the valid keys survive.
  expect((await service.get()).backup).toEqual({ lastBackupAt: '2026-11-02T14:30:00' });
});

test('a file written before P1 round-trips byte-identically with the new keys', async () => {
  const dir = await tempDir();
  try {
    const filePath = join(dir, 'state.json');
    const defaults = createDefaultSettings('/tmp/legacy-vault');
    const legacy = `${JSON.stringify(
      { onboarded: true, settings: { ...defaults, backup: { ageLineEnabled: true } } },
      null,
      2
    )}\n`;
    await writeFile(filePath, legacy, 'utf8');
    const store = new JsonStateStore({
      filePath,
      createDefault: () => createDefaultAppState('/tmp/ignored')
    });
    const service = new SettingsService(store);

    // A read and an unrelated save introduce none of the P1 keys.
    expect((await service.get()).backup).toEqual({ ageLineEnabled: true });
    await service.update({ notifications: { morning: '07:15' } as never });
    const after = await readFile(filePath, 'utf8');
    expect(after).toBe(legacy.replace('"morning": "08:00"', '"morning": "07:15"'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
