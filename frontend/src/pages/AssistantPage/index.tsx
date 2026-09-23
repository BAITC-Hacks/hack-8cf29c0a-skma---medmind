import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Composer } from '../../features/assistant/Composer';
import { OrderApproval } from '../../features/assistant/OrderApproval';
import { MessageItem, PendingReply } from '../../features/assistant/MessageItem';
import { describeFile, modeLabels, suggestions, validateFile } from '../../features/assistant/model';
import type { AssistantFile, AssistantMessage, AssistantMode, Conversation } from '../../features/assistant/types';
import {
  createConversation,
  deleteConversation,
  getAssistantStatus,
  getConversation,
  listConversations,
  sendAssistantMessage,
  uploadAssistantFile,
} from '../../shared/api/assistant';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Icon } from '../../shared/ui/Icon';
import { Select } from '../../shared/ui/Select';

const panel = 'rounded-3xl border border-border bg-surface';
const dateLabel = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function ErrorBanner({ text, onRetry, onClose }: { text: string; onRetry?: () => void; onClose?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-start gap-3 rounded-2xl border border-status-critical bg-surface p-4 text-sm">
      <Icon name="warning" className="mt-0.5 shrink-0 text-status-critical" />
      <p className="min-w-0 flex-1">{text}</p>
      <div className="flex gap-2">
        {onRetry && <Button variant="secondary" className="min-h-9 px-3 py-1.5" onClick={onRetry}>Повторить</Button>}
        {onClose && <Button variant="ghost" className="min-h-9 px-3 py-1.5" onClick={onClose} aria-label="Скрыть ошибку"><Icon name="close" width="16" height="16" /></Button>}
      </div>
    </div>
  );
}

function ConversationList({ items, selectedId, onSelect, onNew, onDelete, loading }: {
  items: Conversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (conv: Conversation) => void;
  loading: boolean;
}) {
  return (
    <aside className={`${panel} flex min-w-0 flex-col p-4 xl:max-h-[calc(100vh-19.5rem)]`} aria-labelledby="conversations-title">
      <div className="flex items-center justify-between gap-2 px-1 pb-3">
        <h2 id="conversations-title" className="text-sm font-semibold">Диалоги</h2>
        <Button variant="secondary" className="min-h-9 px-3 py-1.5" onClick={onNew}><Icon name="plus" width="16" height="16" />Новый</Button>
      </div>
      {loading ? (
        <div role="status" className="space-y-2"><span className="sr-only">Загрузка диалогов…</span>{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-2xl bg-page-bg" />)}</div>
      ) : items.length === 0 ? (
        <p className="px-1 py-4 text-sm text-text-secondary">Диалогов пока нет. Задайте первый вопрос — диалог сохранится здесь.</p>
      ) : (
        <ul className="-mx-1 max-h-64 space-y-1 overflow-y-auto px-1 xl:max-h-none">
          {items.map((conv) => (
            <li key={conv.id} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(conv.id)}
                aria-current={conv.id === selectedId ? 'true' : undefined}
                className={`min-w-0 flex-1 rounded-2xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring ${conv.id === selectedId ? 'bg-accent-subtle-bg text-accent-subtle-text' : 'hover:bg-page-bg'}`}
              >
                <span className="block truncate text-sm font-medium">{conv.title}</span>
                <span className={`block text-xs ${conv.id === selectedId ? 'text-accent-subtle-text' : 'text-text-muted'}`}>{dateLabel(conv.updated_at)}</span>
              </button>
              <button
                type="button"
                onClick={() => onDelete(conv)}
                aria-label={`Удалить диалог «${conv.title}»`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-page-bg hover:text-status-critical focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
              >
                <Icon name="trash" width="16" height="16" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

function EmptyChat({ onPick, disabled }: { onPick: (text: string) => void; disabled: boolean }) {
  return (
    // m-auto вместо justify-center: в прокручиваемом контейнере центрирование flex обрезает верх контента
    <div className="m-auto flex flex-col items-center px-2 py-6 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-accent-subtle-bg text-accent-text"><Icon name="spark" width="28" height="28" /></span>
      <h2 className="text-lg font-semibold">Спросите — ассистент сам найдёт данные</h2>
      <p className="mt-2 max-w-lg text-sm leading-6 text-text-secondary">
        Анализирует расчёт заказов, историю продаж и остатки, объясняет цифры и строит кривые динамики.
        Прикрепите выгрузку продаж (CSV, XLSX) — получите прогноз по ней.
      </p>
      <div className="mt-6 flex max-w-2xl flex-wrap justify-center gap-2">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            disabled={disabled}
            onClick={() => onPick(s)}
            className="rounded-full border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent-text hover:text-accent-text active:bg-page-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AssistantPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const conversationId = params.get('c');
  const [mode, setMode] = useState<AssistantMode | null>(null);
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<AssistantFile[]>([]);
  const [pending, setPending] = useState<{ content: string; fileIds: string[] } | null>(null);
  const [error, setError] = useState<{ text: string; retry?: () => void } | null>(null);
  const [toDelete, setToDelete] = useState<Conversation | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const status = useQuery({ queryKey: ['assistant', 'status'], queryFn: getAssistantStatus });
  const conversations = useQuery({ queryKey: ['assistant', 'conversations'], queryFn: listConversations });
  const detail = useQuery({
    queryKey: ['assistant', 'conversation', conversationId],
    queryFn: () => getConversation(conversationId!),
    enabled: Boolean(conversationId),
  });

  const activeMode = mode ?? status.data?.default_mode ?? 'standard';
  const enabled = status.data?.enabled ?? false;
  const selectConversation = (id: string | null) => {
    setAttached([]);
    setError(null);
    setParams(id ? { c: id } : {}, { replace: false });
  };

  const ensureConversation = async (): Promise<string> => {
    if (conversationId) return conversationId;
    const conv = await createConversation();
    queryClient.setQueryData(['assistant', 'conversation', conv.id], { ...conv, messages: [], files: [] });
    setParams({ c: conv.id });
    return conv.id;
  };

  const refresh = (id: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['assistant', 'conversation', id] }),
      queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] }),
    ]);

  const send = useMutation({
    mutationFn: async (input: { content: string; fileIds: string[] }) => {
      const id = await ensureConversation();
      return { id, turn: await sendAssistantMessage(id, { content: input.content, file_ids: input.fileIds, mode: activeMode }) };
    },
    onMutate: (input) => {
      const attachedBefore = attached;
      setError(null);
      setPending(input);
      setDraft('');
      setAttached([]);
      return { attachedBefore };
    },
    onSuccess: async ({ id }) => {
      await refresh(id);
      setPending(null);
    },
    onError: (err, input, context) => {
      // возвращаем вопрос и файлы в поле ввода, чтобы можно было поправить и отправить снова
      setPending(null);
      setDraft(input.content);
      setAttached(context?.attachedBefore ?? []);
      setError({ text: err instanceof Error ? err.message : 'Не удалось получить ответ.', retry: () => send.mutate(input) });
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const invalid = validateFile(file);
      if (invalid) throw new Error(invalid);
      const id = await ensureConversation();
      const stored = await uploadAssistantFile(id, file);
      await refresh(id);
      return stored;
    },
    onMutate: () => setError(null),
    onSuccess: (file) => setAttached((prev) => [...prev, file]),
    onError: (err) => setError({ text: err instanceof Error ? err.message : 'Не удалось загрузить файл.' }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteConversation(id),
    onSuccess: async (_, id) => {
      setToDelete(null);
      if (id === conversationId) selectConversation(null);
      queryClient.removeQueries({ queryKey: ['assistant', 'conversation', id] });
      await queryClient.invalidateQueries({ queryKey: ['assistant', 'conversations'] });
    },
    onError: (err) => {
      setToDelete(null);
      setError({ text: err instanceof Error ? err.message : 'Не удалось удалить диалог.' });
    },
  });

  const messages: AssistantMessage[] = detail.data?.messages ?? [];
  const files = detail.data?.files ?? [];
  const pendingMessage: AssistantMessage | null = pending && {
    id: 'pending', role: 'user', content: pending.content, charts: [], file_ids: pending.fileIds,
    tool_calls: [], model: null, created_at: new Date().toISOString(),
  };

  // прокручиваем только ленту сообщений, не всю страницу (scrollIntoView двигал бы и внешние контейнеры)
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTo({ top: list.scrollHeight, behavior: 'smooth' });
  }, [messages.length, pending]);

  const submit = (text = draft) => {
    const content = text.trim();
    if (!content || send.isPending) return;
    send.mutate({ content, fileIds: attached.map((f) => f.id) });
  };

  const modeOptions = (status.data?.models ?? []).map((m) => ({ value: m.mode, label: `${modeLabels[m.mode]} · ${m.model}` }));
  const modeDescription = status.data?.models.find((m) => m.mode === activeMode)?.description;
  const showEmpty = !conversationId || (detail.isSuccess && messages.length === 0 && !pending);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">AI Ассистент</h1>
            <span className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary">Ленивый режим</span>
          </div>
          <p className="text-sm text-text-secondary">Вопросы обычным языком: заказы, спрос, остатки, прогноз по вашим файлам</p>
        </div>
        {modeOptions.length > 0 && (
          <div className="flex min-w-0 flex-col gap-1">
            <Select aria-label="Режим ассистента" options={modeOptions} value={activeMode} onChange={(v) => setMode(v as AssistantMode)} disabled={!enabled} />
            {modeDescription && <p className="max-w-xs text-xs text-text-muted">{modeDescription}</p>}
          </div>
        )}
      </div>

      {status.isError && (
        <ErrorBanner text="Не удалось подключиться к ассистенту. Повторите попытку." onRetry={() => status.refetch()} />
      )}
      {status.data && !status.data.enabled && (
        <div role="status" className="flex items-start gap-3 rounded-2xl border border-status-warning bg-surface p-4 text-sm">
          <Icon name="info" className="mt-0.5 shrink-0 text-text-secondary" />
          <p>Ассистент выключен{status.data.reason ? `: ${status.data.reason}` : ''}. Добавьте API-ключ OpenAI в <Link to="/settings" className="rounded text-accent-text underline hover:text-accent-hover active:text-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">настройках ассистента</Link>.</p>
        </div>
      )}

      <div className="grid min-w-0 gap-6 xl:grid-cols-[17rem_minmax(0,1fr)]">
        <ConversationList
          items={conversations.data ?? []}
          selectedId={conversationId}
          onSelect={selectConversation}
          onNew={() => selectConversation(null)}
          onDelete={setToDelete}
          loading={conversations.isLoading}
        />

        <section className={`${panel} flex min-h-[30rem] min-w-0 flex-col p-4 sm:p-6 xl:h-[calc(100vh-19.5rem)]`} aria-label="Чат с ассистентом">
          {files.length > 0 && (
            <details className="mb-4 rounded-2xl bg-page-bg px-4 py-3 text-sm">
              <summary className="cursor-pointer rounded text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">Файлы диалога ({files.length})</summary>
              <ul className="mt-3 space-y-2">
                {files.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center gap-2">
                    <Icon name="file" width="16" height="16" className="text-text-secondary" />
                    <span className="font-medium">{f.filename}</span>
                    <span className="text-xs text-text-muted">{describeFile(f.summary)}</span>
                    {!attached.some((a) => a.id === f.id) && (
                      <button type="button" onClick={() => setAttached((prev) => [...prev, f])} className="rounded text-xs text-accent-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">
                        Прикрепить к вопросу
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div ref={listRef} className="-mx-2 flex min-h-0 flex-1 flex-col overflow-y-auto px-2" aria-live="polite">
            {conversationId && detail.isLoading ? (
              <div role="status" className="space-y-4 py-4"><span className="sr-only">Загрузка диалога…</span>{[0, 1].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl bg-page-bg" />)}</div>
            ) : conversationId && detail.isError ? (
              <ErrorBanner text="Диалог не найден или недоступен." onRetry={() => detail.refetch()} onClose={() => selectConversation(null)} />
            ) : showEmpty && !pendingMessage ? (
              <EmptyChat onPick={(s) => submit(s)} disabled={!enabled || send.isPending} />
            ) : (
              <ol className="space-y-6 py-2">
                {messages.map((m) => <MessageItem key={m.id} message={m} files={files} />)}
                {pendingMessage && <MessageItem message={pendingMessage} files={[...files, ...attached]} />}
                {pending && <PendingReply />}
              </ol>
            )}
          </div>

          {error && <div className="mt-4"><ErrorBanner text={error.text} onRetry={error.retry} onClose={() => setError(null)} /></div>}

          <div className="mt-4">
            <Composer
              value={draft}
              onChange={setDraft}
              onSubmit={() => submit()}
              onAttach={(file) => upload.mutate(file)}
              attached={attached}
              onDetach={(id) => setAttached((prev) => prev.filter((f) => f.id !== id))}
              uploading={upload.isPending}
              disabled={!enabled}
              busy={send.isPending}
            />
          </div>
        </section>
      </div>

      {params.get('order') && (
        <OrderApproval id={params.get('order')!} onClose={() => {
          const next = new URLSearchParams(params);
          next.delete('order');
          setParams(next, { replace: true });
        }} />
      )}
      {toDelete && (
        <Dialog onClose={() => setToDelete(null)} labelledBy="delete-conversation-title">
          <h2 id="delete-conversation-title" className="text-lg font-semibold">Удалить диалог?</h2>
          <p className="mt-3 text-sm leading-6 text-text-secondary">«{toDelete.title}» и прикреплённые к нему файлы будут удалены без возможности восстановления.</p>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={() => setToDelete(null)}>Отмена</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(toDelete.id)}>Удалить</Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
