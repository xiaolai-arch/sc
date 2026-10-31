import { useCallback, useEffect, useState } from 'react';
import { formatLocalDate } from '../../shared/date';
import type { UpdateTaskInput } from '../../shared/ipc';
import type { DailyPlan } from '../../shared/types';
import { ReviewDialog } from '../review/ReviewDialog';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { EmptyState } from '../ui/EmptyState';
import { Progress } from '../ui/Progress';
import { TaskCard } from './TaskCard';

type TodayPageProps = {
  hasApiKey?: boolean;
  onOpenSettings?: () => void;
};

function formatReadableDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })
    .replace('星期', ' 星期');
}

export function TodayPage({ hasApiKey = true, onOpenSettings }: TodayPageProps) {
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [startedAtByTask, setStartedAtByTask] = useState<Record<string, Date>>({});

  const load = useCallback(async () => {
    const api = window.studyCoach;
    if (!api) {
      setPlan(null);
      setLoadFailed(true);
      setError('应用桥接不可用，请刷新页面重试。');
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadFailed(false);
    setError(null);
    try {
      setPlan(await api.getTodayPlan());
    } catch (cause) {
      setPlan(null);
      setLoadFailed(true);
      setError(cause instanceof Error ? cause.message : '加载今日计划失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function updateTask(input: UpdateTaskInput) {
    const api = window.studyCoach;
    if (!api) throw new Error('应用桥接不可用，请刷新页面重试。');
    try {
      const updated = await api.updateTask(input);
      setPlan(updated);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '更新任务失败。');
      throw cause;
    }
  }

  async function generate() {
    const api = window.studyCoach;
    if (!api) {
      setError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      setPlan(await api.generateTodayPlan());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成今日计划失败。');
    } finally {
      setGenerating(false);
    }
  }

  const today = plan?.date ?? formatLocalDate(new Date());
  const tasks = plan?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'done').length;
  const totalMinutes = tasks.reduce((sum, task) => sum + task.durationMin, 0);
  const actualMinutes = tasks.reduce((sum, task) => sum + (task.actualMin ?? 0), 0);

  return (
    <div>
      <header className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm text-gray-600">{formatReadableDate(today)}</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-black md:text-4xl">
            今天，按计划走就好。
          </h2>
        </div>
        <Button variant="secondary" onClick={() => setReviewOpen(true)}>
          复盘
        </Button>
      </header>

      {!hasApiKey ? (
        <Card className="mt-8 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <p className="text-gray-600">未配置模型，当前使用模板计划。</p>
          {onOpenSettings ? (
            <Button variant="ghost" size="sm" onClick={onOpenSettings}>
              去设置
            </Button>
          ) : null}
        </Card>
      ) : null}

      {error && !loadFailed ? (
        <p role="alert" className="mt-6 text-sm text-[#d70015]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-12 text-gray-600">正在加载今日计划…</p>
      ) : loadFailed ? (
        <Card className="mt-12">
          <h3 className="text-xl font-semibold tracking-tight text-black md:text-2xl">
            今日计划加载失败
          </h3>
          <p role="alert" className="mt-2 text-sm text-[#d70015]">
            {error ?? '请稍后重试。'}
          </p>
          <Button className="mt-6" onClick={() => void load()}>
            重新加载
          </Button>
        </Card>
      ) : !plan ? (
        <div className="mt-12">
          <EmptyState
            title="今天还没有计划"
            description="让 Study Coach 为你安排今天的任务。"
            action={
              <Button disabled={generating} onClick={() => void generate()}>
                {generating ? '正在生成…' : '生成今日计划'}
              </Button>
            }
          />
        </div>
      ) : tasks.length === 0 ? (
        <div className="mt-12">
          <EmptyState
            title="今天没有安排任务"
            description="可以休息，或者生成一份新计划。"
            action={
              <Button disabled={generating} onClick={() => void generate()}>
                {generating ? '正在生成…' : '生成今日计划'}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-10 grid gap-8 lg:mt-12 lg:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                startedAt={startedAtByTask[task.id]}
                onStart={() =>
                  setStartedAtByTask((current) => ({ ...current, [task.id]: new Date() }))
                }
                onUpdate={updateTask}
              />
            ))}
          </div>
          <aside className="order-first lg:order-none lg:sticky lg:top-8 lg:self-start">
            <Card>
              <p className="text-sm text-gray-600">今日进度</p>
              <p className="mt-2 text-4xl font-semibold tracking-tight text-black">
                {`${completed} / ${tasks.length} 完成`}
              </p>
              <div className="mt-4">
                <Progress value={completed} max={tasks.length} ariaLabel="今日进度" />
              </div>
              <dl className="mt-6 grid gap-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-600">计划时长</dt>
                  <dd className="font-medium text-black">{totalMinutes} 分钟</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-gray-600">实际用时</dt>
                  <dd className="font-medium text-black">{actualMinutes} 分钟</dd>
                </div>
              </dl>
            </Card>
          </aside>
        </div>
      )}

      {reviewOpen ? <ReviewDialog date={today} onClose={() => setReviewOpen(false)} /> : null}
    </div>
  );
}
