import type { NoteMeta } from '../../../shared/types';
import {
  REMINDER_STATES,
  type Reminder,
  type ReminderState
} from '../../../shared/workspace';
import { isLocalDateTime } from '../../../shared/date';
import { parseNote, serializeNote } from '../../vault/note';
import { asBoolean, asRecord, asString } from './coerce';

/**
 * YAML 1.1 reads a bare `21:30` as a sexagesimal number (1290), so hand-edited
 * reminder files are coerced back to HH:MM. Serialized values are always quoted.
 */
function coerceTime(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    const hours = Math.floor(value / 60);
    const minutes = Math.round(value % 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  return '';
}

function coerceDays(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const days = [...new Set(value)]
    .filter((day): day is number => typeof day === 'number' && Number.isInteger(day))
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  return days.length > 0 ? days : undefined;
}

/**
 * Legacy `reminders.md` files carry no state field. Leaving it absent lets
 * `reminderState()` / the page read a legacy reminder as `pending` without
 * inventing data in the file; a later real transition writes the field.
 */
function coerceState(value: unknown): ReminderState | undefined {
  return typeof value === 'string' && (REMINDER_STATES as readonly string[]).includes(value)
    ? (value as ReminderState)
    : undefined;
}

function coerceTimestamp(value: unknown): string | undefined {
  const text = asString(value);
  if (!text) return undefined;
  // Hand-edited or YAML-coerced values must round-trip as an ISO timestamp.
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? undefined : text;
}

function coerceLocalDateTime(value: unknown): string | undefined {
  const text = asString(value);
  return text && isLocalDateTime(text) ? text : undefined;
}

/**
 * `doneAt` is a local calendar day, not a timestamp. A hand-edited bad value
 * drops the field rather than failing the whole reminder, so an old file with
 * no `doneAt` still round-trips byte-identically (the key is only written when
 * a real completion day exists).
 */
function coerceDoneAt(value: unknown): string | undefined {
  const text = asString(value)?.trim();
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return text;
}

export function parseRemindersFile(raw: string): Reminder[] {
  const { meta } = parseNote(raw);
  if (!Array.isArray(meta.items)) return [];
  const reminders: Reminder[] = [];
  for (const value of meta.items) {
    const record = asRecord(value);
    if (record === null) continue;
    const id = asString(record.id);
    const label = asString(record.label);
    if (!id || !label) continue;
    const days = coerceDays(record.days);
    const state = coerceState(record.state);
    const firedAt = coerceTimestamp(record.firedAt);
    const postponedTo = coerceLocalDateTime(record.postponedTo);
    const doneAt = coerceDoneAt(record.doneAt);
    const lastError = asString(record.lastError);
    reminders.push({
      id,
      time: coerceTime(record.time),
      label,
      enabled: asBoolean(record.enabled, true),
      ...(days ? { days } : {}),
      ...(state ? { state } : {}),
      ...(firedAt ? { firedAt } : {}),
      ...(postponedTo ? { postponedTo } : {}),
      ...(doneAt ? { doneAt } : {}),
      ...(lastError ? { lastError } : {})
    });
  }
  return reminders;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function serializeRemindersFile(reminders: readonly Reminder[]): string {
  const meta: NoteMeta = {
    type: 'plan',
    source: 'user',
    items: reminders.map((reminder) => ({ ...reminder }))
  };
  const lines = reminders.map((reminder) => {
    const repeat =
      reminder.days && reminder.days.length > 0
        ? `（${reminder.days.map((day) => WEEKDAY_LABELS[day] ?? '').join('、')}）`
        : '';
    return `- ${reminder.time} ${reminder.label}${repeat}${reminder.enabled ? '' : '（已关闭）'}`;
  });
  const body = ['# 提醒', '', ...lines, ''].join('\n');
  return serializeNote(meta, body);
}
