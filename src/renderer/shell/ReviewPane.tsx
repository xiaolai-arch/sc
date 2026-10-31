import { useState } from 'react';
import type { ReviewAnswers } from '../../shared/types';
import { formatLocalDate, parseLocalDate } from '../../shared/date';
import { Button } from '../ui/Button';
import { CheckIcon, MoonIcon } from '../ui/icons';
import { Label } from '../ui/Label';
import { Textarea } from '../ui/Textarea';
import { cn } from '../ui/cn';
import type { MemoryItem, Reminder, Workspace } from '../../shared/workspace';
import { shellPaneClass } from './TaskListPane';

function previousDate(date: string, offset: number) {
  const value = parseLocalDate(date);
  value.setDate(value.getDate() - offset);
  return formatLocalDate(value);
}

function dayLabel(date: string, today: string) {
  if (date === today) return '今天';
  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

type ReviewListProps = {
  today: string;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  savedDates: string[];
};

export function ReviewList({ today, selectedDate, onSelectDate, savedDates }: ReviewListProps) {
  const days = [0, 1, 2].map((offset) => previousDate(today, offset));
  return (
    <aside className={shellPaneClass}>
      <div className="flex h-11 shrink-0 items-center border-b border-black/[0.06] px-4">
        <span className="text-[13px] font-medium text-black">复盘</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        {days.map((date) => (
          <button
            key={date}
            type="button"
            onClick={() => onSelectDate(date)}
            aria-current={selectedDate === date ? 'true' : undefined}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150',
              selectedDate === date ? 'bg-[#f0f0f2] text-black' : 'text-gray-600 hover:bg-[#f7f7f8]'
            )}
          >
            <span className="inline-flex items-center gap-2">
              <MoonIcon className="h-3.5 w-3.5 text-gray-400" />
              {dayLabel(date, today)}
            </span>
            {savedDates.includes(date) ? (
              <CheckIcon className="h-3.5 w-3.5 text-[#34c759]" />
            ) : null}
          </button>
        ))}
      </div>
    </aside>
  );
}

type ReviewPaneProps = {
  workspace: Workspace | null;
  date: string;
  dateLabel: string;
  memory: MemoryItem[];
  reminders: Reminder[];
  streak: number;
  saved: boolean;
  onSave: (answers: ReviewAnswers) => Promise<void>;
  onOpenChat: () => void;
};

export function ReviewPane({
  workspace,
  dateLabel,
  memory,
  reminders,
  streak,
  saved,
  onSave,
  onOpenChat
}: ReviewPaneProps) {
  const [completed, setCompleted] = useState('');
  const [stuck, setStuck] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(saved ? '已保存' : null);

  async function submit(answers: ReviewAnswers) {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await onSave(answers);
      setStatus('已保存');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存复盘失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-black/[0.06] px-4 md:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-[13px] font-medium text-black">复盘</span>
          <span className="text-[11px] text-gray-400">/</span>
          <span className="truncate text-[11px] text-gray-500">
            {workspace?.name ?? '全部工作区'} · {dateLabel}
          </span>
        </div>
        <Button size="sm" variant="secondary" onClick={onOpenChat}>
          问管家
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6">
        <div className="mx-auto w-full max-w-[760px] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-[#fafafa] px-4 py-3">
            <span className="inline-flex items-center gap-2 text-[12px] text-gray-600">
              <span className="h-1.5 w-1.5 rounded-full bg-[#34c759]" />
              连续 {streak} 天完成复盘
            </span>
            <span className="text-[11px] text-gray-500">
              下一提醒 {reminders[1]?.time ?? '21:30'} {reminders[1]?.label ?? '晚间复盘'}
            </span>
          </div>

          <div className="rounded-xl border border-black/[0.06] p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-medium text-black">画像与记忆</p>
              <span className="text-[10px] text-gray-400">可见 · 可编辑（后续）</span>
            </div>
            <div className="mt-3 space-y-2">
              {memory.length === 0 ? (
                <p className="text-[12px] text-gray-500">这个工作区还没有记忆，完成一次复盘后会开始积累。</p>
              ) : (
                memory.map((item) => (
                  <div key={item.id} className="flex items-start gap-2 text-[12px] leading-5 text-gray-600">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0071e3]" />
                    <span>
                      {item.text}
                      <span className="ml-1 text-[10px] text-gray-400">（{item.source}）</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-xl border border-black/[0.06] p-4">
            <p className="text-[13px] font-medium text-black">今天复盘</p>
            <div className="mt-4 space-y-4">
              <div>
                <Label htmlFor="pane-review-completed">今天完成了什么？</Label>
                <Textarea
                  id="pane-review-completed"
                  value={completed}
                  onChange={(event) => setCompleted(event.target.value)}
                  placeholder="例如：数学 2 小时，英语阅读 1 篇"
                />
              </div>
              <div>
                <Label htmlFor="pane-review-stuck">卡在哪里？</Label>
                <Textarea
                  id="pane-review-stuck"
                  value={stuck}
                  onChange={(event) => setStuck(event.target.value)}
                  placeholder="例如：极限的定义还不熟"
                />
              </div>
              <div>
                <Label htmlFor="pane-review-tomorrow">明天想怎么调整？</Label>
                <Textarea
                  id="pane-review-tomorrow"
                  value={tomorrow}
                  onChange={(event) => setTomorrow(event.target.value)}
                  placeholder="例如：先复习极限，再做新题"
                />
              </div>
              {error ? (
                <p role="alert" className="text-[12px] text-[#d70015]">
                  {error}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => void submit({ completed, stuck, tomorrow })}>
                  {busy ? '正在保存…' : '保存复盘'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void submit({ skipped: true, completed: '', stuck: '', tomorrow: '' })
                  }
                >
                  跳过
                </Button>
                {status ? (
                  <p role="status" className="inline-flex items-center gap-1.5 text-[11px] text-gray-600">
                    <CheckIcon className="h-3.5 w-3.5 text-[#34c759]" />
                    {status}
                  </p>
                ) : null}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-black/[0.06] p-4">
            <p className="text-[13px] font-medium text-black">督促</p>
            <div className="mt-3 space-y-2">
              {reminders.map((reminder) => (
                <div key={reminder.id} className="flex items-center justify-between text-[12px] text-gray-600">
                  <span>{reminder.label}</span>
                  <span className="text-[11px] text-gray-500">{reminder.time}</span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-5 text-gray-500">
              复盘会更新画像和明天的计划；跳过也会记录，但不会产生新的记忆。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
