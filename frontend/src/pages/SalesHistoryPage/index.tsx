import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { API_BASE, request } from '../../shared/api/client';
import { getOrderLookups } from '../../shared/api/orders';
import { Button } from '../../shared/ui/Button';
import { Select } from '../../shared/ui/Select';
import { Dialog } from '../../shared/ui/Dialog';
import { QueryError, QueryLoading } from '../../shared/ui/QueryState';
import { SalesTrend } from '../../features/sales/SalesTrend';
import { useDebouncedValue } from '../../shared/useDebouncedValue';

interface Sale {
  id: number; ts: string; document: string; doc_type: string; sku_code: string;
  supplier_sku: string | null; name: string | null; supplier: string | null;
  category: string | null; unit: string | null; qty: number;
}
interface SalesData {
  items: Sale[]; total: number;
  summary: { operations: number; documents: number; skus: number; returns: number };
  trend: { date: string; operations: number }[];
  counts: { all: number; sale: number; return: number };
  range: { from: string | null; to: string | null };
}
const field = 'min-h-11 min-w-0 rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring';
const initial = { search: '', from: '', to: '', supplier_id: '', category_id: '', kind: '' };
const dateLabel = (date: string) => date.slice(0, 10).split('-').reverse().join('.');
export function SalesHistoryPage() {
  const [filters, setFilters] = useState(initial);
  const settledSearch = useDebouncedValue(filters.search);
  const [sort, setSort] = useState('date');
  const [ascending, setAscending] = useState(false);
  const [page, setPage] = useState(0);
  const [active, setActive] = useState<Sale | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const params = new URLSearchParams(Object.entries({ ...filters, search: settledSearch }).filter(([, value]) => Boolean(value)));
  params.set('sort', sort); params.set('ascending', String(ascending));
  const invalidDates = Boolean(filters.from && filters.to && filters.from > filters.to);
  const lookups = useQuery({ queryKey: ['order-lookups'], queryFn: getOrderLookups });
  const query = useQuery({ queryKey: ['sales', params.toString(), page], enabled: !invalidDates,
    queryFn: ({ signal }) => request<SalesData>(`/sales?${params}&limit=25&offset=${page * 25}`, { signal }) });
  const change = (values: Partial<typeof initial>) => { setFilters(previous => ({ ...previous, ...values })); setPage(0); };
  const data = invalidDates ? undefined : query.data;
  function preset(days: number | null) {
    if (!days) { change({ from: '', to: '' }); return; }
    const end = data?.range.to ?? new Date().toLocaleDateString('en-CA');
    change({ from: new Date(Date.parse(end + 'T00:00:00Z') - (days - 1) * 86400000).toISOString().slice(0, 10), to: end });
  }
  async function exportCsv() {
    setExporting(true); setError('');
    try {
      const response = await fetch(`${API_BASE}/sales/export?${params}`);
      if (!response.ok) throw new Error('Не удалось выгрузить продажи. Повторите экспорт.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'sales-history.csv';
      document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось выгрузить продажи.'); }
    finally { setExporting(false); }
  }
  return <div className="space-y-6">
    <header className="flex flex-wrap justify-between gap-4"><div><h1 className="text-3xl font-semibold">История продаж</h1><p className="mt-2 text-sm text-text-secondary">Документы и движение товаров</p></div><Button variant="secondary" disabled={!data?.total || exporting} onClick={() => void exportCsv()}>{exporting ? 'Подготовка…' : 'Экспорт CSV'}</Button></header>
    <section aria-label="Фильтры истории продаж" className="space-y-4 rounded-3xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-end gap-3"><label className="grid gap-2 text-xs text-text-secondary">С даты<input type="date" value={filters.from} onChange={e => change({ from: e.target.value })} className={field} /></label><label className="grid gap-2 text-xs text-text-secondary">По дату<input type="date" value={filters.to} onChange={e => change({ to: e.target.value })} className={field} /></label>{[7, 30, null].map(days => <Button key={String(days)} variant="ghost" onClick={() => preset(days)}>{days ? days + ' дней' : 'Весь период'}</Button>)}</div>
      {invalidDates && <p role="alert" className="text-sm">Начальная дата должна быть не позже конечной.</p>}
      <div className="flex flex-wrap gap-3"><input aria-label="Поиск продаж" placeholder="Товар, код или документ" value={filters.search} onChange={e => change({ search: e.target.value })} className={field + ' flex-1'} /><Select aria-label="Поставщик продаж" value={filters.supplier_id} onChange={v => change({ supplier_id: v })} options={[{ value: '', label: 'Все поставщики' }, ...(lookups.data?.suppliers ?? []).map(s => ({ value: s.id, label: s.name }))]} /><Select aria-label="Категория продаж" value={filters.category_id} onChange={v => change({ category_id: v })} options={[{ value: '', label: 'Все категории' }, ...(lookups.data?.categories ?? []).map(c => ({ value: c.id, label: c.name }))]} /></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-xs text-text-secondary">{data?.range.to ? 'Данные по ' + dateLabel(data.range.to) : ''}</span><Button variant="ghost" onClick={() => change(initial)}>Сбросить фильтры</Button></div>
    </section>
    {lookups.isError && <QueryError error={lookups.error} retry={lookups.refetch} />}
    {error && <p role="alert" className="rounded-2xl border border-status-critical p-4">{error}</p>}
    {!invalidDates && (query.isPending ? <QueryLoading /> : query.isError ? <QueryError error={query.error} retry={query.refetch} /> : data && <>
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{([['Операций', data.summary.operations], ['Документов', data.summary.documents], ['Товарных позиций', data.summary.skus], ['Строк возвратов', data.summary.returns]] as const).map(([label, value]) => <section key={label} className="rounded-3xl border border-border bg-surface p-5"><h2 className="text-sm text-text-secondary">{label}</h2><p className="mt-4 text-3xl font-semibold">{value.toLocaleString('ru-RU')}</p></section>)}</div>
      <SalesTrend data={data.trend} />
      <section className="overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 p-5">{([{ value: '', label: 'Все операции', count: data.counts.all }, { value: 'sale', label: 'Отгрузки', count: data.counts.sale }, { value: 'return', label: 'Возвраты', count: data.counts.return }]).map(tab => <Button key={tab.value} variant={filters.kind === tab.value ? 'primary' : 'ghost'} onClick={() => change({ kind: tab.value })}>{tab.label} · {tab.count}</Button>)}</div>
        <div className="flex flex-wrap gap-3 border-t border-border px-5 py-3"><Select aria-label="Сортировка продаж" value={sort} onChange={v => { setSort(v); setPage(0); }} options={[{ value: 'date', label: 'По дате' }, { value: 'name', label: 'По товару' }, { value: 'quantity', label: 'По количеству' }]} /><Button variant="ghost" onClick={() => { setAscending(!ascending); setPage(0); }}>{ascending ? 'По возрастанию ↑' : 'По убыванию ↓'}</Button></div>
        {data.items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">История операций</caption><thead className="bg-page-bg text-text-secondary"><tr>{['Дата / документ', 'Товар', 'Поставщик', 'Тип документа', 'Количество'].map(title => <th className="px-5 py-4 font-medium" key={title}>{title}</th>)}</tr></thead><tbody className="divide-y divide-border">{data.items.map(row => <tr key={row.id}><td className="whitespace-nowrap px-5 py-4"><p>{dateLabel(row.ts)}</p><button onClick={() => setActive(row)} className="mt-1 rounded text-accent-text hover:underline active:text-accent-active focus-visible:ring-2 focus-visible:ring-accent-focus-ring">{row.document}</button></td><td className="min-w-60 px-5 py-4">{row.name ?? row.sku_code}<p className="mt-1 text-xs text-text-secondary">{row.sku_code} · {row.category ?? '—'}</p></td><td className="px-5 py-4">{row.supplier ?? '—'}</td><td className="px-5 py-4">{row.doc_type}{row.qty < 0 && <span className="mt-1 block text-xs text-text-secondary">↩ Возврат</span>}</td><td className="whitespace-nowrap px-5 py-4 text-right tabular-nums">{row.qty.toLocaleString('ru-RU')} {row.unit}</td></tr>)}</tbody></table></div> : <p className="p-10 text-center text-text-secondary">Операции не найдены. Измените фильтры или загрузите продажи.</p>}
        <div className="flex items-center justify-between gap-3 border-t border-border p-4"><p className="text-sm text-text-secondary">{data.total ? `${page * 25 + 1}–${Math.min((page + 1) * 25, data.total)} из ${data.total}` : '0 операций'}</p><div className="flex gap-2"><Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Назад</Button><Button variant="ghost" disabled={(page + 1) * 25 >= data.total} onClick={() => setPage(page + 1)}>Далее</Button></div></div>
      </section>
    </>)}
    {active && <Dialog onClose={() => setActive(null)} labelledBy="sale-title"><h2 id="sale-title" className="text-xl font-semibold">{active.document}</h2><dl className="my-6 space-y-4">{[['Дата', dateLabel(active.ts)], ['Тип документа', active.doc_type], ['Товар', active.name ?? active.sku_code], ['Код 1С', active.sku_code], ['Артикул', active.supplier_sku ?? '—'], ['Поставщик', active.supplier ?? '—'], ['Количество', active.qty.toLocaleString('ru-RU') + ' ' + (active.unit ?? '')]].map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1">{value}</dd></div>)}</dl><Button onClick={() => setActive(null)}>Закрыть</Button></Dialog>}
  </div>;
}
