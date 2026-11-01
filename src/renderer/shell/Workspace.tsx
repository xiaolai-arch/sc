import { useCallback, useEffect, useRef, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import type { ConversationMessage, ConversationStep } from '../../shared/conversations';
import type { SendMessageInput, WorkspaceNote } from '../../shared/workspace';
import { SettingsPage } from '../settings/SettingsPage';
import { Dialog } from '../ui/Dialog';
import { ChatPane } from './ChatPane';
import { ConversationSidebar } from './ConversationSidebar';
import { ProjectPanel, type ProjectPanelTab } from './ProjectPanel';
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
    memoryProfile,
    reminders,
    loading,
    error,
    retry,
    reload,
    stream
  } = useWorkspaceData();
  const conversations = useConversations();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<ProjectPanelTab>('plan');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewNote, setPreviewNote] = useState<WorkspaceNote | null>(null);
  const [typing, setTyping] = useState(false);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [reasoningById, setReasoningById] = useState<Record<string, string>>({});
  const [reasoningMetaById, setReasoningMetaById] = useState<
    Record<string, { startedAt?: number; endedAt?: number }>
  >({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [modelLabel, setModelLabel] = useState('模板计划');

  const currentWorkspace = workspaces.find((workspace) => workspace.id === projectId) ?? null;
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
    } catch {
      setModelLabel('模板计划');
    }
  }, []);

  useEffect(() => {
    void loadModelLabel();
  }, [loadModelLabel]);

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

  async function sendMessage(text: string) {
    if (typing) return;
    setActionError(null);
    setTyping(true);

    let conversation = conversations.active;
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

    const assistantId = chatMessageId('a');
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
      const finalText =
        (result.text || assistantText).trim() || '管家暂时没有整理出回复，请再试一次。';
      const finalConversationId = result.conversationId ?? conversation.id;
      await conversations.append(finalConversationId, {
        id: assistantId,
        role: 'assistant',
        text: finalText,
        createdAt: new Date().toISOString(),
        ...(assistantSteps.length > 0
          ? { steps: toConversationSteps(assistantSteps) }
          : {}),
        source: 'butler'
      });
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
      await reload();
    } catch (cause) {
      flushNow();
      setActionError(streamError ?? messageOf(cause));
      const fallback = assistantText.trim() || '管家暂时没有回应，请稍后再试。';
      try {
        await conversations.append(conversation.id, {
          id: assistantId,
          role: 'assistant',
          text: fallback,
          createdAt: new Date().toISOString(),
          ...(assistantSteps.length > 0
            ? { steps: toConversationSteps(assistantSteps) }
            : {}),
          source: 'butler'
        });
      } catch {
        // The visible error banner already explains the failure.
      }
    } finally {
      flushNow();
      setStreamingMessage(null);
      setTyping(false);
    }
  }

  function startDraft() {
    conversations.startDraft();
    setStreamingMessage(null);
    setActionError(null);
  }

  function selectConversation(id: string) {
    setStreamingMessage(null);
    setActionError(null);
    void conversations.select(id);
  }

  function selectProject(id: string) {
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
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          <ChatPane
            workspace={currentWorkspace}
            messages={chatMessages}
            typing={typing}
            onSend={(text) => void sendMessage(text)}
            modelLabel={displayModel}
            hasApiKey={hasApiKey}
            onOpenSettings={() => setSettingsOpen(true)}
            dateLabel={dateLabel}
            panelOpen={panelOpen}
            onTogglePanel={() => setPanelOpen((open) => !open)}
          />

          <ProjectPanel
            open={panelOpen}
            workspace={currentWorkspace}
            workspaces={workspaces}
            tasks={tasks}
            notes={notes}
            reviews={reviews}
            reminders={reminders}
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
