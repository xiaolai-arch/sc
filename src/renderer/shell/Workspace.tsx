import { useCallback, useEffect, useRef, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import type { Conversation, ConversationMessage } from '../../shared/conversations';
import type { SendMessageInput, WorkspaceNote } from '../../shared/workspace';
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
import { LearningPane } from './LearningPane';
import { MemoryPage } from './MemoryPage';
import { ModelPickerDialog } from './ModelPickerDialog';
import { NavigationSidebar, type Section } from './NavigationSidebar';
import { PageFrame } from './PageFrame';
import { ProjectsPage } from './ProjectsPage';
import { QuickCaptureDialog } from './QuickCaptureDialog';
import { RemindersPage } from './RemindersPage';
import { ReviewPage } from './ReviewPage';
import { stepsToTrace } from './trace';
import type { ChatMessage, ChatTraceItem } from './types';
import { useConversations } from './useConversations';
import { useWorkspaceData } from './useWorkspaceData';

type WorkspaceProps = {
  hasApiKey: boolean;
  onRefresh: () => void;
};

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
}

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
    memoryProfile,
    reminders,
    loading,
    error,
    retry,
    reload,
    stream,
    cancelStream,
    submitPracticeAnswer,
    updateTask,
    updateWorkspace,
    createNote,
    createReminder,
    updateReminder,
    memoryRecords,
    updateMemory,
    deleteMemory
  } = useWorkspaceData();
  const conversations = useConversations();
  const [section, setSection] = useState<Section>('chat');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  const currentWorkspace = workspaces.find((workspace) => workspace.id === projectId) ?? null;
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
    if (!conversations.active) return;
    setProjectId(conversations.active.workspaceId ?? null);
  }, [conversations.active?.id, conversations.active?.workspaceId]);

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
    options: { appendUser: boolean; conversation?: Conversation | null }
  ) {
    if (typing) return;
    const generation = ++streamGenerationRef.current;
    setActionError(null);
    setStreamStatus(null);
    setTyping(true);

    let conversation = options.conversation ?? conversations.active;
    try {
      if (!conversation) {
        conversation = await conversations.create({
          workspaceId: projectId ?? undefined
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
      const result = await stream(
        {
          workspaceId: conversation.workspaceId ?? projectId ?? undefined,
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
      await reload();
    } catch (cause) {
      flushNow();
      setActionError(streamError ?? messageOf(cause));
      if (
        generation === streamGenerationRef.current ||
        activeConversationIdRef.current === conversation.id
      ) {
        try {
          await conversations.select(conversation.id);
          await reload();
        } catch {
          // The visible error banner already explains the failure.
        }
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
      setStreamingMessage(null);
      setActiveAssistantId(null);
      setStreamStatus(null);
      setTyping(false);
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

  function changeSection(next: Section) {
    setSection(next);
    setSidebarOpen(false);
  }

  function openSettings() {
    changeSection('settings');
  }

  /** Every "ask the butler" affordance lands in chat and sends the prompt. */
  function promptButler(prompt: string) {
    changeSection('chat');
    void sendMessage(prompt);
  }

  function startDraft() {
    streamGenerationRef.current += 1;
    conversations.startDraft();
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
    setSidebarOpen(false);
    setModelPickerOpen(false);
    setModelError(null);
    setSection('chat');
  }

  function selectConversation(id: string) {
    streamGenerationRef.current += 1;
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

  function selectProject(id: string | null) {
    setSidebarOpen(false);
    if (id === null) {
      setProjectId(null);
      return;
    }
    setProjectId(id);
    // Outside the chat section a project is only a filter; stay on the page.
    if (section !== 'chat') return;
    if (conversations.active?.workspaceId === id) return;
    const recent = conversations.summaries.find((summary) => summary.workspaceId === id);
    if (recent) {
      selectConversation(recent.id);
      return;
    }
    startDraft();
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
          conversations={conversations.summaries}
          projects={workspaces}
          activeConversationId={conversations.active?.id ?? null}
          selectedProjectId={projectId}
          onSectionChange={changeSection}
          onNewConversation={startDraft}
          onSelectConversation={selectConversation}
          onSelectProject={selectProject}
          onRenameConversation={(id, title) => void renameConversation(id, title)}
          onTogglePinned={(id, pinned) => void togglePinnedConversation(id, pinned)}
          onDeleteConversation={(id) => void deleteConversation(id)}
          onSearchConversations={conversations.search}
          mobileOpen={sidebarOpen}
          onCloseMobile={() => setSidebarOpen(false)}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          {section === 'chat' ? (
            <ChatPane
              workspace={currentWorkspace}
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
              onOpenSidebar={() => setSidebarOpen(true)}
              sidebarOpen={sidebarOpen}
              typingStatus={streamStatus}
              {...(conversations.active ? { onOpenModelPicker: openModelPicker } : {})}
            />
          ) : null}

          {section === 'projects' ? (
            <ProjectsPage
              workspace={currentWorkspace}
              workspaces={workspaces}
              tasks={tasks}
              notes={notes}
              profile={memoryProfile}
              onOpenSidebar={() => setSidebarOpen(true)}
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

          {section === 'memory' ? (
            <MemoryPage
              workspace={currentWorkspace}
              memoryRecords={memoryRecords}
              profile={memoryProfile}
              onOpenSidebar={() => setSidebarOpen(true)}
              onUpdateMemory={updateMemory}
              onDeleteMemory={deleteMemory}
            />
          ) : null}

          {section === 'review' ? (
            <ReviewPage
              workspace={currentWorkspace}
              reviews={reviews}
              onOpenSidebar={() => setSidebarOpen(true)}
              onPrompt={promptButler}
            />
          ) : null}

          {section === 'reminders' ? (
            <RemindersPage
              reminders={reminders}
              onCreateReminder={createReminder}
              onUpdateReminder={updateReminder}
              snoozedToday={snoozedUntil === today}
              onSnoozeCheckIns={() => void snoozeCheckIns()}
              onOpenSidebar={() => setSidebarOpen(true)}
              onPrompt={promptButler}
            />
          ) : null}

          {section === 'settings' ? (
            <PageFrame
              title="设置"
              subtitle="模型、预算与提醒"
              onOpenSidebar={() => setSidebarOpen(true)}
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
