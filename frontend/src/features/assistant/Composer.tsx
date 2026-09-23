import { useRef, type FormEvent, type KeyboardEvent } from 'react';
import { FileChip } from './MessageItem';
import { ACCEPTED_FILES } from './model';
import type { AssistantFile } from './types';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAttach: (file: File) => void;
  attached: AssistantFile[];
  onDetach: (id: string) => void;
  uploading: boolean;
  disabled: boolean;
  busy: boolean;
}

export function Composer({ value, onChange, onSubmit, onAttach, attached, onDetach, uploading, disabled, busy }: ComposerProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const canSend = !disabled && !busy && !uploading && value.trim().length > 0;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSubmit();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter — отправить, Shift+Enter — новая строка; во время набора IME не перехватываем
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submit(event);
  };

  return (
    <form onSubmit={submit} className="border-t border-border pt-4">
      {(attached.length > 0 || uploading) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attached.map((f) => <FileChip key={f.id} file={f} onRemove={() => onDetach(f.id)} />)}
          {uploading && <span role="status" className="animate-pulse rounded-full border border-border px-3 py-1.5 text-xs text-text-secondary">Загрузка и разбор файла…</span>}
        </div>
      )}
      <div className="flex items-end gap-2 rounded-3xl border border-border bg-surface p-2 focus-within:ring-2 focus-within:ring-accent-focus-ring">
        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_FILES}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onAttach(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || uploading}
          aria-label="Прикрепить файл CSV или XLSX"
          title="Прикрепить выгрузку продаж (CSV, XLSX до 20 МБ)"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-text-secondary transition-colors hover:bg-accent-subtle-bg hover:text-accent-text active:bg-page-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Icon name="attach" />
        </button>
        <label htmlFor="assistant-input" className="sr-only">Вопрос ассистенту</label>
        <textarea
          id="assistant-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={2}
          maxLength={4000}
          placeholder={disabled ? 'Ассистент недоступен' : 'Спросите о заказах, спросе или прикрепите выгрузку для прогноза…'}
          className="max-h-48 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
        />
        <Button type="submit" disabled={!canSend} aria-label="Отправить" className="shrink-0 px-4">
          <Icon name="send" />
          <span className="hidden sm:inline">{busy ? 'Думаю…' : 'Отправить'}</span>
        </Button>
      </div>
      <p className="mt-2 px-2 text-xs text-text-muted">
        Enter — отправить, Shift+Enter — новая строка. Откройте ссылку рядом с товаром, проверьте количество и утвердите заказ.
      </p>
    </form>
  );
}
