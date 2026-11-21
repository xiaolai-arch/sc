import type { ButlerReference } from './butler-stream';
import type { AgentPermissions, MessageAttachment } from './attachments';

export type ConversationKind = 'chat' | 'check-in';
export type CheckInTrigger = 'morning' | 'evening' | 'weekly' | 'behind' | 'custom';

/**
 * Virtual workspace for cross-workspace chats (daily planning and check-ins).
 * It is never written to the vault; the butler receives no workspaceId for it.
 */
export const DAILY_WORKSPACE_ID = '__daily__';

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
  /** Records the answer used, persisted so reloads keep the same evidence. */
  references?: ButlerReference[];
  /** Files the user attached to this turn, kept for the bubble's file chips. */
  attachments?: MessageAttachment[];
  source?: 'user' | 'butler' | 'check-in';
  /** Present on check-in assistant messages; used for durable dedupe/budget. */
  trigger?: CheckInTrigger;
};

export type Conversation = {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  /** Pinned conversations sort ahead of recent ones and survive restarts. */
  pinned?: boolean;
  /** Per-conversation model override; absent follows the global provider. */
  model?: string;
  /** Agent capabilities chosen for this conversation; absent uses defaults. */
  permissions?: AgentPermissions;
  /** Rolling summary of messages before `summaryCount`. */
  summary?: string;
  /** Number of leading messages covered by `summary`. */
  summaryCount?: number;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  kind: ConversationKind;
  workspaceId?: string;
  pinned?: boolean;
  updatedAt: string;
  preview: string;
};

export type CreateConversationInput = {
  title?: string;
  kind?: ConversationKind;
  workspaceId?: string;
  /** Permissions to remember with a conversation created from a draft. */
  permissions?: AgentPermissions;
};
