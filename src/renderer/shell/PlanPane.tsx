import { useState } from 'react';
import type { UpdateTaskInput } from '../../shared/ipc';
import type { StudyTask } from '../../shared/types';
import type { Workspace, WorkspaceTask } from '../../shared/workspace';
import { TaskCard } from '../today/TaskCard';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Input } from '../ui/Input';
import { cn } from '../ui/cn';
import { MoreHorizontalIcon } from '../ui/icons';

export type NewTaskDraft = {
  title: string;
  subject: string;
  durationMin: number;
  acceptance: string;
};

function statusLabel(status: WorkspaceTask['status']) {
  if (status === 'done') return '已完成';
  if (status === 'in-progress') return '进行中';
  if (status === 'skipped') return '已跳过';
  return '待开始';
}

function statusDotClass(status: WorkspaceTask['status']) {
  if (status === 'done') return 'bg-[#34c759]';
  if (status === 'in-progress') return 'bg-[#0071e3]';
  if (status === 'skipped') return 'bg-[#c7c7cc]';
  return 'bg-[#d1d1d6]';
}

function toStudyTask(task: WorkspaceTask): StudyTask {
  return {
    id: task.id,
    title: task.title,
    subject: task.subject,
    durationMin: task.durationMin,
    materialRefs: [],
    acceptance: task.acceptance,
    status: task.status,
    actualMin: task.actualMin
  };
}

type PlanPaneProps = {
  workspace: Workspace | null;
  tasks: WorkspaceTask[];
  workspaces: Workspace[];
  selectedTask: WorkspaceTask | null;
  startedAt?: Date;
  onStart: () => void;
  onSelectTask: (id: string) => void;
  onUpdate: (input: UpdateTaskInput) => Promise<void>;
  onCreateTask: (input: NewTaskDraft) => Promise<void>;
  showWorkspace: boolean;
  dateLabel: string;
  onOpenChat: () => void;
};

export function PlanPane({
  workspace,
  tasks,
  workspaces,
  selectedTask,
  startedAt,
  onStart,
  onSelectTask,
  onUpdate,
  onCreateTask,
  showWorkspace,
  dateLabel,
  onOpenChat
}: PlanPaneProps) {
  const completed = tasks.filter((task) => task.status === 'done').length;
  const totalMinutes = tasks.reduce((sum, task) => sum + task.durationMin, 0);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [duration, setDuration] = useState('30');
  const [acceptance, setAcceptance] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<string | null>(null);

  async function submitTask() {
    if (!title.trim()) {
      setFormError('请先填写任务标题。');
      return;
    }
    setBusy(true);
    setFormError(null);
    setFormStatus(null);
    try {
      await onCreateTask({
        title: title.trim(),
        subject: subject.trim() || '学习',
        durationMin: Math.max(0, Number(duration) || 30),
        acceptance: acceptance.trim() || '完成即可'
      });
      setTitle('');
      setSubject('');
      setDuration('30');
      setAcceptance('');
      setFormStatus('任务已添加');
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : '添加任务失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">计划</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">
            {workspace?.name ?? '全部工作区'} · {dateLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] text-gray-500 sm:inline">
            {completed} / {tasks.length} 完成
          </span>
          <button
            type="button"
            aria-label="更多"
            className="flex h-7 w-7 items-center justify-center rounded-md text-gray-500 transition-colors duration-150 hover:bg-black/[0.04] hover:text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
          >
            <MoreHorizontalIcon className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto w-full max-w-[760px] space-y-5">
          <Card padding="compact">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium text-gray-500">目标</p>
                <p className="mt-1 text-[14px] font-medium text-black">
                  {workspace?.goal ?? '把今天最重要的事先做完'}
                </p>
                <p className="mt-1 text-[12px] text-gray-500">
                  {workspace?.description ?? `今天 ${tasks.length} 个任务，已完成 ${completed} 个。`}
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={onOpenChat}>
                去管家
              </Button>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
              <span>{completed} / {tasks.length} 完成</span>
              <span>·</span>
              <span>{totalMinutes} 分钟</span>
            </div>
          </Card>

          <Card padding="compact">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-[13px] font-medium text-black">添加任务</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  新任务会写入当前工作区，稍后可以在管家那里继续拆解。
                </p>
              </div>
              {formStatus ? (
                <span role="status" className="text-[11px] text-gray-500">
                  {formStatus}
                </span>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Input
                aria-label="任务标题"
                placeholder="任务标题"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <Input
                aria-label="科目"
                placeholder="科目"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
              />
              <Input
                aria-label="时长（分钟）"
                type="number"
                min={0}
                placeholder="时长（分钟）"
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
              <Input
                aria-label="验收标准"
                placeholder="验收标准（可选）"
                value={acceptance}
                onChange={(event) => setAcceptance(event.target.value)}
              />
            </div>
            {formError ? (
              <p role="alert" className="mt-2 text-[12px] text-[#d70015]">
                {formError}
              </p>
            ) : null}
            <div className="mt-3">
              <Button size="sm" disabled={busy} onClick={() => void submitTask()}>
                {busy ? '正在添加…' : '添加任务'}
              </Button>
            </div>
          </Card>

          {selectedTask ? (
            <TaskCard
              task={toStudyTask(selectedTask)}
              startedAt={startedAt}
              onStart={onStart}
              onUpdate={onUpdate}
              compact
            />
          ) : (
            <p className="py-10 text-center text-[13px] text-gray-500">这个工作区今天还没有任务。</p>
          )}

          <div className="overflow-hidden rounded-xl border border-black/[0.06]">
            <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#fafafa] px-3 py-2">
              <span className="text-[11px] font-medium text-gray-500">今日安排</span>
              <span className="text-[11px] text-gray-400">{tasks.length} 个任务</span>
            </div>
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-black/[0.04] text-[11px] text-gray-500">
                  <th className="px-3 py-2 text-left font-medium">任务</th>
                  {showWorkspace ? <th className="px-3 py-2 text-left font-medium">工作区</th> : null}
                  <th className="px-3 py-2 text-right font-medium">时长</th>
                  <th className="px-3 py-2 text-right font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const taskWorkspace = workspaces.find((item) => item.id === task.workspaceId);
                  return (
                    <tr key={task.id} className="border-t border-black/[0.04] first:border-t-0">
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => onSelectTask(task.id)}
                          className="block text-left text-[12px] text-black hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                        >
                          {task.title}
                        </button>
                        <span className="text-[11px] text-gray-500">{task.subject}</span>
                      </td>
                      {showWorkspace ? (
                        <td className="px-3 py-2 text-[11px] text-gray-500">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: taskWorkspace?.color ?? '#8e8e93' }}
                            />
                            {taskWorkspace?.name ?? '工作区'}
                          </span>
                        </td>
                      ) : null}
                      <td className="px-3 py-2 text-right text-[11px] text-gray-500">
                        {task.durationMin} 分钟
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                          <span className={cn('h-1.5 w-1.5 rounded-full', statusDotClass(task.status))} />
                          {statusLabel(task.status)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
