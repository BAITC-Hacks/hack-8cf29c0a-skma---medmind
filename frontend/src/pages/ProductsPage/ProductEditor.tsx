import { useState, type FormEvent } from 'react';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { categoryOptions, units, type Product } from './model';

const inputClass = 'mt-1 min-h-11 w-full rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text-primary hover:border-accent-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring';

type Props = {
  product: Product | null;
  products: Product[];
  onSave: (product: Product) => string | null;
  onClose: () => void;
};

export function ProductEditor({ product, products, onSave, onClose }: Props) {
  const [error, setError] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const next: Product = {
      id: product?.id ?? crypto.randomUUID(),
      sku: text('sku'), name: text('name'), category: text('category'),
      supplier: text('supplier'), unit: text('unit'),
      stock: Number(text('stock')), price: Number(text('price')),
    };
    if (!next.sku || !next.name || !next.supplier) {
      setError('Артикул, название и поставщик не могут состоять из пробелов.');
      return;
    }
    if (products.some(p => p.id !== next.id && p.sku.toLocaleLowerCase('ru-RU') === next.sku.toLocaleLowerCase('ru-RU'))) {
      setError('Товар с таким артикулом уже существует. Укажите уникальный артикул.');
      return;
    }
    if (!Number.isFinite(next.stock) || !Number.isFinite(next.price) || next.stock < 0 || next.price < 0) {
      setError('Остаток и цена должны быть конечными неотрицательными числами.');
      return;
    }
    const failure = onSave(next);
    if (failure) setError(failure);
  }
  return (
    <Dialog onClose={onClose} labelledBy="product-editor-title">
      <h2 id="product-editor-title" className="text-xl font-semibold">{product ? 'Редактировать товар' : 'Новый товар'}</h2>
      <p className="mt-2 text-sm text-text-secondary">Все поля обязательны. Цена указана за единицу товара.</p>
      <form onSubmit={submit} className="mt-5 space-y-4">
        <label className="block text-sm">Артикул<input autoFocus name="sku" required maxLength={64} defaultValue={product?.sku} className={inputClass} /></label>
        <label className="block text-sm">Название<input name="name" required maxLength={160} defaultValue={product?.name} className={inputClass} /></label>
        <label className="block text-sm">Категория<select name="category" defaultValue={product?.category ?? categoryOptions[0]} className={inputClass}>{[...new Set([...categoryOptions, ...(product ? [product.category] : [])])].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="block text-sm">Поставщик<input name="supplier" required maxLength={120} defaultValue={product?.supplier} className={inputClass} /></label>
        <label className="block text-sm">Единица измерения<select name="unit" defaultValue={product?.unit ?? units[0]} className={inputClass}>{[...new Set([...units, ...(product ? [product.unit] : [])])].map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">Остаток<input name="stock" type="number" min="0" max="999999999" step="0.001" required defaultValue={product?.stock ?? 0} className={inputClass} /></label>
          <label className="block text-sm">Цена, ₸<input name="price" type="number" min="0" max="999999999" step="0.01" required defaultValue={product?.price ?? 0} className={inputClass} /></label>
        </div>
        {error && <p role="alert" className="rounded-2xl border border-status-critical p-3 text-sm text-text-primary">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2 pt-2"><Button type="button" variant="secondary" onClick={onClose}>Отмена</Button><Button type="submit">{product ? 'Сохранить' : 'Создать товар'}</Button></div>
      </form>
    </Dialog>
  );
}
