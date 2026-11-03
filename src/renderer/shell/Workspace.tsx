import { useCallback, useEffect, useRef, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import {
  DAILY_WORKSPACE_ID,
  type Conversation,
  type ConversationMessage
} from '../../shared/conversations';
import type { LongPlan, LongPlanDay } from '../../shared/plans';
import type { SendMessageInput, WorkspaceNote } from '../../shared/workspace';
import type { SearchResult } from '../../shared/search';
import { SettingsPage } from '../settings/SettingsPage';
import { Dialog } from '../ui/Dialog';
import { ChatPane } from './ChatPane';
import {
  FOCUS_DURATION_MS,
  FOCUS_TICK_MS,
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
import { LearningPane } from './LearningPane';
import { LongPlanPage } from './LongPlanPage';
import { MemoryPage } from './MemoryPage';
import { ModelPickerDialog } from './ModelPickerDialog';
import {
  NavigationSidebar,
  type ChatScope,
  type NavSection,
  type Section
} from './NavigationSidebar';
import { PageFrame } from './PageFrame';
import { ProjectsPage } from './ProjectsPage';
import { QuickCaptureDialog } from './QuickCaptureDialog';
import { RemindersPage } from './RemindersPage';
import { ReviewPage } from './ReviewPage';
import { SchedulePage } from './SchedulePage';
import { stepsToTrace } from './trace';
import type { ChatMessage, ChatTraceItem } from './types';
import { useConversations } from './useConversations';
import { useWorkspaceData } from './useWorkspaceData';
import { friendlyErrorMessage } from '../../shared/errors';

type WorkspaceProps = {
  hasApiKey: boolean;
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

function scheduleFrame(callback: () => void): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return globalThis.setTimeout(callback, 16) as unknown as number;
}

function cancelFrame(id: number): void {
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(id);
    return;
  }
  globalThis.clearTimeout(id);
}

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

export function Workspace({ hasApiKey, onRefresh }: WorkspaceProps) {
  const {
    workspaces,
    tasks,
    notes,
    reviews,
    practiceSets,
    practiceMistakes,
    practiceAttempts,
    memoryProfile,
    reminders,
    longPlans,
    knowledgeTopics,
    loading,
    error,
    retry,
    reload,
    refreshKnowledge,
    stream,
    cancelStream,
    submitPracticeAnswer,
    createTask,
    updateTask,
    deleteTask,
    updateWorkspace,
    createNote,
    createReminder,
    updateReminder,
    deleteReminder,
    createMemory,
    createPracticeSet,
    memoryRecords,
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
    getKnowledgeBacklinks,
    searchAll
  } = useWorkspaceData();
  const conversations = useConversations();
  const [section, setSection] = useState<Section>('chat');
  const [chatScope, setChatScope] = useState<ChatScope>('daily');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Remember who opened the mobile drawer so focus can return there on close.
  const sidebarOpenerRef = useRef<HTMLElement | null>(null);
  const sidebarWasOpenRef = useRef(false);
  const [previewNote, setPreviewNote] = useState<WorkspaceNote | null>(null);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceSetId, setPracticeSetId] = useState<string | null>(null);
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [composerText, setComposerText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusSession | null>(null);
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  const [snoozedUntil, setSnoozedUntil] = useState<string | null>(null);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [knowledgeFocusTopicId, setKnowledgeFocusTopicId] = useState<string | null>(null);
  const [planFocusId, setPlanFocusId] = useState<string | null>(null);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const focusSessionCounterRef = useRef(0);
  const recordedFocusSessionsRef = useRef<Set<number>>(new Set());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [traceById, setTraceById] = useState<Record<string, ChatTraceItem[]>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState('模板计划');
  const streamGenerationRef = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = conversations.active?.id ?? null;

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
      ? '还没有归入工作区的对话'
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
  const today = formatLocalDate(new Date());
  const dateLabel = formatChineseDate(today);

  const loadModelLabel = useCallback(async () => {
    const api = window.studyCoach;
    if (!api) {
      setModelLabel('模板计划');
      return;
    }
    try {
      const settings = await api.getSettings();
      setModelLabel(
        settings.provider.kind === 'local-cli'
          ? settings.provider.model ?? settings.provider.agent
          : settings.provider.model
      );
      setSnoozedUntil(settings.notifications.snoozedUntil ?? null);
    } catch {
      setModelLabel('模板计划');
    }
  }, []);

  useEffect(() => {
    void loadModelLabel();
  }, [loadModelLabel]);

  useEffect(() => {
    if (!focus?.running) return undefined;
    const id = window.setInterval(() => {
      setFocus((current) => (current && current.running ? tickFocus(current) : current));
    }, FOCUS_TICK_MS);
    return () => window.clearInterval(id);
  }, [focus?.running]);

  useEffect(() => {
    const api = window.studyCoach;
    if (!api?.onQuickCapture) return undefined;
    return api.onQuickCapture(() => setQuickCaptureOpen(true));
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
    setFocus((current) => (current ? { ...current, recorded: true } : current));
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
    if (!conversations.externalOpen) return;
    stopActiveStreamForNavigation();
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
    setModelPickerOpen(false);
    setModelError(null);
    setSidebarOpen(false);
    setSection('chat');
  }, [conversations.externalOpen?.seq]);

  const chatMessages: ChatMessage[] = [
    ...(conversations.active?.messages ?? []).map((message): ChatMessage => {
      const trace =
        message.role === 'assistant'
          ? traceById[message.id] ?? stepsToTrace(message.steps)
          : [];
      return {
        id: message.id,
        role: message.role,
        text: message.text,
        ...(trace.length > 0 ? { trace } : {}),
        streaming: false
      };
    }),
    ...(streamingMessage ? [streamingMessage] : [])
  ];

  async function runTurn(
    text: string,
    options: {
      appendUser: boolean;
      conversation?: Conversation | null;
      /** Ignores the currently open conversation and creates a fresh one. */
      newConversation?: boolean;
      /** Overrides the chat scope for a newly created conversation. */
      workspaceId?: string | null;
    }
  ) {
    if (typing) return;
    const generation = ++streamGenerationRef.current;
    setActionError(null);
    setStreamStatus(null);
    setTyping(true);

    let conversation = options.newConversation
      ? null
      : options.conversation ?? conversations.active;
    const creationWorkspaceId =
      options.workspaceId !== undefined
        ? options.workspaceId
        : conversation
          ? conversation.workspaceId ?? null
          : chatWorkspaceId;
    try {
      if (!conversation) {
        conversation = await conversations.create({
          ...(creationWorkspaceId ? { workspaceId: creationWorkspaceId } : {})
        });
      }
    } catch (cause) {
      setActionError(messageOf(cause));
      setTyping(false);
      return;
    }

    if (options.appendUser) {
      const userMessage: ConversationMessage = {
        id: chatMessageId('u'),
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
        source: 'user'
      };
      try {
        await conversations.append(conversation.id, userMessage);
      } catch (cause) {
        setActionError(messageOf(cause));
        setTyping(false);
        return;
      }
    }

    const assistantId = chatMessageId('a');
    const pendingTrace: ChatTraceItem[] = [
      {
        kind: 'reasoning',
        id: `trace-${assistantId}-pending`,
        text: '',
        streaming: true
      }
    ];
    let trace: ChatTraceItem[] = pendingTrace;
    let reasoningCount = 0;
    setActiveAssistantId(assistantId);
    setStreamingMessage({
      id: assistantId,
      role: 'assistant',
      text: '',
      trace: pendingTrace,
      streaming: true
    });
    let pendingReasoning = '';
    let pendingText = '';
    let frameId: number | null = null;
    let assistantText = '';
    let streamError: string | null = null;

    const cloneTrace = (): ChatTraceItem[] => trace.map((item) => ({ ...item }));

    const updateStreaming = (updater: (message: ChatMessage) => ChatMessage) => {
      setStreamingMessage((current) =>
        current && current.id === assistantId ? updater(current) : current
      );
    };

    const publishTrace = () => {
      updateStreaming((message) => ({ ...message, trace: cloneTrace() }));
    };

    const appendReasoning = (chunk: string) => {
      let current = trace[trace.length - 1];
      if (!current || current.kind !== 'reasoning') {
        reasoningCount += 1;
        current = {
          kind: 'reasoning',
          id: `trace-${assistantId}-${reasoningCount}`,
          text: '',
          streaming: true
        };
        trace = [...trace, current];
      }
      current.text += chunk;
      current.streaming = true;
    };

    const settleReasoning = () => {
      for (const item of trace) {
        if (item.kind === 'reasoning') item.streaming = false;
      }
    };

    const settleTrace = () => {
      trace = trace.map((item) =>
        item.kind === 'reasoning'
          ? { ...item, streaming: false }
          : item.status === 'running'
            ? { ...item, status: 'failed' }
            : item
      );
    };

    const flush = () => {
      frameId = null;
      const reasoning = pendingReasoning;
      const text = pendingText;
      pendingReasoning = '';
      pendingText = '';
      if (!reasoning && !text) return;
      if (reasoning) appendReasoning(reasoning);
      if (text) assistantText += text;
      updateStreaming((message) => ({
        ...message,
        ...(reasoning ? { trace: cloneTrace() } : {}),
        ...(text ? { text: `${message.text}${text}` } : {})
      }));
    };

    const scheduleFlush = () => {
      if (frameId !== null) return;
      frameId = scheduleFrame(flush);
    };

    const flushNow = () => {
      if (frameId !== null) {
        cancelFrame(frameId);
        frameId = null;
      }
      flush();
    };

    try {
      const runtimeWorkspaceId =
        conversation.workspaceId && conversation.workspaceId !== DAILY_WORKSPACE_ID
          ? conversation.workspaceId
          : undefined;
      const result = await stream(
        {
          ...(runtimeWorkspaceId ? { workspaceId: runtimeWorkspaceId } : {}),
          conversationId: conversation.id,
          assistantMessageId: assistantId,
          message: text
        } satisfies SendMessageInput,
        (event) => {
          switch (event.type) {
            case 'retry':
              setStreamStatus(event.message);
              break;
            case 'reasoning':
              setStreamStatus(null);
              pendingReasoning += event.text;
              scheduleFlush();
              break;
            case 'narration':
              flushNow();
              appendReasoning(
                trace[trace.length - 1]?.kind === 'reasoning'
                  ? `\n\n${event.text}`
                  : event.text
              );
              publishTrace();
              break;
            case 'text':
              setStreamStatus(null);
              flushNow();
              settleReasoning();
              publishTrace();
              pendingText += event.text;
              scheduleFlush();
              break;
            case 'tool-start': {
              flushNow();
              settleReasoning();
              trace = [
                ...trace,
                {
                  kind: 'tool',
                  id: event.id,
                  name: event.name,
                  label: event.label,
                  status: 'running'
                }
              ];
              publishTrace();
              break;
            }
            case 'tool-result': {
              flushNow();
              trace = trace.map((item) =>
                item.kind === 'tool' && item.id === event.id
                  ? {
                      ...item,
                      status: event.ok ? 'done' : 'failed',
                      ...(event.detail !== undefined ? { detail: event.detail } : {})
                    }
                  : item
              );
              publishTrace();
              // Show tool-written knowledge immediately, even mid-turn.
              if (event.ok && KNOWLEDGE_TOOLS.has(event.name)) {
                void refreshKnowledge();
              }
              break;
            }
            case 'error':
              flushNow();
              setStreamStatus(null);
              settleTrace();
              publishTrace();
              streamError = event.message;
              setActionError(event.message);
              break;
            case 'done':
              flushNow();
              setStreamStatus(null);
              settleTrace();
              publishTrace();
              assistantText = event.text || assistantText;
              updateStreaming((message) => ({
                ...message,
                text: event.text || message.text,
                streaming: false,
                trace: cloneTrace()
              }));
              break;
          }
        }
      );

      flushNow();
      const finalConversationId = result.conversationId ?? conversation.id;
      if (generation !== streamGenerationRef.current) {
        await conversations.refresh();
        // Reopening the same conversation during a turn bumps the generation;
        // reload it so the answer that was persisted meanwhile becomes visible.
        if (activeConversationIdRef.current === finalConversationId) {
          await conversations.select(finalConversationId);
        }
        await reload();
        return;
      }
      await conversations.select(finalConversationId);
      await conversations.refresh();
      await reload();
    } catch (cause) {
      flushNow();
      if (generation !== streamGenerationRef.current) {
        // The user navigated away or started another turn; a cancellation is
        // not an error worth showing in the new view.
        await conversations.refresh().catch(() => undefined);
        await reload().catch(() => undefined);
        return;
      }
      setActionError(streamError ?? messageOf(cause));
      try {
        await conversations.select(conversation.id);
        await conversations.refresh();
        await reload();
      } catch {
        // The visible error banner already explains the failure.
      }
    } finally {
      flushNow();
      if (trace.length > 0) {
        settleTrace();
        setTraceById((current) => ({
          ...current,
          [assistantId]: trace.map((item) => ({ ...item }))
        }));
      }
      // A superseded turn must not clear the state of the turn that replaced it.
      if (generation === streamGenerationRef.current) {
        setStreamingMessage(null);
        setActiveAssistantId(null);
        setStreamStatus(null);
        setTyping(false);
      }
    }
  }

  async function sendMessage(text: string) {
    await runTurn(text, { appendUser: true });
  }

  async function submitComposer(text: string) {
    if (typing) return;
    const conversation = conversations.active;
    if (editingMessageId && conversation) {
      const index = conversation.messages.findIndex(
        (message) => message.id === editingMessageId
      );
      if (index >= 0) {
        try {
          await conversations.truncate(conversation.id, index);
        } catch (cause) {
          setActionError(messageOf(cause));
          return;
        }
      }
    }
    setEditingMessageId(null);
    await runTurn(text, { appendUser: true, conversation });
  }

  async function regenerateMessage(messageId: string) {
    if (typing) return;
    const conversation = conversations.active;
    if (!conversation) return;
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
    await runTurn(userMessage.text, { appendUser: false, conversation });
  }

  function editLastUserMessage(messageId: string) {
    if (typing) return;
    const conversation = conversations.active;
    if (!conversation) return;
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

  function startFocusForTask(taskId: string) {
    const task = tasks.find((entry) => entry.id === taskId);
    if (!task) return;
    focusSessionCounterRef.current += 1;
    setFocus(startFocusSession(focusSessionCounterRef.current, task));
    setFocusNotice(null);
  }

  function startDefaultFocus() {
    const task = firstFocusableTask(tasks);
    if (task) startFocusForTask(task.id);
  }

  function pauseFocus() {
    setFocus((current) => (current ? pauseFocusSession(current) : current));
  }

  function resumeFocus() {
    setFocus((current) => (current ? resumeFocusSession(current) : current));
  }

  function resetFocus() {
    if (!focus) return;
    focusSessionCounterRef.current += 1;
    setFocus({
      ...focus,
      sessionId: focusSessionCounterRef.current,
      remainingMs: FOCUS_DURATION_MS,
      running: false,
      recorded: false,
      lastTickAt: Date.now()
    });
    setFocusNotice(null);
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
    if (conversations.active?.id === id) {
      streamGenerationRef.current += 1;
      setStreamingMessage(null);
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

  async function snoozeCheckIns() {
    const api = window.studyCoach;
    if (!api) {
      setActionError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    try {
      const settings = await api.updateSettings({ notifications: { snoozedUntil: today } });
      setSnoozedUntil(settings.notifications.snoozedUntil ?? today);
    } catch (cause) {
      setActionError(messageOf(cause));
    }
  }

  function stopStreaming() {
    if (activeAssistantId) {
      void cancelStream(activeAssistantId);
    }
  }

  /** Opens the narrow-screen drawer, remembering the control that invoked it. */
  function openSidebar() {
    const active = document.activeElement;
    sidebarOpenerRef.current = active instanceof HTMLElement ? active : null;
    setSidebarOpen(true);
  }

  function changeSection(next: Section) {
    setSection(next);
    setSidebarOpen(false);
  }

  /** Leaving a turn must not leave its Stop button bound to the new view. */
  function stopActiveStreamForNavigation() {
    if (typing && activeAssistantId) {
      void cancelStream(activeAssistantId);
    }
    setTyping(false);
    setActiveAssistantId(null);
  }

  function resetDraftState() {
    streamGenerationRef.current += 1;
    stopActiveStreamForNavigation();
    conversations.startDraft();
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
    setSidebarOpen(false);
    setModelPickerOpen(false);
    setModelError(null);
  }

  /** Leaves the open conversation but keeps a typed composer draft. */
  function leaveConversation() {
    streamGenerationRef.current += 1;
    stopActiveStreamForNavigation();
    conversations.startDraft();
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setModelPickerOpen(false);
    setModelError(null);
  }

  function selectDaily() {
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
  }

  function selectUnfiled() {
    setSidebarOpen(false);
    setSection('chat');
    setProjectId(null);
    setChatScope('unfiled');
    const active = conversations.active;
    if (active && !active.workspaceId && active.kind !== 'check-in') return;
    if (active) leaveConversation();
  }

  function selectWorkspace(id: string) {
    setSidebarOpen(false);
    setSection('chat');
    setProjectId(id);
    setChatScope('workspace');
    // Keep an open conversation in this workspace; the folder row is a
    // disclosure toggle, not a "go home" action. 新对话 starts a fresh draft.
    if (conversations.active?.workspaceId === id) return;
    if (conversations.active) leaveConversation();
  }

  function selectAll() {
    setSidebarOpen(false);
    setProjectId(null);
    if (section === 'memory' || section === 'review') return;
    setSection('projects');
  }

  function changeNavigation(next: NavSection) {
    if (next === 'daily') {
      selectDaily();
      return;
    }
    if (next === 'knowledge' || next === 'memory' || next === 'review') {
      // These pages have their own workspace filter; keep chat scope intact.
      setProjectId(null);
      changeSection(next);
      return;
    }
    changeSection(next);
  }

  function openSettings() {
    changeSection('settings');
  }

  /** Every "ask the butler" affordance lands in chat and sends the prompt. */
  function promptButler(prompt: string, workspaceIdOverride?: string) {
    if (typing) return;
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
  }

  /** Schedule actions always start a cross-workspace daily conversation. */
  function promptDaily(prompt: string) {
    if (typing) return;
    resetDraftState();
    setProjectId(null);
    setChatScope('daily');
    setSection('chat');
    void runTurn(prompt, {
      appendUser: true,
      newConversation: true,
      workspaceId: DAILY_WORKSPACE_ID
    });
  }

  function startDraft() {
    resetDraftState();
    if (projectId && section !== 'chat') {
      setChatScope('workspace');
    } else if (chatScope === 'workspace' && !projectId) {
      setChatScope('daily');
    }
    setSection('chat');
  }

  function startNewWorkspace() {
    resetDraftState();
    setProjectId(null);
    setChatScope('daily');
    setSection('chat');
    setComposerText('我想新建一个工作区：');
  }

  function selectConversation(id: string) {
    // Reopening the streaming conversation should let it finish and reload, not
    // cancel it; switching away cancels so Stop can never target the old turn.
    const sameStreamingConversation =
      typing && conversations.active?.id === id;
    streamGenerationRef.current += 1;
    if (!sameStreamingConversation) stopActiveStreamForNavigation();
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
    setSidebarOpen(false);
    setModelPickerOpen(false);
    setModelError(null);
    setSection('chat');
    void conversations.select(id);
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
      setKnowledgeFocusTopicId(result.docId);
      changeNavigation('knowledge');
      return;
    }
    if (result.kind === 'plan') {
      setPlanFocusId(result.docId);
      changeSection('plan');
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
      setProjectId(result.workspaceId);
      setChatScope('workspace');
      changeSection('projects');
      void openNotePreview(result.workspaceId, result.docId);
      return;
    }
    if (result.workspaceId) {
      setProjectId(result.workspaceId);
      setChatScope('workspace');
    }
    changeSection('projects');
  }

  /** Turn one long-plan day into ordinary tasks, so 今日安排 can schedule them. */
  async function addPlanDayToSchedule(plan: LongPlan, day: LongPlanDay) {
    const workspace = workspaces.find((entry) => entry.id === plan.workspaceId);
    if (!workspace) throw new Error('计划所属的工作区不存在。');
    const taskCount = Math.max(1, day.tasks.length);
    const perTask = Math.max(
      15,
      Math.min(120, Math.round((plan.weeklyHours * 60) / 7 / taskCount))
    );
    await Promise.all(
      day.tasks.map((title) =>
        createTask({
          workspaceId: plan.workspaceId,
          title,
          subject: workspace.name,
          durationMin: perTask,
          acceptance: day.output,
          due: day.date
        })
      )
    );
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
        title="工作区加载失败"
        detail={error}
        actionLabel="重试"
        onAction={() => void retry()}
        alert
      />
    );
  }

  const bannerError = actionError ?? conversations.error ?? error;
  const displayModel =
    conversations.active?.model?.trim() || (hasApiKey ? modelLabel : '模板计划');

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
              void retry();
              void conversations.refresh();
            }}
            className="shrink-0 rounded-full px-2 py-1 font-medium text-[#0071e3] transition-all duration-300 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff]"
          >
            重试
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
          conversations={conversations.summaries}
          projects={workspaces}
          activeConversationId={conversations.active?.id ?? null}
          selectedProjectId={projectId}
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
          mobileOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          {section === 'chat' ? (
            <ChatPane
              workspace={currentWorkspace}
              contextLabel={contextLabel}
              homeTitle={homeTitle}
              homeGoal={homeGoal}
              homeHint={homeHint}
              stats={chatStats}
              messages={chatMessages}
              typing={typing}
              onSend={(text) => void submitComposer(text)}
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
              typingStatus={streamStatus}
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
              onOpenSidebar={openSidebar}
              onCreatePlan={createLongPlan}
              onRecalibrate={recalibrateLongPlan}
              onSetItemDone={setLongPlanItemDone}
              onDeletePlan={deleteLongPlan}
              onAddDayToSchedule={addPlanDayToSchedule}
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
              onOpenPractice={() => {
                setPracticeSetId(filteredPracticeSets[0]?.id ?? null);
                setPracticeOpen(true);
              }}
              onPrompt={promptButler}
              onPreviewNote={setPreviewNote}
              onCreateNote={createNote}
              busy={typing}
              onUpdateTask={updateTask}
              onCreateTask={createTask}
              onDeleteTask={deleteTask}
              focus={focus}
              focusNotice={focusNotice}
              canStartFocus={firstFocusableTask(tasks) !== undefined}
              onStartFocus={startFocusForTask}
              onStartDefaultFocus={startDefaultFocus}
              onPauseFocus={pauseFocus}
              onResumeFocus={resumeFocus}
              onResetFocus={resetFocus}
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
              onUpdateMemory={updateMemory}
              onDeleteMemory={deleteMemory}
            />
          ) : null}

          {section === 'review' ? (
            <ReviewPage
              workspaces={workspaces}
              reviews={reviews}
              onOpenSidebar={openSidebar}
              onPrompt={promptButler}
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
              onCreateReminder={createReminder}
              onUpdateReminder={updateReminder}
              onDeleteReminder={deleteReminder}
              snoozedToday={snoozedUntil === today}
              onSnoozeCheckIns={() => void snoozeCheckIns()}
              onOpenSidebar={openSidebar}
              onPrompt={promptButler}
            />
          ) : null}

          {section === 'settings' ? (
            <PageFrame
              title="设置"
              subtitle="模型、预算与提醒"
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
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => setPracticeSetId(set.id)}
                    aria-current={selectedPracticeSet?.id === set.id ? 'page' : undefined}
                    className={`mb-1 flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors duration-200 ${
                      selectedPracticeSet?.id === set.id
                        ? 'bg-black/[0.06] dark:bg-white/[0.1]'
                        : 'hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
                    }`}
                  >
                    <span className="truncate text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {set.title}
                    </span>
                    <span className="mt-0.5 text-[12px] text-gray-500 dark:text-[#8e8e93]">
                      {set.subject} · {set.questions.length} 题
                    </span>
                  </button>
                ))
              )}
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
                  workspace={currentWorkspace}
                  notes={notes.filter(
                    (note) => !projectId || note.workspaceId === projectId
                  )}
                  mistakes={practiceMistakes.filter(
                    (mistake) =>
                      !projectId || mistake.workspaceId === projectId
                  )}
                  onSubmitAnswer={submitPracticeAnswer}
                  attempts={practiceAttempts.filter(
                    (attempt) =>
                      !projectId || attempt.workspaceId === projectId
                  )}
                  onCreateSet={createPracticeSet}
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
        globalModel={modelLabel}
        initialModel={conversations.active?.model ?? ''}
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
    </div>
  );
}
