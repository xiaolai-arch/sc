import type { ButlerReference } from '../../shared/butler-stream';
import type { MessageAttachment } from '../../shared/attachments';

export type ChatStep = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
};

export type ChatTraceItem =
  | {
      kind: 'reasoning';
      id: string;
      text: string;
      streaming?: boolean;
      /** Absolute clock, so the elapsed time survives page navigation. */
      startedAt?: number;
      endedAt?: number;
    }
  | {
      kind: 'tool';
      id: string;
      name: string;
      label: string;
      status: 'running' | 'done' | 'failed';
      detail?: string;
    };

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Ordered thinking/tool rows rendered above the answer. */
  trace?: ChatTraceItem[];
  /** Records this answer drew on, shown as "本次参考" under the text. */
  references?: ButlerReference[];
  /** Files the user attached to this turn. */
  attachments?: MessageAttachment[];
  /** Legacy fields kept for compatibility; the UI renders `trace` instead. */
  reasoning?: string;
  steps?: ChatStep[];
  streaming?: boolean;
  /** Shown under the text, e.g. why a restored run is no longer generating. */
  notice?: string;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
};
