import { type ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-solid text-white hover:bg-accent-hover active:bg-accent-active',
  secondary: 'bg-surface text-text-primary border border-border hover:bg-accent-subtle-bg active:bg-page-bg',
  destructive: 'bg-transparent text-status-critical border border-status-critical hover:bg-page-bg active:bg-surface',
  ghost: 'bg-transparent text-text-secondary hover:bg-accent-subtle-bg hover:text-accent-text active:bg-page-bg',
};

export function Button({ variant = 'primary', className = '', ...rest }: ButtonProps) {
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-page-bg disabled:cursor-not-allowed disabled:opacity-50 ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}
