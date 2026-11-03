import type { NoteMeta } from '../../../shared/types';
import type { Reminder } from '../../../shared/workspace';
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
    reminders.push({
      id,
      time: coerceTime(record.time),
      label,
      enabled: asBoolean(record.enabled, true),
      ...(days ? { days } : {})
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
