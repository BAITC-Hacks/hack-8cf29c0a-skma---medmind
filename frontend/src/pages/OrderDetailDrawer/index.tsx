import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrderRecommendation } from '../../shared/api/types';
import { getExplanation, getOrder } from '../../shared/api/orders';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Icon } from '../../shared/ui/Icon';
import { OrderBadge } from '../../features/orders/OrderBadge';
import { inputClass, number, parseQuantity } from '../../features/orders/model';

export function OrderDetailDrawer(props: Parameters<typeof OrderDetailContent>[0]) {
  const query = useQuery({ queryKey: ['order', props.order.id], queryFn: () => getOrder(props.order.run_id, props.order.id), retry: 1 });
  if (!query.data) return <Dialog drawer labelledBy="detail-loading" onClose={props.onClose}>
    <div className="space-y-4 p-6">
      <h2 id="detail-loading" className="text-xl font-semibold">Заказ</h2>
      <p role={query.isError ? 'alert' : 'status'}>{query.isError ? query.error.message : 'Загрузка заказа…'}</p>
      {query.isError && <Button onClick={() => void query.refetch()}>Повторить</Button>}
      <Button variant="secondary" onClick={props.onClose}>Закрыть</Button>
    </div>
  </Dialog>;
  return <OrderDetailContent {...props} order={query.data} />;
}

function OrderDetailContent({
  order,
  initialQuantity,
  busy,
  error,
  onClose,
  onDecide,
  onEdit,
  onDelete,
}: {
  order: OrderRecommendation;
  initialQuantity: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
  onEdit: (order: OrderRecommendation) => void;
  onDelete: (order: OrderRecommendation) => void;
  onDecide: (
    order: OrderRecommendation,
    quantity: number,
    status: 'approved' | 'rejected',
    comment: string,
  ) => void;
}) {
  const [quantity, setQuantity] = useState(initialQuantity);
  const [comment, setComment] = useState(order.comment ?? '');
  const [attempted, setAttempted] = useState(false);
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['explanation', order.run_id, order.sku_code],
    queryFn: () => getExplanation(order.run_id, order.sku_code),
    retry: 1,
    enabled: order.has_explanation !== false,
  });
  const parsed = parseQuantity(quantity);
  const submit = (status: 'approved' | 'rejected') => {
    setAttempted(true);
    if (status === 'approved' && parsed === null) return;
    onDecide(order, parsed ?? order.recommended_qty, status, comment.trim());
  };
  return (
    <Dialog
      drawer
      labelledBy="detail-title"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-text-secondary">
            Обоснование рекомендации
          </p>
          <p className="text-xs text-text-secondary">
            {order.supplier_name} · {order.sku_code}
          </p>
        </div>
        <Button
          variant="ghost"
          className="!h-11 !w-11 shrink-0 !px-0"
          aria-label="Закрыть обоснование"
          onClick={onClose}
          disabled={busy}
        >
          <Icon name="close" />
        </Button>
      </div>
      <div className="space-y-7 px-6 py-6">
        <div>
          <h2 id="detail-title" className="text-xl font-semibold leading-7">
            {order.name}
          </h2>
          <p className="mt-2 text-xs text-text-secondary">Артикул поставщика: {order.supplier_sku}</p>
          <div className="mt-4 flex gap-2">
            <OrderBadge urgency={order.urgency} />
            <OrderBadge status={order.status} />
          </div>
        </div>
        <p className="rounded-2xl bg-page-bg p-4 text-sm leading-6">{order.short_reason}</p>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => onEdit(order)}>Редактировать</Button>
          <Button variant="destructive" disabled={busy} onClick={() => onDelete(order)}><Icon name="trash" />Удалить</Button>
        </div>
        {order.has_explanation === false ? <p className="text-sm text-text-secondary">Для этой позиции нет сохранённого прогноза. Количество и обоснование можно задать вручную.</p> : isPending ? (
          <div role="status" className="space-y-3">
            <span className="sr-only">Загрузка обоснования</span>
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-page-bg" />
            ))}
          </div>
        ) : isError ? (
          <div role="alert" className="rounded-2xl border border-border p-4">
            <p className="mb-3 text-sm">Не удалось загрузить обоснование.</p>
            <Button variant="secondary" onClick={() => void refetch()}>
              Повторить
            </Button>
          </div>
        ) : (
          data && (
            <>
              <section className="rounded-2xl bg-page-bg p-5">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Icon name="spark" className="text-accent-text" />
                  Исходный прогноз
                </div>
                <p className="text-sm leading-6 text-text-secondary">{data.narrative}</p>
                {data.final_qty !== order.recommended_qty && <p className="mt-3 text-sm text-text-secondary">Исходное количество: {number(data.final_qty)} {order.unit}. Количество заказа изменено вручную.</p>}
              </section>
              <section>
                <h3 className="mb-4 text-sm font-semibold">Как рассчитана потребность</h3>
                <dl className="divide-y divide-border text-sm">
                  {[
                    [
                      'Базовый спрос',
                      'На горизонт выбранного расчёта',
                      `${number(data.base_demand)} ${order.unit}`,
                    ],
                    ['Сезонность', 'Изменение спроса в этом периоде', `× ${number(data.seasonality_factor)}`],
                    ['Рост спроса', 'Устойчивый тренд продаж', `× ${number(data.growth_factor)}`],
                    [
                      'Компенсация дефицита',
                      'Спрос за дни без товара',
                      `+ ${number(data.stockout_compensation)} ${order.unit}`,
                    ],
                    [
                      'Страховой запас',
                      'Буфер на колебания спроса',
                      `+ ${number(data.safety_buffer)} ${order.unit}`,
                    ],
                  ].map(([label, hint, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 py-3">
                      <dt>
                        {label}
                        <span className="mt-1 block text-xs text-text-secondary">{hint}</span>
                      </dt>
                      <dd className="shrink-0 font-semibold tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 rounded-xl bg-page-bg p-3 text-xs leading-5 text-text-secondary">
                  Спрос × сезонность × рост + компенсация + буфер − свободный остаток − товар в пути.
                  Итог учитывает правила округления и минимальной партии товара.
                </p>
              </section>
              <section>
                <h3 className="mb-4 text-sm font-semibold">Остатки и поставки</h3>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['На складе', data.current_stock],
                    ['В резерве', data.reserved_stock],
                    ['Свободно', data.free_stock],
                    ['В пути', data.goods_in_transit],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-border p-3">
                      <dt className="text-xs text-text-secondary">{label}</dt>
                      <dd className="mt-2 text-lg font-semibold tabular-nums">
                        {number(Number(value))}
                        <span className="ml-1 text-xs font-normal text-text-secondary">{order.unit}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-semibold">Исключённые оптовые продажи</h3>
                <p className="mb-3 text-xs leading-5 text-text-secondary">
                  Разовые крупные отгрузки не учтены в регулярном спросе.
                </p>
                {data.bulk_outliers_excluded.length ? (
                  <div className="overflow-hidden rounded-2xl border border-border">
                    <table className="w-full text-left text-xs">
                      <caption className="sr-only">Исключённые документы продаж</caption>
                      <thead className="bg-page-bg text-text-secondary">
                        <tr>
                          <th className="p-3">Дата</th>
                          <th className="p-3">Документ</th>
                          <th className="p-3 text-right">Объём</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.bulk_outliers_excluded.map((item) => (
                          <tr key={item.document} className="border-t border-border">
                            <td className="p-3">{new Date(item.date).toLocaleDateString('ru-RU')}</td>
                            <td className="p-3">{item.document}</td>
                            <td className="p-3 text-right tabular-nums">
                              {number(item.qty)} {order.unit}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rounded-xl bg-page-bg p-3 text-xs text-text-secondary">
                    Аномальных отгрузок не обнаружено.
                  </p>
                )}
              </section>
            </>
          )
        )}
      </div>
      <form
        className="mt-auto space-y-4 border-t border-border bg-page-bg p-6"
        onSubmit={(event) => {
          event.preventDefault();
          submit('approved');
        }}
      >
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-status-critical p-3 text-sm"
          >
            <Icon name="warning" className="shrink-0 text-status-critical" />
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm text-text-secondary">Рекомендовано</span>
          <strong className="text-xl tabular-nums">
            {number(order.recommended_qty)} <span className="text-sm font-normal">{order.unit}</span>
          </strong>
        </div>
        <label className="block text-sm font-medium" htmlFor="detail-quantity">
          Количество к утверждению
          <input
            id="detail-quantity"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            className={`${inputClass} mt-2 w-full tabular-nums`}
            aria-invalid={attempted && parsed === null}
            aria-describedby={attempted && parsed === null ? 'quantity-error' : undefined}
            disabled={busy}
          />
        </label>
        {attempted && parsed === null && (
          <p id="quantity-error" role="alert" className="flex items-center gap-2 text-xs text-text-secondary">
            <Icon name="warning" className="shrink-0 text-status-critical" />
            Введите число больше 0 и не больше 1 000 000.
          </p>
        )}
        <label className="block text-sm font-medium" htmlFor="detail-comment">
          Комментарий <span className="font-normal text-text-secondary">· необязательно</span>
          <textarea
            id="detail-comment"
            rows={2}
            maxLength={500}
            value={comment}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
            className={`${inputClass} mt-2 w-full resize-y`}
            placeholder="Причина корректировки или отклонения"
          />
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={busy} className="flex-1">
            <Icon name="check" />
            {busy ? 'Сохраняем…' : 'Утвердить'}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => submit('rejected')}
          >
            Отклонить
          </Button>
        </div>
        <p className="flex items-start gap-2 text-xs leading-5 text-text-secondary">
          <Icon name="info" width="16" height="16" className="mt-0.5 shrink-0" />
          Утверждение не отправляет заказ поставщику автоматически.
        </p>
      </form>
    </Dialog>
  );
}
