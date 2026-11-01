import { useCallback, useEffect, useRef, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import type {
  Conversation,
  ConversationMessage,
  ConversationStep
} from '../../shared/conversations';
import type { SendMessageInput, WorkspaceNote } from '../../shared/workspace';
import { SettingsPage } from '../settings/SettingsPage';
import { Dialog } from '../ui/Dialog';
import { ChatPane } from './ChatPane';
import { ConversationSidebar } from './ConversationSidebar';
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
import { ProjectPanel, type ProjectPanelTab } from './ProjectPanel';
import { QuickCaptureDialog } from './QuickCaptureDialog';
import type { ChatMessage, ChatStep } from './types';
import { useConversations } from './useConversations';
import { useWorkspaceData } from './useWorkspaceData';

type WorkspaceProps = {
  hasApiKey: boolean;
  onRefresh: () => void;
};

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
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
    <div className="flex h-screen items-center justify-center bg-[#f7f6f3] p-4">
      <div
        role={alert ? 'alert' : 'status'}
        className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-6 text-center shadow-sm"
      >
        <p className="text-[15px] font-medium text-black">{title}</p>
        {detail ? <p className="mt-2 text-[12px] leading-5 text-gray-600">{detail}</p> : null}
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-4 rounded-md bg-[#0071e3] px-3 py-1.5 text-[12px] font-medium text-white"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function toConversationSteps(steps: ChatStep[]): ConversationStep[] {
  return steps.map((step) => ({ ...step }));
}

function toChatSteps(steps: ConversationStep[] | undefined): ChatStep[] | undefined {
  return steps?.map((step) => ({ ...step }));
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
  const [projectId, setProjectId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<ProjectPanelTab>('plan');
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const focusSessionCounterRef = useRef(0);
  const recordedFocusSessionsRef = useRef<Set<number>>(new Set());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const [reasoningById, setReasoningById] = useState<Record<string, string>>({});
  const [reasoningMetaById, setReasoningMetaById] = useState<
    Record<string, { startedAt?: number; endedAt?: number }>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState('模板计划');
  const streamGenerationRef = useRef(0);

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
      const reasoning = reasoningById[message.id];
      const meta = reasoningMetaById[message.id];
      return {
        id: message.id,
        role: message.role,
        text: message.text,
        ...(reasoning ? { reasoning } : {}),
        ...(meta?.startedAt !== undefined ? { reasoningStartedAt: meta.startedAt } : {}),
        ...(meta?.endedAt !== undefined ? { reasoningEndedAt: meta.endedAt } : {}),
        ...(message.steps ? { steps: toChatSteps(message.steps) } : {}),
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
    setActiveAssistantId(assistantId);
    setStreamingMessage({
      id: assistantId,
      role: 'assistant',
      text: '',
      reasoning: '',
      steps: [],
      streaming: true
    });

    let pendingReasoning = '';
    let pendingText = '';
    let frameId: number | null = null;
    let assistantReasoning = '';
    let assistantText = '';
    let assistantSteps: ChatStep[] = [];
    let assistantReasoningStartedAt: number | undefined;
    let assistantReasoningEndedAt: number | undefined;
    let streamError: string | null = null;

    const updateStreaming = (updater: (message: ChatMessage) => ChatMessage) => {
      setStreamingMessage((current) =>
        current && current.id === assistantId ? updater(current) : current
      );
    };

    const flush = () => {
      frameId = null;
      const reasoning = pendingReasoning;
      const text = pendingText;
      pendingReasoning = '';
      pendingText = '';
      if (!reasoning && !text) return;
      assistantReasoning += reasoning;
      assistantText += text;
      updateStreaming((message) => ({
        ...message,
        ...(reasoning
          ? {
              reasoning: `${message.reasoning ?? ''}${reasoning}`,
              reasoningStartedAt: message.reasoningStartedAt ?? Date.now()
            }
          : {}),
        ...(text
          ? {
              text: `${message.text}${text}`,
              reasoningEndedAt: message.reasoningEndedAt ?? Date.now()
            }
          : {})
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
            case 'reasoning':
              assistantReasoningStartedAt ??= Date.now();
              pendingReasoning += event.text;
              scheduleFlush();
              break;
            case 'narration':
              flushNow();
              assistantReasoningStartedAt ??= Date.now();
              assistantReasoning += assistantReasoning ? `\n\n${event.text}` : event.text;
              updateStreaming((message) => ({
                ...message,
                reasoning: message.reasoning
                  ? `${message.reasoning}\n\n${event.text}`
                  : event.text,
                reasoningStartedAt: message.reasoningStartedAt ?? Date.now()
              }));
              break;
            case 'text':
              assistantReasoningEndedAt ??= Date.now();
              pendingText += event.text;
              scheduleFlush();
              break;
            case 'tool-start': {
              flushNow();
              const step: ChatStep = {
                id: event.id,
                name: event.name,
                label: event.label,
                status: 'running'
              };
              assistantSteps = [...assistantSteps, step];
              updateStreaming((message) => ({
                ...message,
                steps: [...(message.steps ?? []), step]
              }));
              break;
            }
            case 'tool-result': {
              flushNow();
              assistantSteps = assistantSteps.map((step) =>
                step.id === event.id
                  ? {
                      ...step,
                      status: event.ok ? 'done' : 'failed',
                      ...(event.detail ? { detail: event.detail } : {})
                    }
                  : step
              );
              updateStreaming((message) => ({
                ...message,
                steps: (message.steps ?? []).map((step) =>
                  step.id === event.id
                    ? {
                        ...step,
                        status: event.ok ? 'done' : 'failed',
                        ...(event.detail ? { detail: event.detail } : {})
                      }
                    : step
                )
              }));
              break;
            }
            case 'error':
              flushNow();
              streamError = event.message;
              setActionError(event.message);
              break;
            case 'done':
              flushNow();
              assistantReasoningEndedAt ??= Date.now();
              assistantText = event.text || assistantText;
              updateStreaming((message) => ({
                ...message,
                text: event.text || message.text,
                streaming: false,
                reasoningEndedAt: message.reasoningEndedAt ?? Date.now()
              }));
              break;
          }
        }
      );

      flushNow();
      const finalConversationId = result.conversationId ?? conversation.id;
      if (generation !== streamGenerationRef.current) {
        await conversations.refresh();
        await reload();
        return;
      }
      if (assistantReasoning) {
        setReasoningById((current) => ({ ...current, [assistantId]: assistantReasoning }));
        setReasoningMetaById((current) => ({
          ...current,
          [assistantId]: {
            ...(assistantReasoningStartedAt !== undefined
              ? { startedAt: assistantReasoningStartedAt }
              : {}),
            ...(assistantReasoningEndedAt !== undefined
              ? { endedAt: assistantReasoningEndedAt }
              : {})
          }
        }));
      }
      await conversations.select(finalConversationId);
      await reload();
    } catch (cause) {
      flushNow();
      setActionError(streamError ?? messageOf(cause));
      if (generation === streamGenerationRef.current) {
        try {
          await conversations.select(conversation.id);
          await reload();
        } catch {
          // The visible error banner already explains the failure.
        }
      }
    } finally {
      flushNow();
      setStreamingMessage(null);
      setActiveAssistantId(null);
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
    }
    try {
      await conversations.remove(id);
    } catch (cause) {
      setActionError(messageOf(cause));
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

  function startDraft() {
    streamGenerationRef.current += 1;
    conversations.startDraft();
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
  }

  function selectConversation(id: string) {
    streamGenerationRef.current += 1;
    setStreamingMessage(null);
    setActionError(null);
    setEditingMessageId(null);
    setComposerText('');
    void conversations.select(id);
  }

  function selectProject(id: string) {
    streamGenerationRef.current += 1;
    setProjectId(id);
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
        title="正在准备管家…"
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
  const displayModel = hasApiKey ? modelLabel : '模板计划';

  return (
    <div className="flex h-screen flex-col bg-[#f7f6f3]">
      {bannerError ? (
        <div
          role="alert"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-[#d70015]/10 bg-[#fdf3f2] px-4 py-2 text-[12px] text-[#d70015]"
        >
          <span className="min-w-0 truncate">{bannerError}</span>
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              void retry();
              void conversations.refresh();
            }}
            className="shrink-0 font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          >
            重试
          </button>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ConversationSidebar
          conversations={conversations.summaries}
          projects={workspaces}
          activeConversationId={conversations.active?.id ?? null}
          selectedProjectId={projectId}
          onNewConversation={startDraft}
          onSelectConversation={selectConversation}
          onSelectProject={selectProject}
          onOpenSettings={() => setSettingsOpen(true)}
          onRenameConversation={(id, title) => void renameConversation(id, title)}
          onTogglePinned={(id, pinned) => void togglePinnedConversation(id, pinned)}
          onDeleteConversation={(id) => void deleteConversation(id)}
          onSearchConversations={conversations.search}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          <ChatPane
            workspace={currentWorkspace}
            messages={chatMessages}
            typing={typing}
            onSend={(text) => void submitComposer(text)}
            modelLabel={displayModel}
            hasApiKey={hasApiKey}
            onOpenSettings={() => setSettingsOpen(true)}
            dateLabel={dateLabel}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((open) => !open)}
            onStop={stopStreaming}
            composerText={composerText}
            onComposerTextChange={setComposerText}
            editing={editingMessageId !== null}
            onCancelEdit={cancelEdit}
            onRegenerate={(id) => void regenerateMessage(id)}
            onEditMessage={editLastUserMessage}
          />

          <ProjectPanel
            open={panelOpen}
            workspace={currentWorkspace}
            workspaces={workspaces}
            tasks={tasks}
            notes={notes}
            reviews={reviews}
            reminders={reminders}
            memoryRecords={memoryRecords}
            profile={memoryProfile}
            tab={panelTab}
            onTabChange={setPanelTab}
            onClose={() => setPanelOpen(false)}
            onSelectWorkspace={(id) => {
              if (id === '') {
                setProjectId(null);
                return;
              }
              selectProject(id);
            }}
            onPrompt={(prompt) => void sendMessage(prompt)}
            onPreviewNote={setPreviewNote}
            onOpenPractice={() => {
              setPracticeSetId(filteredPracticeSets[0]?.id ?? null);
              setPracticeOpen(true);
            }}
            busy={typing}
            onUpdateTask={updateTask}
            onCreateNote={createNote}
            onCreateReminder={createReminder}
            onUpdateReminder={updateReminder}
            focus={focus}
            focusNotice={focusNotice}
            canStartFocus={firstFocusableTask(tasks) !== undefined}
            onStartFocus={startFocusForTask}
            onStartDefaultFocus={startDefaultFocus}
            onPauseFocus={pauseFocus}
            onResumeFocus={resumeFocus}
            onResetFocus={resetFocus}
            onUpdateMemory={updateMemory}
            onDeleteMemory={deleteMemory}
            onUpdateWorkspace={updateWorkspace}
            snoozedToday={snoozedUntil === today}
            onSnoozeCheckIns={() => void snoozeCheckIns()}
          />
        </div>
      </div>

      {settingsOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <SettingsPage
              embedded
              onClose={() => {
                setSettingsOpen(false);
                void loadModelLabel();
                onRefresh();
              }}
            />
          </div>
        </div>
      ) : null}

      {practiceOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4">
          <div className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="w-56 shrink-0 overflow-y-auto border-r border-[#ece9e4] p-2">
              <div className="px-2 py-2 text-[11px] font-semibold text-[#1d1d1f]">
                练习
              </div>
              {filteredPracticeSets.length === 0 ? (
                <p className="px-2 py-2 text-[11px] leading-5 text-[#8a8a8e]">
                  这个项目还没有练习集。可以让管家先记一些错题。
                </p>
              ) : (
                filteredPracticeSets.map((set) => (
                  <button
                    key={set.id}
                    type="button"
                    onClick={() => setPracticeSetId(set.id)}
                    aria-current={selectedPracticeSet?.id === set.id ? 'page' : undefined}
                    className={`mb-1 flex w-full flex-col rounded-lg px-2 py-2 text-left transition-colors ${
                      selectedPracticeSet?.id === set.id
                        ? 'bg-[#e9e6e0]'
                        : 'hover:bg-[#f1eee8]'
                    }`}
                  >
                    <span className="truncate text-[11px] font-medium text-[#1d1d1f]">
                      {set.title}
                    </span>
                    <span className="mt-0.5 text-[9px] text-[#8a8a8e]">
                      {set.subject} · {set.questions.length} 题
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-[#ece9e4] px-4">
                <span className="text-[12px] font-semibold text-[#1d1d1f]">练习</span>
                <button
                  type="button"
                  aria-label="关闭练习"
                  onClick={() => setPracticeOpen(false)}
                  className="rounded-md px-2 py-1 text-[11px] text-[#6b6b70] hover:bg-black/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
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
                  onOpenChat={() => setPracticeOpen(false)}
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
          void sendMessage(text);
        }}
      />

      <Dialog
        open={previewNote !== null}
        onClose={() => setPreviewNote(null)}
        title={previewNote?.title ?? '笔记'}
      >
        {previewNote ? (
          <div>
            <p className="text-[11px] text-gray-500">
              {previewNote.subject} · {previewNote.updated}
            </p>
            <div className="mt-3 whitespace-pre-wrap text-[13px] leading-6 text-[#1d1d1f]">
              {previewNote.body}
            </div>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  const note = previewNote;
                  setPreviewNote(null);
                  void sendMessage(`帮我改一下笔记《${note.title}》：`);
                }}
                className="rounded-md bg-[#0071e3] px-3 py-1.5 text-[12px] font-medium text-white"
              >
                让管家改
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
