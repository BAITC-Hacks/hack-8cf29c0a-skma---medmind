import { type SelectHTMLAttributes } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  'aria-label': string;
}

export function Select({ options, value, onChange, className = '', ...rest }: SelectProps) {
  return (
    <select
      className={`min-h-11 min-w-0 max-w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm text-text-primary transition-colors hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring ${className}`}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      {...rest}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
