import type { KnowledgeStatus } from '../../shared/knowledge';
import type { Workspace } from '../../shared/workspace';

export const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  planned: '计划中',
  learning: '在学',
  mastered: '已掌握',
  paused: '暂停'
};

export const STATUS_ORDER: KnowledgeStatus[] = ['planned', 'learning', 'mastered', 'paused'];

export const STATUS_DOT_CLASS: Record<KnowledgeStatus, string> = {
  planned: 'bg-gray-400 dark:bg-[#8e8e93]',
  learning: 'bg-[#0071e3]',
  mastered: 'bg-[#34c759]',
  paused: 'bg-[#ff9f0a]'
};

export function evidenceDate(date: string): string {
  const [, month, day] = date.split('-');
  if (!month || !day) return date;
  return `${Number(month)}/${Number(day)}`;
}

export function workspaceName(workspaces: Workspace[], workspaceId: string | undefined): string {
  if (!workspaceId) return '全局';
  return workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? workspaceId;
}
