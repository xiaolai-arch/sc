export type ShellView = 'chat' | 'today' | 'notes' | 'learn' | 'review' | 'settings';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};
