import { useId } from 'react';
import { Icon } from '../../shared/ui/Icon';

export function MultiSelect({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const id = useId();
  return (
    <details
      className="relative min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          event.currentTarget.open = false;
      }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-2xl border border-border bg-surface px-3 py-2 text-sm hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">
        <span className="truncate">
          {label}
          {values.length > 0 && ` · ${values.length}`}
        </span>
        <Icon name="chevron" width="14" height="14" className="shrink-0 rotate-90 text-text-secondary" />
      </summary>
      <fieldset className="absolute left-0 top-full z-20 mt-2 w-64 max-w-[calc(100vw-3rem)] rounded-2xl border border-border bg-surface p-2 shadow-lg">
        <legend className="sr-only">{label}</legend>
        {options.map((option) => (
          <label
            key={option.id}
            htmlFor={`${id}-${option.id}`}
            className="flex cursor-pointer items-center gap-3 rounded-xl p-3 text-sm hover:bg-page-bg"
          >
            <input
              id={`${id}-${option.id}`}
              type="checkbox"
              className="h-4 w-4 shrink-0 accent-accent-solid focus-visible:outline-accent-focus-ring"
              checked={values.includes(option.id)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option.id]
                    : values.filter((value) => value !== option.id),
                )
              }
            />
            {option.name}
          </label>
        ))}
      </fieldset>
    </details>
  );
}
