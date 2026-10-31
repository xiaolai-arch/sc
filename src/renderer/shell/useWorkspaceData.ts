import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudyCoachApi } from '../../shared/ipc';
import type { ReviewAnswers } from '../../shared/types';
import type {
  CreateNoteInput,
  CreateTaskInput,
  MemoryItem,
  Reminder,
  SendMessageInput,
  SendMessageResult,
  UpdateWorkspaceNoteInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceTask
} from '../../shared/workspace';
import { demoPracticeSets, demoStreak } from './demoData';
import type { PracticeSet } from './demoData';

type WorkspaceDataState = {
  workspaces: Workspace[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  memory: MemoryItem[];
  reminders: Reminder[];
  practiceSets: PracticeSet[];
  streak: number;
  loading: boolean;
  error: string | null;
};

export type WorkspaceData = WorkspaceDataState & {
  reload: () => Promise<void>;
  retry: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<WorkspaceTask>;
  updateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
  createNote: (input: CreateNoteInput) => Promise<WorkspaceNote>;
  updateNote: (input: UpdateWorkspaceNoteInput) => Promise<WorkspaceNote>;
  send: (input: SendMessageInput) => Promise<SendMessageResult>;
  submitReview: (date: string, answers: ReviewAnswers) => Promise<void>;
};

function apiOrThrow(): StudyCoachApi {
  const api = window.studyCoach;
  if (!api) throw new Error('数据服务不可用，请重启应用后重试。');
  return api;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '数据加载失败，请重试。';
}

/**
 * Loads the workspace dataset through the preload API. The browser prototype
 * supplies the same contract from web/mock-api.ts, so the renderer never
 * imports seed data directly.
 */
export function useWorkspaceData(): WorkspaceData {
  const [state, setState] = useState<WorkspaceDataState>({
    workspaces: [],
    tasks: [],
    notes: [],
    memory: [],
    reminders: [],
    practiceSets: demoPracticeSets,
    streak: demoStreak,
    loading: true,
    error: null
  });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const api = apiOrThrow();
      const [workspaces, reminders, memory] = await Promise.all([
        api.listWorkspaces(),
        api.getReminders(),
        api.getMemory()
      ]);
      const snapshots = await Promise.all(
        workspaces.map((workspace) => api.getWorkspaceSnapshot(workspace.id))
      );
      if (request !== requestRef.current) return;

      const snapshotMemory = snapshots.flatMap((snapshot) => snapshot.memory);
      setState({
        workspaces,
        tasks: snapshots.flatMap((snapshot) => snapshot.tasks),
        notes: snapshots.flatMap((snapshot) => snapshot.notes),
        memory: memory.length > 0 ? memory : snapshotMemory,
        reminders,
        practiceSets: demoPracticeSets,
        streak: demoStreak,
        loading: false,
        error: null
      });
    } catch (cause) {
      if (request !== requestRef.current) return;
      setState((current) => ({ ...current, loading: false, error: messageOf(cause) }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const task = await apiOrThrow().createTask(input);
    setState((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    return task;
  }, []);

  const updateTask = useCallback(async (input: UpdateWorkspaceTaskInput) => {
    const task = await apiOrThrow().updateWorkspaceTask(input);
    setState((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? task : item))
    }));
    return task;
  }, []);

  const createNote = useCallback(async (input: CreateNoteInput) => {
    const note = await apiOrThrow().createNote(input);
    setState((current) => ({ ...current, notes: [note, ...current.notes] }));
    return note;
  }, []);

  const updateNote = useCallback(async (input: UpdateWorkspaceNoteInput) => {
    const note = await apiOrThrow().updateNote(input);
    setState((current) => ({
      ...current,
      notes: current.notes.map((item) => (item.id === note.id ? note : item))
    }));
    return note;
  }, []);

  const send = useCallback(
    async (input: SendMessageInput) => {
      const result = await apiOrThrow().send(input);
      // A butler reply may have written a note or changed a task through tools.
      await reload();
      return result;
    },
    [reload]
  );

  const submitReview = useCallback(
    async (date: string, answers: ReviewAnswers) => {
      await apiOrThrow().submitReview({ date, answers });
      await reload();
    },
    [reload]
  );

  return {
    ...state,
    reload,
    retry: reload,
    createTask,
    updateTask,
    createNote,
    updateNote,
    send,
    submitReview
  };
}
