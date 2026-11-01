import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function Label({ className, ...props }: ComponentPropsWithoutRef<'label'>) {
  return (
    <label
      className={cn('mb-2 block text-[13px] font-medium text-gray-500 dark:text-[#a1a1a6]', className)}
      {...props}
    />
  );
}
