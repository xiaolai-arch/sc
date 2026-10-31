import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return <div className={cn('bg-white rounded-2xl shadow-sm p-8', className)} {...props} />;
}
