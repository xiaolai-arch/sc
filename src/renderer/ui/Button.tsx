import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';
import { buttonDanger, buttonPrimary, buttonSecondary, pressable } from './styles';

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
};

const variantClasses = {
  primary: buttonPrimary,
  secondary: buttonSecondary,
  ghost: `rounded-full font-medium bg-transparent text-[#0071e3] dark:text-[#4da3ff] ${pressable}`,
  danger: buttonDanger
} as const;

const sizeClasses = {
  md: 'px-6 py-3 text-[14px]',
  sm: 'px-4 py-2 text-[13px]'
} as const;

export function Button({
  variant = 'primary',
  size = 'md',
  type = 'button',
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 disabled:pointer-events-none disabled:opacity-40',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
