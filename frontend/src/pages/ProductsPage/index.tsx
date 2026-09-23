import { useState } from 'react';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Select } from '../../shared/ui/Select';
import { ProductEditor } from './ProductEditor';
import { readProducts, storageKey, type Product } from './model';

const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
const money = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'KZT', maximumFractionDigits: 2 });
type Action = { type: 'create' } | { type: 'edit' | 'view' | 'delete'; product: Product } | null;

export function ProductsPage() {
  const [catalog, setCatalog] = useState(readProducts);
  const [action, setAction] = useState<Action>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('name');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const categories = [...new Set(catalog.products.map(p => p.category))].sort();
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const visible = catalog.products.filter(p => (!category || p.category === category)
    && `${p.sku} ${p.name} ${p.supplier}`.toLocaleLowerCase('ru-RU').includes(query))
    .sort((a, b) => sort === 'stock' ? a.stock - b.stock : sort === 'price' ? a.price - b.price : a.name.localeCompare(b.name, 'ru'));

  function persist(next: Product[], success: string): string | null {
    try {
      if (catalog.error) throw new Error('Не удалось загрузить каталог. Повторите загрузку перед изменением.');
      if (localStorage.getItem(storageKey) !== catalog.raw) throw new Error('Каталог изменился в другой вкладке. Закройте форму и нажмите «Обновить каталог», затем повторите изменение.');
      const raw = JSON.stringify(next);
      localStorage.setItem(storageKey, raw);
      setCatalog({ products: next, raw, error: '' });
      setAction(null);
      setError('');
      setMessage(success);
      return null;
    } catch (failure) {
      const text = failure instanceof Error && failure.message.includes('Каталог') ? failure.message : 'Не удалось сохранить изменения. Проверьте доступ и свободное место в хранилище браузера.';
      setError(text);
      return text;
    }
  }
  function reload() {
    setCatalog(readProducts());
    setCategory('');
    setError('');
    setMessage('');
  }
  function save(product: Product) {
    const exists = catalog.products.some(p => p.id === product.id);
    return persist(exists ? catalog.products.map(p => p.id === product.id ? product : p) : [...catalog.products, product], exists ? 'Изменения товара сохранены.' : 'Товар создан.');
  }
  function open(next: Action) { setError(''); setMessage(''); setAction(next); }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-3xl font-semibold tracking-tight">Товары</h1><p className="mt-2 text-sm text-text-secondary">Каталог товаров · {catalog.products.length} позиций</p></div>
        <Button onClick={() => open({ type: 'create' })} disabled={Boolean(catalog.error)}>Добавить товар</Button>
      </header>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4 text-sm text-text-secondary">
        <p>Локальный каталог с тестовыми товарами. Изменения сохраняются в этом браузере; заказы и аналитика используют свои данные.</p>
        <Button variant="ghost" onClick={reload}>Обновить каталог</Button>
      </div>
      {message && <p role="status" className="rounded-2xl border border-border bg-surface p-4 text-sm">{message}</p>}
      {(catalog.error || error) && <p role="alert" className="rounded-2xl border border-status-critical bg-surface p-4 text-sm">{catalog.error || error}</p>}
      <section aria-label="Каталог товаров" className="overflow-hidden rounded-3xl border border-border bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-border p-5">
          <input aria-label="Поиск товаров" placeholder="Название, артикул или поставщик" value={search} onChange={e => setSearch(e.target.value)} className="min-h-11 min-w-0 flex-1 rounded-2xl border border-border bg-surface px-4 py-2 text-sm text-text-primary hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring" />
          <Select aria-label="Категория товаров" value={category} onChange={setCategory} options={[{ value: '', label: 'Все категории' }, ...[...new Set([...categories, ...(category ? [category] : [])])].map(value => ({ value, label: value }))]} />
          <Select aria-label="Сортировка товаров" value={sort} onChange={setSort} options={[{ value: 'name', label: 'По названию' }, { value: 'stock', label: 'По остатку ↑' }, { value: 'price', label: 'По цене ↑' }]} />
          <p className="w-full text-xs text-text-secondary">Показано {visible.length} из {catalog.products.length}</p>
        </div>
        {visible.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">Товары: артикулы, категории, поставщики, остатки и цены</caption>
          <thead className="bg-page-bg text-text-secondary"><tr>{['Товар', 'Категория / поставщик', 'Остаток', 'Цена за ед.', 'Действия'].map(label => <th key={label} scope="col" className="whitespace-nowrap px-5 py-4 font-medium">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-border">{visible.map(product => <tr key={product.id}>
            <td className="min-w-48 px-5 py-4"><button onClick={() => open({ type: 'view', product })} className="rounded text-left font-semibold text-accent-text hover:underline active:text-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring">{product.name}</button><p className="mt-1 text-xs text-text-secondary">{product.sku}</p></td>
            <td className="px-5 py-4"><p>{product.category}</p><p className="mt-1 text-xs text-text-secondary">{product.supplier}</p></td>
            <td className="whitespace-nowrap px-5 py-4 tabular-nums">{format.format(product.stock)} {product.unit}</td>
            <td className="whitespace-nowrap px-5 py-4 tabular-nums">{money.format(product.price)}</td>
            <td className="px-5 py-4"><div className="flex gap-2"><Button variant="secondary" aria-label={`Изменить ${product.sku}`} onClick={() => open({ type: 'edit', product })}>Изменить</Button><Button variant="destructive" aria-label={`Удалить ${product.sku}`} onClick={() => open({ type: 'delete', product })}>Удалить</Button></div></td>
          </tr>)}</tbody>
        </table></div> : <div className="p-10 text-center"><h2 className="text-lg font-semibold">{catalog.error ? 'Каталог недоступен' : catalog.products.length ? 'Товары не найдены' : 'В каталоге пока нет товаров'}</h2><p className="mt-2 text-sm text-text-secondary">{catalog.products.length ? 'Измените запрос или сбросьте фильтры.' : 'Добавьте первый товар, чтобы начать работу.'}</p>{(search || category) && <Button variant="secondary" className="mt-4" onClick={() => { setSearch(''); setCategory(''); }}>Сбросить фильтры</Button>}</div>}
      </section>
      {(action?.type === 'create' || action?.type === 'edit') && <ProductEditor product={action.type === 'edit' ? action.product : null} products={catalog.products} onSave={save} onClose={() => setAction(null)} />}
      {action?.type === 'view' && <Dialog onClose={() => setAction(null)} labelledBy="product-view-title">
        <h2 id="product-view-title" className="break-words text-xl font-semibold">{action.product.name}</h2>
        <dl className="my-6 space-y-4">{[['Артикул', action.product.sku], ['Категория', action.product.category], ['Поставщик', action.product.supplier], ['Остаток', `${format.format(action.product.stock)} ${action.product.unit}`], ['Цена за единицу', money.format(action.product.price)]].map(([label, value]) => <div key={label}><dt className="text-xs text-text-secondary">{label}</dt><dd className="mt-1 break-words text-sm">{value}</dd></div>)}</dl>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => setAction(null)}>Закрыть</Button><Button onClick={() => open({ type: 'edit', product: action.product })}>Редактировать</Button></div>
      </Dialog>}
      {action?.type === 'delete' && <Dialog onClose={() => setAction(null)} labelledBy="product-delete-title">
        <h2 id="product-delete-title" className="text-xl font-semibold">Удалить товар?</h2><p className="mt-4 break-words text-sm text-text-secondary">«{action.product.name}» ({action.product.sku}) будет удалён из локального каталога. Это действие нельзя отменить.</p>
        {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
        <div className="mt-6 flex flex-wrap justify-end gap-2"><Button autoFocus variant="secondary" onClick={() => setAction(null)}>Отмена</Button><Button variant="destructive" onClick={() => persist(catalog.products.filter(p => p.id !== action.product.id), 'Товар удалён.')}>Удалить товар</Button></div>
      </Dialog>}
    </div>
  );
}
