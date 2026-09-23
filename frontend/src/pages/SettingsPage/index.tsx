import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from 'react-router-dom';
import { getCalculation, getSettings, saveCalcParams, saveSupplierLeadTime, saveSupplierRule, startCalculation } from '../../shared/api/settings';
import type { CalcRun } from '../../shared/api/types';
import { useCalcRun } from '../../shared/calc-run/useCalcRun';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Icon } from '../../shared/ui/Icon';
import { Select } from '../../shared/ui/Select';
import { draftChanged, numberError, paramsDraft, ruleDraft, validateParams, type RuleDraft } from './model';
import { AssistantSettings, type AssistantEditState } from './AssistantSettings';

type Settings = Awaited<ReturnType<typeof getSettings>>;
const settingsKey = ['settings'];
const inputClass = 'min-h-11 w-full min-w-0 rounded-2xl border bg-surface px-4 py-2.5 text-sm text-text-primary tabular-nums hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring disabled:cursor-not-allowed';

function NumberField({ id, error, description, ...props }: InputHTMLAttributes<HTMLInputElement> & { id: string; error?: string; description?: string }) {
  return <div>
    <input {...props} id={id} type="number" aria-invalid={Boolean(error)} aria-describedby={[description && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined} className={`${inputClass} ${error ? 'border-status-critical' : 'border-border'}`} />
    {description && <p id={`${id}-hint`} className="mt-2 text-xs leading-5 text-text-secondary">{description}</p>}
    {error && <p id={`${id}-error`} className="mt-2 flex items-start gap-1 text-xs text-text-primary"><Icon name="warning" width="14" height="14" className="shrink-0 text-status-critical" />{error}</p>}
  </div>;
}

export function SettingsPage() {
  const query = useQuery({ queryKey: settingsKey, queryFn: getSettings, staleTime: Infinity, refetchOnWindowFocus: false, retry: 1 });
  return <div className="space-y-6">
    <header><p className="mb-2 text-xs font-medium uppercase tracking-widest text-text-secondary">Управление закупками</p><h1 className="text-3xl font-semibold tracking-tight">Настройки</h1><p className="mt-2 text-sm text-text-secondary">Настройте прогноз спроса и условия заказа у поставщиков.</p></header>
    {query.isPending ? <div role="status" aria-label="Загрузка настроек" className="space-y-6"><span className="sr-only">Загрузка настроек…</span>{[1, 2].map(i => <div key={i} className="h-64 rounded-3xl border border-border bg-surface p-6"><div className="h-6 w-48 rounded-xl bg-border" /><div className="mt-8 grid grid-cols-2 gap-6"><div className="h-24 rounded-2xl bg-page-bg" /><div className="h-24 rounded-2xl bg-page-bg" /></div></div>)}</div>
      : query.isError ? <div role="alert" className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-status-critical bg-surface p-5"><p className="flex items-center gap-3 text-sm"><Icon name="warning" className="shrink-0 text-status-critical" />Не удалось загрузить настройки. {query.error.message}</p><Button variant="secondary" onClick={() => void query.refetch()}>Повторить</Button></div>
        : <SettingsEditor initial={query.data} />}
  </div>;
}

function SettingsEditor({ initial }: { initial: Settings }) {
  const queryClient = useQueryClient();
  const { runs, setSelectedRunId } = useCalcRun();
  const [saved, setSaved] = useState(initial);
  const [assistantState, setAssistantState] = useState<AssistantEditState>({ dirty: false, busy: false });
  const [params, setParams] = useState(() => paramsDraft(initial.params));
  const [ruleEdits, setRuleEdits] = useState<Record<string, RuleDraft>>({});
  const [leadEdits, setLeadEdits] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [startedRun, setStartedRun] = useState<CalcRun | null>(null);
  const paramErrors = validateParams(params);
  const paramsDirty = draftChanged(params, saved.params);
  const dirtyRules = saved.rules.filter(rule => ruleEdits[rule.id] && draftChanged(ruleEdits[rule.id], rule));
  const dirtySuppliers = saved.suppliers.filter(supplier => leadEdits[supplier.id] !== undefined && (leadEdits[supplier.id].trim() === '' || Number(leadEdits[supplier.id]) !== supplier.lead_time_days));
  const otherChanges = dirtyRules.length + dirtySuppliers.length;
  const dirty = paramsDirty || otherChanges > 0 || assistantState.dirty;
  const saving = Boolean(busy) || assistantState.busy;
  const blocker = useBlocker(dirty || saving);
  const activeRunId = startedRun?.status === 'running' ? startedRun.id : runs.find(run => run.status === 'running')?.id;
  const runQuery = useQuery({
    queryKey: ['settings-calculation', activeRunId], queryFn: () => getCalculation(activeRunId!),
    enabled: Boolean(activeRunId),
    refetchInterval: query => query.state.data?.status === 'done' || query.state.data?.status === 'failed' ? false : 2000,
  });
  const trackedRun = runQuery.data ?? startedRun;
  const calculating = Boolean(activeRunId) && (!runQuery.data || runQuery.data.status === 'running');

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const preventUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventUnload);
    return () => window.removeEventListener('beforeunload', preventUnload);
  }, [dirty, saving]);
  useEffect(() => {
    if (runQuery.data && runQuery.data.status !== 'running') void queryClient.invalidateQueries({ queryKey: ['calc-runs'] });
  }, [runQuery.data, queryClient]);

  function updateSaved(next: Settings) {
    setSaved(next);
    queryClient.setQueryData(settingsKey, next);
  }
  async function saveForecast(recalculate = false) {
    setAttempted(true); setError('');
    if (Object.values(paramErrors).some(Boolean)) {
      document.getElementById(Object.keys(paramErrors).find(key => paramErrors[key as keyof typeof paramErrors])!)?.focus();
      return;
    }
    setBusy(recalculate ? 'calculate' : 'params');
    let didSave = false;
    try {
      if (paramsDirty) {
        const result = await saveCalcParams({ forecast_horizon_days: Number(params.forecast_horizon_days), safety_buffer_days: Number(params.safety_buffer_days), outlier_sensitivity: Number(params.outlier_sensitivity) });
        updateSaved({ ...saved, params: result }); setParams(paramsDraft(result)); didSave = true;
      }
      if (recalculate) {
        const run = await startCalculation(); setStartedRun(run);
        queryClient.setQueryData<CalcRun[]>(['calc-runs'], previous => [run, ...(previous ?? []).filter(item => item.id !== run.id)]);
        setSelectedRunId(run.id); setNotice('Пересчёт запущен. Можно продолжить работу.');
      } else setNotice('Параметры прогноза сохранены.');
    } catch (failure) {
      setError(`${didSave && recalculate ? 'Параметры сохранены, но пересчёт не запущен. ' : ''}${failure instanceof Error ? failure.message : 'Не удалось сохранить настройки.'}`);
    } finally { setBusy(''); }
  }
  async function saveRule(id: string) {
    const draft = ruleEdits[id];
    if (!draft || numberError(draft.min_order_qty, 0) || numberError(draft.order_multiple, 1)) return;
    setBusy(id); setError('');
    try {
      const result = await saveSupplierRule(id, { min_order_qty: Number(draft.min_order_qty), order_multiple: Number(draft.order_multiple) });
      updateSaved({ ...saved, rules: saved.rules.map(rule => rule.id === id ? result : rule) });
      setRuleEdits(previous => { const next = { ...previous }; delete next[id]; return next; });
      setNotice(`Правило для SKU ${result.sku_code} сохранено.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить правило.'); }
    finally { setBusy(''); }
  }
  async function saveLeadTime(id: string) {
    if (numberError(leadEdits[id], 1, 365, true)) return;
    setBusy(`supplier-${id}`); setError('');
    try {
      const result = await saveSupplierLeadTime(id, Number(leadEdits[id]));
      updateSaved({ ...saved, suppliers: saved.suppliers.map(supplier => supplier.id === id ? result : supplier) });
      setLeadEdits(previous => { const next = { ...previous }; delete next[id]; return next; });
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      setNotice(`Срок поставки для ${result.name} сохранён.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить срок поставки.'); }
    finally { setBusy(''); }
  }

  const query = search.trim().toLocaleLowerCase('ru');
  const filtered = saved.rules.filter(rule => (!supplierFilter || rule.supplier_id === supplierFilter) && `${rule.sku_code} ${saved.suppliers.find(s => s.id === rule.supplier_id)?.name ?? rule.supplier_id}`.toLocaleLowerCase('ru').includes(query));
  const visible = filtered.slice(page * 10, (page + 1) * 10);
  const lastRun = runs[0];

  return <>
    {error && <div role="alert" className="flex items-start justify-between gap-4 rounded-2xl border border-status-critical bg-surface p-4"><p className="flex items-start gap-3 text-sm"><Icon name="warning" className="shrink-0 text-status-critical" />{error} Повторите действие после устранения ошибки.</p><Button variant="ghost" aria-label="Закрыть ошибку" className="shrink-0 px-3" onClick={() => setError('')}><Icon name="close" /></Button></div>}
    <fieldset disabled={Boolean(busy)} className="min-w-0 space-y-6">
      <AssistantSettings onStateChange={setAssistantState} />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section aria-labelledby="forecast-title" className="min-w-0 rounded-3xl border border-border bg-surface">
          <div className="flex items-start gap-3 border-b border-border p-5 sm:p-6"><span className="rounded-2xl bg-page-bg p-3 text-accent-text"><Icon name="settings" /></span><div><h2 id="forecast-title" className="text-lg font-semibold">Параметры прогноза</h2><p className="mt-1 text-sm text-text-secondary">Общие настройки для следующего расчёта</p></div></div>
          <form noValidate onSubmit={event => { event.preventDefault(); void saveForecast(); }}>
            <div className="space-y-7 p-5 sm:p-6">
              <div className="grid gap-6 sm:grid-cols-2">
                <div><label htmlFor="forecast_horizon_days" className="mb-2 block text-sm font-medium">Горизонт прогноза, дней</label><NumberField id="forecast_horizon_days" min={1} max={365} step={1} value={params.forecast_horizon_days} onChange={e => setParams({ ...params, forecast_horizon_days: e.target.value })} error={attempted ? paramErrors.forecast_horizon_days : ''} description="На сколько дней вперёд планировать спрос. От 1 до 365 дней." /></div>
                <div><label htmlFor="safety_buffer_days" className="mb-2 block text-sm font-medium">Буфер безопасности, дней</label><NumberField id="safety_buffer_days" min={0} max={365} step={1} value={params.safety_buffer_days} onChange={e => setParams({ ...params, safety_buffer_days: e.target.value })} error={attempted ? paramErrors.safety_buffer_days : ''} description="Дополнительный запас на случай колебаний спроса. От 0 до 365 дней." /></div>
              </div>
              <div className="border-t border-border pt-6">
                <div className="flex items-center justify-between gap-4"><label htmlFor="outlier_sensitivity" className="text-sm font-medium">Чувствительность к выбросам</label><output htmlFor="outlier_sensitivity" className="rounded-xl bg-accent-subtle-bg px-3 py-1 text-sm font-semibold tabular-nums text-accent-subtle-text">{Number(params.outlier_sensitivity).toLocaleString('ru-RU', { minimumFractionDigits: 2 })}</output></div>
                <p id="sensitivity-hint" className="mt-2 text-xs leading-5 text-text-secondary">Чем выше значение, тем больше необычно крупных разовых продаж исключается из регулярного спроса.</p>
                <input id="outlier_sensitivity" type="range" min="0" max="1" step="0.05" value={params.outlier_sensitivity} aria-describedby="sensitivity-hint" onChange={e => setParams({ ...params, outlier_sensitivity: e.target.value })} className="mt-4 h-8 w-full cursor-pointer rounded-lg accent-accent-solid hover:accent-accent-hover active:accent-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring" />
                <div className="flex justify-between gap-4 text-xs text-text-secondary"><span>0 · Меньше исключений</span><span>1 · Больше исключений</span></div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-5 sm:px-6"><p role="status" className="flex items-center gap-2 text-xs text-text-secondary"><Icon name={paramsDirty ? 'clock' : 'check'} width="16" height="16" />{paramsDirty ? 'Есть несохранённые изменения' : 'Параметры сохранены'}</p><div className="flex gap-2"><Button type="button" variant="ghost" disabled={!paramsDirty} onClick={() => { setParams(paramsDraft(saved.params)); setAttempted(false); }}>Отменить</Button><Button type="submit" disabled={!paramsDirty}>{busy === 'params' ? 'Сохранение…' : 'Сохранить'}</Button></div></div>
          </form>
        </section>
        <aside aria-labelledby="calculation-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
          <Icon name="spark" className="mb-4 text-accent-text" /><h2 id="calculation-title" className="text-lg font-semibold">Применить настройки</h2><p className="mt-3 text-sm leading-6 text-text-secondary">Сохранённые параметры будут использованы в новом расчёте. Существующие рекомендации останутся прежними.</p>
          <dl className="my-5 space-y-3 border-y border-border py-4 text-sm"><div><dt className="text-xs text-text-secondary">Последний расчёт</dt><dd className="mt-1 font-medium">{lastRun ? new Date(lastRun.created_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : 'Ещё не запускался'}</dd></div><div><dt className="text-xs text-text-secondary">Статус</dt><dd className="mt-1">{lastRun ? { done: 'Завершён', running: 'Выполняется', failed: 'Ошибка расчёта' }[lastRun.status] : 'Нет расчётов'}</dd></div></dl>
          <Button type="button" className="w-full" disabled={calculating || otherChanges > 0} aria-describedby="recalculate-hint" onClick={() => void saveForecast(true)}><Icon name="spark" className="shrink-0" />{busy === 'calculate' ? 'Запуск…' : calculating ? 'Расчёт выполняется…' : paramsDirty ? 'Сохранить и пересчитать' : 'Запустить пересчёт'}</Button>
          <p id="recalculate-hint" className="mt-3 text-xs leading-5 text-text-secondary">{otherChanges ? 'Сначала сохраните или отмените изменения правил и сроков поставки.' : 'Пересчёт не отправляет заказы поставщикам.'}</p>
          {trackedRun && <p role="status" className="mt-4 flex items-start gap-2 text-sm"><Icon name={trackedRun.status === 'failed' ? 'warning' : trackedRun.status === 'done' ? 'check' : 'clock'} className={`shrink-0 ${trackedRun.status === 'failed' ? 'text-status-critical' : 'text-accent-text'}`} />{trackedRun.status === 'done' ? 'Новый расчёт готов. Рекомендации доступны в разделе «Заказы».' : trackedRun.status === 'failed' ? `Расчёт завершился с ошибкой. ${runQuery.data?.error ?? 'Попробуйте запустить его ещё раз.'}` : 'Формируем рекомендации…'}</p>}
          {runQuery.isError && <div role="alert" className="mt-4 text-sm"><p>Не удалось проверить статус расчёта.</p><Button variant="ghost" onClick={() => void runQuery.refetch()}>Проверить снова</Button></div>}
        </aside>
      </div>

      <section aria-labelledby="lead-title" className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <div className="flex items-start gap-3"><span className="rounded-2xl bg-page-bg p-3 text-accent-text"><Icon name="truck" /></span><div><h2 id="lead-title" className="text-lg font-semibold">Сроки поставки</h2><p className="mt-1 text-sm text-text-secondary">Срок действует для всех товаров поставщика. От 1 до 365 дней.</p></div></div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">{saved.suppliers.map(supplier => {
          const value = leadEdits[supplier.id] ?? String(supplier.lead_time_days);
          const changed = dirtySuppliers.some(item => item.id === supplier.id);
          const fieldError = numberError(value, 1, 365, true);
          return <form key={supplier.id} noValidate onSubmit={event => { event.preventDefault(); if (changed) void saveLeadTime(supplier.id); }} className="rounded-2xl border border-border p-4">
            <label htmlFor={`lead-${supplier.id}`} className="mb-3 block text-sm font-semibold">{supplier.name}<span className="ml-2 font-normal text-text-secondary">· дней</span></label>
            <div className="flex flex-wrap items-start gap-2"><div className="min-w-32 flex-1"><NumberField id={`lead-${supplier.id}`} value={value} min={1} max={365} step={1} error={fieldError} onChange={e => setLeadEdits({ ...leadEdits, [supplier.id]: e.target.value })} /></div><Button type="submit" variant="secondary" disabled={!changed || Boolean(fieldError)} aria-label={`Сохранить срок поставки ${supplier.name}`}>{busy === `supplier-${supplier.id}` ? 'Сохранение…' : 'Сохранить'}</Button>{changed && <Button type="button" variant="ghost" aria-label={`Отменить срок поставки ${supplier.name}`} onClick={() => setLeadEdits({ ...leadEdits, [supplier.id]: String(supplier.lead_time_days) })} className="px-3"><Icon name="close" /></Button>}</div>
          </form>;
        })}</div>
        {!saved.suppliers.length && <p className="mt-5 text-sm text-text-secondary">Поставщиков пока нет. Они появятся после загрузки исходных данных.</p>}
      </section>

      <section aria-labelledby="rules-title" className="overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-start gap-3"><span className="rounded-2xl bg-page-bg p-3 text-accent-text"><Icon name="box" /></span><div><h2 id="rules-title" className="text-lg font-semibold">Правила поставщиков</h2><p className="mt-1 text-sm text-text-secondary">Минимальное количество и кратность заказа для каждого SKU</p></div></div>{dirtyRules.length > 0 && <span className="rounded-full border border-border px-3 py-1 text-xs text-text-secondary">Изменено строк: {dirtyRules.length}</span>}</div>
          <div className="mt-5 flex flex-wrap gap-3"><div className="relative min-w-0 flex-1 basis-60"><Icon name="search" className="pointer-events-none absolute left-4 top-3 text-text-muted" /><input aria-label="Поиск правил" placeholder="Артикул или поставщик" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className={`${inputClass} border-border pl-12`} /></div><Select aria-label="Фильтр поставщиков" value={supplierFilter} onChange={value => { setSupplierFilter(value); setPage(0); }} options={[{ value: '', label: 'Все поставщики' }, ...saved.suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))]} /></div>
        </div>
        {visible.length > 0 ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Правила заказа: поставщик, артикул, минимальное количество и кратность. Изменения сохраняются отдельно по строкам.</caption><thead className="border-y border-border bg-page-bg text-xs text-text-secondary"><tr>{['Поставщик / SKU', 'Мин. заказ', 'Кратность', 'Действия'].map(title => <th key={title} scope="col" className="px-5 py-4 font-medium">{title}</th>)}</tr></thead><tbody className="divide-y divide-border">{visible.map(rule => {
          const draft = ruleEdits[rule.id] ?? ruleDraft(rule);
          const changed = draftChanged(draft, rule);
          const minError = numberError(draft.min_order_qty, 0);
          const multipleError = numberError(draft.order_multiple, 1);
          return <tr key={rule.id} className={changed ? 'bg-page-bg' : ''}><th scope="row" className="min-w-44 px-5 py-4 font-normal"><p className="font-medium">{saved.suppliers.find(supplier => supplier.id === rule.supplier_id)?.name ?? rule.supplier_id}</p><p className="mt-1 text-xs tabular-nums text-text-secondary">{rule.sku_code}</p></th><td className="min-w-36 max-w-52 px-5 py-4 align-top"><NumberField id={`min-${rule.id}`} aria-label={`Минимальный заказ ${rule.sku_code}`} value={draft.min_order_qty} min={0} step="any" error={minError} onChange={e => setRuleEdits({ ...ruleEdits, [rule.id]: { ...draft, min_order_qty: e.target.value } })} /></td><td className="min-w-36 max-w-52 px-5 py-4 align-top"><NumberField id={`multiple-${rule.id}`} aria-label={`Кратность ${rule.sku_code}`} value={draft.order_multiple} min={1} step="any" error={multipleError} onChange={e => setRuleEdits({ ...ruleEdits, [rule.id]: { ...draft, order_multiple: e.target.value } })} /></td><td className="px-5 py-4 align-top"><div className="flex gap-2"><Button type="button" variant="secondary" disabled={!changed || Boolean(minError || multipleError)} onClick={() => void saveRule(rule.id)} aria-label={`Сохранить правило ${rule.sku_code}`}>{busy === rule.id ? 'Сохранение…' : 'Сохранить'}</Button>{changed && <Button type="button" variant="ghost" className="px-3" aria-label={`Отменить правило ${rule.sku_code}`} onClick={() => setRuleEdits({ ...ruleEdits, [rule.id]: ruleDraft(rule) })}><Icon name="close" /></Button>}</div></td></tr>;
        })}</tbody></table></div> : <div className="border-t border-border px-5 py-10 text-center"><Icon name="search" width="28" height="28" className="mx-auto mb-3 text-text-muted" /><h3 className="font-semibold">{saved.rules.length ? 'Правила не найдены' : 'Правил пока нет'}</h3><p className="mt-2 text-sm text-text-secondary">{saved.rules.length ? 'Попробуйте другой артикул или поставщика.' : 'Правила появятся после загрузки исходных данных.'}</p>{(search || supplierFilter) && <Button variant="secondary" className="mt-4" onClick={() => { setSearch(''); setSupplierFilter(''); setPage(0); }}>Сбросить фильтры</Button>}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4"><p className="text-xs text-text-secondary">{filtered.length ? `${page * 10 + 1}–${Math.min((page + 1) * 10, filtered.length)} из ${filtered.length}` : '0 правил'}{(search || supplierFilter) && ` · всего ${saved.rules.length}`}</p><div className="flex gap-2"><Button type="button" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Назад</Button><Button type="button" variant="ghost" disabled={(page + 1) * 10 >= filtered.length} onClick={() => setPage(page + 1)}>Далее</Button></div></div>
        <p className="border-t border-border px-5 py-4 text-xs leading-5 text-text-secondary">Количество указано в единицах товара. Минимум 0 — без ограничения; кратность 1 — заказ любого целого количества. Сохраняйте каждую изменённую строку отдельно.</p>
      </section>
    </fieldset>
    {notice && <div role="status" className="fixed bottom-5 right-5 z-50 flex max-w-[calc(100%-2.5rem)] items-center gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg"><Icon name="check" className="shrink-0 text-status-good" /><p className="text-sm">{notice}</p><Button variant="ghost" className="shrink-0 px-3" aria-label="Закрыть уведомление" onClick={() => setNotice('')}><Icon name="close" /></Button></div>}
    {blocker.state === 'blocked' && <Dialog labelledBy="leave-settings-title" onClose={() => blocker.reset()}><h2 id="leave-settings-title" className="text-xl font-semibold">{saving ? 'Сохранение настроек' : 'Есть несохранённые изменения'}</h2><p className="mt-3 text-sm leading-6 text-text-secondary">{saving ? 'Дождитесь окончания операции перед переходом на другой экран.' : 'При переходе ваши несохранённые правки будут потеряны.'}</p><div className="mt-6 flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={() => blocker.reset()}>Остаться</Button>{!saving && <Button onClick={() => blocker.proceed()}>Уйти без сохранения</Button>}</div></Dialog>}
  </>;
}
