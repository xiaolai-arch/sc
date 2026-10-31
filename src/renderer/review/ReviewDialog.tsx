import { useState } from 'react';
import type { ReviewAnswers } from '../../shared/types';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Label } from '../ui/Label';
import { Textarea } from '../ui/Textarea';

type ReviewDialogProps = {
  date: string;
  onClose: () => void;
};

export function ReviewDialog({ date, onClose }: ReviewDialogProps) {
  const [completed, setCompleted] = useState('');
  const [stuck, setStuck] = useState('');
  const [tomorrow, setTomorrow] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(answers: ReviewAnswers) {
    const api = window.studyCoach;
    if (!api) {
      setError('应用桥接不可用，请刷新页面重试。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.submitReview({ date, answers });
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存复盘失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="晚间复盘">
      <p className="-mt-2 text-sm text-gray-600">{date}</p>
      <div className="mt-6 grid gap-5">
        <div>
          <Label htmlFor="review-completed">今天完成了什么？</Label>
          <Textarea
            id="review-completed"
            value={completed}
            onChange={(event) => setCompleted(event.target.value)}
            placeholder="例如：数学 2 小时，英语阅读 1 篇"
          />
        </div>
        <div>
          <Label htmlFor="review-stuck">卡在哪里？</Label>
          <Textarea
            id="review-stuck"
            value={stuck}
            onChange={(event) => setStuck(event.target.value)}
            placeholder="例如：极限的定义还不熟"
          />
        </div>
        <div>
          <Label htmlFor="review-tomorrow">明天想怎么调整？</Label>
          <Textarea
            id="review-tomorrow"
            value={tomorrow}
            onChange={(event) => setTomorrow(event.target.value)}
            placeholder="例如：先复习极限，再做新题"
          />
        </div>

        {error ? (
          <p role="alert" className="text-sm text-[#d70015]">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" disabled={busy} onClick={() => void submit({ completed, stuck, tomorrow })}>
            保存复盘
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void submit({ skipped: true, completed: '', stuck: '', tomorrow: '' })}
          >
            跳过
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
