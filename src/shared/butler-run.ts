import type { ConversationStep } from './conversations';

export type ConversationRunStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'cancelled'
  | 'failed'
  | 'interrupted';

/**
 * A conversation turn that the main process owns. The renderer only mirrors
 * this snapshot: navigating away never cancels it, and after a restart a
 * previously running turn is reported as `interrupted` instead of pretending
 * to still run.
 */
export type ConversationRunSnapshot = {
  runId: string;
  conversationId: string;
  assistantMessageId: string;
  status: ConversationRunStatus;
  /** Last applied event sequence; lets a view resume without applying twice. */
  sequence: number;
  partialText: string;
  reasoningText: string;
  steps: ConversationStep[];
  startedAt: string;
  lastActivityAt: string;
  /** Last transient status line (retry/waiting), already redacted. */
  statusMessage?: string;
  errorReason?: string;
};
