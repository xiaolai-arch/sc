import { useCallback, useEffect, useRef, useState } from 'react';
import {
  KNOWLEDGE_NOTE_CONFLICT_MESSAGE,
  type KnowledgeBacklink,
  type KnowledgeNote,
  type SaveKnowledgeNoteInput
} from '../../shared/knowledge';
import { friendlyErrorMessage } from '../../shared/errors';

export type KnowledgeNoteStatus =
  | 'loading'
  | 'dirty'
  | 'saving'
  | 'saved'
  | 'error'
  | 'conflict';

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
  /** True when the note changed in another app while this draft was open. */
  conflict: boolean;
  setBody(body: string): void;
  flush(): Promise<void>;
  retrySave(): Promise<void>;
  /** Saves this draft over the external version. */
  overwriteConflict(): Promise<void>;
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
/** Revision each draft was based on; null means the disk revision is unknown. */
const draftRevisions = new Map<string, string | null>();
/** Topics whose draft hit an external edit and must not autosave. */
const draftConflicts = new Set<string>();

/** Drops every in-memory draft, for tests and for switching vaults. */
export function clearKnowledgeNoteDrafts(): void {
  drafts.clear();
  draftErrors.clear();
  draftRevisions.clear();
  draftConflicts.clear();
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
  const [conflict, setConflict] = useState(false);

  const topicRef = useRef(topicId);
  /** The topic the current body belongs to; null while loading a switch. */
  const bodyTopicRef = useRef<string | null>(null);
  const bodyRef = useRef('');
  /** Null means the on-disk body is unknown (a draft was restored). */
  const savedBodyRef = useRef<string | null>(null);
  /** Revision the current body is based on; null when the disk revision is unknown. */
  const revisionRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const save = useCallback(async (force = false) => {
    const target = topicRef.current;
    // No body has arrived for this topic yet, or it belongs to another one.
    if (bodyTopicRef.current !== target) return;
    // A conflict waits for an explicit choice; autosave must not clobber it.
    if (conflictRef.current && !force) return;
    const draft = bodyRef.current;
    if (!force && savedBodyRef.current !== null && draft === savedBodyRef.current) return;
    setStatus('saving');
    setError(null);
    const baseRevision = revisionRef.current;
    try {
      const saved = await apiRef.current.saveNote({
        topicId: target,
        body: draft,
        ...(baseRevision !== null ? { expectedRevision: baseRevision } : {}),
        ...(force ? { force: true } : {})
      });
      // Only clear the draft if it was not replaced while the save ran.
      if (drafts.get(target) === draft) {
        drafts.delete(target);
        draftErrors.delete(target);
        draftRevisions.delete(target);
      } else if (drafts.has(target)) {
        draftRevisions.set(target, saved.revision ?? null);
      }
      draftConflicts.delete(target);
      if (topicRef.current !== target || bodyTopicRef.current !== target) return;
      revisionRef.current = saved.revision ?? null;
      conflictRef.current = false;
      setConflict(false);
      savedBodyRef.current = saved.body;
      if (bodyRef.current === saved.body) {
        setStatus('saved');
      } else {
        // The user kept typing while the save was in flight.
        setStatus('dirty');
      }
    } catch (cause) {
      const message = friendlyErrorMessage(cause, SAVE_FAILED);
      // Never replace a newer draft with the body that just failed.
      if (!drafts.has(target) || drafts.get(target) === draft) {
        drafts.set(target, draft);
        draftRevisions.set(target, baseRevision);
      }
      if (message === KNOWLEDGE_NOTE_CONFLICT_MESSAGE) {
        draftErrors.delete(target);
        draftConflicts.add(target);
        draftRevisions.set(target, baseRevision);
        if (topicRef.current !== target || bodyTopicRef.current !== target) return;
        conflictRef.current = true;
        setConflict(true);
        setStatus('conflict');
        setError(null);
        return;
      }
      draftErrors.set(target, message);
      draftConflicts.delete(target);
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
      // While conflicted, every keystroke stays in the draft until the user
      // chooses which version wins; it must not trigger an autosave.
      if (conflictRef.current) {
        drafts.set(target, next);
        draftRevisions.set(target, revisionRef.current);
        setStatus('conflict');
        return;
      }
      if (savedBodyRef.current !== null && next === savedBodyRef.current) {
        drafts.delete(target);
        draftErrors.delete(target);
        draftRevisions.delete(target);
        setStatus('saved');
        setError(null);
        return;
      }
      drafts.set(target, next);
      draftRevisions.set(target, revisionRef.current);
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

  const overwriteConflict = useCallback(async () => {
    await save(true);
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
      revisionRef.current = note.revision ?? null;
      conflictRef.current = false;
      setConflict(false);
      setBodyState(note.body);
      setStatus('saved');
      setError(null);
    } catch (cause) {
      if (token !== tokenRef.current) return;
      bodyRef.current = '';
      savedBodyRef.current = null;
      revisionRef.current = null;
      conflictRef.current = false;
      setConflict(false);
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
    const previousRevision = revisionRef.current;
    const previousConflict = conflictRef.current;
    const previousDirty = hadBody && (previousSaved === null || previousBody !== previousSaved);

    topicRef.current = topicId;
    clearTimer();
    // Until this topic's own load settles there is no live body: the editor is
    // a loading placeholder, and a flush from the old body cannot reach disk.
    bodyTopicRef.current = null;
    bodyRef.current = '';
    savedBodyRef.current = null;
    revisionRef.current = null;
    conflictRef.current = false;
    setBodyState('');
    setStatus('loading');
    setError(null);
    setLoadError(null);
    setConflict(false);
    setBacklinks([]);
    setBacklinksError(null);

    async function run() {
      // A conflicted draft is not saved on the way out: the user has not
      // chosen between their version and the one on disk yet.
      if (previousTopic !== topicId && previousDirty && !previousConflict) {
        try {
          const saved = await apiRef.current.saveNote({
            topicId: previousTopic,
            body: previousBody,
            ...(previousRevision !== null ? { expectedRevision: previousRevision } : {})
          });
          if (drafts.get(previousTopic) === previousBody) {
            drafts.delete(previousTopic);
            draftErrors.delete(previousTopic);
            draftRevisions.delete(previousTopic);
          } else if (drafts.has(previousTopic)) {
            draftRevisions.set(previousTopic, saved.revision ?? null);
          }
          draftConflicts.delete(previousTopic);
        } catch (cause) {
          // Keep the draft; coming back to the topic restores it.
          const message = friendlyErrorMessage(cause, SAVE_FAILED);
          if (!drafts.has(previousTopic) || drafts.get(previousTopic) === previousBody) {
            drafts.set(previousTopic, previousBody);
          }
          if (message === KNOWLEDGE_NOTE_CONFLICT_MESSAGE) {
            draftErrors.delete(previousTopic);
            draftConflicts.add(previousTopic);
            draftRevisions.set(previousTopic, previousRevision);
          } else {
            draftErrors.set(previousTopic, message);
            draftConflicts.delete(previousTopic);
          }
        }
      }
      if (token !== tokenRef.current) return;

      const draft = drafts.get(topicId);
      if (draft !== undefined) {
        bodyTopicRef.current = topicId;
        bodyRef.current = draft;
        savedBodyRef.current = null;
        revisionRef.current = draftRevisions.get(topicId) ?? null;
        const hasConflict = draftConflicts.has(topicId);
        conflictRef.current = hasConflict;
        setConflict(hasConflict);
        setBodyState(draft);
        const draftError = draftErrors.get(topicId);
        setStatus(hasConflict ? 'conflict' : draftError ? 'error' : 'dirty');
        setError(hasConflict ? null : draftError ?? null);
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
    draftRevisions.delete(target);
    draftConflicts.delete(target);
    conflictRef.current = false;
    setConflict(false);
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
    conflict,
    setBody,
    flush,
    retrySave,
    overwriteConflict,
    reloadNote,
    reloadBacklinks
  };
}
