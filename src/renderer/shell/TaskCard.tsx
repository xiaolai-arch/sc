import { useState } from 'react';
import type { UpdateWorkspaceTaskInput, WorkspaceTask } from '../../shared/workspace';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { CheckIcon, ClockIcon, PlayIcon, SkipIcon } from '../ui/icons';
import { Timer } from './Timer';
import { elapsedMinutes } from './timer-logic';

type TaskCardProps = {
  task: WorkspaceTask;
  startedAt?: Date;
  onStart: () => void;
  onUpdate: (input: UpdateWorkspaceTaskInput) => Promise<void>;
  compact?: boolean;
};

export function TaskCard({ task, startedAt, onStart, onUpdate, compact = false }: TaskCardProps) {
  const [busy, setBusy] = useState(false);

  async function update(input: UpdateWorkspaceTaskInput) {
    setBusy(true);
    try {
      await onUpdate(input);
    } catch {
      // The page owns the user-facing error state.
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    const actualMin = startedAt ? elapsedMinutes(startedAt, new Date()) : undefined;
    void update({
      taskId: task.id,
      status: 'done',
      ...(actualMin !== undefined ? { actualMin } : {})
    });
  }

  const statusBadge =
    task.status === 'done' ? (
      <Badge tone="green">已完成</Badge>
    ) : task.status === 'skipped' ? (
      <Badge tone="gray">已跳过</Badge>
    ) : null;

  return (
    <Card padding={compact ? 'compact' : 'default'}>
      <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Badge>{task.subject}</Badge>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-600">
              <ClockIcon className="h-4 w-4" />
              {task.durationMin} 分钟
            </span>
            {statusBadge}
          </div>
          <h3
            className={
              task.status === 'done'
                ? `break-words font-semibold tracking-tight text-gray-500 line-through ${compact ? 'mt-2.5 text-lg' : 'mt-3 text-xl md:text-2xl'}`
                : `break-words font-semibold tracking-tight text-black ${compact ? 'mt-2.5 text-lg' : 'mt-3 text-xl md:text-2xl'}`
            }
          >
            {task.title}
          </h3>
          <p className={compact ? 'mt-1.5 break-words text-[13px] text-gray-600' : 'mt-2 break-words text-gray-600'}>
            <span className="text-gray-500">验收：</span>
            <span>{task.acceptance}</span>
          </p>
          {task.status === 'in-progress' && startedAt ? (
            <div className="mt-4">
              <Timer startedAt={startedAt} />
            </div>
          ) : null}
          {task.status === 'done' && task.actualMin ? (
            <p className="mt-2 text-sm text-gray-600">实际用时 {task.actualMin} 分钟</p>
          ) : null}
        </div>

        {task.status === 'done' || task.status === 'skipped' ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {task.status === 'pending' ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  onStart();
                  void update({ taskId: task.id, status: 'in-progress' });
                }}
              >
                <PlayIcon className="h-4 w-4" />
                开始
              </Button>
            ) : null}
            {task.status === 'in-progress' && !startedAt ? (
              <Button variant="secondary" size="sm" disabled={busy} onClick={onStart}>
                <PlayIcon className="h-4 w-4" />
                开始计时
              </Button>
            ) : null}
            <Button size="sm" disabled={busy} onClick={finish}>
              <CheckIcon className="h-4 w-4" />
              完成
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void update({ taskId: task.id, status: 'skipped' })}
            >
              <SkipIcon className="h-4 w-4" />
              跳过
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
