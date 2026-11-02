import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KnowledgeBacklink,
  KnowledgeNote,
  SaveKnowledgeNoteInput
} from '../../shared/knowledge';
import { friendlyErrorMessage } from '../../shared/errors';

export type KnowledgeNoteStatus = 'loading' | 'dirty' | 'saving' | 'saved' | 'error';

export interface UseKnowledgeNoteOptions {
  topicId: string;
  getNote(topicId: string): Promise<KnowledgeNote>;
  saveNote(input: SaveKnowledgeNoteInput): Promise<KnowledgeNote>;
  getBacklinks(topicId: string): Promise<KnowledgeBacklink[]>;
  /** Quiet period before autosave; defaults to 600ms. */
  debounceMs?: number;
}

export interface UseKnowledgeNoteResult {
  body: string;
  status: KnowledgeNoteStatus;
  error: string | null;
  loadError: string | null;
  backlinks: KnowledgeBacklink[];
  backlinksError: string | null;
  setBody(body: string): void;
  flush(): Promise<void>;
  retrySave(): Promise<void>;
  reloadNote(): Promise<void>;
  reloadBacklinks(): Promise<void>;
}

const SAVE_FAILED = '保存失败，请重试。';
const LOAD_FAILED = '笔记加载失败。';
const BACKLINKS_FAILED = '反向链接加载失败。';

/**
 * Owns one topic's note draft. Text typed here lives in memory until it is
 * saved: switching topics awaits the outgoing save, a failed save keeps the
 * draft for when the user comes back, and a newer load always wins.
 */
export function useKnowledgeNote(options: UseKnowledgeNoteOptions): UseKnowledgeNoteResult {
  const { topicId, debounceMs = 600 } = options;
  const apiRef = useRef(options);
  useEffect(() => {
    apiRef.current = options;
  });

  const [body, setBodyState] = useState('');
  const [status, setStatus] = useState<KnowledgeNoteStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [backlinks, setBacklinks] = useState<KnowledgeBacklink[]>([]);
  const [backlinksError, setBacklinksError] = useState<string | null>(null);

  const topicRef = useRef(topicId);
  const bodyRef = useRef('');
  const savedBodyRef = useRef('');
  const draftsRef = useRef(new Map<string, string>());
  const draftErrorsRef = useRef(new Map<string, string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const save = useCallback(async () => {
    const target = topicRef.current;
    const draft = bodyRef.current;
    if (draft === savedBodyRef.current) return;
    setStatus('saving');
    setError(null);
    try {
      const saved = await apiRef.current.saveNote({ topicId: target, body: draft });
      draftsRef.current.delete(target);
      draftErrorsRef.current.delete(target);
      if (topicRef.current !== target) return;
      savedBodyRef.current = saved.body;
      if (bodyRef.current === saved.body) {
        setStatus('saved');
      } else {
        // The user kept typing while the save was in flight.
        setStatus('dirty');
      }
    } catch (cause) {
      const message = friendlyErrorMessage(cause, SAVE_FAILED);
      draftsRef.current.set(target, draft);
      draftErrorsRef.current.set(target, message);
      if (topicRef.current !== target) return;
      setStatus('error');
      setError(message);
    }
  }, []);

  const setBody = useCallback(
    (next: string) => {
      const target = topicRef.current;
      bodyRef.current = next;
      setBodyState(next);
      clearTimer();
      if (next === savedBodyRef.current) {
        draftsRef.current.delete(target);
        draftErrorsRef.current.delete(target);
        setStatus('saved');
        setError(null);
        return;
      }
      draftsRef.current.set(target, next);
      setStatus('dirty');
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void save();
      }, debounceMs);
    },
    [clearTimer, debounceMs, save]
  );

  const flush = useCallback(async () => {
    clearTimer();
    await save();
  }, [clearTimer, save]);

  const retrySave = useCallback(async () => {
    await save();
  }, [save]);

  async function loadBacklinks(token: number, target: string) {
    try {
      const links = await apiRef.current.getBacklinks(target);
      if (token !== tokenRef.current) return;
      setBacklinks(links);
      setBacklinksError(null);
    } catch (cause) {
      if (token !== tokenRef.current) return;
      setBacklinks([]);
      setBacklinksError(friendlyErrorMessage(cause, BACKLINKS_FAILED));
    }
  }

  async function loadNote(token: number, target: string) {
    setStatus('loading');
    setLoadError(null);
    try {
      const note = await apiRef.current.getNote(target);
      if (token !== tokenRef.current) return;
      bodyRef.current = note.body;
      savedBodyRef.current = note.body;
      setBodyState(note.body);
      setStatus('saved');
      setError(null);
    } catch (cause) {
      if (token !== tokenRef.current) return;
      bodyRef.current = '';
      savedBodyRef.current = '';
      setBodyState('');
      setStatus('saved');
      setLoadError(friendlyErrorMessage(cause, LOAD_FAILED));
    }
    await loadBacklinks(token, target);
  }

  // One effect per topic switch: settle the outgoing draft, then load.
  useEffect(() => {
    const token = ++tokenRef.current;
    const previousTopic = topicRef.current;
    const previousBody = bodyRef.current;
    topicRef.current = topicId;
    clearTimer();

    async function run() {
      if (previousTopic !== topicId && previousBody !== savedBodyRef.current) {
        try {
          await apiRef.current.saveNote({ topicId: previousTopic, body: previousBody });
          draftsRef.current.delete(previousTopic);
          draftErrorsRef.current.delete(previousTopic);
        } catch (cause) {
          // Keep the draft; coming back to the topic restores it.
          draftsRef.current.set(previousTopic, previousBody);
          draftErrorsRef.current.set(
            previousTopic,
            friendlyErrorMessage(cause, SAVE_FAILED)
          );
        }
      }
      if (token !== tokenRef.current) return;

      const draft = draftsRef.current.get(topicId);
      if (draft !== undefined) {
        bodyRef.current = draft;
        setBodyState(draft);
        const draftError = draftErrorsRef.current.get(topicId);
        setStatus(draftError ? 'error' : 'dirty');
        setError(draftError ?? null);
        setLoadError(null);
        await loadBacklinks(token, topicId);
        return;
      }

      await loadNote(token, topicId);
    }

    void run();
  }, [topicId, clearTimer]);

  const reloadNote = useCallback(async () => {
    const token = ++tokenRef.current;
    const target = topicRef.current;
    draftsRef.current.delete(target);
    draftErrorsRef.current.delete(target);
    await loadNote(token, target);
  }, []);

  const reloadBacklinks = useCallback(async () => {
    await loadBacklinks(tokenRef.current, topicRef.current);
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // Leaning the page is the last chance to land the draft. Best-effort only:
  // no async cleanup, so the app is free to disappear immediately.
  useEffect(
    () => () => {
      void flushRef.current();
    },
    []
  );

  return {
    body,
    status,
    error,
    loadError,
    backlinks,
    backlinksError,
    setBody,
    flush,
    retrySave,
    reloadNote,
    reloadBacklinks
  };
}
