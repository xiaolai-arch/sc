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
  get_today_plan: '读取今日计划',
  write_note: '写入笔记',
  update_task: '更新任务',
  get_memory: '读取记忆'
};

export function butlerToolLabel(name: string): string {
  return BUTLER_TOOL_LABELS[name] ?? name;
}
