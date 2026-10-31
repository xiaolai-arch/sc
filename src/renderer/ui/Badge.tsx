import type { ReactNode } from 'react';
import { cn } from './cn';

type BadgeProps = {
  tone?: 'gray' | 'blue' | 'green' | 'red';
  children: ReactNode;
};

const toneClasses = {
  gray: 'bg-[#f5f5f7] text-gray-600',
  blue: 'bg-[#0071e3]/10 text-[#1d1d1f]',
  green: 'bg-[#34c759]/10 text-[#1d1d1f]',
  red: 'bg-[#ff3b30]/10 text-[#1d1d1f]'
} as const;

export function Badge({ tone = 'gray', children }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-3 py-1 text-sm font-medium', toneClasses[tone])}>
      {children}
    </span>
  );
}
