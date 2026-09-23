import fixture from '../../shared/api/fixtures/orders.json' with { type: 'json' };

export interface Sale {
  id: string;
  date: string;
  document: string;
  sku: string;
  supplierSku: string;
  name: string;
  supplierId: string;
  supplier: string;
  categoryId: string;
  category: string;
  unit: string;
  quantity: number;
  price: number;
  amount: number;
  operation: 'sale' | 'return';
  bulk: boolean;
}
export interface SalesFilters {
  search: string;
  from: string;
  to: string;
  supplier: string;
  category: string;
  kind: string;
}
export const demoEnd = '2026-09-23';
export const demoStart = '2026-08-25';
export const defaultFilters: SalesFilters = {
  search: '',
  from: '2026-09-01',
  to: demoEnd,
  supplier: '',
  category: '',
  kind: '',
};
export const suppliers = fixture.suppliers;
export const categories = fixture.categories;
export const formatNumber = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
export const money = (value: number) => `${formatNumber(value)} ₸`;
export const dateLabel = (date: string) => date.split('-').reverse().join('.');

// Fixed, synthetic transactions: no network requests and no customer data.
export const sales: Sale[] = Array.from({ length: 90 }, (_, index): Sale => {
  const day = Math.floor(index / 3);
  const product = fixture.products[(index * 7) % fixture.products.length];
  const date = new Date(Date.UTC(2026, 7, 25 + day)).toISOString().slice(0, 10);
  const returned = index % 13 === 8;
  const bulk = !returned && index % 17 === 4;
  const quantity = ((index % 7) + 2) * (product.unit === 'м' ? 10 : 1) * (bulk ? 15 : 1);
  const price = product.unit === 'м' ? 180 + (index % 3) * 25 : 950 + fixture.products.indexOf(product) * 275;
  return {
    id: `sale-${index + 1}`,
    date,
    document: `${returned ? 'ВЗ' : 'РТ'}-${String(10400 + index).padStart(6, '0')}`,
    sku: product.sku_code,
    supplierSku: product.supplier_sku,
    name: product.name,
    supplierId: product.supplier_id,
    supplier: suppliers.find((item) => item.id === product.supplier_id)!.name,
    categoryId: product.category_id,
    category: categories.find((item) => item.id === product.category_id)!.name,
    unit: product.unit,
    quantity,
    price,
    amount: quantity * price * (returned ? -1 : 1),
    operation: returned ? 'return' : 'sale',
    bulk,
  };
}).reverse();

export function filterSales(rows: Sale[], filters: SalesFilters) {
  const search = filters.search.trim().toLocaleLowerCase('ru');
  if (filters.from && filters.to && filters.from > filters.to) return [];
  return rows.filter(
    (row) =>
      (!filters.from || row.date >= filters.from) &&
      (!filters.to || row.date <= filters.to) &&
      (!filters.supplier || row.supplierId === filters.supplier) &&
      (!filters.category || row.categoryId === filters.category) &&
      (!filters.kind || (filters.kind === 'bulk' ? row.bulk : row.operation === filters.kind)) &&
      (!search ||
        `${row.document} ${row.sku} ${row.supplierSku} ${row.name}`.toLocaleLowerCase('ru').includes(search)),
  );
}
export function summarizeSales(rows: Sale[]) {
  const units: Record<string, number> = {};
  rows.forEach((row) => {
    units[row.unit] = (units[row.unit] ?? 0) + row.quantity * (row.operation === 'return' ? -1 : 1);
  });
  return {
    revenue: rows.reduce((sum, row) => sum + row.amount, 0),
    documents: new Set(rows.map((row) => row.document)).size,
    returns: rows.filter((row) => row.operation === 'return').length,
    skus: new Set(rows.map((row) => row.sku)).size,
    units,
  };
}
export function salesTrend(rows: Sale[]) {
  const daily = new Map<string, number>();
  rows.forEach((row) => daily.set(row.date, (daily.get(row.date) ?? 0) + row.amount));
  return [...daily].sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => ({ date, amount }));
}
export type SalesSort = 'date' | 'name' | 'quantity' | 'amount';
export function sortSales(rows: Sale[], key: SalesSort, ascending: boolean) {
  return [...rows].sort((a, b) => {
    const av = key === 'quantity' ? a.quantity * (a.operation === 'return' ? -1 : 1) : a[key];
    const bv = key === 'quantity' ? b.quantity * (b.operation === 'return' ? -1 : 1) : b[key];
    const comparison =
      typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'ru');
    return comparison * (ascending ? 1 : -1) || b.id.localeCompare(a.id);
  });
}
export function salesCsv(rows: Sale[]) {
  const cell = (value: string | number) => {
    const text = typeof value === 'string' && /^\s*[=+@-]/.test(value) ? `'${value}` : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [
      [
        'Дата',
        'Документ',
        'Код 1С',
        'Артикул',
        'Товар',
        'Поставщик',
        'Категория',
        'Операция',
        'Количество',
        'Ед.',
        'Цена, KZT',
        'Сумма, KZT',
        'Оптовая',
      ],
      ...rows.map((row) => [
        row.date,
        row.document,
        row.sku,
        row.supplierSku,
        row.name,
        row.supplier,
        row.category,
        row.operation === 'sale' ? 'Продажа' : 'Возврат',
        row.quantity,
        row.unit,
        row.price,
        row.amount,
        row.bulk ? 'Да' : 'Нет',
      ]),
    ]
      .map((row) => row.map(cell).join(';'))
      .join('\r\n')
  );
}
