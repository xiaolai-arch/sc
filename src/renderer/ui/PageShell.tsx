import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function PageShell({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'min-h-screen bg-[#f5f5f7] font-sans text-[#1d1d1f] dark:bg-[#0f0f10] dark:text-[#f5f5f7]',
        className
      )}
      {...props}
    />
  );
}
