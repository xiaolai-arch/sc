import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';
import { input } from './styles';

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<'textarea'>) {
  return (
    <textarea
      className={cn(
        'w-full min-h-28 resize-y rounded-xl px-4 py-3 text-[14px] leading-6 disabled:opacity-40',
        input,
        className
      )}
      {...props}
    />
  );
}
