import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { request, jsonRequest } from '../../shared/api/client';
import { getOrderLookups } from '../../shared/api/orders';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Select } from '../../shared/ui/Select';
import { QueryError, QueryLoading } from '../../shared/ui/QueryState';
import { ProductEditor } from './ProductEditor';
import type { Product, ProductWrite } from './model';
import { SupplierImport } from './SupplierImport';
import { useDebouncedValue } from '../../shared/useDebouncedValue';

const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT' });
type Action = { type: 'create' } | { type: 'edit' | 'view' | 'delete'; product: Product } | null;

export function ProductsPage() {
  const cache = useQueryClient();
  const [action, setAction] = useState<Action>(null);
  const [search, setSearch] = useState('');
  const settledSearch = useDebouncedValue(search);
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lookups = useQuery({ queryKey: ['order-lookups'], queryFn: getOrderLookups });
  const query = useQuery({ queryKey: ['products', settledSearch, category, sort, page], queryFn: ({ signal }) => request<{ items: Product[]; total: number }>(`/products?${new URLSearchParams({ search: settledSearch, ...(category ? { category_id: category } : {}), sort, limit: '25', offset: String(page * 25) })}`, { signal }) });
  async function refresh() { await Promise.all(['products', 'order-products', 'orders', 'dashboard', 'settings', 'order-lookups'].map(key => cache.invalidateQueries({ queryKey: [key] }))); }
  async function save(body: ProductWrite) {
    await request(action?.type === 'edit' ? `/products/${encodeURIComponent(action.product.code)}` : '/products', jsonRequest(action?.type === 'edit' ? 'PUT' : 'POST', body));
    setAction(null); setMessage('Товар сохранён.'); await refresh();
  }
  async function remove(product: Product) {
    setBusy(true); setError('');
    try { await request(`/input-data/products/${encodeURIComponent(product.code)}`, { method: 'DELETE' }); setAction(null); setMessage('Товар удалён.'); setPage(0); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось удалить товар.'); }
    finally { setBusy(false); }
  }
  function open(next: Action) { setError(''); setMessage(''); setAction(next); }
  const items = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Товары</h1><p className="mt-2 text-sm text-text-secondary">Каталог и складские остатки</p></div><div className="flex gap-2"><Button variant="secondary" onClick={() => void refresh()}>Обновить</Button><Button onClick={() => open({ type: 'create' })} disabled={!lookups.data}>Добавить товар</Button></div></header>
    <SupplierImport />
    {message && <p role="status" className="rounded-2xl border border-border bg-surface p-4">{message}</p>}
    {lookups.isError && <QueryError error={lookups.error} retry={lookups.refetch} />}
    <section className="overflow-hidden rounded-3xl border border-border bg-surface">
      <div className="flex flex-wrap gap-3 border-b border-border p-5"><input aria-label="Поиск товаров" placeholder="Название, код или поставщик" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="min-h-11 min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring" /><Select aria-label="Категория товаров" value={category} onChange={v => { setCategory(v); setPage(0); }} options={[{ value: '', label: 'Все категории' }, ...(lookups.data?.categories ?? []).map(c => ({ value: c.id, label: c.name }))]} /><Select aria-label="Сортировка товаров" value={sort} onChange={v => { setSort(v); setPage(0); }} options={[{ value: 'name', label: 'По названию' }, { value: 'stock', label: 'По остатку ↑' }, { value: 'price', label: 'По себестоимости ↑' }]} /></div>
      {query.isPending ? <QueryLoading /> : query.isError ? <QueryError error={query.error} retry={query.refetch} /> : <>
        {items.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Каталог товаров</caption><thead className="bg-page-bg text-text-secondary"><tr>{['Товар', 'Категория / поставщик', 'Остаток / свободно', 'Себестоимость', 'Действия'].map(label => <th key={label} className="px-5 py-4 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{items.map(product => <tr key={product.code}>
          <td className="min-w-56 px-5 py-4"><button onClick={() => open({ type: 'view', product })} className="rounded text-left font-semibold text-accent-text hover:underline active:text-accent-active focus-visible:ring-2 focus-visible:ring-accent-focus-ring">{product.name}</button><p className="mt-1 text-xs text-text-secondary">{product.code} · {product.supplier_sku || '—'}</p></td>
          <td className="px-5 py-4">{product.category_name}<p className="mt-1 text-xs text-text-secondary">{product.supplier_name}</p></td>
          <td className="whitespace-nowrap px-5 py-4 tabular-nums">{product.stock ? <>{number.format(product.stock.on_hand)} / {number.format(product.stock.free)} {product.unit}<p className="mt-1 text-xs text-text-secondary">на {product.stock.as_of}</p></> : product.monthly_stock ? <>{number.format(product.monthly_stock.on_hand)} {product.unit}<p className="mt-1 text-xs text-text-secondary">на {product.monthly_stock.as_of} · резерв неизвестен</p></> : 'Нет сведений'}</td>
          <td className="whitespace-nowrap px-5 py-4">{product.unit_cost === null ? '—' : money.format(product.unit_cost)}</td>
          <td className="px-5 py-4"><div className="flex gap-2"><Button variant="secondary" disabled={!lookups.data} onClick={() => open({ type: 'edit', product })}>Изменить</Button><Button variant="destructive" onClick={() => open({ type: 'delete', product })}>Удалить</Button></div></td>
        </tr>)}</tbody></table></div> : <p className="p-10 text-center text-text-secondary">Товары не найдены. Добавьте товар или измените фильтры.</p>}
        <div className="flex items-center justify-between gap-3 border-t border-border p-4"><span className="text-sm text-text-secondary">{total ? `${page * 25 + 1}–${Math.min((page + 1) * 25, total)} из ${total}` : '0 товаров'}</span><div className="flex gap-2"><Button variant="ghost" disabled={!page} onClick={() => setPage(page - 1)}>Назад</Button><Button variant="ghost" disabled={(page + 1) * 25 >= total} onClick={() => setPage(page + 1)}>Далее</Button></div></div>
      </>}
    </section>
    {(action?.type === 'create' || action?.type === 'edit') && lookups.data && <ProductEditor product={action.type === 'edit' ? action.product : null} {...lookups.data} onSave={save} onClose={() => setAction(null)} />}
    {action?.type === 'view' && <Dialog onClose={() => setAction(null)} labelledBy="product-view"><h2 id="product-view" className="text-xl font-semibold">{action.product.name}</h2><dl className="my-5 space-y-3">{[['Код 1С', action.product.code], ['Артикул', action.product.supplier_sku ?? '—'], ['Поставщик', action.product.supplier_name], ['Категория', action.product.category_name], ['Единица', action.product.unit], ['В резерве', action.product.stock ? number.format(action.product.stock.reserved) : 'Нет сведений']].map(([k, v]) => <div key={k}><dt className="text-xs text-text-secondary">{k}</dt><dd>{v}</dd></div>)}</dl><Button onClick={() => setAction(null)}>Закрыть</Button></Dialog>}
    {action?.type === 'delete' && <Dialog onClose={() => { if (!busy) setAction(null); }} labelledBy="product-delete"><h2 id="product-delete" className="text-xl font-semibold">Удалить товар?</h2><p className="mt-4 text-sm">{action.product.name} ({action.product.code}). Товары с историей продаж, остатками или заказами удалить нельзя.</p>{error && <p role="alert" className="mt-4 text-sm">{error}</p>}<div className="mt-6 flex justify-end gap-2"><Button disabled={busy} variant="secondary" onClick={() => setAction(null)}>Отмена</Button><Button disabled={busy} variant="destructive" onClick={() => void remove(action.product)}>{busy ? 'Удаляем…' : 'Удалить'}</Button></div></Dialog>}
  </div>;
}
