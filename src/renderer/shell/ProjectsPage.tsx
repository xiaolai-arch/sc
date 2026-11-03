import { useState } from 'react';
import { friendlyErrorMessage } from '../../shared/errors';
import type { LearnerProfile } from '../../shared/memory';
import type {
  CreateNoteInput,
  CreateTaskInput,
  DeleteTaskInput,
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
  onCreateTask?: (input: CreateTaskInput) => Promise<WorkspaceTask>;
  onDeleteTask?: (input: DeleteTaskInput) => Promise<void>;
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
  onCreateTask,
  onDeleteTask,
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
      setWorkspaceError(friendlyErrorMessage(cause, '保存失败，请重试。'));
    }
  }

  return (
    <PageFrame
      title="项目"
      subtitle={workspace?.name ?? '全部项目'}
      onOpenSidebar={onOpenSidebar}
    >
      {workspaces.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300/80 px-6 py-16 text-center dark:border-white/10">
          <p className="text-[16px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
            先在对话里创建项目
          </p>
          <p className="mt-2 text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
            告诉阿咲你想学什么，阿咲会建好项目并排出第一批任务。
          </p>
          <button
            type="button"
            onClick={onOpenChat}
            className="mt-5 rounded-full bg-[#0071e3] px-4 py-2 text-[13px] font-medium text-white transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100"
          >
            去和阿咲聊
          </button>
        </div>
      ) : (
        <>
          <header className="rounded-2xl bg-white p-6 shadow-sm dark:bg-[#1c1c1e] md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-[18px] font-semibold tracking-tight text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {workspace?.name ?? '全部项目'}
                  </h2>
                  {profile ? (
                    <span className="shrink-0 rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]">
                      {profile.weaknesses.length} 个薄弱点
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 text-[13px] leading-6 text-gray-500 dark:text-[#8e8e93]">
                  {workspace?.goal || '告诉阿咲你想做什么，阿咲会创建项目。'}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenPractice}
                  className="rounded-full px-4 py-2 text-[13px] font-medium text-[#0071e3] transition-all duration-300 ease-[cubic-bezier(0.25,0.1,0.25,1)] hover:bg-[#0071e3]/10 hover:opacity-80 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30 motion-reduce:transition-none motion-reduce:active:scale-100 dark:text-[#4da3ff] dark:hover:bg-[#0a84ff]/20"
                >
                  练习
                </button>
                <select
                  aria-label="切换项目"
                  value={workspace?.id ?? ''}
                  onChange={(event) =>
                    onSelectWorkspace(event.target.value === '' ? null : event.target.value)
                  }
                  className="h-9 rounded-xl border-0 bg-[#f5f5f7] px-3 text-[13px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]"
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
              <div className="mt-4 flex items-center justify-between gap-2 border-t border-gray-100 pt-3 dark:border-white/[0.08]">
                <label
                  htmlFor="workspace-check-in"
                  className="text-[12px] text-gray-500 dark:text-[#a1a1a6]"
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
                  className="h-8 rounded-xl border-0 bg-[#f5f5f7] px-2 text-[12px] text-gray-700 outline-none transition-all duration-200 focus:ring-2 focus:ring-[#0071e3]/30 dark:bg-[#242426] dark:text-[#a1a1a6]"
                >
                  <option value="daily">每天</option>
                  <option value="off">关闭</option>
                </select>
              </div>
            ) : null}
            {workspaceError ? (
              <p role="alert" className="mt-2 text-[12px] text-[#d70015] dark:text-[#ff7b72]">
                {workspaceError}
              </p>
            ) : null}
          </header>

          <div className="mt-6 grid gap-6 md:gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
            <PlanSection
              workspace={workspace}
              tasks={tasks}
              busy={busy}
              onUpdateTask={onUpdateTask}
              onCreateTask={onCreateTask}
              onDeleteTask={onDeleteTask}
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
