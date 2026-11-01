import { useCallback, useEffect, useRef, useState } from 'react';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import type { ReviewRecord, StudyCoachApi } from '../../shared/ipc';
import type { LearnerProfile, MemoryRecord } from '../../shared/memory';
import type {
  CreatePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult
} from '../../shared/practice';
import type { WorkspacePlan } from '../../shared/planning';
import type { SearchResult } from '../../shared/search';
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

type PracticeData = {
  practiceSets: PracticeSet[];
  practiceMistakes: PracticeMistake[];
  practiceDue: PracticeMistake[];
  practiceAttempts: PracticeAttempt[];
};

type WorkspaceDataState = {
  workspaces: Workspace[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  memory: MemoryItem[];
  memoryRecords: MemoryRecord[];
  memoryProfile: LearnerProfile | null;
  reviews: ReviewRecord[];
  reminders: Reminder[];
  practiceSets: PracticeSet[];
  practiceMistakes: PracticeMistake[];
  practiceDue: PracticeMistake[];
  practiceAttempts: PracticeAttempt[];
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
  createPracticeSet: (input: CreatePracticeSetInput) => Promise<PracticeSet>;
  submitPracticeAnswer: (input: SubmitAnswerInput) => Promise<SubmitAnswerResult>;
  generatePlan: (workspaceId: string) => Promise<WorkspacePlan>;
  searchWorkspace: (workspaceId: string, query: string, limit?: number) => Promise<SearchResult[]>;
  send: (input: SendMessageInput) => Promise<SendMessageResult>;
  submitReview: (date: string, answers: ReviewAnswers, workspaceId?: string) => Promise<void>;
};

const EMPTY_PRACTICE: PracticeData = {
  practiceSets: [],
  practiceMistakes: [],
  practiceDue: [],
  practiceAttempts: []
};

function apiOrThrow(): StudyCoachApi {
  const api = window.studyCoach;
  if (!api) throw new Error('数据服务不可用，请重启应用后重试。');
  return api;
}

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '数据加载失败，请重试。';
}

function replaceWorkspaceSlice<T extends { workspaceId: string }>(
  current: T[],
  next: T[],
  workspaceId: string
): T[] {
  const firstIndex = current.findIndex((entry) => entry.workspaceId === workspaceId);
  const without = current.filter((entry) => entry.workspaceId !== workspaceId);
  if (firstIndex < 0) return [...without, ...next];
  // Keep the refreshed workspace slice at its original position so lists that
  // fall back to "first item" (e.g. the selected practice set) stay stable.
  const before = current
    .slice(0, firstIndex)
    .filter((entry) => entry.workspaceId !== workspaceId).length;
  return [...without.slice(0, before), ...next, ...without.slice(before)];
}

/** Consecutive review days ending today (skipped days still count as reviewed). */
function reviewStreak(reviews: ReviewRecord[], today: string): number {
  const dates = new Set(reviews.map((entry) => entry.date));
  let streak = 0;
  const cursor = parseLocalDate(today);
  while (dates.has(formatLocalDate(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

async function loadPractice(
  api: StudyCoachApi,
  workspaceIds: string[]
): Promise<PracticeData> {
  const date = formatLocalDate(new Date());
  const perWorkspace = await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const [sets, mistakes, due, attempts] = await Promise.all([
        api.listPracticeSets(workspaceId).catch(() => [] as PracticeSet[]),
        api.getPracticeMistakes(workspaceId).catch(() => [] as PracticeMistake[]),
        api.getPracticeDue({ workspaceId, date }).catch(() => [] as PracticeMistake[]),
        api.listPracticeAttempts(workspaceId).catch(() => [] as PracticeAttempt[])
      ]);
      return { sets, mistakes, due, attempts };
    })
  );
  return {
    practiceSets: perWorkspace.flatMap((entry) => entry.sets),
    practiceMistakes: perWorkspace.flatMap((entry) => entry.mistakes),
    practiceDue: perWorkspace.flatMap((entry) => entry.due),
    practiceAttempts: perWorkspace.flatMap((entry) => entry.attempts)
  };
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
    memoryRecords: [],
    memoryProfile: null,
    reviews: [],
    reminders: [],
    ...EMPTY_PRACTICE,
    streak: 0,
    loading: true,
    error: null
  });
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestRef.current;
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const api = apiOrThrow();
      const [workspaces, reminders] = await Promise.all([api.listWorkspaces(), api.getReminders()]);
      const workspaceIds = workspaces.map((workspace) => workspace.id);
      const [snapshots, practice, memoryRecords, memoryProfile, reviews] = await Promise.all([
        Promise.all(workspaces.map((workspace) => api.getWorkspaceSnapshot(workspace.id))),
        loadPractice(api, workspaceIds),
        api.listMemory().catch(() => [] as MemoryRecord[]),
        api.getMemoryProfile().catch(() => null),
        api.listReviews({ limit: 60 }).catch(() => [] as ReviewRecord[])
      ]);
      if (request !== requestRef.current) return;

      const snapshotMemory = snapshots.flatMap((snapshot) => snapshot.memory);
      setState({
        workspaces,
        tasks: snapshots.flatMap((snapshot) => snapshot.tasks),
        notes: snapshots.flatMap((snapshot) => snapshot.notes),
        memory: snapshotMemory.length > 0 ? snapshotMemory : memoryRecords,
        memoryRecords,
        memoryProfile,
        reviews,
        reminders,
        ...practice,
        streak: reviewStreak(reviews, formatLocalDate(new Date())),
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

  const createPracticeSet = useCallback(async (input: CreatePracticeSetInput) => {
    const set = await apiOrThrow().createPracticeSet(input);
    setState((current) => ({
      ...current,
      practiceSets: [...current.practiceSets.filter((item) => item.id !== set.id), set]
    }));
    return set;
  }, []);

  const submitPracticeAnswer = useCallback(async (input: SubmitAnswerInput) => {
    const api = apiOrThrow();
    const result = await api.submitPracticeAnswer(input);
    const fresh = await loadPractice(api, [result.workspaceId]);
    setState((current) => ({
      ...current,
      practiceSets: replaceWorkspaceSlice(current.practiceSets, fresh.practiceSets, result.workspaceId),
      practiceMistakes: replaceWorkspaceSlice(
        current.practiceMistakes,
        fresh.practiceMistakes,
        result.workspaceId
      ),
      practiceDue: replaceWorkspaceSlice(current.practiceDue, fresh.practiceDue, result.workspaceId),
      practiceAttempts: replaceWorkspaceSlice(
        current.practiceAttempts,
        fresh.practiceAttempts,
        result.workspaceId
      )
    }));
    return result;
  }, []);

  const generatePlan = useCallback(async (workspaceId: string) => {
    const api = apiOrThrow();
    const plan = await api.planWorkspace({ workspaceId });
    const created = await Promise.all(
      plan.tasks.map((task) =>
        api.createTask({
          workspaceId,
          title: task.title,
          subject: task.subject,
          durationMin: task.durationMin,
          acceptance: task.acceptance
        })
      )
    );
    setState((current) => ({ ...current, tasks: [...created, ...current.tasks] }));
    return plan;
  }, []);

  const searchWorkspace = useCallback(
    async (workspaceId: string, query: string, limit?: number) =>
      apiOrThrow().searchWorkspace({ workspaceId, query, ...(limit !== undefined ? { limit } : {}) }),
    []
  );

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
    async (date: string, answers: ReviewAnswers, workspaceId?: string) => {
      await apiOrThrow().submitReview({
        date,
        answers,
        ...(workspaceId !== undefined ? { workspaceId } : {})
      });
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
    createPracticeSet,
    submitPracticeAnswer,
    generatePlan,
    searchWorkspace,
    send,
    submitReview
  };
}
