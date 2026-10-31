import { useEffect, useRef, useState } from 'react';
import type { UpdateTaskInput } from '../../shared/ipc';
import type { DailyPlan, StudyTask } from '../../shared/types';
import { TaskCard } from '../today/TaskCard';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { cn } from '../ui/cn';
import { MoreHorizontalIcon, SparklesIcon } from '../ui/icons';
import { Composer } from './Composer';
import type { ChatMessage } from './types';

function statusLabel(status: StudyTask['status']) {
  if (status === 'done') return '已完成';
  if (status === 'in-progress') return '进行中';
  if (status === 'skipped') return '已跳过';
  return '待开始';
}

function statusDotClass(status: StudyTask['status']) {
  if (status === 'done') return 'bg-[#34c759]';
  if (status === 'in-progress') return 'bg-[#0071e3]';
  if (status === 'skipped') return 'bg-[#c7c7cc]';
  return 'bg-[#d1d1d6]';
}

type CoachPaneProps = {
  plan: DailyPlan | null;
  selectedTask: StudyTask | null;
  startedAt?: Date;
  onStart: () => void;
  onSelectTask: (id: string) => void;
  onUpdate: (input: UpdateTaskInput) => Promise<void>;
  hasApiKey: boolean;
  onOpenSettings: () => void;
  loading: boolean;
  loadFailed: boolean;
  error: string | null;
  onReload: () => void;
  onGenerate: () => void;
  generating: boolean;
  modelLabel: string;
  dateLabel: string;
};

const CANNED_REPLY =
  '收到。我先记下这条反馈；目前还是原型模式，等接入真实模型后，我会结合你的计划、错题和复盘给出具体建议。';

export function CoachPane({
  plan,
  selectedTask,
  startedAt,
  onStart,
  onSelectTask,
  onUpdate,
  hasApiKey,
  onOpenSettings,
  loading,
  loadFailed,
  error,
  onReload,
  onGenerate,
  generating,
  modelLabel,
  dateLabel
}: CoachPaneProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [typing, setTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (messages.length === 0 && !typing) return;
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo?.({ top: node.scrollHeight });
  }, [messages, typing]);

  function send(text: string) {
    const userMessage: ChatMessage = { id: `u-${Date.now()}`, role: 'user', text };
    setMessages((current) => [...current, userMessage]);
    setTyping(true);
    timeoutRef.current = window.setTimeout(() => {
      setMessages((current) => [
        ...current,
        { id: `a-${Date.now()}`, role: 'assistant', text: CANNED_REPLY }
      ]);
      setTyping(false);
    }, 500);
  }

  const tasks = plan?.tasks ?? [];
  const completed = tasks.filter((task) => task.status === 'done').length;
  const totalMinutes = tasks.reduce((sum, task) => sum + task.durationMin, 0);
  const greeting = selectedTask
    ? selectedTask.status === 'done'
      ? `「${selectedTask.title}」已完成，今天已完成 ${completed} / ${tasks.length}。`
      : selectedTask.status === 'in-progress'
        ? `「${selectedTask.title}」正在进行，记得完成后标记。`
        : selectedTask.status === 'skipped'
          ? `「${selectedTask.title}」已跳过，可以从左侧换一个任务。`
          : `今天安排了 ${tasks.length} 个任务，共 ${totalMinutes} 分钟。先从「${selectedTask.title}」开始。`
    : `今天安排了 ${tasks.length} 个任务，共 ${totalMinutes} 分钟。`;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">今日计划</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">{dateLabel}</span>
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

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto w-full max-w-[760px] space-y-5">
          {loading ? (
            <div className="space-y-3 pt-2">
              <div className="h-4 w-2/3 rounded bg-black/[0.04]" />
              <div className="h-4 w-1/2 rounded bg-black/[0.04]" />
              <div className="h-40 rounded-xl bg-black/[0.03]" />
            </div>
          ) : loadFailed ? (
            <Card padding="compact">
              <h2 className="text-[14px] font-semibold tracking-tight text-black">今日计划加载失败</h2>
              <p role="alert" className="mt-1 text-[12px] text-[#d70015]">
                {error ?? '请稍后重试。'}
              </p>
              <Button className="mt-4" size="sm" onClick={onReload}>
                重新加载
              </Button>
            </Card>
          ) : !plan ? (
            <div className="py-16 text-center">
              <p className="text-[14px] font-medium text-black">今天还没有计划</p>
              <p className="mt-1 text-[12px] text-gray-500">让 Study Coach 安排今天的任务。</p>
              <Button className="mt-4" size="sm" disabled={generating} onClick={onGenerate}>
                {generating ? '正在生成…' : '生成今日计划'}
              </Button>
            </div>
          ) : !selectedTask ? (
            plan.tasks.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-[14px] font-medium text-black">今天没有安排任务</p>
                <p className="mt-1 text-[12px] text-gray-500">可以休息，或者生成一份新计划。</p>
                <Button className="mt-4" size="sm" disabled={generating} onClick={onGenerate}>
                  {generating ? '正在生成…' : '生成今日计划'}
                </Button>
              </div>
            ) : (
              <div className="py-16 text-center">
                <p className="text-[14px] font-medium text-black">没有匹配的任务</p>
                <p className="mt-1 text-[12px] text-gray-500">在左侧选择一个科目，或切换到全部科目。</p>
              </div>
            )
          ) : (
            <>
              {!hasApiKey ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[#0071e3]/15 bg-[#f2f7fd] px-3 py-2">
                  <p className="text-[12px] text-gray-600">未配置模型，当前使用模板计划。</p>
                  <button
                    type="button"
                    onClick={onOpenSettings}
                    className="shrink-0 text-[12px] font-medium text-[#0071e3] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0071e3]/30"
                  >
                    去设置
                  </button>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="text-[12px] text-[#d70015]">
                  {error}
                </p>
              ) : null}

              <div className="flex gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white">
                  <SparklesIcon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-medium text-gray-500">Study Coach</p>
                  <p className="mt-1 text-[13px] leading-6 text-[#1d1d1f]">{greeting}</p>
                </div>
              </div>

              <div className="ml-0 md:ml-9">
                <TaskCard
                  task={selectedTask}
                  startedAt={startedAt}
                  onStart={onStart}
                  onUpdate={onUpdate}
                  compact
                />
              </div>

              <div className="ml-0 overflow-hidden rounded-xl border border-black/[0.06] md:ml-9">
                <div className="flex items-center justify-between border-b border-black/[0.06] bg-[#fafafa] px-3 py-2">
                  <span className="text-[11px] font-medium text-gray-500">今日安排</span>
                  <span className="text-[11px] text-gray-400">{tasks.length} 个任务</span>
                </div>
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-black/[0.04] text-[11px] text-gray-500">
                      <th className="px-3 py-2 text-left font-medium">任务</th>
                      <th className="px-3 py-2 text-right font-medium">时长</th>
                      <th className="px-3 py-2 text-right font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((task) => (
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
                    ))}
                  </tbody>
                </table>
              </div>

              {messages.map((message) =>
                message.role === 'user' ? (
                  <div key={message.id} className="flex justify-end">
                    <p className="max-w-[85%] rounded-2xl bg-[#0071e3] px-3.5 py-2 text-[13px] leading-6 text-white">
                      {message.text}
                    </p>
                  </div>
                ) : (
                  <div key={message.id} className="flex gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0071e3] text-white">
                      <SparklesIcon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-gray-500">Study Coach</p>
                      <p className="mt-1 text-[13px] leading-6 text-[#1d1d1f]">{message.text}</p>
                    </div>
                  </div>
                )
              )}

              {typing ? (
                <p className="ml-9 text-[12px] text-gray-500" role="status">
                  正在输入…
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>

      {plan && selectedTask ? <Composer modelLabel={modelLabel} onSend={send} /> : null}
    </div>
  );
}
