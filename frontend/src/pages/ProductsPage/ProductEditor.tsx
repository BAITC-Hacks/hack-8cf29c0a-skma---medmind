import { useState, type FormEvent } from 'react';
import type { Category, Supplier } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import type { Product, ProductWrite } from './model';

const field = 'mt-1 min-h-11 w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring';

export function ProductEditor({ product, suppliers, categories, onSave, onClose }: {
  product: Product | null; suppliers: Supplier[]; categories: Category[];
  onSave: (product: ProductWrite) => Promise<void>; onClose: () => void;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [editStock, setEditStock] = useState(Boolean(product?.stock));
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const next: ProductWrite = {
      code: product?.code ?? text('code'), name: text('name'), supplier_sku: text('supplier_sku') || null,
      supplier_id: text('supplier_id'), category_id: text('category_id'), unit: text('unit'),
      unit_cost: text('unit_cost') ? Number(text('unit_cost')) : null,
      stock: editStock ? { as_of: text('as_of'), on_hand: Number(text('on_hand')), reserved: Number(text('reserved')) } : null,
    };
    if (!next.code || !next.name || !next.unit) { setError('Заполните код, название и единицу измерения.'); return; }
    if (next.stock && next.stock.reserved > next.stock.on_hand) { setError('Резерв не может превышать остаток.'); return; }
    setBusy(true); setError('');
    try { await onSave(next); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Не удалось сохранить товар.'); }
    finally { setBusy(false); }
  }
  return <Dialog onClose={() => { if (!busy) onClose(); }} labelledBy="product-editor-title">
    <h2 id="product-editor-title" className="text-xl font-semibold">{product ? 'Редактировать товар' : 'Новый товар'}</h2>
    <form onSubmit={submit} className="mt-5"><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">Код 1С<input autoFocus name="code" required readOnly={Boolean(product)} maxLength={64} defaultValue={product?.code} className={field} /></label>
      <label className="block text-sm">Артикул поставщика<input name="supplier_sku" maxLength={128} defaultValue={product?.supplier_sku ?? ''} className={field} /></label>
      <label className="block text-sm">Название<input name="name" required maxLength={500} defaultValue={product?.name} className={field} /></label>
      <label className="block text-sm">Категория<select required name="category_id" defaultValue={product?.category_id ?? ''} className={field}><option value="" disabled>Выберите категорию</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="block text-sm">Поставщик<select required name="supplier_id" defaultValue={product?.supplier_id ?? ''} className={field}><option value="" disabled>Выберите поставщика</option>{suppliers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-4"><label className="block text-sm">Единица<input name="unit" required maxLength={16} defaultValue={product?.unit ?? 'шт'} className={field} /></label><label className="block text-sm">Себестоимость, ₸<input name="unit_cost" type="number" min="0" step="any" defaultValue={product?.unit_cost ?? ''} className={field} /></label></div>
      {!product?.stock && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={editStock} onChange={e => setEditStock(e.target.checked)} className="accent-accent-solid" />Указать остаток</label>}
      {editStock && <div className="space-y-3 rounded-2xl border border-border p-4"><label className="block text-sm">Дата остатка<input name="as_of" type="date" required defaultValue={product?.stock?.as_of ?? new Date().toLocaleDateString('en-CA')} className={field} /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm">На складе<input name="on_hand" type="number" required min="0" step="any" defaultValue={product?.stock?.on_hand ?? 0} className={field} /></label><label className="block text-sm">В резерве<input name="reserved" type="number" required min="0" step="any" defaultValue={product?.stock?.reserved ?? 0} className={field} /></label></div></div>}
      {error && <p role="alert" className="rounded-2xl border border-status-critical p-3 text-sm">{error}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit">{busy ? 'Сохраняем…' : 'Сохранить'}</Button></div>
    </fieldset></form>
  </Dialog>;
}
