import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';
import { input } from './styles';

/**
 * Three densities cover every dropdown in the app:
 * - md: dialog/form fields beside shared Input controls (44px)
 * - field: dense in-page forms that already use 40px fields
 * - sm: toolbar filters and compact section rows (36px)
 */
export type SelectSize = 'md' | 'field' | 'sm';

const sizeClasses: Record<SelectSize, string> = {
  md: 'min-h-11 py-3 pl-4 pr-9 text-[14px]',
  field: 'h-10 pl-3 pr-8 text-[14px]',
  sm: 'h-9 pl-3 pr-8 text-[13px]'
};

type SelectProps = Omit<ComponentPropsWithoutRef<'select'>, 'size'> & {
  size?: SelectSize;
  /**
   * Fills its container by default. Toolbar filters pass false so the control
   * keeps its natural width (or a width supplied via className).
   */
  fullWidth?: boolean;
};

export function Select({
  size = 'md',
  fullWidth = true,
  className,
  ...props
}: SelectProps) {
  return (
    <select
      className={cn(
        'cursor-pointer rounded-xl border-0 disabled:cursor-not-allowed disabled:opacity-40',
        fullWidth && 'w-full',
        input,
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
