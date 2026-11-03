import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ButlerStreamListener,
  StreamingButlerApi
} from '../../shared/butler-stream';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import { friendlyErrorMessage } from '../../shared/errors';
import type { ReviewRecord, StudyCoachApi } from '../../shared/ipc';
import type {
  CreateKnowledgeTopicInput,
  KnowledgeBacklink,
  KnowledgeNote,
  KnowledgeTopic,
  SaveKnowledgeNoteInput,
  UpdateKnowledgeTopicInput
} from '../../shared/knowledge';
import type {
  DeleteMemoryInput,
  CreateMemoryInput,
  LearnerProfile,
  MemoryRecord,
  UpdateMemoryInput
} from '../../shared/memory';
import type {
  CreatePracticeSetInput,
  PracticeAttempt,
  PracticeMistake,
  PracticeSet,
  SubmitAnswerInput,
  SubmitAnswerResult
} from '../../shared/practice';
import type {
  CreateLongPlanInput,
  LongPlan,
  RecalibrateLongPlanInput,
  UpdateLongPlanItemInput
} from '../../shared/plans';
import type { WorkspacePlan } from '../../shared/planning';
import type { SearchResult } from '../../shared/search';
import type { ReviewAnswers } from '../../shared/types';
import type {
  CreateNoteInput,
  CreateReminderInput,
  CreateTaskInput,
  DeleteReminderInput,
  DeleteTaskInput,
  MemoryItem,
  Reminder,
  SendMessageInput,
  SendMessageResult,
  UpdateReminderInput,
  UpdateWorkspaceInput,
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
  longPlans: LongPlan[];
  knowledgeTopics: KnowledgeTopic[];
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
  refreshKnowledge: () => Promise<void>;
  retry: () => Promise<void>;
  createTask: (input: CreateTaskInput) => Promise<WorkspaceTask>;
  updateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
  deleteTask: (input: DeleteTaskInput) => Promise<void>;
  createNote: (input: CreateNoteInput) => Promise<WorkspaceNote>;
  updateNote: (input: UpdateWorkspaceNoteInput) => Promise<WorkspaceNote>;
  createPracticeSet: (input: CreatePracticeSetInput) => Promise<PracticeSet>;
  submitPracticeAnswer: (input: SubmitAnswerInput) => Promise<SubmitAnswerResult>;
  generatePlan: (workspaceId: string) => Promise<WorkspacePlan>;
  searchWorkspace: (workspaceId: string, query: string, limit?: number) => Promise<SearchResult[]>;
  searchAll: (query: string, limit?: number) => Promise<SearchResult[]>;
  send: (input: SendMessageInput) => Promise<SendMessageResult>;
  stream: (
    input: SendMessageInput,
    onEvent: ButlerStreamListener
  ) => Promise<SendMessageResult>;
  cancelStream: (messageId: string) => Promise<void>;
  submitReview: (date: string, answers: ReviewAnswers, workspaceId?: string) => Promise<void>;
  createReminder: (input: CreateReminderInput) => Promise<Reminder>;
  updateReminder: (input: UpdateReminderInput) => Promise<Reminder>;
  deleteReminder: (input: DeleteReminderInput) => Promise<void>;
  createMemory: (input: CreateMemoryInput) => Promise<MemoryRecord>;
  updateMemory: (input: UpdateMemoryInput) => Promise<MemoryRecord>;
  deleteMemory: (input: DeleteMemoryInput) => Promise<void>;
  updateWorkspace: (input: UpdateWorkspaceInput) => Promise<Workspace>;
  createLongPlan: (input: CreateLongPlanInput) => Promise<LongPlan>;
  recalibrateLongPlan: (input: RecalibrateLongPlanInput) => Promise<LongPlan>;
  setLongPlanItemDone: (input: UpdateLongPlanItemInput) => Promise<LongPlan>;
  deleteLongPlan: (planId: string) => Promise<void>;
  createKnowledgeTopic: (input: CreateKnowledgeTopicInput) => Promise<KnowledgeTopic>;
  updateKnowledgeTopic: (input: UpdateKnowledgeTopicInput) => Promise<KnowledgeTopic>;
  deleteKnowledgeTopic: (topicId: string) => Promise<void>;
  getKnowledgeNote: (topicId: string) => Promise<KnowledgeNote>;
  saveKnowledgeNote: (input: SaveKnowledgeNoteInput) => Promise<KnowledgeNote>;
  getKnowledgeBacklinks: (topicId: string) => Promise<KnowledgeBacklink[]>;
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
  return friendlyErrorMessage(cause, '数据加载失败，请重试。');
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
    longPlans: [],
    knowledgeTopics: [],
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
      const [snapshots, practice, memoryRecords, memoryProfile, reviews, longPlans, knowledgeTopics] =
        await Promise.all([
          Promise.all(workspaces.map((workspace) => api.getWorkspaceSnapshot(workspace.id))),
          loadPractice(api, workspaceIds),
          api.listMemory().catch(() => [] as MemoryRecord[]),
          api.getMemoryProfile().catch(() => null),
          api.listReviews({ limit: 60 }).catch(() => [] as ReviewRecord[]),
          api.listLongPlans().catch(() => [] as LongPlan[]),
          api.listKnowledgeTopics().catch(() => [] as KnowledgeTopic[])
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
        longPlans,
        knowledgeTopics,
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

  /** Tasks, notes and reviews auto-link knowledge evidence on disk. */
  const refreshKnowledge = useCallback(async () => {
    const api = apiOrThrow();
    if (typeof api.listKnowledgeTopics !== 'function') return;
    const topics = await api.listKnowledgeTopics().catch(() => null);
    if (topics === null) return;
    setState((current) => ({ ...current, knowledgeTopics: topics }));
  }, []);

  const createTask = useCallback(async (input: CreateTaskInput) => {
    const task = await apiOrThrow().createTask(input);
    setState((current) => ({ ...current, tasks: [task, ...current.tasks] }));
    return task;
  }, []);

  const updateWorkspace = useCallback(async (input: UpdateWorkspaceInput) => {
    const api = apiOrThrow();
    if (!api.updateWorkspace) throw new Error('当前存储不支持更新项目。');
    const workspace = await api.updateWorkspace(input);
    setState((current) => ({
      ...current,
      workspaces: current.workspaces.map((entry) =>
        entry.id === workspace.id ? workspace : entry
      )
    }));
    return workspace;
  }, []);

  const createLongPlan = useCallback(async (input: CreateLongPlanInput) => {
    const plan = await apiOrThrow().createLongPlan(input);
    setState((current) => ({ ...current, longPlans: [plan, ...current.longPlans] }));
    return plan;
  }, []);

  const recalibrateLongPlan = useCallback(async (input: RecalibrateLongPlanInput) => {
    const plan = await apiOrThrow().recalibrateLongPlan(input);
    setState((current) => ({
      ...current,
      longPlans: current.longPlans.map((entry) => (entry.id === plan.id ? plan : entry))
    }));
    return plan;
  }, []);

  const setLongPlanItemDone = useCallback(async (input: UpdateLongPlanItemInput) => {
    const plan = await apiOrThrow().setLongPlanItemDone(input);
    setState((current) => ({
      ...current,
      longPlans: current.longPlans.map((entry) => (entry.id === plan.id ? plan : entry))
    }));
    return plan;
  }, []);

  const deleteLongPlan = useCallback(async (planId: string) => {
    await apiOrThrow().deleteLongPlan(planId);
    setState((current) => ({
      ...current,
      longPlans: current.longPlans.filter((plan) => plan.id !== planId)
    }));
  }, []);

  const createKnowledgeTopic = useCallback(async (input: CreateKnowledgeTopicInput) => {
    const topic = await apiOrThrow().createKnowledgeTopic(input);
    setState((current) => ({
      ...current,
      knowledgeTopics: [topic, ...current.knowledgeTopics]
    }));
    return topic;
  }, []);

  const updateKnowledgeTopic = useCallback(async (input: UpdateKnowledgeTopicInput) => {
    const topic = await apiOrThrow().updateKnowledgeTopic(input);
    setState((current) => ({
      ...current,
      knowledgeTopics: current.knowledgeTopics.map((entry) =>
        entry.id === topic.id ? topic : entry
      )
    }));
    return topic;
  }, []);

  const deleteKnowledgeTopic = useCallback(async (topicId: string) => {
    await apiOrThrow().deleteKnowledgeTopic(topicId);
    setState((current) => ({
      ...current,
      knowledgeTopics: current.knowledgeTopics.filter((topic) => topic.id !== topicId)
    }));
  }, []);

  const getKnowledgeNote = useCallback(
    (topicId: string) => apiOrThrow().getKnowledgeNote(topicId),
    []
  );

  const saveKnowledgeNote = useCallback(
    (input: SaveKnowledgeNoteInput) => apiOrThrow().saveKnowledgeNote(input),
    []
  );

  const getKnowledgeBacklinks = useCallback(
    (topicId: string) => apiOrThrow().getKnowledgeBacklinks(topicId),
    []
  );

  const updateTask = useCallback(
    async (input: UpdateWorkspaceTaskInput) => {
      const task = await apiOrThrow().updateWorkspaceTask(input);
      setState((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? task : item))
      }));
      // Completing a task appends knowledge evidence in the main process.
      if (task.status === 'done') await refreshKnowledge();
      return task;
    },
    [refreshKnowledge]
  );

  const deleteTask = useCallback(async (input: DeleteTaskInput) => {
    const api = apiOrThrow();
    if (!api.deleteTask) throw new Error('当前存储不支持删除任务。');
    await api.deleteTask(input);
    setState((current) => ({
      ...current,
      tasks: current.tasks.filter((task) => task.id !== input.taskId)
    }));
  }, []);

  const createNote = useCallback(
    async (input: CreateNoteInput) => {
      const note = await apiOrThrow().createNote(input);
      setState((current) => ({ ...current, notes: [note, ...current.notes] }));
      await refreshKnowledge();
      return note;
    },
    [refreshKnowledge]
  );

  const updateNote = useCallback(
    async (input: UpdateWorkspaceNoteInput) => {
      const note = await apiOrThrow().updateNote(input);
      setState((current) => ({
        ...current,
        notes: current.notes.map((item) => (item.id === note.id ? note : item))
      }));
      await refreshKnowledge();
      return note;
    },
    [refreshKnowledge]
  );

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
    // Regenerating the same goal must not duplicate tasks already in the workspace.
    const snapshot = await api.getWorkspaceSnapshot(workspaceId);
    const existing = new Set(snapshot.tasks.map((task) => task.title.trim()));
    const created = await Promise.all(
      plan.tasks
        .filter((task) => !existing.has(task.title.trim()))
        .map((task) =>
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

  const searchAll = useCallback(
    async (query: string, limit?: number) =>
      apiOrThrow().searchAll({ query, ...(limit !== undefined ? { limit } : {}) }),
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

  const stream = useCallback(
    async (input: SendMessageInput, onEvent: ButlerStreamListener) => {
      const api = apiOrThrow() as StudyCoachApi & Partial<StreamingButlerApi>;
      let result: SendMessageResult;
      if (typeof api.stream === 'function') {
        result = await api.stream(input, onEvent);
      } else {
        result = await api.send(input);
        onEvent({ type: 'text', text: result.text });
        onEvent({
          type: 'done',
          text: result.text,
          ...(result.usage ? { usage: result.usage } : {})
        });
      }
      // A butler reply may have written a note or changed a task through tools.
      await reload();
      return result;
    },
    [reload]
  );

  const cancelStream = useCallback(async (messageId: string) => {
    await apiOrThrow().cancelStream(messageId);
  }, []);

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

  const refreshMemoryProfile = useCallback(async () => {
    try {
      const profile = await apiOrThrow().getMemoryProfile();
      setState((current) => ({ ...current, memoryProfile: profile }));
    } catch {
      // Profile refresh is best-effort; the record change already succeeded.
    }
  }, []);

  const updateMemory = useCallback(
    async (input: UpdateMemoryInput) => {
      const record = await apiOrThrow().updateMemory(input);
      setState((current) => ({
        ...current,
        memoryRecords: current.memoryRecords.map((entry) =>
          entry.id === record.id ? record : entry
        )
      }));
      await refreshMemoryProfile();
      return record;
    },
    [refreshMemoryProfile]
  );

  const deleteMemory = useCallback(
    async (input: DeleteMemoryInput) => {
      await apiOrThrow().deleteMemory(input);
      setState((current) => ({
        ...current,
        memoryRecords: current.memoryRecords.filter((entry) => entry.id !== input.id)
      }));
      await refreshMemoryProfile();
    },
    [refreshMemoryProfile]
  );

  const createReminder = useCallback(async (input: CreateReminderInput) => {
    const api = apiOrThrow();
    if (!api.createReminder) throw new Error('当前存储不支持提醒。');
    const reminder = await api.createReminder(input);
    setState((current) => ({ ...current, reminders: [...current.reminders, reminder] }));
    return reminder;
  }, []);

  const updateReminder = useCallback(
    async (input: UpdateReminderInput) => {
      const api = apiOrThrow();
      if (!api.updateReminder) throw new Error('当前存储不支持提醒。');
      // Optimistic flip keeps the switch responsive; reload restores truth on failure.
      setState((current) => ({
        ...current,
        reminders: current.reminders.map((reminder) => {
          if (reminder.id !== input.id) return reminder;
          const next: Reminder = {
            ...reminder,
            ...(input.time !== undefined ? { time: input.time } : {}),
            ...(input.label !== undefined ? { label: input.label } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {})
          };
          if (input.days !== undefined) {
            if (input.days === null || input.days.length === 0) delete next.days;
            else next.days = input.days;
          }
          return next;
        })
      }));
      try {
        const reminder = await api.updateReminder(input);
        setState((current) => ({
          ...current,
          reminders: current.reminders.map((entry) =>
            entry.id === reminder.id ? reminder : entry
          )
        }));
        return reminder;
      } catch (cause) {
        await reload();
        throw cause;
      }
    },
    [reload]
  );

  const deleteReminder = useCallback(async (input: DeleteReminderInput) => {
    const api = apiOrThrow();
    if (!api.deleteReminder) throw new Error('当前存储不支持删除提醒。');
    await api.deleteReminder(input);
    setState((current) => ({
      ...current,
      reminders: current.reminders.filter((reminder) => reminder.id !== input.id)
    }));
  }, []);

  const createMemory = useCallback(
    async (input: CreateMemoryInput) => {
      const api = apiOrThrow();
      if (!api.createMemory) throw new Error('当前存储不支持新增记忆。');
      const record = await api.createMemory(input);
      setState((current) => ({
        ...current,
        memoryRecords: [record, ...current.memoryRecords]
      }));
      await refreshMemoryProfile();
      return record;
    },
    [refreshMemoryProfile]
  );

  return {
    ...state,
    reload,
    refreshKnowledge,
    retry: reload,
    createTask,
    updateTask,
    deleteTask,
    updateWorkspace,
    createNote,
    updateNote,
    createPracticeSet,
    submitPracticeAnswer,
    generatePlan,
    searchWorkspace,
    searchAll,
    send,
    stream,
    cancelStream,
    submitReview,
    createReminder,
    updateReminder,
    deleteReminder,
    createMemory,
    updateMemory,
    deleteMemory,
    createLongPlan,
    recalibrateLongPlan,
    setLongPlanItemDone,
    deleteLongPlan,
    createKnowledgeTopic,
    updateKnowledgeTopic,
    deleteKnowledgeTopic,
    getKnowledgeNote,
    saveKnowledgeNote,
    getKnowledgeBacklinks
  };
}
