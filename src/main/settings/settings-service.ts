import {
  MAX_ACCOUNTABILITY_NAME,
  type AppSettings,
  type LocalCliEffort,
  type NotificationSettings,
  type ProviderConfig
} from '../../shared/types';
import type { SettingsPatch } from '../../shared/ipc';
import type { AppState, JsonStateStore } from '../state-store';
import { createDefaultSettings } from './defaults';

const PROVIDER_KINDS = ['anthropic', 'openai-compatible', 'ollama', 'local-cli'] as const;
const LOCAL_CLI_AGENTS = ['codex', 'claude', 'zcode', 'opencode'] as const;
const LOCAL_CLI_EFFORTS = ['low', 'medium', 'high'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_NOTIFICATIONS = createDefaultSettings('').notifications;

/**
 * State files written before the weekly recap existed lack these keys. Fill
 * them on read and before every merge so callers never see a partial object.
 */
function normalizeNotifications(value: NotificationSettings | undefined): NotificationSettings {
  const current = value ?? DEFAULT_NOTIFICATIONS;
  return {
    ...DEFAULT_NOTIFICATIONS,
    ...current,
    weekly:
      typeof current.weekly === 'string' && TIME_PATTERN.test(current.weekly)
        ? current.weekly
        : DEFAULT_NOTIFICATIONS.weekly,
    weeklyEnabled:
      typeof current.weeklyEnabled === 'boolean'
        ? current.weeklyEnabled
        : DEFAULT_NOTIFICATIONS.weeklyEnabled,
    behindSchedule:
      typeof current.behindSchedule === 'string' && TIME_PATTERN.test(current.behindSchedule)
        ? current.behindSchedule
        : DEFAULT_NOTIFICATIONS.behindSchedule,
    behindScheduleEnabled:
      typeof current.behindScheduleEnabled === 'boolean'
        ? current.behindScheduleEnabled
        : DEFAULT_NOTIFICATIONS.behindScheduleEnabled
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const displayName =
    typeof settings.displayName === 'string' && settings.displayName.trim().length > 0
      ? settings.displayName.trim()
      : createDefaultSettings('').displayName;
  // `strictMastery` is opt-in, so it is only carried (and later serialized)
  // when literally true. Absent, false or a junk value all mean the default.
  const { strictMastery, accountabilityName, ...rest } = settings;
  // The accountability name is local-only and off by default: only a valid,
  // non-empty name is carried, so a settings file written before this feature
  // (or after a clear) round-trips byte-identically.
  const carriedName = normalizeAccountabilityName(accountabilityName);
  return {
    ...rest,
    displayName,
    ...(strictMastery === true ? { strictMastery: true } : {}),
    ...(carriedName ? { accountabilityName: carriedName } : {}),
    notifications: normalizeNotifications(settings.notifications)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const NEWLINE_PATTERN = /[\r\n]/;

/**
 * Tolerant read of a stored accountability name: trimmed, single-line and at
 * most `MAX_ACCOUNTABILITY_NAME` chars. Anything else reads as absent, so one
 * hand edit in `state.json` cannot put a multi-line name into a reminder.
 */
function normalizeAccountabilityName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.trim();
  if (name === '' || NEWLINE_PATTERN.test(name)) return undefined;
  if ([...name].length > MAX_ACCOUNTABILITY_NAME) return undefined;
  return name;
}

/**
 * Validates an accountability-name patch. An empty value turns the feature
 * off; a non-empty one must be single-line and within the character limit.
 */
function validateAccountabilityName(value: unknown): string | undefined {
  if (typeof value !== 'string') throw new Error('问责对象必须是文本。');
  const name = value.trim();
  if (name === '') return undefined;
  if (NEWLINE_PATTERN.test(name)) throw new Error('问责对象不能包含换行。');
  if ([...name].length > MAX_ACCOUNTABILITY_NAME) {
    throw new Error(`问责对象不能超过 ${MAX_ACCOUNTABILITY_NAME} 字。`);
  }
  return name;
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label}不能为空。`);
  }
  return value.trim();
}

function validateProvider(value: unknown): ProviderConfig {
  if (!isRecord(value)) throw new Error('模型 provider 格式无效。');
  const kind = value.kind;
  if (typeof kind !== 'string' || !(PROVIDER_KINDS as readonly string[]).includes(kind)) {
    throw new Error('模型 provider 类型无效。');
  }
  if (kind === 'local-cli') {
    const agent = value.agent;
    if (
      typeof agent !== 'string' ||
      !(LOCAL_CLI_AGENTS as readonly string[]).includes(agent)
    ) {
      throw new Error('本地 CLI agent 无效。');
    }
    const command =
      typeof value.command === 'string' && value.command.trim().length > 0
        ? value.command.trim()
        : undefined;
    const model =
      typeof value.model === 'string' && value.model.trim().length > 0
        ? value.model.trim()
        : undefined;
    let effort: LocalCliEffort | undefined;
    if (value.effort !== undefined) {
      if (
        typeof value.effort !== 'string' ||
        !(LOCAL_CLI_EFFORTS as readonly string[]).includes(value.effort)
      ) {
        throw new Error('推理强度无效。');
      }
      effort = value.effort as LocalCliEffort;
    }
    return {
      kind: 'local-cli',
      agent: agent as (typeof LOCAL_CLI_AGENTS)[number],
      ...(command ? { command } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(value.isolate === true ? { isolate: true } : {}),
      ...(value.nativeTools === true ? { nativeTools: true } : {})
    };
  }
  const model = nonEmptyString(value.model, '模型名称');
  if (kind === 'anthropic') {
    return { kind, model };
  }
  const baseURL = nonEmptyString(value.baseURL, 'Base URL');
  return { kind: kind as 'openai-compatible' | 'ollama', baseURL, model };
}

function validateNotifications(value: unknown): Partial<NotificationSettings> {
  if (!isRecord(value)) throw new Error('通知设置格式无效。');
  const result: Partial<NotificationSettings> = {};
  if (value.enabled !== undefined) {
    if (typeof value.enabled !== 'boolean') throw new Error('通知开关必须是布尔值。');
    result.enabled = value.enabled;
  }
  for (const key of ['morning', 'evening', 'weekly', 'behindSchedule', 'dndStart', 'dndEnd'] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'string' || !TIME_PATTERN.test(entry)) {
      throw new Error('提醒时间格式必须为 HH:MM。');
    }
    result[key] = entry;
  }
  if (value.weeklyEnabled !== undefined) {
    if (typeof value.weeklyEnabled !== 'boolean') {
      throw new Error('周日复盘开关必须是布尔值。');
    }
    result.weeklyEnabled = value.weeklyEnabled;
  }
  if (value.behindScheduleEnabled !== undefined) {
    if (typeof value.behindScheduleEnabled !== 'boolean') {
      throw new Error('落后提醒开关必须是布尔值。');
    }
    result.behindScheduleEnabled = value.behindScheduleEnabled;
  }
  if (value.snoozedUntil !== undefined) {
    if (typeof value.snoozedUntil !== 'string') {
      throw new Error('静音日期格式无效。');
    }
    const trimmed = value.snoozedUntil.trim();
    if (trimmed !== '' && !DATE_PATTERN.test(trimmed)) {
      throw new Error('静音日期格式必须为 YYYY-MM-DD。');
    }
    result.snoozedUntil = trimmed;
  }
  return result;
}

function validateBudget(value: unknown): AppSettings['budget'] | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error('预算设置格式无效。');
  const result: Partial<AppSettings['budget']> = {};
  for (const key of ['proactiveSessionsPerDay', 'dailyTokens'] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'number' || !Number.isInteger(entry) || entry < 0) {
      throw new Error('预算数值必须是非负整数。');
    }
    result[key] = entry;
  }
  for (const key of ['inputPricePerMillion', 'outputPricePerMillion'] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    if (typeof entry !== 'number' || !Number.isFinite(entry) || entry < 0) {
      throw new Error('单价必须是非负数字。');
    }
    result[key] = entry;
  }
  return result as AppSettings['budget'];
}

function mergeSettings(current: AppSettings, patch: unknown): AppSettings {
  if (!isRecord(patch)) throw new Error('设置参数无效。');
  const next: AppSettings = {
    displayName:
      patch.displayName === undefined
        ? current.displayName
        : nonEmptyString(patch.displayName, '称呼'),
    vaultPath: patch.vaultPath === undefined ? current.vaultPath : nonEmptyString(patch.vaultPath, 'Vault 路径'),
    provider: patch.provider === undefined ? current.provider : validateProvider(patch.provider),
    notifications: {
      ...current.notifications,
      ...(patch.notifications === undefined ? {} : validateNotifications(patch.notifications))
    },
    budget: {
      ...current.budget,
      ...(validateBudget(patch.budget) ?? {})
    },
    launchAtLogin:
      patch.launchAtLogin === undefined ? current.launchAtLogin : validateBoolean(patch.launchAtLogin)
  };
  // Only `true` is stored; turning it off removes the key so a file written
  // without the setting round-trips byte-identically.
  const strictMastery =
    patch.strictMastery === undefined
      ? current.strictMastery
      : validateStrictMastery(patch.strictMastery);
  const withStrictMastery =
    strictMastery === true ? { ...next, strictMastery: true } : next;
  // The accountability name is stored only when non-empty, so an empty patch
  // clears it (and the key) rather than writing a blank string.
  const accountabilityName =
    patch.accountabilityName === undefined
      ? current.accountabilityName
      : validateAccountabilityName(patch.accountabilityName);
  return accountabilityName === undefined
    ? withStrictMastery
    : { ...withStrictMastery, accountabilityName };
}

function validateBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('启动设置必须是布尔值。');
  return value;
}

function validateStrictMastery(value: unknown): boolean | undefined {
  if (typeof value !== 'boolean') throw new Error('严格掌握设置必须是布尔值。');
  return value ? true : undefined;
}

/**
 * Reads and mutates the persisted settings document. The API key is stored
 * separately through a SecretStore and is never part of AppSettings.
 */
export class SettingsService {
  private readonly state: JsonStateStore;

  constructor(state: JsonStateStore) {
    this.state = state;
  }

  async get(): Promise<AppSettings> {
    const snapshot = await this.state.read();
    return structuredClone(normalizeSettings(snapshot.settings));
  }

  async update(patch: SettingsPatch): Promise<AppSettings> {
    const next = await this.state.update((current: AppState) => ({
      ...current,
      settings: mergeSettings(normalizeSettings(current.settings), patch)
    }));
    return structuredClone(normalizeSettings(next.settings));
  }
}
