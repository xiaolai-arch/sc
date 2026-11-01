import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';
import { input } from './styles';

export function Input({ className, ...props }: ComponentPropsWithoutRef<'input'>) {
  return (
    <input
      className={cn(
        'w-full min-h-11 rounded-xl px-4 py-3 text-[14px] disabled:opacity-40',
        input,
        className
      )}
      {...props}
    />
  );
}
