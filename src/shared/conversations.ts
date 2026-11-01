export type ConversationKind = 'chat' | 'check-in';
export type CheckInTrigger = 'morning' | 'evening' | 'custom';

export type ConversationStep = {
  id: string;
  name: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  detail?: string;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  steps?: ConversationStep[];
  source?: 'user' | 'butler' | 'check-in';
  /** Present on check-in assistant messages; used for durable dedupe/budget. */
  trigger?: CheckInTrigger;
};

export type Conversation = {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  updatedAt: string;
  preview: string;
};

export type CreateConversationInput = {
  title?: string;
  kind?: ConversationKind;
  workspaceId?: string;
};
