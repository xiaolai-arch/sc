import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full min-h-11 rounded-xl bg-[#f5f5f7] px-4 py-3 text-[#1d1d1f] placeholder:text-gray-500 transition-all focus:outline-none focus:ring-2 focus:ring-[#0071e3]/30 disabled:opacity-40 resize-y min-h-28',
        className
      )}
      {...props}
    />
  );
}
