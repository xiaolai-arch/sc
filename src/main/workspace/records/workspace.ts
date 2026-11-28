import type { NoteMeta } from '../../../shared/types';
import {
  MAX_DAILY_AVAILABLE_MINUTES,
  MIN_DAILY_AVAILABLE_MINUTES,
  isExamPhase,
  isTargetDate,
  type Workspace,
  type WorkspaceKind
} from '../../../shared/workspace';
import { parseNote, serializeNote } from '../../vault/note';
import { asRecord, asString } from './coerce';

const KINDS: readonly WorkspaceKind[] = ['exam', 'study', 'project', 'life'];

const KIND_LABELS: Record<WorkspaceKind, string> = {
  exam: '备考',
  study: '学习',
  project: '项目',
  life: '生活'
};

export const DEFAULT_COLORS: Record<WorkspaceKind, string> = {
  exam: '#0071e3',
  study: '#34c759',
  project: '#ff9f0a',
  life: '#a13ff6'
};

export function isWorkspaceKind(value: unknown): value is WorkspaceKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

export function parseWorkspaceFile(raw: string, workspaceId: string): Workspace | null {
  const { meta } = parseNote(raw);
  const name = asString(meta.name);
  if (!name) return null;
  const kind = isWorkspaceKind(meta.kind) ? meta.kind : 'study';
  return {
    id: workspaceId,
    name,
    kind,
    color: asString(meta.color) ?? DEFAULT_COLORS[kind],
    ...(asString(meta.goalId) ? { goalId: asString(meta.goalId) } : {}),
    goal: asString(meta.goal) ?? '',
    description: asString(meta.description) ?? '',
    checkIn: meta.checkIn === 'off' ? 'off' : 'daily',
    ...(typeof meta.availableMinutes === 'number' &&
    Number.isFinite(meta.availableMinutes) &&
    Math.round(meta.availableMinutes) >= MIN_DAILY_AVAILABLE_MINUTES &&
    Math.round(meta.availableMinutes) <= MAX_DAILY_AVAILABLE_MINUTES
      ? { availableMinutes: Math.round(meta.availableMinutes) }
      : {}),
    ...(isTargetDate(meta.targetDate) ? { targetDate: meta.targetDate } : {}),
    // A phase outside the three labels (or a hand-edited file) reads as unset;
    // an unreadable asked-on date is dropped the same way.
    ...(isExamPhase(meta.phase) ? { phase: meta.phase } : {}),
    ...(isTargetDate(meta.phaseAskedAt) ? { phaseAskedAt: meta.phaseAskedAt } : {}),
    createdAt: asString(meta.createdAt),
    updatedAt: asString(meta.updatedAt)
  };
}

export function serializeWorkspaceFile(workspace: Workspace): string {
  const meta: NoteMeta = {
    type: 'profile',
    source: 'user',
    id: workspace.id,
    name: workspace.name,
    kind: workspace.kind,
    color: workspace.color,
    ...(workspace.goalId !== undefined ? { goalId: workspace.goalId } : {}),
    goal: workspace.goal,
    description: workspace.description,
    checkIn: workspace.checkIn ?? 'daily',
    ...(workspace.availableMinutes !== undefined
      ? { availableMinutes: workspace.availableMinutes }
      : {}),
    ...(workspace.targetDate !== undefined ? { targetDate: workspace.targetDate } : {}),
    ...(workspace.phase !== undefined ? { phase: workspace.phase } : {}),
    ...(workspace.phaseAskedAt !== undefined
      ? { phaseAskedAt: workspace.phaseAskedAt }
      : {}),
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt
  };
  const body = [
    `# ${workspace.name}`,
    '',
    `- 类型：${KIND_LABELS[workspace.kind]}`,
    `- 目标：${workspace.goal}`,
    `- 说明：${workspace.description}`,
    ''
  ].join('\n');
  return serializeNote(meta, body);
}
