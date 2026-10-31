import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

type CardProps = ComponentPropsWithoutRef<'div'> & {
  padding?: 'default' | 'compact';
};

export function Card({ className, padding = 'default', ...props }: CardProps) {
  return (
    <div
      className={cn('bg-white rounded-2xl shadow-sm', padding === 'compact' ? 'p-5' : 'p-8', className)}
      {...props}
    />
  );
}
