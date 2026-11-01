import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={cn(
        'w-full min-h-11 rounded-xl bg-[#f5f5f7] px-4 py-3 text-[#1d1d1f] placeholder:text-gray-600 transition-all motion-reduce:transition-none focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 disabled:opacity-40 dark:bg-[#242426] dark:border dark:border-white/10 dark:text-[#f5f5f7] dark:placeholder:text-[#8e8e93]',
        className
      )}
      {...props}
    />
  );
}
