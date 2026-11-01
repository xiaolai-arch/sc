import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

type CardProps = ComponentPropsWithoutRef<'div'> & {
  padding?: 'default' | 'compact';
};

export function Card({ className, padding = 'default', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl bg-white shadow-sm dark:bg-[#1c1c1e]',
        padding === 'compact' ? 'p-5' : 'p-6 md:p-8',
        className
      )}
      {...props}
    />
  );
}
