import { isAbsolute } from 'node:path';
import {
  MAX_ACCOUNTABILITY_NAME,
  type AppSettings,
  type BackupSettings,
  type LocalCliEffort,
  type NotificationSettings,
  type ProviderConfig
} from '../../shared/types';
import { isLocalDateTimeSeconds } from '../../shared/date';
import type { SettingsPatch } from '../../shared/ipc';
import type { AppState, JsonStateStore } from '../state-store';
import { createDefaultSettings } from './defaults';

const PROVIDER_KINDS = ['anthropic', 'openai-compatible', 'ollama', 'local-cli'] as const;
const LOCAL_CLI_AGENTS = ['codex', 'claude', 'zcode', 'opencode'] as const;
const LOCAL_CLI_EFFORTS = ['low', 'medium', 'high'] as const;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const AUTO_INTERVAL_DAYS = [1, 7, 30] as const;
/** Caps the stored failure reason so one junk write cannot bloat settings. */
const MAX_BACKUP_ERROR_LENGTH = 200;
const DEFAULT_NOTIFICATIONS = createDefaultSettings('').notifications;

/**
 * State files written before the weekly recap existed lack these keys. Fill
 * them on read and before every merge so callers never see a partial object.
 */
function normalizeNotifications(value: NotificationSettings | undefined): NotificationSettings {
  const current = value ?? DEFAULT_NOTIFICATIONS;
  // `resumedFrom` exists only while a mute resume is pending. An empty or
  // malformed value is dropped rather than carried, so a settings file written
  // before this feature round-trips byte-identically. `resumedFromMuteEnd`
  // shares that lifetime: it is meaningful only beside a pending resume, so a
  // stray copy is dropped too rather than becoming a future fake sentence.
  const resumedFrom =
    typeof current.resumedFrom === 'string' && DATE_PATTERN.test(current.resumedFrom)
      ? current.resumedFrom
      : undefined;
  const resumedFromMuteEnd =
    typeof current.resumedFromMuteEnd === 'string' &&
    DATE_PATTERN.test(current.resumedFromMuteEnd)
      ? current.resumedFromMuteEnd
      : undefined;
  const { resumedFrom: _ignoredResumedFrom, resumedFromMuteEnd: _ignoredMuteEnd, ...rest } =
    current;
  return {
    ...DEFAULT_NOTIFICATIONS,
    ...rest,
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
        : DEFAULT_NOTIFICATIONS.behindScheduleEnabled,
    ...(resumedFrom ? { resumedFrom } : {}),
    ...(resumedFrom && resumedFromMuteEnd ? { resumedFromMuteEnd } : {})
  };
}

function normalizeSettings(settings: AppSettings): AppSettings {
  const displayName =
    typeof settings.displayName === 'string' && settings.displayName.trim().length > 0
      ? settings.displayName.trim()
      : createDefaultSettings('').displayName;
  // `strictMastery` is opt-in, so it is only carried (and later serialized)
  // when literally true. Absent, false or a junk value all mean the default.
  const { strictMastery, accountabilityName, backup, ...rest } = settings;
  // The accountability name is local-only and off by default: only a valid,
  // non-empty name is carried, so a settings file written before this feature
  // (or after a clear) round-trips byte-identically.
  const carriedName = normalizeAccountabilityName(accountabilityName);
  // The backup block is absent until the first export records a fact (or the
  // user opts into the weekly-review age line); junk keys are dropped one by
  // one and an empty result drops the whole block, keeping legacy files'
  // bytes unchanged.
  const carriedBackup = normalizeBackup(backup);
  return {
    ...rest,
    displayName,
    ...(strictMastery === true ? { strictMastery: true } : {}),
    ...(carriedName ? { accountabilityName: carriedName } : {}),
    ...(carriedBackup ? { backup: carriedBackup } : {}),
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
 * Tolerant read of the stored backup block. Every key stands alone: a junk
 * value is dropped rather than carried (a bad date reads as "never backed
 * up"), and a block with no valid key at all is dropped entirely, so a
 * settings file written before this feature round-trips byte-identically.
 *
 * The auto-backup keys follow the same opt-in shape as `ageLineEnabled`:
 * `autoEnabled` and `autoBackupAsked` carry only literal `true`, an interval
 * outside 1|7|30 is dropped (absent reads as the 7-day default), and a
 * relative or non-string destination is dropped so the auto backup simply
 * never runs. The failure reason carries as a trimmed single-line string.
 */
function normalizeBackup(value: unknown): BackupSettings | undefined {
  if (!isRecord(value)) return undefined;
  const backup: BackupSettings = {};
  let carried = 0;
  // The age line is opt-in and only `true` serializes, matching strictMastery.
  if (value.ageLineEnabled === true) {
    backup.ageLineEnabled = true;
    carried += 1;
  }
  // 默认关 is the owner's decision: absent/false/junk all mean off, and off
  // is never serialized — 「暂不」 on the ask writes only autoBackupAsked.
  if (value.autoEnabled === true) {
    backup.autoEnabled = true;
    carried += 1;
  }
  if (value.autoBackupAsked === true) {
    backup.autoBackupAsked = true;
    carried += 1;
  }
  if (
    typeof value.autoIntervalDays === 'number' &&
    (AUTO_INTERVAL_DAYS as readonly number[]).includes(value.autoIntervalDays)
  ) {
    backup.autoIntervalDays = value.autoIntervalDays as BackupSettings['autoIntervalDays'];
    carried += 1;
  }
  if (typeof value.autoDestination === 'string' && isAbsolute(value.autoDestination)) {
    backup.autoDestination = value.autoDestination;
    carried += 1;
  }
  const backupError = normalizeBackupError(value.lastBackupError);
  if (backupError !== undefined) {
    backup.lastBackupError = backupError;
    carried += 1;
  }
  if (isLocalDateTimeSeconds(value.lastBackupAt)) {
    backup.lastBackupAt = value.lastBackupAt;
    carried += 1;
  }
  if (typeof value.lastBackupPath === 'string' && isAbsolute(value.lastBackupPath)) {
    backup.lastBackupPath = value.lastBackupPath;
    carried += 1;
  }
  if (value.lastBackupOutcome === 'ok' || value.lastBackupOutcome === 'failed') {
    backup.lastBackupOutcome = value.lastBackupOutcome;
    carried += 1;
  }
  return carried > 0 ? backup : undefined;
}

/**
 * The stored auto-backup failure reason: trimmed, single-line and capped. An
 * empty, blank or non-string value reads as nothing pending; a line break
 * would break the one-line three-layer copy, so such a value is dropped.
 */
function normalizeBackupError(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const reason = value.trim();
  if (reason === '' || NEWLINE_PATTERN.test(reason)) return undefined;
  return reason.length > MAX_BACKUP_ERROR_LENGTH
    ? reason.slice(0, MAX_BACKUP_ERROR_LENGTH)
    : reason;
}

/**
 * Merges a validated `backup` patch onto the current block, then re-reads the
 * result through `normalizeBackup`: turning the age line off removes that key
 * again, and a block left empty by the merge disappears so a never-backed-up
 * file keeps its bytes.
 */
function mergeBackup(
  current: BackupSettings | undefined,
  patch: Partial<BackupSettings>
): BackupSettings | undefined {
  return normalizeBackup({ ...(current ?? {}), ...patch });
}

/**
 * Validates a `backup` patch. The settings page toggles the age line and the
 * auto-backup switches; the last-backup facts arrive from the export flow and
 * the auto-backup flow (success facts, failure reason). A bad value fails the
 * whole patch with a Chinese error instead of half-writing. `''` clears
 * `autoDestination` and `lastBackupError`, like the mute-date keys.
 */
function validateBackupPatch(value: unknown): Partial<BackupSettings> {
  if (!isRecord(value)) throw new Error('备份设置格式无效。');
  const result: Partial<BackupSettings> = {};
  if (value.ageLineEnabled !== undefined) {
    if (typeof value.ageLineEnabled !== 'boolean') {
      throw new Error('备份年龄行开关必须是布尔值。');
    }
    result.ageLineEnabled = value.ageLineEnabled;
  }
  if (value.autoEnabled !== undefined) {
    if (typeof value.autoEnabled !== 'boolean') {
      throw new Error('自动备份开关必须是布尔值。');
    }
    result.autoEnabled = value.autoEnabled;
  }
  if (value.autoBackupAsked !== undefined) {
    if (typeof value.autoBackupAsked !== 'boolean') {
      throw new Error('自动备份询问状态必须是布尔值。');
    }
    result.autoBackupAsked = value.autoBackupAsked;
  }
  if (value.autoIntervalDays !== undefined) {
    if (
      typeof value.autoIntervalDays !== 'number' ||
      !(AUTO_INTERVAL_DAYS as readonly number[]).includes(value.autoIntervalDays)
    ) {
      throw new Error('自动备份间隔必须是 1、7 或 30 天。');
    }
    result.autoIntervalDays = value.autoIntervalDays as BackupSettings['autoIntervalDays'];
  }
  if (value.autoDestination !== undefined) {
    if (typeof value.autoDestination !== 'string') {
      throw new Error('自动备份目录必须是绝对路径。');
    }
    const trimmed = value.autoDestination.trim();
    // '' is an explicit clear; anything else must be absolute.
    if (trimmed !== '' && !isAbsolute(trimmed)) {
      throw new Error('自动备份目录必须是绝对路径。');
    }
    result.autoDestination = trimmed;
  }
  if (value.lastBackupError !== undefined) {
    if (typeof value.lastBackupError !== 'string') {
      throw new Error('备份失败原因必须是文本。');
    }
    const trimmed = value.lastBackupError.trim();
    if (trimmed !== '' && NEWLINE_PATTERN.test(trimmed)) {
      throw new Error('备份失败原因不能包含换行。');
    }
    result.lastBackupError = trimmed;
  }
  if (value.lastBackupAt !== undefined) {
    if (!isLocalDateTimeSeconds(value.lastBackupAt)) {
      throw new Error('备份时间格式无效。');
    }
    result.lastBackupAt = value.lastBackupAt;
  }
  if (value.lastBackupPath !== undefined) {
    if (typeof value.lastBackupPath !== 'string' || !isAbsolute(value.lastBackupPath)) {
      throw new Error('备份路径必须是绝对路径。');
    }
    result.lastBackupPath = value.lastBackupPath;
  }
  if (value.lastBackupOutcome !== undefined) {
    if (value.lastBackupOutcome !== 'ok' && value.lastBackupOutcome !== 'failed') {
      throw new Error('备份结果无效。');
    }
    result.lastBackupOutcome = value.lastBackupOutcome;
  }
  return result;
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
  if (value.resumedFrom !== undefined) {
    if (typeof value.resumedFrom !== 'string') {
      throw new Error('恢复日期格式无效。');
    }
    const trimmed = value.resumedFrom.trim();
    // '' clears the pending resume; a date must be a real local day.
    if (trimmed !== '' && !DATE_PATTERN.test(trimmed)) {
      throw new Error('恢复日期格式必须为 YYYY-MM-DD。');
    }
    result.resumedFrom = trimmed;
  }
  if (value.resumedFromMuteEnd !== undefined) {
    if (typeof value.resumedFromMuteEnd !== 'string') {
      throw new Error('恢复前静音日期格式无效。');
    }
    const trimmed = value.resumedFromMuteEnd.trim();
    if (trimmed !== '' && !DATE_PATTERN.test(trimmed)) {
      throw new Error('恢复前静音日期格式必须为 YYYY-MM-DD。');
    }
    result.resumedFromMuteEnd = trimmed;
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
  // `resumedFrom` is stored only while a mute resume is pending: an empty
  // patch value clears it (and the key) rather than writing a blank string.
  // `resumedFromMuteEnd` rides with it and is cleared the same way, so the two
  // never drift apart into a stale sentence source.
  const notifications = {
    ...current.notifications,
    ...(patch.notifications === undefined ? {} : validateNotifications(patch.notifications))
  };
  if (notifications.resumedFrom === '') delete notifications.resumedFrom;
  if (notifications.resumedFromMuteEnd === '') delete notifications.resumedFromMuteEnd;
  if (notifications.resumedFrom === undefined) delete notifications.resumedFromMuteEnd;
  const next: AppSettings = {
    displayName:
      patch.displayName === undefined
        ? current.displayName
        : nonEmptyString(patch.displayName, '称呼'),
    vaultPath: patch.vaultPath === undefined ? current.vaultPath : nonEmptyString(patch.vaultPath, 'Vault 路径'),
    provider: patch.provider === undefined ? current.provider : validateProvider(patch.provider),
    notifications,
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
  const withAccountability =
    accountabilityName === undefined
      ? withStrictMastery
      : { ...withStrictMastery, accountabilityName };
  // The backup block merges field-by-field: a patch toggling the age line
  // must not erase the recorded last-backup facts, and a state write from the
  // export flow must not erase the toggle. An empty patch keeps whatever is
  // stored (still normalized), so an absent block stays absent.
  const backup = mergeBackup(
    current.backup,
    patch.backup === undefined ? {} : validateBackupPatch(patch.backup)
  );
  return backup === undefined ? withAccountability : { ...withAccountability, backup };
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
