export type ShellView = 'chat' | 'today' | 'notes' | 'learn' | 'review' | 'settings';

export type ChatStep = {
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
  reasoning?: string;
  steps?: ChatStep[];
  streaming?: boolean;
  reasoningStartedAt?: number;
  reasoningEndedAt?: number;
};
