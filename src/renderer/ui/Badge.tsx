import type { ReactNode } from 'react';
import { cn } from './cn';

type BadgeProps = {
  tone?: 'gray' | 'blue' | 'green' | 'red';
  children: ReactNode;
};

const toneClasses = {
  gray: 'bg-[#f5f5f7] text-gray-500 dark:bg-white/[0.08] dark:text-[#a1a1a6]',
  blue: 'bg-[#0071e3]/10 text-[#0071e3] dark:bg-[#0a84ff]/20 dark:text-[#4da3ff]',
  green: 'bg-[#34c759]/10 text-[#1d7f3a] dark:bg-[#34c759]/20 dark:text-[#7ee2a0]',
  red: 'bg-[#ff3b30]/10 text-[#d70015] dark:bg-[#ff3b30]/20 dark:text-[#ff7b72]'
} as const;

export function Badge({ tone = 'gray', children }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium',
        toneClasses[tone]
      )}
    >
      {children}
    </span>
  );
}
