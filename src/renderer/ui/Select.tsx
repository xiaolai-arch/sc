import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function Select({ className, ...props }: ComponentPropsWithoutRef<'select'>) {
  return (
    <select
      className={cn(
        'w-full min-h-11 rounded-xl bg-[#f5f5f7] pl-4 pr-8 py-3 text-[#1d1d1f] transition-all focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 disabled:opacity-40',
        className
      )}
      {...props}
    />
  );
}
