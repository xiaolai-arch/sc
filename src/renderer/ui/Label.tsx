import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function Label({ className, ...props }: ComponentPropsWithoutRef<'label'>) {
  return <label className={cn('block text-sm font-medium text-gray-600 dark:text-[#a1a1a6] mb-2', className)} {...props} />;
}
