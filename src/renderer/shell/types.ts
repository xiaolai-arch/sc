export type ShellView = 'today' | 'settings';

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
};
