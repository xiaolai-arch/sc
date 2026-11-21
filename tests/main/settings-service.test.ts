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
