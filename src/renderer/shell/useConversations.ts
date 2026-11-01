import { useCallback, useEffect, useState } from 'react';
import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  CreateConversationInput
} from '../../shared/conversations';
import type { StudyCoachApi } from '../../shared/ipc';

export type ConversationController = {
  summaries: ConversationSummary[];
  active: Conversation | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  startDraft: () => void;
  create: (input?: CreateConversationInput) => Promise<Conversation>;
  append: (id: string, message: ConversationMessage) => Promise<Conversation>;
  remove: (id: string) => Promise<void>;
};

function apiOrThrow(): StudyCoachApi {
  const api = window.studyCoach;
  if (!api) throw new Error('数据服务不可用，请重启应用后重试。');
  return api;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : '对话加载失败，请重试。';
}

export function useConversations(): ConversationController {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const api = apiOrThrow();
      const next = await api.listConversations();
      setSummaries(next);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const select = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const api = apiOrThrow();
      const conversation = await api.getConversation(id);
      setActive(conversation);
      setError(null);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  const startDraft = useCallback(() => {
    setActive(null);
    setError(null);
  }, []);

  const create = useCallback(async (input?: CreateConversationInput) => {
    const api = apiOrThrow();
    const conversation = await api.createConversation(input);
    setActive(conversation);
    await refresh();
    return conversation;
  }, [refresh]);

  const append = useCallback(
    async (id: string, message: ConversationMessage) => {
      const api = apiOrThrow();
      const conversation = await api.appendConversationMessage(id, message);
      setActive((current) => (current?.id === conversation.id ? conversation : current));
      await refresh();
      return conversation;
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      const api = apiOrThrow();
      await api.deleteConversation(id);
      setActive((current) => (current?.id === id ? null : current));
      await refresh();
    },
    [refresh]
  );

  return {
    summaries,
    active,
    loading,
    error,
    refresh,
    select,
    startDraft,
    create,
    append,
    remove
  };
}
