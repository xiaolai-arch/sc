import { useCallback, useEffect, useState } from 'react';
import { formatChineseDate, formatLocalDate } from '../../shared/date';
import { ReviewDialog } from '../review/ReviewDialog';
import { SettingsPage } from '../settings/SettingsPage';
import { useTodayPlan } from '../today/useTodayPlan';
import { CoachPane } from './CoachPane';
import { SettingsList, TaskListPane } from './TaskListPane';
import { Sidebar } from './Sidebar';
import type { ShellView } from './types';

type WorkspaceProps = {
  hasApiKey: boolean;
  onRefresh: () => void;
};

export function Workspace({ hasApiKey, onRefresh }: WorkspaceProps) {
  const { plan, loading, loadFailed, error, generating, load, updateTask, generate } = useTodayPlan();
  const [view, setView] = useState<ShellView>('today');
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [startedAtByTask, setStartedAtByTask] = useState<Record<string, Date>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [modelLabel, setModelLabel] = useState('模板计划');

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

  const subjects = Array.from(new Set((plan?.tasks ?? []).map((task) => task.subject)));
  const sidebarSubjects = subjects.length > 0 ? subjects : ['数学', '英语', '政治'];

  useEffect(() => {
    if (!plan) return;
    const visible = plan.tasks.filter((task) => !subjectFilter || task.subject === subjectFilter);
    if (visible.length === 0) {
      if (selectedTaskId !== null) setSelectedTaskId(null);
      return;
    }
    if (!visible.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(visible[0].id);
    }
  }, [plan, subjectFilter, selectedTaskId]);

  const visibleTasks =
    plan?.tasks.filter((task) => !subjectFilter || task.subject === subjectFilter) ?? [];
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0] ?? null;
  const today = plan?.date ?? formatLocalDate(new Date());

  function handleViewChange(next: ShellView) {
    setView(next);
    if (next === 'today') {
      void loadModelLabel();
      onRefresh();
    }
  }

  function handleSelectSubject(subject: string | null) {
    setSubjectFilter(subject);
    if (!plan) return;
    const first = plan.tasks.find((task) => !subject || task.subject === subject);
    setSelectedTaskId(first?.id ?? null);
  }

  function handleSection(id: string) {
    document.getElementById(id)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  return (
    <>
      <div className="flex h-screen flex-col bg-[#e9e9ec] md:p-2">
        <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden border-black/10 bg-white md:rounded-xl md:border md:shadow-sm">
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <Sidebar
              view={view}
              onViewChange={handleViewChange}
              onReview={() => setReviewOpen(true)}
              subjects={sidebarSubjects}
              subjectFilter={subjectFilter}
              onSelectSubject={handleSelectSubject}
            />

            {view === 'settings' ? (
              <SettingsList onSection={handleSection} />
            ) : (
              <TaskListPane
                tasks={plan?.tasks ?? []}
                selectedTaskId={selectedTask?.id ?? null}
                onSelectTask={setSelectedTaskId}
                subjectFilter={subjectFilter}
                loading={loading}
                loadFailed={loadFailed}
              />
            )}

            <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
              {view === 'settings' ? (
                <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
                  <div className="mx-auto w-full max-w-[820px]">
                    <SettingsPage
                      embedded
                      onClose={() => {
                        setView('today');
                        void loadModelLabel();
                        onRefresh();
                      }}
                    />
                  </div>
                </div>
              ) : (
                <CoachPane
                  plan={plan}
                  selectedTask={selectedTask}
                  startedAt={selectedTask ? startedAtByTask[selectedTask.id] : undefined}
                  onStart={() => {
                    if (!selectedTask) return;
                    setStartedAtByTask((current) => ({ ...current, [selectedTask.id]: new Date() }));
                  }}
                  onSelectTask={setSelectedTaskId}
                  onUpdate={updateTask}
                  hasApiKey={hasApiKey}
                  onOpenSettings={() => setView('settings')}
                  loading={loading}
                  loadFailed={loadFailed}
                  error={error}
                  onReload={() => void load()}
                  onGenerate={() => void generate()}
                  generating={generating}
                  modelLabel={hasApiKey ? modelLabel : '模板计划'}
                  dateLabel={formatChineseDate(today)}
                />
              )}
            </main>
          </div>
        </div>
      </div>

      {reviewOpen ? <ReviewDialog date={today} onClose={() => setReviewOpen(false)} /> : null}
    </>
  );
}
