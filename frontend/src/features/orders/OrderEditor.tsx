import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createOrder, findOrderProducts, updateOrder } from '../../shared/api/orders';
import type { OrderRecommendation, Urgency } from '../../shared/api/types';
import { Dialog } from '../../shared/ui/Dialog';
import { Button } from '../../shared/ui/Button';
import { inputClass, parseQuantity, urgencyLabels } from './model';

interface Fields {
  sku_code: string;
  quantity: string;
  urgency: Urgency;
  reason: string;
  comment: string;
}

export function OrderEditor({ order, runId, onClose, onSaved }: {
  order?: OrderRecommendation;
  runId: string | null;
  onClose: () => void;
  onSaved: (order: OrderRecommendation) => void;
}) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(id);
  }, [search]);
  const products = useQuery({
    queryKey: ['order-products', debounced],
    queryFn: () => findOrderProducts(debounced),
    enabled: !order,
    retry: 1,
  });
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<Fields>({
    defaultValues: {
      sku_code: order?.sku_code ?? '',
      quantity: String(order?.recommended_qty ?? ''),
      urgency: order?.urgency ?? 'medium',
      reason: order?.short_reason ?? '',
      comment: order?.comment ?? '',
    },
  });
  const save = useMutation({
    mutationFn: (fields: Fields) => {
      const values = {
        recommended_qty: parseQuantity(fields.quantity)!,
        urgency: fields.urgency,
        short_reason: fields.reason.trim(),
        comment: fields.comment.trim() || null,
      };
      return order
        ? updateOrder(order, values)
        : createOrder({ ...values, run_id: runId, sku_code: fields.sku_code });
    },
    onSuccess: onSaved,
  });
  const errorClass = 'mt-1 text-xs text-text-secondary';
  return <Dialog labelledBy="order-editor-title" onClose={() => { if (!save.isPending) onClose(); }}>
    <h2 id="order-editor-title" className="text-xl font-semibold">
      {order ? 'Редактировать заказ' : 'Новый заказ'}
    </h2>
    <p className="mt-2 text-sm leading-6 text-text-secondary">
      {order ? 'После изменения потребуется повторное согласование.'
        : runId ? 'Добавьте позицию в выбранный расчёт.' : 'Будет создан отдельный набор ручных заказов.'}
    </p>
    <form onSubmit={handleSubmit(fields => save.mutate(fields))} className="mt-5 space-y-4">
      <fieldset disabled={save.isPending} className="space-y-4">
        {order ? <p className="rounded-2xl bg-page-bg p-3 text-sm">
          {order.name}
          <span className="mt-1 block text-xs text-text-secondary">{order.sku_code} · {order.supplier_name} · {order.unit}</span>
        </p> : <>
          <label className="block text-sm font-medium">
            Поиск товара
            <input className={`${inputClass} mt-2 w-full`} value={search}
              onChange={e => { setSearch(e.target.value); setValue('sku_code', ''); }}
              placeholder="Код, артикул или название" />
          </label>
          {products.isPending ? <p role="status" className="text-sm text-text-secondary">Загрузка каталога…</p>
            : products.isError ? <div role="alert">
              <p className="text-sm text-text-secondary">{products.error.message}</p>
              <Button type="button" variant="secondary" onClick={() => void products.refetch()}>Повторить</Button>
            </div> : <>
            <label className="block text-sm font-medium">
              Товар
              <select className={`${inputClass} mt-2 w-full`} aria-invalid={!!errors.sku_code}
                {...register('sku_code', { required: 'Выберите товар' })}>
                <option value="">Выберите товар</option>
                {products.data.items.map(p => <option key={p.code} value={p.code}>{p.code} · {p.name} ({p.unit})</option>)}
              </select>
            </label>
            {!products.data.total && <p className="text-sm text-text-secondary">Товары не найдены. Измените поиск или импортируйте каталог товаров.</p>}
            {products.data.total > products.data.items.length && <p className="text-xs text-text-secondary">Первые {products.data.items.length} из {products.data.total}. Уточните поиск.</p>}
          </>}
          {errors.sku_code && <p role="alert" className={errorClass}>{errors.sku_code.message}</p>}
        </>}
        <label className="block text-sm font-medium">
          Количество
          <input inputMode="decimal" className={`${inputClass} mt-2 w-full ${errors.quantity ? 'border-status-critical' : ''}`}
            aria-invalid={!!errors.quantity}
            {...register('quantity', { validate: value => parseQuantity(value) !== null || 'Укажите количество больше 0 и до 1 000 000' })} />
        </label>
        {errors.quantity && <p role="alert" className={errorClass}>{errors.quantity.message}</p>}
        <label className="block text-sm font-medium">
          Срочность
          <select className={`${inputClass} mt-2 w-full`} {...register('urgency')}>
            {Object.entries(urgencyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Обоснование
          <textarea rows={3} maxLength={2000} className={`${inputClass} mt-2 w-full`} aria-invalid={!!errors.reason}
            {...register('reason', { validate: value => !!value.trim() || 'Укажите причину заказа', maxLength: 2000 })} />
        </label>
        {errors.reason && <p role="alert" className={errorClass}>{errors.reason.message}</p>}
        <label className="block text-sm font-medium">
          Комментарий
          <textarea rows={2} maxLength={500} className={`${inputClass} mt-2 w-full`} {...register('comment', { maxLength: 500 })} />
        </label>
      </fieldset>
      {save.isError && <p role="alert" className="rounded-xl border border-status-critical p-3 text-sm text-text-secondary">{save.error.message}</p>}
      <p className="text-xs leading-5 text-text-secondary">Сохранение и утверждение не отправляют заказ поставщику автоматически.</p>
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={onClose} disabled={save.isPending}>Отмена</Button>
        <Button type="submit" disabled={save.isPending || (!order && (products.isPending || products.isError))}>
          {save.isPending ? 'Сохраняем…' : order ? 'Сохранить' : 'Создать заказ'}
        </Button>
      </div>
    </form>
  </Dialog>;
}
