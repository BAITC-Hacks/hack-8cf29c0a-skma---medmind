import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { approveAssistantOrder, getAssistantOrder } from '../../shared/api/assistant';
import type { OrderRecommendation } from '../../shared/api/types';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { OrderBadge } from '../orders/OrderBadge';
import { inputClass, number, parseQuantity } from '../orders/model';

export function OrderApproval({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ['assistant-order', id], queryFn: () => getAssistantOrder(id), staleTime: 0 });
  if (query.isFetching || !query.data || query.isError) return (
    <Dialog labelledBy="assistant-order-title" onClose={onClose}>
      <h2 id="assistant-order-title" className="text-xl font-semibold">Заказ</h2>
      <p className="mt-4 text-sm text-text-secondary" role={query.isError ? 'alert' : 'status'}>
        {query.isError ? query.error.message : 'Загрузка актуального заказа…'}
      </p>
      <div className="mt-6 flex gap-3">
        {query.isError && <Button onClick={() => void query.refetch()}>Повторить</Button>}
        <Button variant="secondary" onClick={onClose}>Закрыть</Button>
      </div>
    </Dialog>
  );
  return <ApprovalForm key={id} order={query.data} onClose={onClose} />;
}

function ApprovalForm({ order, onClose }: { order: OrderRecommendation; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = useState(String(order.approved_qty ?? order.recommended_qty));
  const [comment, setComment] = useState(order.comment ?? '');
  const [attempted, setAttempted] = useState(false);
  const parsed = parseQuantity(quantity);
  const approved = order.status === 'approved';
  const approval = useMutation({
    mutationFn: () => approveAssistantOrder(order.id, parsed!, comment.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(['assistant-order', order.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['orders'] });
      void queryClient.invalidateQueries({ queryKey: ['order', order.id] });
    },
  });
  return (
    <Dialog labelledBy="assistant-order-title" onClose={() => { if (!approval.isPending) onClose(); }}>
      <form className="space-y-4" onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        if (parsed !== null && !approved && !approval.isPending) approval.mutate();
      }}>
        <h2 id="assistant-order-title" className="text-xl font-semibold">{order.name}</h2>
        <p className="text-sm text-text-secondary">{order.supplier_name} · {order.sku_code}</p>
        <div className="flex flex-wrap gap-2"><OrderBadge status={order.status} /><OrderBadge urgency={order.urgency} /></div>
        <p className="text-sm leading-6 text-text-secondary">{order.short_reason}</p>
        <p className="text-sm">Рекомендовано: <strong>{number(order.recommended_qty)} {order.unit}</strong></p>
        {approved ? (
          <p role="status" className="text-sm">Заказ утверждён: {number(order.approved_qty ?? order.recommended_qty)} {order.unit}.</p>
        ) : (
          <>
            <label className="block text-sm font-medium" htmlFor="assistant-order-quantity">
              Количество к утверждению, {order.unit}
              <input id="assistant-order-quantity" className={`${inputClass} mt-2 w-full`} inputMode="decimal"
                value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={approval.isPending}
                aria-invalid={attempted && parsed === null} aria-describedby={attempted && parsed === null ? 'assistant-quantity-error' : undefined} />
            </label>
            {attempted && parsed === null && <p id="assistant-quantity-error" role="alert" className="text-sm text-text-secondary">Введите количество больше 0 и не больше 1 000 000.</p>}
            <label className="block text-sm font-medium" htmlFor="assistant-order-comment">
              Комментарий
              <textarea id="assistant-order-comment" className={`${inputClass} mt-2 w-full`} rows={2} maxLength={500}
                value={comment} onChange={(e) => setComment(e.target.value)} disabled={approval.isPending} />
            </label>
          </>
        )}
        {approval.isError && <p role="alert" className="rounded-xl border border-status-critical p-3 text-sm">{approval.error.message}</p>}
        <p className="text-xs leading-5 text-text-secondary">Утверждение не отправляет заказ поставщику автоматически.</p>
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="secondary" onClick={onClose} disabled={approval.isPending}>Закрыть</Button>
          {!approved && <Button type="submit" disabled={approval.isPending}>{approval.isPending ? 'Сохраняем…' : 'Утвердить'}</Button>}
        </div>
      </form>
    </Dialog>
  );
}
