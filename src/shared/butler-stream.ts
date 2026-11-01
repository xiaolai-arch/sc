import type { SendMessageInput, SendMessageResult } from './workspace';

export type ButlerStreamEvent =
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

export const BUTLER_TOOL_LABELS: Record<string, string> = {
  create_workspace: '创建项目',
  create_task: '创建任务',
  set_reminder: '设置提醒',
  save_review: '保存复盘',
  plan_workspace: '生成计划',
  update_workspace: '更新项目',
  get_today_plan: '读取今日计划',
  write_note: '写入笔记',
  update_task: '更新任务',
  get_memory: '读取记忆'
};

export function butlerToolLabel(name: string): string {
  return BUTLER_TOOL_LABELS[name] ?? name;
}
