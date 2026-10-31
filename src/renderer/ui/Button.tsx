import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './cn';

type ButtonProps = ComponentPropsWithoutRef<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
};

const variantClasses = {
  primary: 'bg-[#0071e3] text-white',
  secondary: 'bg-white text-[#1d1d1f] ring-1 ring-black/10',
  ghost: 'bg-transparent text-[#0071e3]',
  danger: 'bg-[#ff3b30] text-white'
} as const;

const sizeClasses = {
  md: 'px-6 py-3 text-base',
  sm: 'px-4 py-2 text-sm'
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
        'inline-flex items-center justify-center gap-2 min-h-11 rounded-full font-medium transition-all duration-300 active:scale-[0.98] hover:opacity-80 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0071e3]/30 disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
}
