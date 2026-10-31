import { useEffect, useState } from 'react';
import { ClockIcon } from '../ui/icons';
import { elapsedMinutes } from './timer-logic';

type TimerProps = {
  startedAt: Date;
};

export function Timer({ startedAt }: TimerProps) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const minutes = elapsedMinutes(startedAt, now);

  return (
    <span className="inline-flex items-center gap-2 text-sm text-gray-600">
      <ClockIcon className="h-4 w-4" />
      已计时 {minutes} 分钟
    </span>
  );
}
