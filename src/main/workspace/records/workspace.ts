import type { NoteMeta } from '../../../shared/types';
import type { Workspace, WorkspaceKind } from '../../../shared/workspace';
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
    goal: asString(meta.goal) ?? '',
    description: asString(meta.description) ?? '',
    checkIn: meta.checkIn === 'off' ? 'off' : 'daily',
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
    goal: workspace.goal,
    description: workspace.description,
    checkIn: workspace.checkIn ?? 'daily',
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
