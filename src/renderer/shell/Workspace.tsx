import { useCallback, useEffect, useRef, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import type { UpdateTaskInput } from '../../shared/ipc';
import type { ReviewAnswers } from '../../shared/types';
import { SettingsPage } from '../settings/SettingsPage';
import { ChatPane } from './ChatPane';
import {
  demoMemory,
  demoNotes,
  demoPracticeSets,
  demoReminders,
  demoStreak,
  demoTasks,
  workspaces
} from './demoData';
import type { WorkspaceNote, WorkspaceTask } from './demoData';
import { LearningPane, PracticeList } from './LearningPane';
import { NoteList, NotePane } from './NotePane';
import { PlanPane } from './PlanPane';
import { ReviewList, ReviewPane } from './ReviewPane';
import { Sidebar } from './Sidebar';
import { SettingsList, TaskListPane } from './TaskListPane';
import type { ChatMessage, ShellView } from './types';

type WorkspaceProps = {
  hasApiKey: boolean;
  onRefresh: () => void;
};

function butlerReply(text: string) {
  if (/记一下|记录/.test(text)) return '记下了。可以去「记录」里查看这条随手记。';
  if (/提醒/.test(text)) return '好，我会在 21:30 提醒你复盘（原型）。';
  if (/优先级|安排|排/.test(text)) {
    return '我先按截止时间和精力排：数学 45 分钟 → 英语 30 分钟 → 政治 30 分钟。';
  }
  if (/洛必达/.test(text)) {
    return '洛必达法则要先确认 0/0 或 ∞/∞，且导函数比值极限存在。你「错题：洛必达法则的适用条件」里正好记了这一点。';
  }
  return '收到。目前是原型模式；接入模型后，我会结合你的计划、记录和复盘回答。';
}

export function Workspace({ hasApiKey, onRefresh }: WorkspaceProps) {
  const [view, setView] = useState<ShellView>('chat');
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WorkspaceTask[]>(demoTasks);
  const [notes, setNotes] = useState<WorkspaceNote[]>(demoNotes);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [reviewDate, setReviewDate] = useState(() => formatLocalDate(new Date()));
  const [savedReviewDates, setSavedReviewDates] = useState<string[]>([]);
  const [startedAtByTask, setStartedAtByTask] = useState<Record<string, Date>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const [modelLabel, setModelLabel] = useState('模板计划');
  const timeoutRef = useRef<number | null>(null);

  const currentWorkspace = workspaces.find((workspace) => workspace.id === workspaceId) ?? null;
  const filteredTasks = tasks.filter((task) => !workspaceId || task.workspaceId === workspaceId);
  const filteredNotes = notes.filter((note) => !workspaceId || note.workspaceId === workspaceId);
  const filteredSets = demoPracticeSets.filter((set) => !workspaceId || set.workspaceId === workspaceId);
  const filteredMemory = demoMemory.filter((item) => !workspaceId || item.workspaceId === workspaceId);

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
      setModelLabel(settings.provider.model);
    } catch {
      setModelLabel('模板计划');
    }
  }, []);

  useEffect(() => {
    void loadModelLabel();
  }, [loadModelLabel]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  async function updateTask(input: UpdateTaskInput) {
    setTasks((current) =>
      current.map((task) =>
        task.id === input.taskId
          ? { ...task, status: input.status, actualMin: input.actualMin ?? task.actualMin }
          : task
      )
    );
  }

  function sendMessage(text: string) {
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((current) => [...current, userMessage]);

    if (/记一下|记录/.test(text)) {
      const workspace = currentWorkspace ?? workspaces[0];
      const title = text.replace(/^(记一下|记录)[：:\s]*/, '').slice(0, 28) || '随手记';
      const note: WorkspaceNote = {
        id: `note-${Date.now()}`,
        workspaceId: workspace.id,
        title,
        subject: workspace.name,
        tags: ['随手记'],
        updated: '今天',
        summary: text,
        blocks: [{ kind: 'p', text }],
        related: []
      };
      setNotes((current) => [note, ...current]);
    }

    setTyping(true);
    timeoutRef.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: `a-${Date.now()}`, role: 'assistant', text: butlerReply(text) }
      ]);
      setTyping(false);
    }, 500);
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
    const api = window.studyCoach;
    if (api) {
      await api.submitReview({ date: reviewDate, answers });
    }
    setSavedReviewDates((current) =>
      current.includes(reviewDate) ? current : [...current, reviewDate]
    );
  }

  function handleSection(id: string) {
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  const showWorkspace = workspaceId === null;
  const dateLabel = formatChineseDate(today);
  const displayModel = hasApiKey ? modelLabel : '模板计划';

  return (
    <div className="flex h-screen flex-col bg-[#e9e9ec] md:p-2">
      <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden border-black/10 bg-white md:rounded-xl md:border md:shadow-sm">
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
                onSend={sendMessage}
                modelLabel={displayModel}
                hasApiKey={hasApiKey}
                onOpenSettings={() => setView('settings')}
                onOpenPlan={() => setView('plan')}
                onOpenReview={() => setView('review')}
                streak={demoStreak}
                nextReminder={`${demoReminders[1]?.time ?? '21:30'} ${demoReminders[1]?.label ?? '晚间复盘'}`}
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
                onUpdate={updateTask}
                showWorkspace={showWorkspace}
                dateLabel={dateLabel}
                onOpenChat={() => setView('chat')}
              />
            ) : view === 'notes' ? (
              <NotePane
                note={selectedNote}
                notes={notes}
                workspaces={workspaces}
                onSelectNote={setSelectedNoteId}
                onOpenChat={() => setView('chat')}
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
                reminders={demoReminders}
                streak={demoStreak}
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
