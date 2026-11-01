export type ChatStep = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
};

export type ChatTraceItem =
  | { kind: 'reasoning'; id: string; text: string; streaming?: boolean }
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
  /** Legacy fields kept for compatibility; the UI renders `trace` instead. */
  reasoning?: string;
  steps?: ChatStep[];
  streaming?: boolean;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
};
