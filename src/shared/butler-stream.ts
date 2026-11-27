import type { SendMessageInput, SendMessageResult } from './workspace';

/**
 * One record the current answer actually drew on. Shown as "本次参考" so the
 * user can open the original instead of trusting the reply blindly.
 */
export interface ButlerReference {
  /** Record id: profile entry id, task id, note id, plan id, topic id. */
  id: string;
  kind:
    | 'profile'
    | 'workspace'
    | 'note'
    | 'task'
    | 'memory'
    | 'plan'
    | 'review'
    | 'knowledge-topic'
    | 'practice-set'
    | 'practice-question'
    | 'practice-mistake';
  title: string;
  /** Short excerpt or provenance note (profile category, snippet). */
  detail?: string;
  workspaceId?: string;
  /** Vault-relative path when the record came from a file. */
  path?: string;
}

export type ButlerStreamEvent =
  | { type: 'references'; items: ButlerReference[] }
  | { type: 'reasoning'; text: string }
  | { type: 'narration'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-start'; id: string; name: string; label: string }
  | {
      type: 'tool-result';
      id: string;
      name: string;
      ok: boolean;
      label: string;
      detail?: string;
    }
  | { type: 'retry'; attempt: number; message: string }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      text: string;
      usage?: { inputTokens: number; outputTokens: number };
      canceled?: boolean;
    };

export type ButlerStreamListener = (event: ButlerStreamEvent) => void;

/** Structural capability: mock and future main-process APIs may implement it. */
export interface StreamingButlerApi {
  stream(
    input: SendMessageInput,
    onEvent: ButlerStreamListener
  ): Promise<SendMessageResult>;
}

export const BUTLER_REFERENCE_LABELS: Record<ButlerReference['kind'], string> = {
  profile: '个人档案',
  workspace: '项目',
  note: '笔记',
  task: '任务',
  memory: '记忆',
  plan: '计划',
  review: '复盘',
  'knowledge-topic': '知识主题',
  'practice-set': '练习',
  'practice-question': '练习题',
  'practice-mistake': '错题'
};

export const BUTLER_TOOL_LABELS: Record<string, string> = {
  create_workspace: '创建项目',
  create_task: '创建任务',
  set_reminder: '设置提醒',
  save_review: '保存复盘',
  plan_workspace: '生成计划',
  create_long_plan: '生成长期计划',
  update_workspace: '更新项目',
  get_today_plan: '读取今日计划',
  write_note: '写入笔记',
  update_task: '更新任务',
  get_memory: '读取记忆',
  record_knowledge: '记录知识',
  save_profile: '记录个人信息',
  record_commitment: '记下承诺',
  resolve_commitment: '结掉承诺',
  set_week_availability: '记录周可用性'
};

export function butlerToolLabel(name: string): string {
  return BUTLER_TOOL_LABELS[name] ?? name;
}
