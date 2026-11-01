import { useState } from 'react';
import type { LearnerProfile } from '../../shared/memory';
import type {
  CreateNoteInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceTaskInput,
  Workspace,
  WorkspaceNote,
  WorkspaceTask
} from '../../shared/workspace';
import { PageFrame } from './PageFrame';
import { PlanSection, RecordsSection } from './ProjectSections';
import type { FocusSession } from './focus-timer';

type ProjectsPageProps = {
  workspace: Workspace | null;
  workspaces: Workspace[];
  tasks: WorkspaceTask[];
  notes: WorkspaceNote[];
  profile: LearnerProfile | null;
  onOpenSidebar: () => void;
  onOpenChat: () => void;
  onSelectWorkspace: (id: string | null) => void;
  onUpdateWorkspace: (input: UpdateWorkspaceInput) => Promise<Workspace>;
  onOpenPractice: () => void;
  onPrompt: (prompt: string) => void;
  onPreviewNote: (note: WorkspaceNote) => void;
  onCreateNote: (input: CreateNoteInput) => Promise<WorkspaceNote>;
  busy?: boolean;
  onUpdateTask: (input: UpdateWorkspaceTaskInput) => Promise<WorkspaceTask>;
  focus: FocusSession | null;
  focusNotice: string | null;
  canStartFocus: boolean;
  onStartFocus: (taskId: string) => void;
  onStartDefaultFocus: () => void;
  onPauseFocus: () => void;
  onResumeFocus: () => void;
  onResetFocus: () => void;
};

export function ProjectsPage({
  workspace,
  workspaces,
  tasks,
  notes,
  profile,
  onOpenSidebar,
  onOpenChat,
  onSelectWorkspace,
  onUpdateWorkspace,
  onOpenPractice,
  onPrompt,
  onPreviewNote,
  onCreateNote,
  busy = false,
  onUpdateTask,
  focus,
  focusNotice,
  canStartFocus,
  onStartFocus,
  onStartDefaultFocus,
  onPauseFocus,
  onResumeFocus,
  onResetFocus
}: ProjectsPageProps) {
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  async function updateCheckIn(checkIn: 'daily' | 'off') {
    if (!workspace) return;
    setWorkspaceError(null);
    try {
      await onUpdateWorkspace({ workspaceId: workspace.id, checkIn });
    } catch (cause) {
      setWorkspaceError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    }
  }

  return (
    <PageFrame
      title="项目"
      subtitle={workspace?.name ?? '全部项目'}
      onOpenSidebar={onOpenSidebar}
    >
      {workspaces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#ddd8d0] dark:border-white/10 px-6 py-12 text-center">
          <p className="text-[13px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">
            先在对话里创建项目
          </p>
          <p className="mt-1 text-[12px] leading-5 text-[#8a8a8e] dark:text-[#8e8e93]">
            告诉管家你想学什么，他会建好项目并排出第一批任务。
          </p>
          <button
            type="button"
            onClick={onOpenChat}
            className="mt-4 rounded-md bg-[#0071e3] px-3 py-1.5 text-[12px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          >
            去和管家聊
          </button>
        </div>
      ) : (
        <>
          <header className="rounded-xl border border-[#e5e1da] dark:border-white/10 bg-white dark:bg-[#1c1c1e] p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h2 className="truncate text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {workspace?.name ?? '全部项目'}
                  </h2>
                  {profile ? (
                    <span className="shrink-0 rounded-full bg-[#f1eee8] dark:bg-white/[0.08] px-1.5 py-0.5 text-[9px] text-[#6b6b70] dark:text-[#a1a1a6]">
                      {profile.weaknesses.length} 个薄弱点
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-[#8a8a8e] dark:text-[#8e8e93]">
                  {workspace?.goal || '告诉管家你想做什么，他会创建项目。'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenPractice}
                  className="rounded-md px-2.5 py-1.5 text-[11px] font-medium text-[#0071e3] dark:text-[#4da3ff] hover:bg-[#e8f2ff] dark:hover:bg-[#0a84ff]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                >
                  练习
                </button>
                <select
                  aria-label="切换项目"
                  value={workspace?.id ?? ''}
                  onChange={(event) =>
                    onSelectWorkspace(event.target.value === '' ? null : event.target.value)
                  }
                  className="h-8 rounded-md border border-[#e5e1da] dark:border-white/10 bg-white dark:bg-[#242426] px-2 text-[11px] text-[#3c3c3f] dark:text-[#a1a1a6] outline-none focus:border-[#0071e3]"
                >
                  <option value="">全部项目</option>
                  {workspaces.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {workspace ? (
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-[#f0ece6] dark:border-white/[0.08] pt-2">
                <label
                  htmlFor="workspace-check-in"
                  className="text-[10px] text-[#6b6b70] dark:text-[#a1a1a6]"
                >
                  参与检查
                </label>
                <select
                  id="workspace-check-in"
                  aria-label="参与检查"
                  value={workspace.checkIn === 'off' ? 'off' : 'daily'}
                  onChange={(event) =>
                    void updateCheckIn(event.target.value as 'daily' | 'off')
                  }
                  className="h-7 rounded-md border border-[#e5e1da] dark:border-white/10 bg-white dark:bg-[#242426] px-1.5 text-[10px] text-[#3c3c3f] dark:text-[#a1a1a6] outline-none focus:border-[#0071e3]"
                >
                  <option value="daily">每天</option>
                  <option value="off">关闭</option>
                </select>
              </div>
            ) : null}
            {workspaceError ? (
              <p role="alert" className="mt-2 text-[10px] text-[#d70015] dark:text-[#ff7b72]">
                {workspaceError}
              </p>
            ) : null}
          </header>

          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <PlanSection
              workspace={workspace}
              tasks={tasks}
              busy={busy}
              onUpdateTask={onUpdateTask}
              onPrompt={onPrompt}
              focus={focus}
              focusNotice={focusNotice}
              canStartFocus={canStartFocus}
              onStartFocus={onStartFocus}
              onStartDefaultFocus={onStartDefaultFocus}
              onPauseFocus={onPauseFocus}
              onResumeFocus={onResumeFocus}
              onResetFocus={onResetFocus}
            />
            <RecordsSection
              workspace={workspace}
              notes={notes}
              onCreateNote={onCreateNote}
              onPreviewNote={onPreviewNote}
              onPrompt={onPrompt}
            />
          </div>
        </>
      )}
    </PageFrame>
  );
}
