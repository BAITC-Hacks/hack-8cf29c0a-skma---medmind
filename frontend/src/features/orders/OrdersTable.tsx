import { Fragment, useEffect, useRef, useState } from 'react';
import type { OrderRecommendation, Supplier } from '../../shared/api/types';
import { Icon } from '../../shared/ui/Icon';
import { OrderBadge } from './OrderBadge';
import { inputClass, number, parseQuantity, type SortKey } from './model';

function Checkbox({
  checked,
  mixed = false,
  label,
  onChange,
}: {
  checked: boolean;
  mixed?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      onClick={(event) => event.stopPropagation()}
      className="h-4 w-4 cursor-pointer rounded border-border accent-accent-solid focus-visible:outline-accent-focus-ring"
    />
  );
}

const columns: { key: SortKey; label: string; className?: string }[] = [
  { key: 'sku_code', label: 'Артикул', className: 'w-40' },
  { key: 'name', label: 'Наименование', className: 'min-w-[230px]' },
  { key: 'category_id', label: 'Категория', className: 'w-36' },
  { key: 'recommended_qty', label: 'Рекомендовано', className: 'text-right' },
  { key: 'approved_qty', label: 'К утверждению', className: 'w-32 text-right' },
  { key: 'urgency', label: 'Срочность' },
  { key: 'status', label: 'Статус' },
];

export function OrdersTable({
  rows,
  filtered,
  suppliers,
  categoryNames,
  selected,
  sort,
  draft,
  onDraft,
  onSort,
  onSelect,
  onOpen,
}: {
  rows: OrderRecommendation[];
  filtered: OrderRecommendation[];
  suppliers: Supplier[];
  categoryNames: Record<string, string>;
  selected: Set<string>;
  sort: { key: SortKey; direction: 'asc' | 'desc' };
  draft: (order: OrderRecommendation) => string;
  onDraft: (id: string, value: string) => void;
  onSort: (key: SortKey) => void;
  onSelect: (orders: OrderRecommendation[], checked: boolean) => void;
  onOpen: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const selection = (items: OrderRecommendation[]) => ({
    checked: items.length > 0 && items.every((order) => selected.has(order.id)),
    mixed: items.some((order) => selected.has(order.id)) && !items.every((order) => selected.has(order.id)),
  });
  return (
    <div
      className="relative overflow-x-auto"
      role="region"
      aria-label="Таблица рекомендаций, прокрутка по горизонтали"
      tabIndex={0}
    >
      <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
        <caption className="sr-only">Рекомендации к заказу, сгруппированные по поставщику</caption>
        <thead className="border-y border-border bg-page-bg text-xs text-text-secondary">
          <tr>
            <th className="w-12 px-5 py-4">
              <Checkbox
                {...selection(rows)}
                label="Выбрать все позиции на странице"
                onChange={(checked) => onSelect(rows, checked)}
              />
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort.key === column.key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className={`px-3 py-4 font-medium ${column.className ?? ''}`}
              >
                <button
                  type="button"
                  onClick={() => onSort(column.key)}
                  className="inline-flex items-center gap-1.5 rounded-lg text-left hover:text-accent-text active:text-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
                >
                  {column.label}
                  <Icon
                    name={sort.key === column.key ? 'chevron' : 'sort'}
                    width="12"
                    height="12"
                    className={
                      sort.key === column.key
                        ? sort.direction === 'asc'
                          ? '-rotate-90 text-accent-text'
                          : 'rotate-90 text-accent-text'
                        : ''
                    }
                  />
                </button>
              </th>
            ))}
            <th className="w-12">
              <span className="sr-only">Обоснование</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {suppliers.map((supplier) => {
            const group = rows.filter((order) => order.supplier_id === supplier.id);
            if (!group.length) return null;
            const total = filtered.filter((order) => order.supplier_id === supplier.id).length;
            return (
              <Fragment key={supplier.id}>
                <tr className="border-b border-border bg-page-bg">
                  <td className="px-5 py-3">
                    <Checkbox
                      label={`Выбрать позиции ${supplier.name} на странице`}
                      {...selection(group)}
                      onChange={(checked) => onSelect(group, checked)}
                    />
                  </td>
                  <th colSpan={8} scope="rowgroup" className="p-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-3 text-left hover:bg-accent-subtle-bg active:bg-page-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-focus-ring"
                      aria-expanded={!collapsed.has(supplier.id)}
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (next.has(supplier.id)) next.delete(supplier.id);
                          else next.add(supplier.id);
                          return next;
                        })
                      }
                    >
                      <Icon
                        name="chevron"
                        width="15"
                        height="15"
                        className={`text-text-secondary ${collapsed.has(supplier.id) ? '' : 'rotate-90'}`}
                      />
                      <span className="flex h-8 min-w-8 items-center justify-center rounded-xl border border-border bg-surface px-1.5 text-[10px] font-bold text-accent-text">
                        {supplier.name.slice(0, 3).toUpperCase()}
                      </span>
                      <span className="font-semibold">{supplier.name}</span>
                      <span className="text-xs font-normal text-text-secondary">
                        Позиций: {total}{group.length < total && ` · ${group.length} на странице`}
                      </span>
                      <span className="ml-auto pr-3 text-xs font-normal text-text-secondary">
                        Поставка · {supplier.lead_time_days} дней
                      </span>
                    </button>
                  </th>
                </tr>
                {!collapsed.has(supplier.id) &&
                  group.map((order) => (
                    <tr
                      key={order.id}
                      onClick={() => onOpen(order.id)}
                      className={`cursor-pointer border-b border-border transition-colors hover:bg-page-bg ${selected.has(order.id) ? 'bg-accent-subtle-bg' : ''}`}
                    >
                      <td className="px-5 py-5" onClick={(event) => event.stopPropagation()}>
                        <Checkbox
                          label={`Выбрать ${order.sku_code}`}
                          checked={selected.has(order.id)}
                          onChange={(checked) => onSelect([order], checked)}
                        />
                      </td>
                      <td className="px-3 py-5">
                        <span className="block text-xs font-medium tabular-nums">{order.sku_code}</span>
                        <span className="mt-1.5 block max-w-36 break-words text-[11px] leading-4 text-text-secondary">
                          {order.supplier_sku}
                        </span>
                      </td>
                      <td className="px-3 py-5">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(order.id);
                          }}
                          className="rounded-md text-left text-sm font-medium leading-5 hover:text-accent-text active:text-accent-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
                        >
                          {order.name}
                        </button>
                        <span className="mt-1.5 block text-xs leading-5 text-text-secondary">
                          {order.short_reason}
                        </span>
                      </td>
                      <td className="px-3 py-5">
                        <span className="inline-block rounded-lg bg-page-bg px-2 py-1 text-[11px] leading-4 text-text-secondary">
                          {categoryNames[order.category_id] ?? order.category_id}
                        </span>
                      </td>
                      <td className="px-3 py-5 text-right tabular-nums">
                        <strong className="font-semibold">{number(order.recommended_qty)}</strong>
                        <span className="mt-1 block text-xs text-text-secondary">{order.unit}</span>
                      </td>
                      <td className="px-3 py-5 text-right" onClick={(event) => event.stopPropagation()}>
                        {order.status === 'pending' ? (
                          <>
                            <input
                              aria-label={`Количество ${order.sku_code}`}
                              inputMode="decimal"
                              autoComplete="off"
                              value={draft(order)}
                              onChange={(event) => onDraft(order.id, event.target.value)}
                              aria-invalid={parseQuantity(draft(order)) === null}
                              aria-describedby={
                                parseQuantity(draft(order)) === null ? `invalid-${order.id}` : undefined
                              }
                              className={`${inputClass} w-24 !rounded-xl text-right tabular-nums ${parseQuantity(draft(order)) === null ? '!border-status-critical' : ''}`}
                            />
                            {parseQuantity(draft(order)) === null && (
                              <span
                                id={`invalid-${order.id}`}
                                className="mt-1 block max-w-24 text-[10px] text-text-secondary"
                              >
                                Больше 0, до 1 000 000
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="tabular-nums">
                            {order.approved_qty === null ? '—' : number(order.approved_qty)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-5">
                        <OrderBadge urgency={order.urgency} />
                      </td>
                      <td className="px-3 py-5">
                        <OrderBadge status={order.status} />
                      </td>
                      <td className="px-2 py-5">
                        <button
                          type="button"
                          aria-label={`Обоснование ${order.sku_code}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(order.id);
                          }}
                          className="flex h-10 w-10 items-center justify-center rounded-xl text-text-secondary hover:bg-accent-subtle-bg hover:text-accent-text active:bg-page-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-focus-ring"
                        >
                          <Icon name="chevron" width="17" height="17" />
                        </button>
                      </td>
                    </tr>
                  ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
