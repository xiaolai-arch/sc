import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { addLocalDays, formatChineseDate, formatLocalDate } from '../../shared/date';
import {
  DAILY_WORKSPACE_ID,
  type Conversation,
  type ConversationMessage
} from '../../shared/conversations';
import type { LongPlan, LongPlanDay } from '../../shared/plans';
import type { SendMessageInput, WorkspaceNote } from '../../shared/workspace';
import {
  DEFAULT_AGENT_PERMISSIONS,
  type AgentPermissions,
  type ChatAttachment,
  type MessageAttachment
} from '../../shared/attachments';
import type { ProviderConfig } from '../../shared/types';
import type { CommitmentSummary } from '../../shared/notifications';
import { collectNotifications } from '../../shared/notifications';
import type { FocusSnapshotRecord } from '../../shared/ipc';
import type { ButlerReference } from '../../shared/butler-stream';
import type { PracticeMistake, PracticeSet } from '../../shared/practice';
import type { SearchResult } from '../../shared/search';
import { localCliModels, useLocalCliModels } from '../local-cli-models';
import { SettingsPage } from '../settings/SettingsPage';
import { Dialog } from '../ui/Dialog';
import { ChatPane } from './ChatPane';
import {
  FOCUS_DURATION_MS,
  FOCUS_TICK_MS,
  decideFocusRestore,
  firstFocusableTask,
  focusCompletionStatus,
  nextActualMin,
  pauseFocusSession,
  resumeFocusSession,
  startFocusSession,
  tickFocus,
  type FocusSession
} from './focus-timer';
import { KnowledgePage } from './KnowledgePage';
import { GlobalSearchDialog } from './GlobalSearchDialog';
import { FirstRunDialog } from './FirstRunDialog';
import { LearningPane } from './LearningPane';
import { MistakeReviewDialog } from './MistakeReviewDialog';
import { LongPlanPage } from './LongPlanPage';
import { MemoryPage } from './MemoryPage';
import { ModelPickerDialog } from './ModelPickerDialog';
import { PracticeSetDialog } from './PracticeSetDialog';
import { PracticeReviewChip } from './PracticePanels';
import { ProfilePage } from './ProfilePage';
import { TodayOverview, dueRevisitTopics, todayQuizOffer } from './TodayOverview';
import type { OneThingPreference, OneThingStore } from './TodayOverview';
import {
  NavigationSidebar,
  type ChatScope,
  type NavSection,
  type Section
} from './NavigationSidebar';
import { PageFrame } from './PageFrame';
import { ProjectsPage } from './ProjectsPage';
import { QuickCaptureDialog } from './QuickCaptureDialog';
import { NotificationCenter } from './NotificationCenter';
import { RemindersPage } from './RemindersPage';
import { ReviewPage } from './ReviewPage';
import type { ExamWritingStore } from './ReviewRecords';
import { SchedulePage } from './SchedulePage';
import {
  conversationRuns,
  isActiveRun,
  isLiveRun,
  runStatus,
  runToChatMessage,
  useConversationRuns,
  type ConversationRunStatus
} from './conversation-runs';
import { stepsToTrace } from './trace';
import type { ChatMessage, ChatTraceItem } from './types';
import { useConversations } from './useConversations';
import { useWorkspaceData } from './useWorkspaceData';
import { friendlyErrorMessage } from '../../shared/errors';

type WorkspaceProps = {
  hasApiKey: boolean;
  needsOnboarding?: boolean;
  onRefresh: () => void;
};

function messageOf(cause: unknown) {
  return friendlyErrorMessage(cause);
}

/** Butler tools that may append knowledge evidence as a side effect. */
const KNOWLEDGE_TOOLS = new Set([
  'record_knowledge',
  'write_note',
  'update_task',
  'save_review'
]);

/** True when Tailwind's `md` breakpoint (768px) is not met. */
function isNarrowScreen(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < 768;
}

function chatMessageId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * One focus-restore prompt per app run (iter33 P2b①, spec 默认决定 4). The
 * prompt shows the first time the snapshot's own workspace view is open;
 * module scope keeps section switches and component remounts from asking
 * again within the same run. A fresh launch resets it naturally.
 */
let focusRestoreConsumed = false;

/** Drops the payload before it is persisted with the user's message. */
function messageAttachmentsOf(attachments: ChatAttachment[]): MessageAttachment[] {
  return attachments.map(({ name, mediaType, size, kind }) => ({ name, mediaType, size, kind }));
}

/**
 * Quiz-offer cooldown. The offer must show at most once per local day, and the
 * fact "shown" is a renderer-side fact, so it lives in the shell's existing
 * lightweight-prefs localStorage (the same store that already keeps the theme
 * and the sidebar width) rather than in AppSettings: extending AppSettings
 * would change the shared settings/IPC contract. In Electron this persists in
 * the app's profile under userData across restarts; on the web build it is the
 * browser profile. Storage failures degrade to "offer again next launch".
 */
const QUIZ_OFFER_DATE_KEY = 'asaki:today-quiz-offer-date';

function readQuizOfferDate(): string | null {
  try {
    return window.localStorage.getItem(QUIZ_OFFER_DATE_KEY);
  } catch {
    return null;
  }
}

function recordQuizOfferDate(today: string): void {
  try {
    window.localStorage.setItem(QUIZ_OFFER_DATE_KEY, today);
  } catch {
    // Storage unavailable; the worst case is the offer appearing again.
  }
}

/**
 * 今日只做一件 lives beside the quiz-offer date in the same lightweight-prefs
 * store. Only the mode, the local day it was chosen on, and the chosen task
 * id are kept: a restart therefore keeps the mode, and a new local day keeps
 * the mode but drops the choice (the Today page reconciles that on load).
 * Malformed or unavailable storage degrades to "mode off".
 */
const ONE_THING_KEY = 'asaki:today-one-thing';

function readOneThingPreference(): OneThingPreference | null {
  try {
    const raw = window.localStorage.getItem(ONE_THING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OneThingPreference> | null;
    if (!parsed || typeof parsed.enabled !== 'boolean' || typeof parsed.date !== 'string') {
      return null;
    }
    return {
      enabled: parsed.enabled,
      date: parsed.date,
      taskId: typeof parsed.taskId === 'string' ? parsed.taskId : null
    };
  } catch {
    return null;
  }
}

function recordOneThingPreference(preference: OneThingPreference): void {
  try {
    window.localStorage.setItem(ONE_THING_KEY, JSON.stringify(preference));
  } catch {
    // Storage unavailable; the mode still works for this run.
  }
}

const oneThingStore: OneThingStore = {
  load: readOneThingPreference,
  save: recordOneThingPreference
};

/**
 * The one-time pre-exam writing ask lives beside the quiz-offer cooldown and
 * the one-thing mode in the same lightweight-prefs store: the fact "already
 * asked for this exam" is a renderer-side fact, and extending AppSettings
 * would change the shared settings/IPC contract for a purely local preference.
 * One key per exam target date (`asaki:exam-writing-asked:<targetDate>`),
 * value = the local day the ask was sent; clearing browser data simply asks
 * again. Storage failures degrade to "ask again next launch".
 */
const EXAM_WRITING_ASKED_PREFIX = 'asaki:exam-writing-asked:';

const examWritingStore: ExamWritingStore = {
  load: (targetDate) => {
    try {
      return window.localStorage.getItem(`${EXAM_WRITING_ASKED_PREFIX}${targetDate}`);
    } catch {
      return null;
    }
  },
  save: (targetDate, sentOn) => {
    try {
      window.localStorage.setItem(`${EXAM_WRITING_ASKED_PREFIX}${targetDate}`, sentOn);
    } catch {
      // Storage unavailable; the worst case is the ask appearing again.
    }
  }
};

function WorkspaceStatus({
  title,
  detail,
  actionLabel,
  onAction,
  alert = false
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  alert?: boolean;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-[#f5f5f7] p-4 dark:bg-[#0f0f10]">
      <div
        role={alert ? 'alert' : 'status'}
        className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-[#1c1c1e]"
      >
        <p className="text-[16px] font-semibold tracking-tight text-black dark:text-[#f5f5f7]">{title}</p>
        {detail ? <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#a1a1a6]">{detail}</p> : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function Workspace({ hasApiKey, needsOnboarding = false, onRefresh }: WorkspaceProps) {
  const {
    workspaces,
    tasks,
    notes,
    reviews,
    practiceSets,
    practiceMistakes,
    practiceDue,
    practiceAttempts,
    memoryProfile,
    reminders,
    pendingCommitments,
    commitments,
    weekAvailability,
    longPlans,
    knowledgeTopics,
    loading,
    error,
    retry,
    reload,
    refreshKnowledge,
    stream,
    submitPracticeAnswer,
    submitPracticeShortAnswer,
    reviewPracticeMistake,
    resolvePracticeMistake,
    exportMistakeSheet,
    exportAnkiMistakes,
    exportAnkiSet,
    savePracticeMistakeCause,
    archiveResolvedMistakes,
    listArchivedMistakes,
    restoreArchivedMistake,
    createTask,
    updateTask,
    deleteTask,
    updateWorkspace,
    deleteWorkspace,
    createNote,
    updateNote,
    deleteNote,
    createReminder,
    updateReminder,
    deleteReminder,
    resolveCommitmentEntry,
    clearWeekAvailability,
    createMemory,
    createPracticeSet,
    updatePracticeSet,
    deletePracticeSet,
    memoryRecords,
    updateMemory,
    deleteMemory,
    createLongPlan,
    updateLongPlan,
    recalibrateLongPlan,
    setLongPlanItemDone,
    deleteLongPlan,
    createKnowledgeTopic,
    updateKnowledgeTopic,
    deleteKnowledgeTopic,
    mergeKnowledgeTopics,
    getKnowledgeNote,
    saveKnowledgeNote,
    getKnowledgeBacklinks,
    searchAll
  } = useWorkspaceData();
  const conversations = useConversations();
  const runState = useConversationRuns();
  const [section, setSection] = useState<Section>('chat');
  const [chatScope, setChatScope] = useState<ChatScope>('daily');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Remember who opened the mobile drawer so focus can return there on close.
  const sidebarOpenerRef = useRef<HTMLElement | null>(null);
  const sidebarWasOpenRef = useRef(false);
  const [previewNote, setPreviewNote] = useState<WorkspaceNote | null>(null);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<PracticeMistake[] | null>(null);
  const [practiceSetId, setPracticeSetId] = useState<string | null>(null);
  const [renameSetId, setRenameSetId] = useState<string | null>(null);
  const [confirmDeleteSetId, setConfirmDeleteSetId] = useState<string | null>(null);
  const [practiceError, setPracticeError] = useState<string | null>(null);
  const [composerText, setComposerText] = useState('');
  /** Files staged for the next message. */
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [permissions, setPermissions] = useState<AgentPermissions>(DEFAULT_AGENT_PERMISSIONS);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  /** The pending restore prompt, shown once in the session's own workspace view. */
  const [focusRestore, setFocusRestore] = useState<{ session: FocusSession; label: string } | null>(
    null
  );
  const focusSnapshotRef = useRef<FocusSnapshotRecord | null>(null);
  const focusSnapshotLoadedRef = useRef(false);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [knowledgeFocusTopicId, setKnowledgeFocusTopicId] = useState<string | null>(null);
  const [planFocusId, setPlanFocusId] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [budgetPrompt, setBudgetPrompt] = useState<{ used: number; limit: number } | null>(
    null
  );
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsPromptOpen, setSettingsPromptOpen] = useState(false);
  const settingsDirtyRef = useRef(false);
  settingsDirtyRef.current = settingsDirty;
  const sectionRef = useRef<Section>('chat');
  sectionRef.current = section;
  /** The navigation the user asked for while Settings had unsaved edits. */
  const pendingNavigationRef = useRef<(() => void) | null>(null);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const budgetConfirmResolveRef = useRef<((accepted: boolean) => void) | null>(null);
  const budgetConfirmedRef = useRef(false);
  const focusSessionCounterRef = useRef(0);
  const recordedFocusSessionsRef = useRef<Set<number>>(new Set());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [traceById, setTraceById] = useState<Record<string, ChatTraceItem[]>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [canRetryTurn, setCanRetryTurn] = useState(false);
  const [modelLabel, setModelLabel] = useState('模板计划');
  const [provider, setProvider] = useState<ProviderConfig | null>(null);
  const cliModels = useLocalCliModels();
  const [displayName, setDisplayName] = useState('xiaolai');
  /** Opt-in stricter mastery; mirrors the setting so the surfaces can state it. */
  const [strictMastery, setStrictMastery] = useState(false);
  const retryTurnRef = useRef<{
    text: string;
    conversation: Conversation;
    attachments: ChatAttachment[];
  } | null>(null);
  /** Files sent with each user message, kept in memory so regenerate can reuse them. */
  const sentAttachmentsRef = useRef(new Map<string, ChatAttachment[]>());
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = conversations.active?.id ?? null;
  /** A turn can outlive its view (navigation, test teardown); stop updating then. */
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Each conversation remembers its own permissions; a fresh draft starts from
  // the defaults, and staged files never follow the user across threads.
  const syncedConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    const id = conversations.active?.id ?? null;
    if (syncedConversationIdRef.current === id) return;
    syncedConversationIdRef.current = id;
    setPendingAttachments([]);
    setPermissions(conversations.active?.permissions ?? DEFAULT_AGENT_PERMISSIONS);
  }, [conversations.active]);

  // Pick up turns the main process saved before it quit; they show as
  // interrupted instead of a spinner that can never finish.
  useEffect(() => {
    void conversationRuns.hydrate();
  }, []);

  // Stream side effects: a tool may write knowledge mid-turn, and an error
  // must reach the banner only when its conversation is the one on screen.
  useEffect(
    () =>
      conversationRuns.subscribeEvents((event, run) => {
        if (event.type === 'tool-result') {
          if (event.ok && KNOWLEDGE_TOOLS.has(event.name)) void refreshKnowledge();
          return;
        }
        if (event.type === 'error') {
          // The ref lags one render behind `active` right after a conversation
          // is created, so a run with no open conversation still reaches the
          // banner; a failure in some other conversation stays quiet.
          const visible = activeConversationIdRef.current;
          if (mountedRef.current && (visible === null || visible === run.conversationId)) {
            setActionError(event.message);
          }
        }
      }),
    [refreshKnowledge]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) return;
      event.preventDefault();
      setSearchOpen(true);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Restore focus to the opener once the drawer really closes. If that control
  // unmounted (e.g. navigating to another section), leave focus alone.
  useEffect(() => {
    if (sidebarOpen) {
      sidebarWasOpenRef.current = true;
      return;
    }
    if (!sidebarWasOpenRef.current) return;
    sidebarWasOpenRef.current = false;
    const opener = sidebarOpenerRef.current;
    sidebarOpenerRef.current = null;
    if (opener?.isConnected) opener.focus();
  }, [sidebarOpen]);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === projectId) ?? null;
  const previewRelatedTitles = previewNote
    ? previewNote.related
        .map((id) => notes.find((note) => note.id === id)?.title)
        .filter((title): title is string => Boolean(title))
    : [];
  const chatWorkspaceId =
    chatScope === 'workspace'
      ? projectId
      : chatScope === 'daily'
        ? DAILY_WORKSPACE_ID
        : null;
  const chatWorkspaceTasks = projectId
    ? tasks.filter((task) => task.workspaceId === projectId)
    : [];
  const chatStats = currentWorkspace
    ? [
        `${chatWorkspaceTasks.filter((task) => task.status !== 'done' && task.status !== 'skipped').length} 个待办`,
        `${notes.filter((note) => note.workspaceId === currentWorkspace.id).length} 条记录`,
        `${memoryRecords.filter((record) => record.workspaceId === currentWorkspace.id).length} 条记忆`
      ]
    : [];
  const contextLabel = currentWorkspace?.name ?? (chatScope === 'unfiled' ? '未分组' : '日常');
  const homeTitle = currentWorkspace?.name ?? contextLabel;
  const homeGoal = currentWorkspace
    ? currentWorkspace.goal
    : chatScope === 'unfiled'
      ? '还没有归入项目的对话'
      : '每天的检查、随手记和日常对话';
  const homeHint = currentWorkspace
    ? `在这里和阿咲聊${currentWorkspace.name}，或直接开始一个新对话。`
    : chatScope === 'unfiled'
      ? '在这里和阿咲聊，创建后会留在未分组。'
      : '在这里和阿咲聊日常，或直接开始一个新对话。';
  const filteredPracticeSets = practiceSets.filter(
    (set) => !projectId || set.workspaceId === projectId
  );
  const selectedPracticeSet =
    filteredPracticeSets.find((set) => set.id === practiceSetId) ??
    filteredPracticeSets[0] ??
    null;
  // The project whose 错题本 is on screen; the archive actions act on it.
  const mistakeBookProjectId =
    projectId ?? practiceMistakes[0]?.workspaceId ?? workspaces[0]?.id ?? '';
  const today = formatLocalDate(new Date());
  const dateLabel = formatChineseDate(today);
  // A reminder comes due by the clock, not by a click, so the digest needs a
  // clock of its own; without it the dot would wait for an unrelated render.
  const [notificationClock, setNotificationClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNotificationClock(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  // Recomputed from the stores and that clock, never cached: a row disappears
  // the moment the user acts on it elsewhere.
  const notificationDigest = collectNotifications({
    reminders,
    commitments: pendingCommitments,
    snoozedUntil,
    now: new Date(notificationClock)
  });
  const notificationAttention = notificationDigest.items.length > 0;
  const dueRevisits = useMemo(
    () => dueRevisitTopics(knowledgeTopics, today),
    [knowledgeTopics, today]
  );
  // The practice data itself speaking: one proactive quiz offer per day, from
  // the active mistake book and the 8-week accuracy window. The cooldown date
  // is written the moment an offer renders, so the next mount stays silent.
  const todayQuiz = useMemo(
    () => todayQuizOffer(practiceAttempts, practiceMistakes, today, readQuizOfferDate()),
    [practiceAttempts, practiceMistakes, today]
  );
  useEffect(() => {
    if (todayQuiz) recordQuizOfferDate(today);
  }, [todayQuiz, today]);

  const loadModelLabel = useCallback(async () => {
    const api = window.studyCoach;
    if (!api) {
      setModelLabel('模板计划');
      return;
    }
    try {
      const settings = await api.getSettings();
      setProvider(settings.provider);
      setModelLabel(
        settings.provider.kind === 'local-cli'
          ? settings.provider.model ?? settings.provider.agent
          : settings.provider.model
      );
      setDisplayName(settings.displayName?.trim() || 'xiaolai');
      setSnoozedUntil(settings.notifications.snoozedUntil ?? null);
      setStrictMastery(settings.strictMastery === true);
    } catch {
      setModelLabel('模板计划');
    }
  }, []);

  useEffect(() => {
    void loadModelLabel();
  }, [loadModelLabel]);

  // The chat picker offers the same models the settings page shows, so the
  // local CLI scan is loaded once and shared through the module-level store.
  const localCliAgent = provider?.kind === 'local-cli' ? provider.agent : null;
  useEffect(() => {
    if (!localCliAgent) return;
    void localCliModels.load();
  }, [localCliAgent]);
  const cliModelCatalog =
    localCliAgent !== null && cliModels.scan
      ? (cliModels.scan.entries.find((entry) => entry.agent === localCliAgent)?.modelCatalog ??
        null)
      : null;
  const globalModelLabel =
    provider?.kind === 'local-cli'
      ? provider.model?.trim() ||
        (cliModelCatalog?.defaultModel
          ? `继承 CLI 默认（${cliModelCatalog.defaultModel}）`
          : '继承 CLI 默认')
      : provider?.model?.trim() || modelLabel;

  useEffect(() => {
    if (!focus?.running) return undefined;
    const id = window.setInterval(() => {
      setFocus((current) => (current && current.running ? tickFocus(current) : current));
    }, FOCUS_TICK_MS);
    return () => window.clearInterval(id);
  }, [focus?.running]);

  // 中断现场包（iter33 P2b①）: read the single focus-snapshot slot once per
  // run. The 1s tick never touches this channel — only state transitions do.
  useEffect(() => {
    const api = window.studyCoach;
    if (!api?.getFocusSnapshot) {
      focusSnapshotLoadedRef.current = true;
      return undefined;
    }
    void api
      .getFocusSnapshot()
      .then((snapshot) => {
        focusSnapshotRef.current = snapshot;
        focusSnapshotLoadedRef.current = true;
      })
      .catch(() => {
        focusSnapshotRef.current = null;
        focusSnapshotLoadedRef.current = true;
      });
    return undefined;
  }, []);

  // The restore prompt appears once, only in the workspace view the session
  // belongs to, and never as a global toast (spec 默认决定 4).
  useEffect(() => {
    if (focusRestoreConsumed || !focusSnapshotLoadedRef.current) return;
    if (section !== 'plan' || !projectId || focus) return;
    const decision = decideFocusRestore(focusSnapshotRef.current, projectId, today);
    if (decision.action === 'restore') {
      focusRestoreConsumed = true;
      setFocusRestore({ session: decision.session, label: decision.label });
      return;
    }
    // Same workspace but the day (or the record's shape) fails the restore
    // rule: drop the stale slot so it never lingers in state.json. A
    // different workspace's snapshot is left alone — its own view may still
    // restore it later in this run.
    if (
      focusSnapshotRef.current &&
      focusSnapshotRef.current.workspaceId === projectId
    ) {
      focusSnapshotRef.current = null;
      void window.studyCoach?.setFocusSnapshot?.(null).catch(() => undefined);
    }
  }, [section, projectId, focus, today]);

  useEffect(() => {
    const api = window.studyCoach;
    if (!api?.onQuickCapture) return undefined;
    return api.onQuickCapture(() => setQuickCaptureOpen(true));
  }, []);

  useEffect(() => {
    const api = window.studyCoach;
    if (!api?.onNavigate) return undefined;
    return api.onNavigate((target) => {
      if (target === 'settings') {
        setSidebarOpen(false);
        setSection('settings');
        return;
      }
      guardSettings(() => {
        setSidebarOpen(false);
        setProjectId(null);
        setSection('review');
      });
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLowerCase() !== 'n') return;
      if (quickCaptureOpen) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable) {
        return;
      }
      event.preventDefault();
      startDraft();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [quickCaptureOpen]);

  useEffect(() => {
    if (!focus || focus.remainingMs > 0 || focus.recorded) return;
    if (recordedFocusSessionsRef.current.has(focus.sessionId)) return;
    recordedFocusSessionsRef.current.add(focus.sessionId);
    const settled: FocusSession = { ...focus, recorded: true };
    setFocus(settled);
    // 结算 is one of the snapshot's write points: the finished round (time at
    // zero) fails the restore rule, so the next launch has nothing to offer.
    writeFocusSnapshot(settled);
    const task = tasksRef.current.find((entry) => entry.id === focus.taskId);
    if (!task) {
      setFocusNotice('专注完成，但任务已不存在。');
      return;
    }
    void (async () => {
      try {
        await updateTask({
          taskId: task.id,
          status: focusCompletionStatus(task.status),
          actualMin: nextActualMin(task.actualMin)
        });
        setFocusNotice('专注完成，已记录 25 分钟');
      } catch (cause) {
        setFocusNotice(messageOf(cause));
      }
    })();
  }, [focus?.remainingMs, focus?.recorded, focus?.sessionId, updateTask]);

  useEffect(() => {
    const active = conversations.active;
    if (!active) return;
    if (active.workspaceId === DAILY_WORKSPACE_ID) {
      setProjectId(null);
      setChatScope('daily');
      return;
    }
    if (active.workspaceId) {
      setProjectId(active.workspaceId);
      setChatScope('workspace');
      return;
    }
    setProjectId(null);
    setChatScope(active.kind === 'check-in' ? 'daily' : 'unfiled');
  }, [conversations.active?.id, conversations.active?.workspaceId, conversations.active?.kind]);

  // Tray/notification opens bypass the sidebar, so make sure the renderer
  // actually leaves Settings/Projects and shows the selected conversation.
  useEffect(() => {
    const external = conversations.externalOpen;
    if (!external) return;
    guardSettings(() => {
      setActionError(null);
      setEditingMessageId(null);
      setComposerText('');
      setModelPickerOpen(false);
      setModelError(null);
      setSidebarOpen(false);
      setSection('chat');
      void conversations.select(external.id);
    });
  }, [conversations.externalOpen, conversations.select]);

  const activeConversation = conversations.active;
  const activeRun =
    activeConversation === null
      ? null
      : runState.runs.find(
          (run) => run.conversationId === activeConversation.id && isLiveRun(run)
        ) ?? null;
  // A run restored from disk may already be persisted in the conversation;
  // drawing both would show the same answer twice, so the file wins.
  const activeRunPersisted = Boolean(
    activeRun &&
      activeConversation?.messages.some(
        (message) => message.id === activeRun.assistantMessageId
      )
  );
  // Only an unfinished turn owns the composer and the Stop button; a failed or
  // interrupted run stays on screen as a partial answer with its notice.
  const typing = activeRun !== null && isActiveRun(activeRun);
  const typingStatus = activeRun?.statusMessage ?? null;

  const chatMessages: ChatMessage[] = [
    ...(activeConversation?.messages ?? []).map((message): ChatMessage => {
      const trace =
        message.role === 'assistant'
          ? traceById[message.id] ?? stepsToTrace(message.steps)
          : [];
      return {
        id: message.id,
        role: message.role,
        text: message.text,
        ...(trace.length > 0 ? { trace } : {}),
        ...(message.references && message.references.length > 0
          ? { references: message.references }
          : {}),
        ...(message.attachments && message.attachments.length > 0
          ? { attachments: message.attachments }
          : {}),
        streaming: false
      };
    }),
    ...(activeRun && !activeRunPersisted ? [runToChatMessage(activeRun)] : [])
  ];

  /** Per-conversation status for the sidebar dots. */
  const runStates = useMemo(() => {
    const priority: Record<ConversationRunStatus, number> = {
      running: 3,
      failed: 2,
      interrupted: 1,
      completed: 0
    };
    const statuses: Record<string, ConversationRunStatus> = {};
    for (const run of runState.runs) {
      const status = runStatus(run);
      const current = statuses[run.conversationId];
      if (current === undefined || priority[status] > priority[current]) {
        statuses[run.conversationId] = status;
      }
    }
    return statuses;
  }, [runState]);

  /**
   * Manual turns keep working after the daily token budget is spent, but the
   * user confirms once per app session instead of being silently blocked.
   */
  async function confirmBudget(): Promise<boolean> {
    if (budgetConfirmedRef.current) return true;
    const api = window.studyCoach;
    if (!api?.getUsageSummary) return true;
    try {
      const [settings, usage] = await Promise.all([api.getSettings(), api.getUsageSummary(1)]);
      const day = usage.days.find((entry) => entry.date === today);
      const used = (day?.inputTokens ?? 0) + (day?.outputTokens ?? 0);
      const limit = settings.budget.dailyTokens;
      // A zero budget only pauses proactive check-ins, not manual turns.
      if (!(limit > 0) || used < limit) return true;
      return await new Promise<boolean>((resolve) => {
        budgetConfirmResolveRef.current = resolve;
        setBudgetPrompt({ used, limit });
      });
    } catch {
      // Budget lookup failures must never block a conversation.
      return true;
    }
  }

  function settleBudget(accepted: boolean) {
    if (accepted) budgetConfirmedRef.current = true;
    budgetConfirmResolveRef.current?.(accepted);
    budgetConfirmResolveRef.current = null;
    setBudgetPrompt(null);
  }

  /**
   * Starts one turn. The run lives in the main process, so this returns as soon
   * as the prompt is stored: navigating away no longer cancels the answer.
   */
  async function runTurn(
    text: string,
    options: {
      appendUser: boolean;
      conversation?: Conversation | null;
      /** Ignores the currently open conversation and creates a fresh one. */
      newConversation?: boolean;
      /** Overrides the chat scope for a newly created conversation. */
      workspaceId?: string | null;
      /** Files attached to this turn only. */
      attachments?: ChatAttachment[];
    }
  ): Promise<boolean> {
    const turnAttachments = options.attachments ?? [];
    const starting = options.newConversation
      ? null
      : options.conversation ?? conversations.active;
    // One turn per conversation; another conversation may still be generating.
    if (starting && conversationRuns.hasActive(starting.id)) return false;
    if (!(await confirmBudget())) return false;
    retryTurnRef.current = null;
    setCanRetryTurn(false);
    setActionError(null);

    let conversation = starting;
    const creationWorkspaceId =
      options.workspaceId !== undefined
        ? options.workspaceId
        : conversation
          ? conversation.workspaceId ?? null
          : chatWorkspaceId;
    if (!conversation) {
      try {
        conversation = await conversations.create({
          ...(creationWorkspaceId ? { workspaceId: creationWorkspaceId } : {}),
          permissions
        });
      } catch (cause) {
        if (mountedRef.current) setActionError(messageOf(cause));
        return false;
      }
    }

    if (options.appendUser) {
      const userMessage: ConversationMessage = {
        id: chatMessageId('u'),
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
        source: 'user',
        ...(turnAttachments.length > 0
          ? { attachments: messageAttachmentsOf(turnAttachments) }
          : {})
      };
      try {
        await conversations.append(conversation.id, userMessage);
      } catch (cause) {
        if (mountedRef.current) setActionError(messageOf(cause));
        // The user message never reached the conversation, so the caller must
        // keep the draft instead of clearing it.
        return false;
      }
      if (turnAttachments.length > 0) {
        sentAttachmentsRef.current.set(userMessage.id, turnAttachments);
      }
    }

    const target = conversation;
    const assistantId = chatMessageId('a');
    // Registering the run before the request goes out means the placeholder is
    // on screen even if the user jumps to another page immediately.
    conversationRuns.start({
      runId: assistantId,
      conversationId: target.id,
      assistantMessageId: assistantId,
      userText: text
    });

    const runtimeWorkspaceId =
      target.workspaceId && target.workspaceId !== DAILY_WORKSPACE_ID
        ? target.workspaceId
        : undefined;
    // Deliberately not awaited: the answer keeps arriving while the user
    // navigates, and `settleRun` refreshes the views it may have touched.
    void stream(
      {
        ...(runtimeWorkspaceId ? { workspaceId: runtimeWorkspaceId } : {}),
        conversationId: target.id,
        assistantMessageId: assistantId,
        message: text,
        permissions,
        ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {})
      } satisfies SendMessageInput,
      (event) => {
        conversationRuns.applyEvent(assistantId, event);
      }
    )
      .then(() => settleRun(assistantId, target, text, turnAttachments))
      .catch((cause: unknown) => settleRun(assistantId, target, text, turnAttachments, cause));
    return true;
  }

  /**
   * Refreshes after a turn ends. It never selects a conversation: a turn that
   * finishes in the background must not move the user's view.
   */
  async function settleRun(
    runId: string,
    conversation: Conversation,
    text: string,
    attachments: ChatAttachment[],
    cause?: unknown
  ): Promise<void> {
    const run = conversationRuns.get(runId);
    const errorReason = run?.errorReason ?? null;
    // Settle the run before copying its trace: a copied "thinking" or "running"
    // row would otherwise stay animated forever once the run is gone.
    if (cause) {
      conversationRuns.fail(runId, errorReason ?? messageOf(cause));
    } else {
      conversationRuns.complete(runId);
    }
    const settled = conversationRuns.get(runId);
    if (settled && mountedRef.current) {
      const trace = settled.trace.map((item) => ({ ...item }));
      if (trace.length > 0) {
        setTraceById((current) => ({ ...current, [runId]: trace }));
      }
    }
    try {
      await conversations.refresh();
      if (activeConversationIdRef.current === conversation.id) {
        await conversations.reloadActive();
      }
    } catch {
      // The message list keeps the last good copy; the next refresh retries.
    }
    if (!cause) return;
    const message = errorReason ?? messageOf(cause);
    // A failed turn never reached the wrapper's reload, but tools it ran
    // before failing may already have written data.
    try {
      await reload();
    } catch {
      // The error banner below already explains the turn's failure.
    }
    if (mountedRef.current && activeConversationIdRef.current === conversation.id) {
      setActionError(message);
      // Keep enough state for the banner to resend instead of only refreshing.
      retryTurnRef.current = { text, conversation, attachments };
      setCanRetryTurn(true);
    }
  }

  async function submitComposer(text: string): Promise<boolean> {
    // While another conversation is loading, `active` is null; sending now
    // would create a brand-new thread instead of reaching the selected one.
    if (conversations.selecting) return false;
    if (conversations.active && conversationRuns.hasActive(conversations.active.id)) {
      return false;
    }
    const conversation = conversations.active;
    if (!(await confirmBudget())) return false;
    if (editingMessageId && conversation) {
      const index = conversation.messages.findIndex(
        (message) => message.id === editingMessageId
      );
      if (index >= 0) {
        try {
          await conversations.truncate(conversation.id, index);
        } catch (cause) {
          setActionError(messageOf(cause));
          return false;
        }
      }
    }
    setEditingMessageId(null);
    const sent = await runTurn(text, {
      appendUser: true,
      conversation,
      attachments: pendingAttachments
    });
    // Only the turn that went out consumes the files; a failed send keeps them
    // staged so the user can retry without picking the files again.
    if (sent) setPendingAttachments([]);
    return sent;
  }

  async function regenerateMessage(messageId: string) {
    const conversation = conversations.active;
    if (!conversation) return;
    if (conversationRuns.hasActive(conversation.id)) return;
    const lastAssistant = [...conversation.messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    const index = conversation.messages.findIndex((message) => message.id === messageId);
    if (!lastAssistant || lastAssistant.id !== messageId || index < 0) return;
    if (conversation.messages[conversation.messages.length - 1]?.id !== messageId) return;
    const userMessage = conversation.messages
      .slice(0, index)
      .reverse()
      .find((message) => message.role === 'user');
    if (!userMessage) return;
    try {
      await conversations.truncate(conversation.id, index);
    } catch (cause) {
      setActionError(messageOf(cause));
      return;
    }
    const attachments = sentAttachmentsRef.current.get(userMessage.id) ?? [];
    await runTurn(userMessage.text, {
      appendUser: false,
      conversation,
      ...(attachments.length > 0 ? { attachments } : {})
    });
  }

  function editLastUserMessage(messageId: string) {
    const conversation = conversations.active;
    if (!conversation) return;
    if (conversationRuns.hasActive(conversation.id)) return;
    const lastUser = [...conversation.messages]
      .reverse()
      .find((message) => message.role === 'user');
    if (!lastUser || lastUser.id !== messageId) return;
    setEditingMessageId(messageId);
    setComposerText(lastUser.text);
  }

  function cancelEdit() {
    setEditingMessageId(null);
    setComposerText('');
  }

  /**
   * The renderer's half of the focus-snapshot contract (iter33 P2b①): one
   * write per state transition — start / pause / resume / settlement / reset
   * — plus the quit-time settle done main-side. The 1s tick never calls this.
   * A null session clears the slot. Failures stay silent: the snapshot is a
   * convenience, never a correctness dependency.
   */
  function writeFocusSnapshot(session: FocusSession | null) {
    const api = window.studyCoach;
    if (!api?.setFocusSnapshot) return;
    const input =
      session === null || !projectId ? null : { workspaceId: projectId, session };
    void api.setFocusSnapshot(input).catch(() => undefined);
  }

  function startFocusForTask(taskId: string) {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    focusSessionCounterRef.current += 1;
    const session = startFocusSession(focusSessionCounterRef.current, task);
    setFocus(session);
    // A fresh start replaces any pending restore prompt and its snapshot.
    setFocusRestore(null);
    writeFocusSnapshot(session);
    setFocusNotice(null);
  }

  function startDefaultFocus() {
    const task = firstFocusableTask(tasks);
    if (task) startFocusForTask(task.id);
  }

  function pauseFocus() {
    if (!focus) return;
    const paused = pauseFocusSession(focus);
    setFocus(paused);
    writeFocusSnapshot(paused);
  }

  function resumeFocus() {
    if (!focus) return;
    const resumed = resumeFocusSession(focus);
    setFocus(resumed);
    writeFocusSnapshot(resumed);
  }

  function resetFocus() {
    if (!focus) return;
    focusSessionCounterRef.current += 1;
    const restarted: FocusSession = {
      ...focus,
      sessionId: focusSessionCounterRef.current,
      remainingMs: FOCUS_DURATION_MS,
      running: false,
      recorded: false,
      lastTickAt: Date.now()
    };
    setFocus(restarted);
    setFocusNotice(null);
    // The reset round replaces the stored snapshot: the abandoned remainder
    // must not come back as a restore prompt on the next launch.
    writeFocusSnapshot(restarted);
  }

  /** The user clicked 继续 on the restore prompt: paused in, resume via the
   * existing path, and the resume write replaces the snapshot in one step. */
  function acceptFocusRestore() {
    if (!focusRestore) return;
    const resumed = resumeFocusSession(focusRestore.session);
    setFocus(resumed);
    setFocusRestore(null);
    writeFocusSnapshot(resumed);
  }

  /** 不要了: the snapshot is dropped, nothing is restored. */
  function dismissFocusRestore() {
    setFocusRestore(null);
    writeFocusSnapshot(null);
  }

  /**
   * The stop/abandon flow (iter33 P2b②): ends the session and, when the user
   * typed one, writes the one-line next step onto the bound task. Skipping is
   * always allowed; a failed write ends the session anyway and says so.
   */
  async function abandonFocus(nextStep: string | null) {
    const session = focus;
    if (!session) return;
    setFocus(null);
    setFocusNotice(null);
    setFocusRestore(null);
    // The session is gone, so the snapshot slot is cleared: nothing left to
    // restore on the next launch.
    writeFocusSnapshot(null);
    if (nextStep === null) return;
    try {
      await updateTask({ taskId: session.taskId, nextStep });
    } catch (cause) {
      setFocusNotice(messageOf(cause));
    }
  }

  async function renameConversation(id: string, title: string) {
    try {
      await conversations.rename(id, title);
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  }

  async function togglePinnedConversation(id: string, pinned: boolean) {
    try {
      await conversations.setPinned(id, pinned);
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  }

  async function deleteConversation(id: string) {
    // A running turn is stopped explicitly first; deleting underneath it would
    // leave its events pointing at a conversation that no longer exists.
    const run = conversationRuns.getForConversation(id);
    if (run && run.phase === 'running') {
      await conversationRuns.cancel(run.runId);
    }
    conversationRuns.clearConversation(id);
    if (conversations.active?.id === id) {
      setEditingMessageId(null);
      setComposerText('');
      setModelPickerOpen(false);
      setModelError(null);
    }
    try {
      await conversations.remove(id);
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  }

  function openModelPicker() {
    if (!conversations.active) return;
    setModelError(null);
    setModelPickerOpen(true);
  }

  /**
   * Permissions are staged in the composer for the next turn and remembered
   * with the conversation as soon as one exists.
   */
  function changePermissions(next: AgentPermissions) {
    setPermissions(next);
    const active = conversations.active;
    if (!active) return;
    void conversations.setPermissions(active.id, next).catch((cause: unknown) => {
      if (mountedRef.current) setActionError(messageOf(cause));
    });
  }

  async function saveConversationModel(model: string) {
    const active = conversations.active;
    if (!active) return;
    setModelSaving(true);
    setModelError(null);
    try {
      const trimmed = model.trim();
      await conversations.setModel(active.id, trimmed ? trimmed : null);
      setModelPickerOpen(false);
    } catch (cause) {
      setModelError(messageOf(cause));
    } finally {
      setModelSaving(false);
    }
  }

  async function snoozeCheckIns(days: number) {
    const api = window.studyCoach;
    if (!api) {
      setActionError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    // Days are counted from the local calendar day, so 0 keeps today muted and
    // 3/7 cover a trip in one click.
    const target = addLocalDays(today, days);
    try {
      const settings = await api.updateSettings({ notifications: { snoozedUntil: target } });
      setSnoozedUntil(settings.notifications.snoozedUntil ?? target);
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  }

  async function resumeCheckIns() {
    const api = window.studyCoach;
    if (!api) {
      setActionError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    // `resumedFrom` records the day the user resumed (today), which is what
    // that field means; the last muted day rides along as `resumedFromMuteEnd`
    // so the first check can truthfully say 「原定暂停到 X」 without the mute
    // still being in force. Both are cleared together by the check that
    // consumes them; an empty value never serializes.
    const prior = snoozedUntil ?? '';
    const resumePatch =
      prior !== ''
        ? { snoozedUntil: '', resumedFrom: today, resumedFromMuteEnd: prior }
        : { snoozedUntil: '' };
    try {
      const settings = await api.updateSettings({ notifications: resumePatch });
      setSnoozedUntil(settings.notifications.snoozedUntil ?? '');
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  }

  /** Stops only the turn of the conversation on screen. */
  function stopStreaming() {
    const conversationId = activeConversationIdRef.current;
    if (!conversationId) return;
    const run = conversationRuns.getForConversation(conversationId);
    if (run && run.phase === 'running') {
      void conversationRuns.cancel(run.runId);
    }
  }

  /** Opens the narrow-screen drawer, remembering the control that invoked it. */
  function openSidebar() {
    const active = document.activeElement;
    sidebarOpenerRef.current = active instanceof HTMLElement ? active : null;
    setSidebarOpen(true);
  }

  function applySection(next: Section) {
    setSection(next);
    setSidebarOpen(false);
  }

  /**
   * Runs a navigation action, but asks first when it would leave Settings with
   * unsaved edits. The action is replayed after the user confirms, so callers
   * can defer the whole jump (including workspace and draft changes).
   */
  function guardSettings(action: () => void): boolean {
    if (sectionRef.current === 'settings' && settingsDirtyRef.current) {
      pendingNavigationRef.current = action;
      setSettingsPromptOpen(true);
      return false;
    }
    action();
    return true;
  }

  function cancelPendingNavigation() {
    pendingNavigationRef.current = null;
    setSettingsPromptOpen(false);
  }

  function confirmDiscardSettings() {
    const action = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    setSettingsPromptOpen(false);
    setSettingsDirty(false);
    // The action runs before React re-renders, so update the ref the guard
    // reads directly; otherwise it would prompt a second time.
    settingsDirtyRef.current = false;
    action?.();
  }

  function changeSection(next: Section) {
    if (next === 'settings') {
      applySection(next);
      return;
    }
    guardSettings(() => applySection(next));
  }

  function resetDraftState() {
    conversations.startDraft();
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
    setSidebarOpen(false);
    setModelPickerOpen(false);
    setModelError(null);
  }

  /** Leaves the open conversation but keeps a typed composer draft. */
  function leaveConversation() {
    conversations.startDraft();
    setActionError(null);
    setEditingMessageId(null);
    setModelPickerOpen(false);
    setModelError(null);
  }

  function selectDaily() {
    guardSettings(() => {
      const alreadyHere = section === 'chat' && chatScope === 'daily';
      setSidebarOpen(false);
      setSection('chat');
      setProjectId(null);
      setChatScope('daily');
      const active = conversations.active;
      const belongsDaily =
        active?.workspaceId === DAILY_WORKSPACE_ID ||
        (!active?.workspaceId && active?.kind === 'check-in');
      if (active && belongsDaily) {
        if (alreadyHere) leaveConversation();
        return;
      }
      if (active) leaveConversation();
    });
  }

  function selectUnfiled() {
    guardSettings(() => {
      setSidebarOpen(false);
      setSection('chat');
      setProjectId(null);
      setChatScope('unfiled');
      const active = conversations.active;
      if (active && !active.workspaceId && active.kind !== 'check-in') return;
      if (active) leaveConversation();
    });
  }

  function selectWorkspace(id: string) {
    guardSettings(() => {
      setSidebarOpen(false);
      setSection('chat');
      setProjectId(id);
      setChatScope('workspace');
      // Keep an open conversation in this workspace; the folder row is a
      // disclosure toggle, not a "go home" action. 新对话 starts a fresh draft.
      if (conversations.active?.workspaceId === id) return;
      if (conversations.active) leaveConversation();
    });
  }

  function selectAll() {
    if (section === 'memory' || section === 'review') return;
    guardSettings(() => {
      setSidebarOpen(false);
      setProjectId(null);
      setSection('projects');
    });
  }

  function changeNavigation(next: NavSection) {
    if (next === 'daily') {
      selectDaily();
      return;
    }
    guardSettings(() => {
      if (next === 'knowledge' || next === 'memory' || next === 'review') {
        // These pages have their own workspace filter; keep chat scope intact.
        setProjectId(null);
      }
      changeSection(next);
    });
  }

  function openSettings() {
    changeSection('settings');
  }

  function openNotifications() {
    setNotificationsOpen(true);
  }

  /**
   * Resolving a promise happens in chat, which owns the commitment tools, so a
   * row opens a draft there with the promise quoted. Nothing is sent for the
   * user; the reply is still theirs to write.
   */
  function openCommitment(commitment: CommitmentSummary) {
    guardSettings(() => {
      applySection('chat');
      setComposerText(`关于承诺「${commitment.text}」：`);
    });
  }

  /** Every "ask the butler" affordance lands in chat and sends the prompt. */
  function promptButler(prompt: string, workspaceIdOverride?: string) {
    if (typing) return;
    guardSettings(() => {
      changeSection('chat');
      const explicitWorkspaceId =
        workspaceIdOverride ??
        projectId ??
        (chatScope === 'unfiled' ? null : DAILY_WORKSPACE_ID);
      const active = conversations.active;
      const activeWorkspaceId =
        active?.workspaceId === DAILY_WORKSPACE_ID
          ? DAILY_WORKSPACE_ID
          : active?.workspaceId ?? (active ? null : explicitWorkspaceId);
      const needsNewConversation = Boolean(
        active && activeWorkspaceId !== explicitWorkspaceId
      );
      if (needsNewConversation) {
        leaveConversation();
        if (explicitWorkspaceId === DAILY_WORKSPACE_ID) {
          setProjectId(null);
          setChatScope('daily');
        } else if (explicitWorkspaceId === null) {
          setProjectId(null);
          setChatScope('unfiled');
        } else {
          setProjectId(explicitWorkspaceId);
          setChatScope('workspace');
        }
      }
      void runTurn(prompt, {
        appendUser: true,
        workspaceId: explicitWorkspaceId,
        ...(needsNewConversation ? { newConversation: true } : {})
      });
    });
  }

  /** Schedule actions always start a cross-workspace daily conversation. */
  function promptDaily(prompt: string) {
    if (typing) return;
    guardSettings(() => {
      resetDraftState();
      setProjectId(null);
      setChatScope('daily');
      setSection('chat');
      void runTurn(prompt, {
        appendUser: true,
        newConversation: true,
        workspaceId: DAILY_WORKSPACE_ID
      });
    });
  }

  function startDraft() {
    guardSettings(() => {
      resetDraftState();
      if (projectId && section !== 'chat') {
        setChatScope('workspace');
      } else if (chatScope === 'workspace' && !projectId) {
        setChatScope('daily');
      }
      setSection('chat');
    });
  }

  function startNewWorkspace() {
    guardSettings(() => {
      resetDraftState();
      setProjectId(null);
      setChatScope('daily');
      setSection('chat');
      setComposerText('我想新建一个项目：');
    });
  }

  function selectConversation(id: string) {
    guardSettings(() => {
      // Opening a conversation never stops a turn: the answer keeps streaming
      // in the background and is already visible when the user comes back.
      conversationRuns.clearSettled(id);
      setActionError(null);
      setEditingMessageId(null);
      setComposerText('');
      setSidebarOpen(false);
      setModelPickerOpen(false);
      setModelError(null);
      setSection('chat');
      void conversations.select(id);
    });
  }

  async function openNotePreview(workspaceId: string, noteId: string): Promise<void> {
    try {
      const snapshot = await window.studyCoach?.getWorkspaceSnapshot(workspaceId);
      const note = snapshot?.notes.find((entry) => entry.id === noteId);
      if (note) setPreviewNote(note);
    } catch {
      // The workspace page is still open; the note simply has no preview.
    }
  }

  /** Deep-links a global-search result to the page that owns it. */
  function openSearchResult(result: SearchResult) {
    setSearchOpen(false);
    if (result.kind === 'knowledge-topic') {
      guardSettings(() => {
        setKnowledgeFocusTopicId(result.docId);
        changeNavigation('knowledge');
      });
      return;
    }
    if (result.kind === 'plan') {
      guardSettings(() => {
        setPlanFocusId(result.docId);
        changeSection('plan');
      });
      return;
    }
    if (result.kind === 'memory') {
      changeNavigation('memory');
      return;
    }
    if (result.kind === 'review') {
      changeNavigation('review');
      return;
    }
    if (result.kind === 'note' && result.workspaceId) {
      const workspaceId = result.workspaceId;
      const docId = result.docId;
      guardSettings(() => {
        setProjectId(workspaceId);
        setChatScope('workspace');
        applySection('projects');
        void openNotePreview(workspaceId, docId);
      });
      return;
    }
    guardSettings(() => {
      if (result.workspaceId) {
        setProjectId(result.workspaceId);
        setChatScope('workspace');
      }
      changeSection('projects');
    });
  }

  /** Turn one long-plan day into ordinary tasks, so 今日安排 can schedule them. */
  async function addPlanDayToSchedule(plan: LongPlan, day: LongPlanDay) {
    const workspace = workspaces.find((entry) => entry.id === plan.workspaceId);
    if (!workspace) throw new Error('计划所属的项目不存在。');
    const taskCount = Math.max(1, day.tasks.length);
    const perTask = Math.max(
      15,
      Math.min(120, Math.round((plan.weeklyHours * 60) / 7 / taskCount))
    );
    const week = plan.phases
      .flatMap((phase) => phase.weeks)
      .find((entry) => entry.days.some((item) => item.id === day.id));
    await Promise.all(
      day.tasks.map((title) =>
        createTask({
          workspaceId: plan.workspaceId,
          title,
          subject: workspace.name,
          durationMin: perTask,
          acceptance: day.output,
          due: day.date,
          planId: plan.id,
          ...(week ? { planWeekId: week.id } : {}),
          planItemId: day.id,
          // The task serves the plan's project goal; the main process fills
          // this from the plan too, but naming it here keeps the call honest.
          ...(workspace.goalId ? { goalId: workspace.goalId } : {})
        })
      )
    );
  }

  /** "本次参考" rows open the record they came from instead of a dead label. */
  function openReference(reference: ButlerReference) {
    if (reference.kind === 'profile') {
      changeSection('profile');
      return;
    }
    if (reference.kind === 'knowledge-topic') {
      changeSection('knowledge');
      return;
    }
    if (reference.kind === 'plan') {
      changeSection('plan');
      return;
    }
    if (reference.kind === 'review') {
      changeSection('review');
      return;
    }
    if (reference.workspaceId) selectWorkspace(reference.workspaceId);
    changeSection(reference.kind === 'memory' ? 'memory' : 'projects');
  }

  function selectProject(id: string | null) {
    setSidebarOpen(false);
    if (id === null) {
      setProjectId(null);
      return;
    }
    setProjectId(id);
    setChatScope('workspace');
  }

  function openRenameSet(set: PracticeSet) {
    setRenameSetId(set.id);
  }

  /** 我看过了: stamps reviewedAt so the 待核对 chip disappears. */
  async function reviewPracticeSet(setId: string): Promise<void> {
    setPracticeError(null);
    try {
      await updatePracticeSet({ setId, reviewedAt: new Date().toISOString() });
    } catch (cause) {
      setPracticeError(messageOf(cause));
    }
  }

  async function removePracticeSet(set: PracticeSet) {
    if (confirmDeleteSetId !== set.id) {
      setConfirmDeleteSetId(set.id);
      return;
    }
    setPracticeError(null);
    try {
      await deletePracticeSet({ setId: set.id });
      setConfirmDeleteSetId(null);
      setPracticeSetId(filteredPracticeSets.find((entry) => entry.id !== set.id)?.id ?? null);
    } catch (cause) {
      setPracticeError(messageOf(cause));
    }
  }

  if (loading && workspaces.length === 0) {
    return (
      <WorkspaceStatus
        title="正在准备阿咲…"
        detail="从本地 vault 读取项目、任务和记录。"
      />
    );
  }

  if (error && workspaces.length === 0) {
    return (
      <WorkspaceStatus
        title="项目加载失败"
        detail={error}
        actionLabel="重试"
        onAction={() => void retry()}
        alert
      />
    );
  }

  const bannerError = actionError ?? conversations.error ?? error;
  const displayModel =
    conversations.active?.model?.trim() || globalModelLabel || '模板计划';

  return (
    <div className="flex h-screen flex-col bg-[#f5f5f7] dark:bg-[#0f0f10]">
      {bannerError ? (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 bg-[#ff3b30]/10 px-4 py-2.5 text-[13px] text-[#d70015] dark:bg-[#ff3b30]/15 dark:text-[#ff7b72]"
        >
          <span className="min-w-0 truncate">{bannerError}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              if (canRetryTurn && retryTurnRef.current) {
                const failed = retryTurnRef.current;
                retryTurnRef.current = null;
                setCanRetryTurn(false);
                void runTurn(failed.text, {
                  appendUser: false,
                  conversation: failed.conversation,
                  ...(failed.attachments.length > 0
                    ? { attachments: failed.attachments }
                    : {})
                });
                return;
              }
              void retry();
              void conversations.refresh();
            }}
            className="shrink-0 rounded-full px-2 py-1 font-medium text-[#0071e3] transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff]"
          >
            {canRetryTurn ? '重试发送' : '重试'}
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        {sidebarOpen && isNarrowScreen() ? (
          <button
            type="button"
            aria-label="关闭导航"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-black/25 dark:bg-black/50 md:hidden"
          />
        ) : null}
        <NavigationSidebar
          section={section}
          chatScope={chatScope}
          displayName={displayName}
          conversations={conversations.summaries}
          projects={workspaces}
          activeConversationId={conversations.active?.id ?? null}
          selectedProjectId={projectId}
          runStates={runStates}
          attention={notificationAttention}
          onSectionChange={changeNavigation}
          onNewConversation={startDraft}
          onSelectConversation={selectConversation}
          onSelectWorkspace={selectWorkspace}
          onSelectUnfiled={selectUnfiled}
          onSelectAll={selectAll}
          onNewWorkspace={startNewWorkspace}
          onRenameConversation={(id, title) => void renameConversation(id, title)}
          onTogglePinned={(id, pinned) => void togglePinnedConversation(id, pinned)}
          onDeleteConversation={(id) => void deleteConversation(id)}
          onOpenSearch={() => setSearchOpen(true)}
          onOpenNotifications={openNotifications}
          mobileOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          {section === 'chat' ? (
            <ChatPane
              workspace={currentWorkspace}
              displayName={displayName}
              contextLabel={contextLabel}
              homeTitle={homeTitle}
              homeGoal={homeGoal}
              homeHint={homeHint}
              stats={chatStats}
              homeOverview={
                <TodayOverview
                  compact
                  tasks={tasks}
                  workspaces={workspaces}
                  reminders={reminders}
                  longPlans={longPlans}
                  today={today}
                  revisits={dueRevisits}
                  quizOffer={todayQuiz}
                  onOpenWorkspace={(workspaceId) => {
                    selectWorkspace(workspaceId);
                    changeSection('projects');
                  }}
                  onOpenSchedule={() => changeSection('schedule')}
                  onOpenPlan={() => changeSection('plan')}
                  onOpenReminders={() => changeSection('reminders')}
                  onToggleTask={(task) =>
                    void updateTask({
                      taskId: task.id,
                      status: task.status === 'done' ? 'pending' : 'done'
                    })
                  }
                  onPrompt={promptDaily}
                />
              }
              messages={chatMessages}
              onOpenReference={openReference}
              onOpenLongPlan={() => changeSection('plan')}
              onOpenTodayTasks={() => changeSection('schedule')}
              onOpenProfile={() => changeSection('profile')}
              typing={typing}
              loading={conversations.selecting}
              onSend={(text) => submitComposer(text)}
              modelLabel={displayModel}
              hasApiKey={hasApiKey}
              onOpenSettings={openSettings}
              dateLabel={dateLabel}
              onOpenProjects={() => changeSection('projects')}
              onStop={stopStreaming}
              composerText={composerText}
              onComposerTextChange={setComposerText}
              editing={editingMessageId !== null}
              onCancelEdit={cancelEdit}
              onRegenerate={(id) => void regenerateMessage(id)}
              onEditMessage={editLastUserMessage}
              onOpenSidebar={openSidebar}
              sidebarOpen={sidebarOpen}
              typingStatus={typingStatus}
              attachments={pendingAttachments}
              onAttachmentsChange={setPendingAttachments}
              permissions={permissions}
              onPermissionsChange={changePermissions}
              {...(conversations.active ? { onOpenModelPicker: openModelPicker } : {})}
            />
          ) : null}

          {section === 'schedule' ? (
            <SchedulePage
              today={today}
              dateLabel={dateLabel}
              tasks={tasks}
              workspaces={workspaces}
              onOpenSidebar={openSidebar}
              onOpenWorkspace={selectWorkspace}
              onPrompt={promptDaily}
              onUpdateTask={updateTask}
            />
          ) : null}

          {section === 'plan' ? (
            <LongPlanPage
              plans={longPlans}
              workspaces={workspaces}
              defaultWorkspaceId={projectId}
              focusPlanId={planFocusId}
              today={today}
              weekAvailability={weekAvailability}
              onOpenSidebar={openSidebar}
              onCreatePlan={createLongPlan}
              onUpdatePlan={updateLongPlan}
              onRecalibrate={recalibrateLongPlan}
              onSetItemDone={setLongPlanItemDone}
              onDeletePlan={deleteLongPlan}
              onAddDayToSchedule={addPlanDayToSchedule}
              onClearWeekAvailability={clearWeekAvailability}
            />
          ) : null}

          {section === 'projects' ? (
            <ProjectsPage
              workspace={currentWorkspace}
              workspaces={workspaces}
              tasks={tasks}
              notes={notes}
              profile={memoryProfile}
              onOpenSidebar={openSidebar}
              onOpenChat={() => changeSection('chat')}
              onSelectWorkspace={selectProject}
              onUpdateWorkspace={updateWorkspace}
              onDeleteWorkspace={async (workspaceId) => {
                await deleteWorkspace(workspaceId);
                if (projectId === workspaceId) setProjectId(null);
              }}
              onOpenPractice={() => {
                setPracticeSetId(filteredPracticeSets[0]?.id ?? null);
                setPracticeOpen(true);
              }}
              onPrompt={promptButler}
              onPreviewNote={setPreviewNote}
              onCreateNote={createNote}
              onUpdateNote={async (input) => {
                const note = await updateNote(input);
                if (previewNote?.id === note.id) setPreviewNote(note);
                return note;
              }}
              onDeleteNote={async (input) => {
                await deleteNote(input);
                if (previewNote?.id === input.noteId) setPreviewNote(null);
              }}
              busy={typing}
              onUpdateTask={updateTask}
              onCreateTask={createTask}
              onDeleteTask={deleteTask}
              focus={focus}
              focusNotice={focusNotice}
              focusRestore={focusRestore}
              onAcceptFocusRestore={acceptFocusRestore}
              onDismissFocusRestore={dismissFocusRestore}
              canStartFocus={firstFocusableTask(tasks) !== undefined}
              onStartFocus={startFocusForTask}
              onStartDefaultFocus={startDefaultFocus}
              onPauseFocus={pauseFocus}
              onResumeFocus={resumeFocus}
              onResetFocus={resetFocus}
              onAbandonFocus={abandonFocus}
            />
          ) : null}

          {section === 'knowledge' ? (
            <KnowledgePage
              topics={knowledgeTopics}
              workspaces={workspaces}
              defaultWorkspaceId={projectId}
              focusTopicId={knowledgeFocusTopicId}
              onOpenSidebar={openSidebar}
              onCreateTopic={createKnowledgeTopic}
              onUpdateTopic={updateKnowledgeTopic}
              onDeleteTopic={deleteKnowledgeTopic}
              onMergeTopic={mergeKnowledgeTopics}
              getKnowledgeNote={getKnowledgeNote}
              saveKnowledgeNote={saveKnowledgeNote}
              getKnowledgeBacklinks={getKnowledgeBacklinks}
            />
          ) : null}

          {section === 'memory' ? (
            <MemoryPage
              workspaces={workspaces}
              memoryRecords={memoryRecords}
              profile={memoryProfile}
              onOpenSidebar={openSidebar}
              onCreateMemory={createMemory}
              onUpdateMemory={updateMemory}
              onDeleteMemory={deleteMemory}
            />
          ) : null}

          {section === 'profile' ? (
            <ProfilePage onOpenSidebar={openSidebar} />
          ) : null}

          {section === 'today' ? (
            <TodayOverview
              tasks={tasks}
              workspaces={workspaces}
              reminders={reminders}
              longPlans={longPlans}
              today={today}
              revisits={dueRevisits}
              quizOffer={todayQuiz}
              oneThingStore={oneThingStore}
              onOpenSidebar={openSidebar}
              onOpenWorkspace={(workspaceId) => {
                selectWorkspace(workspaceId);
                changeSection('projects');
              }}
              onOpenSchedule={() => changeSection('schedule')}
              onOpenPlan={() => changeSection('plan')}
              onOpenReminders={() => changeSection('reminders')}
              onToggleTask={(task) =>
                void updateTask({
                  taskId: task.id,
                  status: task.status === 'done' ? 'pending' : 'done'
                })
              }
              onPrompt={promptDaily}
            />
          ) : null}

          {section === 'review' ? (
            <ReviewPage
              workspaces={workspaces}
              reviews={reviews}
              tasks={tasks}
              attempts={practiceAttempts}
              sets={practiceSets}
              dueMistakes={practiceDue}
              knowledgeTopics={knowledgeTopics}
              onOpenSidebar={openSidebar}
              onPrompt={promptButler}
              examWritingStore={examWritingStore}
              onSubmitReview={async (input) => {
                const api = window.studyCoach;
                if (!api) throw new Error('数据服务不可用，请重启应用后重试。');
                await api.submitReview(input);
              }}
              onSubmitted={() => void reload()}
            />
          ) : null}

          {section === 'reminders' ? (
            <RemindersPage
              reminders={reminders}
              commitments={commitments}
              today={today}
              onCreateReminder={createReminder}
              onUpdateReminder={updateReminder}
              onDeleteReminder={deleteReminder}
              onResolveCommitment={resolveCommitmentEntry}
              snoozedUntil={snoozedUntil ?? ''}
              onSnoozeCheckIns={(days) => void snoozeCheckIns(days)}
              onResumeCheckIns={() => void resumeCheckIns()}
              onOpenSidebar={openSidebar}
              onPrompt={promptButler}
            />
          ) : null}

          {section === 'settings' ? (
            <PageFrame
              title="设置"
              subtitle="个人、模型与数据"
              onOpenSidebar={openSidebar}
              action={
                <button
                  type="button"
                  onClick={() => {
                    changeSection('chat');
                    void loadModelLabel();
                    onRefresh();
                  }}
                  className="rounded-full px-3 py-1.5 text-[13px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:text-black hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
                >
                  返回对话
                </button>
              }
            >
              <SettingsPage
                page
                hasApiKey={hasApiKey}
                onDirtyChange={setSettingsDirty}
                onClose={() => {
                  changeSection('chat');
                  void loadModelLabel();
                  onRefresh();
                }}
              />
            </PageFrame>
          ) : null}
        </div>
      </div>

      {practiceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60">
          <div className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-[0_8px_24px_rgba(0,0,0,0.12)] dark:bg-[#1c1c1e]">
            <div className="w-60 shrink-0 overflow-y-auto border-r border-gray-200/70 p-2 dark:border-white/10">
              <div className="px-2 py-2 text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                练习
              </div>
              {filteredPracticeSets.length === 0 ? (
                <p className="px-2 py-2 text-[12px] leading-5 text-gray-500 dark:text-[#8e8e93]">
                  这个项目还没有练习集。可以让阿咲先记一些错题。
                </p>
              ) : (
                filteredPracticeSets.map((set) => (
                  <div
                    key={set.id}
                    className={`mb-1 rounded-xl transition-colors duration-200 ${
                      selectedPracticeSet?.id === set.id
                        ? 'bg-black/[0.06] dark:bg-white/[0.1]'
                        : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setPracticeSetId(set.id)}
                      aria-current={selectedPracticeSet?.id === set.id ? 'page' : undefined}
                      className="flex w-full flex-col rounded-xl px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                    >
                      <span className="truncate text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                        {set.title}
                      </span>
                      <span className="mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                        {set.subject} · {set.questions.length} 题
                      </span>
                    </button>
                    {/* The chip keeps its own row under the button so the
                        title column is never squeezed to zero at the default
                        window width (the D1 overflow lesson). */}
                    {set.source === 'model' && set.reviewedAt === undefined ? (
                      <div className="flex items-center gap-1.5 px-3 pb-2">
                        <PracticeReviewChip set={set} onReviewed={() => reviewPracticeSet(set.id)} />
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {selectedPracticeSet ? (
                <div className="mt-2 space-y-1 border-t border-gray-200/70 px-2 pt-3 dark:border-white/10">
                  <button
                    type="button"
                    aria-label={`编辑练习集：${selectedPracticeSet.title}`}
                    onClick={() => openRenameSet(selectedPracticeSet)}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-medium text-gray-500 transition-colors duration-200 hover:bg-black/[0.04] hover:text-[#1d1d1f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:text-[#8e8e93] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
                  >
                    编辑题目
                  </button>
                  <button
                    type="button"
                    aria-label={
                      confirmDeleteSetId === selectedPracticeSet.id
                        ? `确认删除练习集：${selectedPracticeSet.title}`
                        : `删除练习集：${selectedPracticeSet.title}`
                    }
                    onClick={() => void removePracticeSet(selectedPracticeSet)}
                    className={`w-full rounded-lg px-2 py-1.5 text-left text-[12px] font-medium transition-colors duration-200 hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 dark:hover:bg-white/[0.06] ${
                      confirmDeleteSetId === selectedPracticeSet.id
                        ? 'text-[#d70015] dark:text-[#ff7b72]'
                        : 'text-gray-500 hover:text-[#d70015] dark:text-[#8e8e93] dark:hover:text-[#ff7b72]'
                    }`}
                  >
                    {confirmDeleteSetId === selectedPracticeSet.id ? '确认删除' : '删除练习集'}
                  </button>
                  {practiceError ? (
                    <p role="alert" className="px-2 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                      {practiceError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-gray-200/70 px-4 dark:border-white/10">
                <span className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">练习</span>
                <button
                  type="button"
                  aria-label="关闭练习"
                  onClick={() => setPracticeOpen(false)}
                  className="rounded-full px-3 py-1.5 text-[13px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#a1a1a6] dark:hover:bg-white/[0.06]"
                >
                  关闭
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <LearningPane
                  set={selectedPracticeSet}
                  sets={filteredPracticeSets}
                  workspace={currentWorkspace}
                  workspaces={workspaces}
                  notes={notes.filter(
                    (note) => !projectId || note.workspaceId === projectId
                  )}
                  mistakes={practiceMistakes.filter(
                    (mistake) =>
                      !projectId || mistake.workspaceId === projectId
                  )}
                  dueMistakes={practiceDue.filter(
                    (mistake) => !projectId || mistake.workspaceId === projectId
                  )}
                  strictMastery={strictMastery}
                  onReviewMistake={(mistake) => {
                    const due = practiceDue.filter(
                      (entry) =>
                        entry.id !== mistake.id &&
                        (!projectId || entry.workspaceId === projectId)
                    );
                    setReviewQueue([mistake, ...due]);
                  }}
                  onReviewAllMistakes={() =>
                    setReviewQueue(
                      practiceDue.filter(
                        (mistake) => !projectId || mistake.workspaceId === projectId
                      )
                    )
                  }
                  onResolveMistake={(mistake) => {
                    void resolvePracticeMistake({
                      mistakeId: mistake.id,
                      resolved: true
                    }).catch((cause: unknown) => {
                      setPracticeError(messageOf(cause));
                    });
                  }}
                  onSubmitAnswer={submitPracticeAnswer}
                  onSubmitShortAnswer={submitPracticeShortAnswer}
                  onExportMistakeSheet={exportMistakeSheet}
                  onExportAnkiMistakes={() =>
                    exportAnkiMistakes({ workspaceId: mistakeBookProjectId })
                  }
                  onExportAnkiSet={exportAnkiSet}
                  onSaveMistakeCause={(mistake, cause) =>
                    savePracticeMistakeCause({ mistakeId: mistake.id, cause })
                  }
                  onClearResolvedMistakes={() =>
                    archiveResolvedMistakes({ workspaceId: mistakeBookProjectId })
                  }
                  onListArchivedMistakes={() => listArchivedMistakes(mistakeBookProjectId)}
                  onRestoreMistake={(mistake) =>
                    restoreArchivedMistake({ mistakeId: mistake.id }).then(() => undefined)
                  }
                  attempts={practiceAttempts.filter(
                    (attempt) =>
                      !projectId || attempt.workspaceId === projectId
                  )}
                  onCreateSet={createPracticeSet}
                  onReviewSet={async (setId) => {
                    await reviewPracticeSet(setId);
                  }}
                  onOpenChat={() => {
                    setPracticeOpen(false);
                    changeSection('chat');
                  }}
                  onOpenNote={(id) => {
                    const note = notes.find((entry) => entry.id === id);
                    if (note) {
                      setPracticeOpen(false);
                      setPreviewNote(note);
                    }
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog
        open={budgetPrompt !== null}
        onClose={() => settleBudget(false)}
        title="今日 token 预算已用完"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => settleBudget(false)}
              className="rounded-full px-4 py-2 text-[13px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:text-black active:scale-[0.98] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => settleBudget(true)}
              className="rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 hover:opacity-80 active:scale-[0.98]"
            >
              继续发送
            </button>
          </div>
        }
      >
        <p className="text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
          今天已使用 {budgetPrompt?.used ?? 0} token，每日上限是 {budgetPrompt?.limit ?? 0}。
          继续对话会超出预算；确认后本次打开应用不再重复提醒。
        </p>
      </Dialog>

      <Dialog
        open={settingsPromptOpen}
        onClose={cancelPendingNavigation}
        title="设置尚未保存"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={cancelPendingNavigation}
              className="rounded-full px-4 py-2 text-[13px] font-medium text-gray-500 transition-all duration-300 hover:bg-black/[0.04] hover:text-black active:scale-[0.98] dark:text-[#a1a1a6] dark:hover:bg-white/[0.06] dark:hover:text-[#f5f5f7]"
            >
              取消
            </button>
            <button
              type="button"
              onClick={confirmDiscardSettings}
              className="rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 hover:opacity-80 active:scale-[0.98]"
            >
              放弃修改并离开
            </button>
          </div>
        }
      >
        <p className="text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
          你有未保存的设置修改，离开后这些修改会丢失。
        </p>
      </Dialog>

      {notificationsOpen ? (
        <NotificationCenter
          reminders={reminders}
          commitments={pendingCommitments}
          snoozedUntil={snoozedUntil}
          today={today}
          now={new Date(notificationClock)}
          onOpenReminders={() => changeSection('reminders')}
          onOpenMuteSettings={() => changeSection('reminders')}
          onOpenCommitment={openCommitment}
          onOpenToday={() => changeSection('today')}
          onClose={() => setNotificationsOpen(false)}
        />
      ) : null}

      <FirstRunDialog
        open={needsOnboarding && !onboardingDone}
        onComplete={(createdName) => {
          setOnboardingDone(true);
          onRefresh();
          void (async () => {
            await reload();
            // Land inside the project the user just created instead of the
            // generic 日常 home, so the first screen is their own goal.
            try {
              const list = await window.studyCoach?.listWorkspaces();
              const created = list?.find((workspace) => workspace.name === createdName);
              if (created) {
                selectProject(created.id);
                setSection('projects');
              }
            } catch {
              // Keep the default view if the lookup fails; onboarding still completed.
            }
          })();
        }}
        onSkip={() => setOnboardingDone(true)}
        onRestoreComplete={() => {
          setOnboardingDone(true);
          onRefresh();
          // The restore replaced conversations and adopted settings behind the
          // renderer's back. Both are read once at mount, so without these the
          // dialog's 「已恢复：…对话…」 is contradicted by an empty sidebar and a
          // stale 称呼 — the restart-shaped gap this entry exists to remove.
          void conversations.refresh();
          void loadModelLabel();
          void (async () => {
            await reload();
            // Land inside the restored data instead of the generic 日常 home;
            // the restore created no workspace, so the first listed project is
            // a restored one (absent when the backup's vault was empty).
            try {
              const list = await window.studyCoach?.listWorkspaces();
              const restored = list?.[0];
              if (restored) {
                selectProject(restored.id);
                setSection('projects');
              }
            } catch {
              // Keep the default view if the lookup fails.
            }
          })();
        }}
      />

      <GlobalSearchDialog
        open={searchOpen}
        workspaces={workspaces}
        onClose={() => setSearchOpen(false)}
        onSearchConversations={conversations.search}
        onSearchAll={searchAll}
        onSelectConversation={(id) => {
          setSearchOpen(false);
          selectConversation(id);
        }}
        onSelectResult={openSearchResult}
      />

      <QuickCaptureDialog
        open={quickCaptureOpen}
        disabled={typing}
        onClose={() => setQuickCaptureOpen(false)}
        onSubmit={(text) => {
          setQuickCaptureOpen(false);
          promptButler(text);
        }}
      />

      <ModelPickerDialog
        open={modelPickerOpen}
        globalModel={globalModelLabel}
        initialModel={conversations.active?.model ?? ''}
        options={cliModelCatalog?.options ?? []}
        saving={modelSaving}
        error={modelError}
        onClose={() => {
          setModelPickerOpen(false);
          setModelError(null);
        }}
        onSave={(model) => void saveConversationModel(model)}
      />

      <Dialog
        open={previewNote !== null}
        onClose={() => setPreviewNote(null)}
        title={previewNote?.title ?? '笔记'}
      >
        {previewNote ? (
          <div>
            <p className="text-[12px] text-gray-500 dark:text-[#8e8e93]">
              {previewNote.subject} · {previewNote.updated}
            </p>
            {previewNote.tags.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {previewNote.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-full bg-[#f5f5f7] px-2 py-0.5 text-[11px] text-gray-600 dark:bg-white/[0.08] dark:text-[#a1a1a6]"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
            {previewRelatedTitles.length > 0 ? (
              <p className="mt-2 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                关联：{previewRelatedTitles.join('、')}
              </p>
            ) : null}
            <div className="mt-3 whitespace-pre-wrap text-[14px] leading-6 text-[#1d1d1f] dark:text-[#f5f5f7]">
              {previewNote.body}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const note = previewNote;
                  setPreviewNote(null);
                  promptButler(`帮我改一下笔记《${note.title}》：`);
                }}
                className="rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
              >
                让阿咲改
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <PracticeSetDialog
        open={renameSetId !== null}
        workspaceId={currentWorkspace?.id ?? ''}
        set={filteredPracticeSets.find((set) => set.id === renameSetId) ?? null}
        workspaces={workspaces}
        onClose={() => setRenameSetId(null)}
        onUpdate={updatePracticeSet}
      />

      <MistakeReviewDialog
        open={reviewQueue !== null}
        queue={reviewQueue ?? []}
        onReview={reviewPracticeMistake}
        onResolve={async (input) => {
          await resolvePracticeMistake(input);
        }}
        onClose={() => setReviewQueue(null)}
      />
    </div>
  );
}
