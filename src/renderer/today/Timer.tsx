import { useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { ClockIcon } from '../ui/icons';
import { elapsedMinutes } from './timer-logic';

type TimerProps = {
  startedAt: Date;
  onFinish: (minutes: number) => void;
};

export function Timer({ startedAt, onFinish }: TimerProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const minutes = elapsedMinutes(startedAt, now);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center gap-2 text-sm text-gray-600">
        <ClockIcon className="h-4 w-4" />
        已计时 {minutes} 分钟
      </span>
      <Button size="sm" onClick={() => onFinish(minutes)}>
        结束并完成
      </Button>
    </div>
  );
}
