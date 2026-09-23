import { AssistantChart } from './AssistantChart';
import { Markdown } from './Markdown';
import { summarizeTools } from './model';
import type { AssistantFile, AssistantMessage } from './types';
import { Icon } from '../../shared/ui/Icon';

const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

export function FileChip({ file, onRemove }: { file: Pick<AssistantFile, 'filename'>; onRemove?: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary">
      <Icon name="file" width="16" height="16" className="shrink-0" />
      <span className="truncate">{file.filename}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Убрать файл ${file.filename} из сообщения`}
          className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full hover:bg-accent-subtle-bg hover:text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
        >
          <Icon name="close" width="14" height="14" />
        </button>
      )}
    </span>
  );
}

export function MessageItem({ message, files }: { message: AssistantMessage; files: AssistantFile[] }) {
  if (message.role === 'user') {
    const attached = files.filter((f) => message.file_ids.includes(f.id));
    return (
      <li className="flex justify-end">
        <div className="max-w-[min(42rem,90%)] space-y-2">
          <div className="whitespace-pre-wrap rounded-3xl rounded-br-lg bg-accent-subtle-bg px-4 py-3 text-sm leading-6 text-accent-subtle-text">
            {message.content}
          </div>
          {attached.length > 0 && <div className="flex flex-wrap justify-end gap-2">{attached.map((f) => <FileChip key={f.id} file={f} />)}</div>}
          <p className="text-right text-xs text-text-muted">{time(message.created_at)}</p>
        </div>
      </li>
    );
  }

  const tools = summarizeTools(message.tool_calls);
  return (
    <li className="flex gap-3">
      <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-accent-subtle-bg text-accent-text">
        <Icon name="spark" width="18" height="18" />
      </span>
      <div className="min-w-0 flex-1 space-y-4">
        <Markdown text={message.content || 'Ассистент не дал текстового ответа.'} />
        {message.charts.map((chart) => <AssistantChart key={chart.id} spec={chart} />)}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-text-muted">
          <span>{time(message.created_at)}</span>
          {message.model && <span>Модель: {message.model}</span>}
          {tools.length > 0 && (
            <details className="w-full sm:w-auto">
              <summary className="cursor-pointer rounded text-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">
                Какие данные использованы ({message.tool_calls.length})
              </summary>
              <ul className="mt-2 space-y-1 text-text-secondary">
                {tools.map((t) => <li key={t.name}>• {t.label}{t.count > 1 ? ` × ${t.count}` : ''}</li>)}
              </ul>
            </details>
          )}
        </div>
      </div>
    </li>
  );
}

export function PendingReply() {
  return (
    <li className="flex gap-3" role="status">
      <span className="mt-1 flex h-9 w-9 shrink-0 animate-pulse items-center justify-center rounded-2xl bg-accent-subtle-bg text-accent-text">
        <Icon name="spark" width="18" height="18" />
      </span>
      <div className="flex-1 space-y-2 pt-1">
        <p className="text-sm text-text-secondary">Ассистент анализирует данные…</p>
        <div className="h-3 w-3/4 animate-pulse rounded-full bg-page-bg" />
        <div className="h-3 w-1/2 animate-pulse rounded-full bg-page-bg" />
      </div>
    </li>
  );
}
