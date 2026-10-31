import { useCallback, useEffect, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import type { UpdateTaskInput } from '../../shared/ipc';
import type { ReviewAnswers } from '../../shared/types';
import type { CreateNoteInput, WorkspaceNote } from '../../shared/workspace';
import { SettingsPage } from '../settings/SettingsPage';
import { Button } from '../ui/Button';
import { ChatPane } from './ChatPane';
import { LearningPane, PracticeList } from './LearningPane';
import { NoteList, NotePane } from './NotePane';
import { PlanPane } from './PlanPane';
import type { NewTaskDraft } from './PlanPane';
import { ReviewList, ReviewPane } from './ReviewPane';
import { Sidebar } from './Sidebar';
import { SettingsList, TaskListPane } from './TaskListPane';
import type { ChatMessage, ShellView } from './types';
import { useWorkspaceData } from './useWorkspaceData';

type WorkspaceProps = {
  hasApiKey: boolean;
  onRefresh: () => void;
};

function messageOf(cause: unknown) {
  return cause instanceof Error ? cause.message : '操作失败，请重试。';
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
    <div className="flex h-screen items-center justify-center bg-[#e9e9ec] p-4">
      <div
        role={alert ? 'alert' : 'status'}
        className="w-full max-w-sm rounded-xl border border-black/10 bg-white p-6 text-center shadow-sm"
      >
        <p className="text-[15px] font-medium text-black">{title}</p>
        {detail ? <p className="mt-2 text-[12px] leading-5 text-gray-600">{detail}</p> : null}
        {actionLabel && onAction ? (
          <Button className="mt-4" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
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
    memory,
    reminders,
    practiceSets,
    streak,
    loading,
    error,
    retry,
    createTask,
    updateTask,
    createNote,
    send,
    submitReview
  } = useWorkspaceData();
  const [view, setView] = useState<ShellView>('chat');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState(() => formatLocalDate(new Date()));
  const [savedReviewDates, setSavedReviewDates] = useState<string[]>([]);
  const [startedAtByTask, setStartedAtByTask] = useState<Record<string, Date>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [modelLabel, setModelLabel] = useState('模板计划');
  const [actionError, setActionError] = useState<string | null>(null);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const filteredTasks = tasks.filter((task) => !workspaceId || task.workspaceId === workspaceId);
  const filteredNotes = notes.filter((note) => !workspaceId || note.workspaceId === workspaceId);
  const filteredSets = practiceSets.filter((set) => !workspaceId || set.workspaceId === workspaceId);
  const filteredMemory = memory.filter((item) => !workspaceId || item.workspaceId === workspaceId);

  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;
  const selectedNote =
    filteredNotes.find((note) => note.id === selectedNoteId) ?? filteredNotes[0] ?? null;
  const selectedSet =
    filteredSets.find((set) => set.id === selectedSetId) ?? filteredSets[0] ?? null;
  const today = formatLocalDate(new Date());

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

  async function handleUpdateTask(input: UpdateTaskInput) {
    setActionError(null);
    try {
      await updateTask(input);
    } catch (cause) {
      setActionError(messageOf(cause));
      throw cause;
    }
  }

  async function handleCreateTask(draft: NewTaskDraft) {
    const workspace = currentWorkspace ?? workspaces[0];
    if (!workspace) throw new Error('还没有工作区，暂时不能添加任务。');
    setActionError(null);
    try {
      const task = await createTask({ workspaceId: workspace.id, ...draft });
      setSelectedTaskId(task.id);
    } catch (cause) {
      setActionError(messageOf(cause));
      throw cause;
    }
  }

  async function handleCreateNote(input: CreateNoteInput) {
    setActionError(null);
    try {
      const note: WorkspaceNote = await createNote(input);
      setSelectedNoteId(note.id);
      return note;
    } catch (cause) {
      setActionError(messageOf(cause));
      throw cause;
    }
  }

  async function sendMessage(text: string) {
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((current) => [...current, userMessage]);
    setTyping(true);
    setActionError(null);
    try {
      const result = await send({
        workspaceId: workspaceId ?? undefined,
        taskId: selectedTask?.id,
        message: text
      });
      setMessages((current) => [
        ...current,
        { id: `a-${Date.now()}`, role: 'assistant', text: result.text }
      ]);
    } catch (cause) {
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: '管家暂时没有回应，请稍后再试。'
        }
      ]);
      setActionError(messageOf(cause));
    } finally {
      setTyping(false);
    }
  }

  function handleViewChange(next: ShellView) {
    setView(next);
    if (next === 'chat') {
      void loadModelLabel();
      onRefresh();
    }
  }

  function handleWorkspaceChange(next: string | null) {
    setWorkspaceId(next);
    setSelectedTaskId(null);
    setSelectedNoteId(null);
    setSelectedSetId(null);
  }

  async function saveReview(answers: ReviewAnswers) {
    await submitReview(reviewDate, answers);
    setSavedReviewDates((current) =>
      current.includes(reviewDate) ? current : [...current, reviewDate]
    );
  }

  function handleSection(id: string) {
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  if (loading && workspaces.length === 0) {
    return <WorkspaceStatus title="正在加载工作区…" detail="从本地 vault 读取任务、记录和提醒。" />;
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

  const showWorkspace = workspaceId === null;
  const dateLabel = formatChineseDate(today);
  const displayModel = hasApiKey ? modelLabel : '模板计划';
  const bannerError = actionError ?? error;

  return (
    <div className="flex h-screen flex-col bg-[#e9e9ec] md:p-2">
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden border-black/10 bg-white md:rounded-xl md:border md:shadow-sm">
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
              }}
              className="shrink-0 font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
            >
              重试
            </button>
          </div>
        ) : null}
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <Sidebar
            view={view}
            onViewChange={handleViewChange}
            workspaceId={workspaceId}
            onWorkspaceChange={handleWorkspaceChange}
            workspaces={workspaces}
          />

          {view === 'chat' || view === 'plan' ? (
            <TaskListPane
              tasks={filteredTasks}
              workspaces={workspaces}
              selectedTaskId={selectedTask?.id ?? null}
              onSelectTask={setSelectedTaskId}
              title={view === 'chat' ? '今日安排' : '计划'}
              showWorkspace={showWorkspace}
            />
          ) : view === 'notes' ? (
            <NoteList
              notes={filteredNotes}
              workspaces={workspaces}
              selectedNoteId={selectedNote?.id ?? null}
              onSelectNote={setSelectedNoteId}
              showWorkspace={showWorkspace}
            />
          ) : view === 'learn' ? (
            <PracticeList
              sets={filteredSets}
              workspaces={workspaces}
              selectedSetId={selectedSet?.id ?? null}
              onSelectSet={setSelectedSetId}
              showWorkspace={showWorkspace}
            />
          ) : view === 'review' ? (
            <ReviewList
              today={today}
              selectedDate={reviewDate}
              onSelectDate={setReviewDate}
              savedDates={savedReviewDates}
            />
          ) : (
            <SettingsList onSection={handleSection} />
          )}

          <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
            {view === 'chat' ? (
              <ChatPane
                workspace={currentWorkspace}
                tasks={filteredTasks}
                selectedTask={selectedTask}
                messages={messages}
                typing={typing}
                onSend={(text) => void sendMessage(text)}
                modelLabel={displayModel}
                hasApiKey={hasApiKey}
                onOpenSettings={() => setView('settings')}
                onOpenPlan={() => setView('plan')}
                onOpenReview={() => setView('review')}
                streak={streak}
                nextReminder={`${reminders[1]?.time ?? '21:30'} ${reminders[1]?.label ?? '晚间复盘'}`}
                dateLabel={dateLabel}
              />
            ) : view === 'plan' ? (
              <PlanPane
                workspace={currentWorkspace}
                tasks={filteredTasks}
                workspaces={workspaces}
                selectedTask={selectedTask}
                startedAt={selectedTask ? startedAtByTask[selectedTask.id] : undefined}
                onStart={() => {
                  if (!selectedTask) return;
                  setStartedAtByTask((current) => ({ ...current, [selectedTask.id]: new Date() }));
                }}
                onSelectTask={setSelectedTaskId}
                onUpdate={handleUpdateTask}
                onCreateTask={handleCreateTask}
                showWorkspace={showWorkspace}
                dateLabel={dateLabel}
                onOpenChat={() => setView('chat')}
              />
            ) : view === 'notes' ? (
              <NotePane
                note={selectedNote}
                notes={notes}
                workspaces={workspaces}
                workspaceId={workspaceId}
                onSelectNote={setSelectedNoteId}
                onOpenChat={() => setView('chat')}
                onCreateNote={handleCreateNote}
              />
            ) : view === 'learn' ? (
              <LearningPane
                set={selectedSet}
                workspace={currentWorkspace}
                notes={filteredNotes}
                onOpenChat={() => setView('chat')}
                onOpenNote={(id) => {
                  setSelectedNoteId(id);
                  setView('notes');
                }}
              />
            ) : view === 'review' ? (
              <ReviewPane
                key={reviewDate}
                workspace={currentWorkspace}
                date={reviewDate}
                dateLabel={formatChineseDate(reviewDate)}
                memory={filteredMemory}
                reminders={reminders}
                streak={streak}
                saved={savedReviewDates.includes(reviewDate)}
                onSave={saveReview}
                onOpenChat={() => setView('chat')}
              />
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
                <div className="mx-auto w-full max-w-[820px]">
                  <SettingsPage
                    embedded
                    onClose={() => {
                      setView('chat');
                      void loadModelLabel();
                      onRefresh();
                    }}
                  />
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
