import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';
import { input } from './styles';

export function Select({ className, ...props }: ComponentPropsWithoutRef<'select'>) {
  return (
    <select
      className={cn(
        'w-full min-h-11 rounded-xl py-3 pl-4 pr-8 text-[14px] disabled:opacity-40',
        input,
        className
      )}
      {...props}
    />
  );
}
