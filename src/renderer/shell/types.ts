export type ShellView = 'chat' | 'plan' | 'notes' | 'learn' | 'review' | 'settings';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};
