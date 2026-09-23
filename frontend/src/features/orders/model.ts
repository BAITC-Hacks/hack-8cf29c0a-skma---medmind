import type { OrderRecommendation, OrderStatus, Urgency } from '../../shared/api/types.ts';

export const urgencyLabels: Record<Urgency, string> = { high: 'Высокая', medium: 'Средняя', low: 'Низкая' };
export const statusLabels: Record<OrderStatus, string> = {
  pending: 'Ожидает',
  approved: 'Утверждено',
  rejected: 'Отклонено',
};
export const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
export const inputClass =
  'min-h-11 rounded-2xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none hover:border-accent-text focus-visible:ring-2 focus-visible:ring-accent-focus-ring';

export interface OrderFilters {
  search: string;
  suppliers: string[];
  categories: string[];
  urgency: string;
  status: string;
}
export const emptyFilters: OrderFilters = {
  search: '',
  suppliers: [],
  categories: [],
  urgency: '',
  status: '',
};
export type SortKey =
  'sku_code' | 'name' | 'category_id' | 'recommended_qty' | 'approved_qty' | 'urgency' | 'status';

export function filterOrders(orders: OrderRecommendation[], filters: OrderFilters) {
  const search = filters.search.trim().toLocaleLowerCase('ru-RU');
  return orders.filter(
    (order) =>
      (!search ||
        `${order.sku_code} ${order.supplier_sku} ${order.name}`
          .toLocaleLowerCase('ru-RU')
          .includes(search)) &&
      (!filters.suppliers.length || filters.suppliers.includes(order.supplier_id)) &&
      (!filters.categories.length || filters.categories.includes(order.category_id)) &&
      (!filters.urgency || order.urgency === filters.urgency) &&
      (!filters.status || order.status === filters.status),
  );
}

export function sortOrders(
  orders: OrderRecommendation[],
  key: SortKey,
  direction: 'asc' | 'desc',
  drafts: Record<string, string> = {},
  categoryNames: Record<string, string> = {},
) {
  const urgencyRank = { high: 0, medium: 1, low: 2 };
  const statusRank = { pending: 0, approved: 1, rejected: 2 };
  const value = (order: OrderRecommendation): string | number =>
    key === 'urgency'
      ? urgencyRank[order.urgency]
      : key === 'status'
        ? statusRank[order.status]
        : key === 'approved_qty'
          ? ((order.status === 'pending' && order.id in drafts
              ? parseQuantity(drafts[order.id])
              : order.approved_qty) ?? order.recommended_qty)
          : key === 'category_id'
            ? (categoryNames[order.category_id] ?? order.category_id)
            : order[key];
  return [...orders].sort((a, b) => {
    const av = value(a),
      bv = value(b);
    return (
      (typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv), 'ru')) * (direction === 'asc' ? 1 : -1)
    );
  });
}

export function parseQuantity(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const quantity = Number(value);
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 1_000_000 ? quantity : null;
}

export function ordersToCsv(orders: OrderRecommendation[], categoryNames: Record<string, string>) {
  const cell = (value: string | number | null) => {
    const text = String(value ?? '');
    // Quoting alone does not prevent a spreadsheet from executing a formula.
    const safe = /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  const rows = [
    [
      'Расчёт',
      'Код 1С',
      'Артикул поставщика',
      'Наименование',
      'Поставщик',
      'Категория',
      'Рекомендовано',
      'Утверждено',
      'Ед.',
      'Срочность',
      'Статус',
      'Комментарий',
    ],
    ...orders.map((o) => [
      o.run_id,
      o.sku_code,
      o.supplier_sku,
      o.name,
      o.supplier_name,
      categoryNames[o.category_id] ?? o.category_id,
      o.recommended_qty,
      o.approved_qty,
      o.unit,
      urgencyLabels[o.urgency],
      statusLabels[o.status],
      o.comment ?? '',
    ]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(cell).join(';')).join('\r\n');
}
