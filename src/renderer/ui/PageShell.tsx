import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function PageShell({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn('min-h-screen bg-[#f5f5f7] text-[#1d1d1f] font-sans', className)}
      {...props}
    />
  );
}
