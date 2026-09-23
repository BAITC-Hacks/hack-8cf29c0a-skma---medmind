import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { deleteAssistantKey, getAssistantSettings, saveAssistantKey } from '../../shared/api/settings';
import { Button } from '../../shared/ui/Button';
import { Icon } from '../../shared/ui/Icon';

const queryKey = ['settings', 'assistant'];
export type AssistantEditState = { dirty: boolean; busy: boolean };

export function AssistantSettings({ onStateChange }: { onStateChange: (state: AssistantEditState) => void }) {
  const cache = useQueryClient();
  const query = useQuery({ queryKey, queryFn: getAssistantSettings, retry: 1 });
  const [key, setKey] = useState('');
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const dirty = key.length > 0;

  useEffect(() => { onStateChange({ dirty, busy }); }, [dirty, busy, onStateChange]);

  async function save(remove = false) {
    if (busy) return;
    setError(''); setNotice('');
    const value = key.trim();
    if (!remove && (!value || value.length > 4096 || /[^\x21-\x7e]/.test(value))) {
      setError('Введите API-ключ без пробелов (до 4096 символов).');
      document.getElementById('assistant-api-key')?.focus();
      return;
    }
    setBusy(true);
    try {
      const result = await (remove ? deleteAssistantKey() : saveAssistantKey(value));
      cache.setQueryData(queryKey, result);
      setKey(''); setVisible(false);
      void cache.invalidateQueries({ queryKey: ['assistant', 'status'] });
      setNotice(remove
        ? result.configured ? 'Ключ удалён из настроек. Используется ключ из окружения сервера.' : 'Ключ удалён. Ассистент отключён.'
        : 'Ключ сохранён и будет использован при следующем запросе к ассистенту.');
    } catch {
      setError('Не удалось изменить API-ключ. Проверьте подключение к серверу и повторите действие.');
    } finally { setBusy(false); }
  }

  return <section aria-labelledby="assistant-settings-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
    <div className="flex items-start gap-3">
      <span className="rounded-2xl bg-page-bg p-3 text-accent-text"><Icon name="spark" /></span>
      <div><h2 id="assistant-settings-title" className="text-lg font-semibold">ИИ-ассистент</h2><p className="mt-1 text-sm text-text-secondary">API-ключ OpenAI для ответов и анализа данных.</p></div>
    </div>
    {query.isPending ? <p role="status" className="mt-5 text-sm text-text-secondary">Загрузка настроек ассистента…</p>
      : query.isError ? <div role="alert" className="mt-5 flex flex-wrap items-center gap-3 text-sm"><Icon name="warning" className="text-status-critical" /><p>Не удалось загрузить настройки ассистента.</p><Button variant="secondary" onClick={() => void query.refetch()}>Повторить</Button></div>
        : <form className="mt-5 space-y-4" noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
          <p className="flex items-center gap-2 text-sm text-text-secondary"><Icon name={query.data.configured ? 'check' : 'info'} width="16" height="16" />{query.data.source === 'environment' ? 'Ключ задан в окружении сервера. Здесь можно задать другой.' : query.data.configured ? 'API-ключ сохранён. Чтобы заменить его, введите новый.' : 'API-ключ ещё не добавлен.'}</p>
          <div className="max-w-2xl">
            <label htmlFor="assistant-api-key" className="mb-2 block text-sm font-medium">{query.data.configured ? 'Новый API-ключ' : 'API-ключ'}</label>
            <div className="flex flex-wrap gap-2">
              <input id="assistant-api-key" type={visible ? 'text' : 'password'} value={key} onChange={event => { setKey(event.target.value); setError(''); setNotice(''); }} disabled={busy} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={4096} placeholder="Введите API-ключ" aria-describedby="assistant-key-hint" aria-invalid={Boolean(error)} className="min-h-11 min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm text-text-primary hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring" />
              <Button type="button" variant="secondary" disabled={busy || !key} aria-pressed={visible} aria-controls="assistant-api-key" onClick={() => setVisible(previous => !previous)}>{visible ? 'Скрыть' : 'Показать'}</Button>
            </div>
            <p id="assistant-key-hint" className="mt-2 text-xs leading-5 text-text-secondary">Ключ сохраняется на сервере и используется всеми пользователями этого приложения. Сохранённый ключ не отображается. Доступ к API проверяется при запросе к ассистенту.</p>
          </div>
          {error && <p role="alert" className="flex items-center gap-2 text-sm text-text-primary"><Icon name="warning" className="shrink-0 text-status-critical" />{error}</p>}
          {notice && <p role="status" className="flex items-center gap-2 text-sm text-text-primary"><Icon name="check" className="shrink-0 text-status-good" />{notice}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy || !key.trim()}>{busy ? 'Сохранение…' : 'Сохранить ключ'}</Button>
            {dirty && <Button type="button" variant="ghost" disabled={busy} onClick={() => { setKey(''); setVisible(false); setError(''); }}>Отменить</Button>}
            {query.data.source === 'settings' && <Button type="button" variant="secondary" disabled={busy} onClick={() => void save(true)}>Удалить ключ</Button>}
          </div>
        </form>}
  </section>;
}
