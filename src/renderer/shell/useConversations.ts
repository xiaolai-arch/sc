import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
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
  /** A conversation switch is in flight; the previous one is already cleared. */
  selecting: boolean;
  error: string | null;
  /** Set when a tray/notification opens a conversation outside the renderer. */
  externalOpen: { id: string; seq: number } | null;
  refresh: () => Promise<void>;
  select: (id: string) => Promise<void>;
  startDraft: () => void;
  create: (input?: CreateConversationInput) => Promise<Conversation>;
  append: (id: string, message: ConversationMessage) => Promise<Conversation>;
  remove: (id: string) => Promise<void>;
  setModel: (id: string, model: string | null) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  truncate: (id: string, keepCount: number) => Promise<Conversation>;
  search: (query: string) => Promise<ConversationSummary[]>;
};

function apiOrThrow(): StudyCoachApi {
  const api = window.studyCoach;
  if (!api) throw new Error('数据服务不可用，请重启应用后重试。');
  return api;
}

function messageOf(cause: unknown): string {
  return friendlyErrorMessage(cause, '对话加载失败，请重试。');
}

export function useConversations(): ConversationController {
  const [summaries, setSummaries] = useState<ConversationSummary[]>([]);
  const [active, setActive] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = active?.id ?? null;
  const [externalOpen, setExternalOpen] = useState<{ id: string; seq: number } | null>(
    null
  );
  const selectRequestRef = useRef(0);
  const externalOpenSeqRef = useRef(0);

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
    const request = ++selectRequestRef.current;
    // Clear the previous conversation before waiting: otherwise its messages
    // stay on screen, and a send during the wait would target the old thread.
    const switching = activeIdRef.current !== id;
    if (switching) {
      setActive(null);
      setSelecting(true);
    }
    setLoading(true);
    try {
      const api = apiOrThrow();
      const conversation = await api.getConversation(id);
      if (request !== selectRequestRef.current) return;
      setActive(conversation);
      setError(null);
    } catch (cause) {
      if (request !== selectRequestRef.current) return;
      setError(messageOf(cause));
    } finally {
      if (request === selectRequestRef.current) {
        setLoading(false);
        setSelecting(false);
      }
    }
  }, []);

  useEffect(() => {
    const api = window.studyCoach;
    if (!api?.onConversationOpened) return undefined;
    return api.onConversationOpened((id) => {
      externalOpenSeqRef.current += 1;
      setExternalOpen({ id, seq: externalOpenSeqRef.current });
      void select(id);
    });
  }, [select]);

  const startDraft = useCallback(() => {
    selectRequestRef.current += 1;
    setActive(null);
    setSelecting(false);
    setError(null);
    setLoading(false);
  }, []);

  const create = useCallback(async (input?: CreateConversationInput) => {
    const request = ++selectRequestRef.current;
    setSelecting(false);
    const api = apiOrThrow();
    const conversation = await api.createConversation(input);
    if (request === selectRequestRef.current) {
      setActive(conversation);
    }
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

  const setModel = useCallback(
    async (id: string, model: string | null) => {
      const api = apiOrThrow();
      const conversation = await api.setConversationModel(id, model);
      setActive((current) => (current?.id === conversation.id ? conversation : current));
      await refresh();
    },
    [refresh]
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      const api = apiOrThrow();
      const conversation = await api.renameConversation(id, title);
      setActive((current) => (current?.id === conversation.id ? conversation : current));
      await refresh();
    },
    [refresh]
  );

  const setPinned = useCallback(
    async (id: string, pinned: boolean) => {
      const api = apiOrThrow();
      const conversation = await api.setConversationPinned(id, pinned);
      setActive((current) => (current?.id === conversation.id ? conversation : current));
      await refresh();
    },
    [refresh]
  );

  const truncate = useCallback(
    async (id: string, keepCount: number) => {
      const api = apiOrThrow();
      const conversation = await api.truncateConversationMessages(id, keepCount);
      setActive((current) => (current?.id === conversation.id ? conversation : current));
      await refresh();
      return conversation;
    },
    [refresh]
  );

  const search = useCallback(
    async (query: string) => apiOrThrow().searchConversations(query),
    []
  );

  return {
    summaries,
    active,
    loading,
    selecting,
    error,
    externalOpen,
    refresh,
    select,
    startDraft,
    create,
    append,
    remove,
    setModel,
    rename,
    setPinned,
    truncate,
    search
  };
}
