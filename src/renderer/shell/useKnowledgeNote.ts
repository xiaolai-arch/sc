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
 * Unsaved drafts live at module scope so leaving the knowledge page and
 * coming back — or a failed save followed by a tab switch — still shows the
 * text the user typed. Memory only: never localStorage, and a process exit
 * loses at most the last 600ms.
 */
const drafts = new Map<string, string>();
const draftErrors = new Map<string, string>();

/** Drops every in-memory draft, for tests and for switching vaults. */
export function clearKnowledgeNoteDrafts(): void {
  drafts.clear();
  draftErrors.clear();
}

/**
 * Owns one topic's note draft. Text typed here lives in memory until it is
 * saved: switching topics awaits the outgoing save, a failed save keeps the
 * draft for when the user comes back, and a newer load always wins.
 *
 * `bodyTopicRef` is what keeps this honest: the body in the editors belongs to
 * exactly one topic, and a save or flush may only touch that topic. During a
 * switch there is no body until the new topic's load settles, so nothing typed
 * into the window between two topics can land in the wrong note.
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
  /** The topic the current body belongs to; null while loading a switch. */
  const bodyTopicRef = useRef<string | null>(null);
  const bodyRef = useRef('');
  /** Null means the on-disk body is unknown (a draft was restored). */
  const savedBodyRef = useRef<string | null>(null);
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
    // No body has arrived for this topic yet, or it belongs to another one.
    if (bodyTopicRef.current !== target) return;
    const draft = bodyRef.current;
    if (savedBodyRef.current !== null && draft === savedBodyRef.current) return;
    setStatus('saving');
    setError(null);
    try {
      const saved = await apiRef.current.saveNote({ topicId: target, body: draft });
      // Only clear the draft if it was not replaced while the save ran.
      if (drafts.get(target) === draft) {
        drafts.delete(target);
        draftErrors.delete(target);
      }
      if (topicRef.current !== target || bodyTopicRef.current !== target) return;
      savedBodyRef.current = saved.body;
      if (bodyRef.current === saved.body) {
        setStatus('saved');
      } else {
        // The user kept typing while the save was in flight.
        setStatus('dirty');
      }
    } catch (cause) {
      const message = friendlyErrorMessage(cause, SAVE_FAILED);
      drafts.set(target, draft);
      draftErrors.set(target, message);
      if (topicRef.current !== target || bodyTopicRef.current !== target) return;
      setStatus('error');
      setError(message);
    }
  }, []);

  const setBody = useCallback(
    (next: string) => {
      const target = topicRef.current;
      // The editor is not live until its own topic's body has loaded.
      if (bodyTopicRef.current !== target) return;
      bodyRef.current = next;
      setBodyState(next);
      clearTimer();
      if (savedBodyRef.current !== null && next === savedBodyRef.current) {
        drafts.delete(target);
        draftErrors.delete(target);
        setStatus('saved');
        setError(null);
        return;
      }
      drafts.set(target, next);
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
      bodyTopicRef.current = target;
      bodyRef.current = note.body;
      savedBodyRef.current = note.body;
      setBodyState(note.body);
      setStatus('saved');
      setError(null);
    } catch (cause) {
      if (token !== tokenRef.current) return;
      bodyRef.current = '';
      savedBodyRef.current = null;
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
    const hadBody = bodyTopicRef.current === previousTopic;
    const previousBody = bodyRef.current;
    const previousSaved = savedBodyRef.current;
    const previousDirty = hadBody && (previousSaved === null || previousBody !== previousSaved);

    topicRef.current = topicId;
    clearTimer();
    // Until this topic's own load settles there is no live body: the editor is
    // a loading placeholder, and a flush from the old body cannot reach disk.
    bodyTopicRef.current = null;
    bodyRef.current = '';
    savedBodyRef.current = null;
    setBodyState('');
    setStatus('loading');
    setError(null);
    setLoadError(null);
    setBacklinks([]);
    setBacklinksError(null);

    async function run() {
      if (previousTopic !== topicId && previousDirty) {
        try {
          await apiRef.current.saveNote({ topicId: previousTopic, body: previousBody });
          if (drafts.get(previousTopic) === previousBody) {
            drafts.delete(previousTopic);
            draftErrors.delete(previousTopic);
          }
        } catch (cause) {
          // Keep the draft; coming back to the topic restores it.
          drafts.set(previousTopic, previousBody);
          draftErrors.set(previousTopic, friendlyErrorMessage(cause, SAVE_FAILED));
        }
      }
      if (token !== tokenRef.current) return;

      const draft = drafts.get(topicId);
      if (draft !== undefined) {
        bodyTopicRef.current = topicId;
        bodyRef.current = draft;
        savedBodyRef.current = null;
        setBodyState(draft);
        const draftError = draftErrors.get(topicId);
        setStatus(draftError ? 'error' : 'dirty');
        setError(draftError ?? null);
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
    drafts.delete(target);
    draftErrors.delete(target);
    await loadNote(token, target);
  }, []);

  const reloadBacklinks = useCallback(async () => {
    await loadBacklinks(tokenRef.current, topicRef.current);
  }, []);

  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });

  // Leaving the page is the last chance to land the draft. Best-effort only:
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
