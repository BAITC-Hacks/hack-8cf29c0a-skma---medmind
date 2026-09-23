import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sales,
  defaultFilters,
  filterSales,
  summarizeSales,
  salesTrend,
  salesCsv,
  sortSales,
} from '../src/features/sales/model.ts';

test('sales filters combine search, date boundaries, supplier, category and operation', () => {
  const row = sales.find((item) => item.operation === 'sale' && item.date >= defaultFilters.from);
  const filters = {
    ...defaultFilters,
    from: row.date,
    to: row.date,
    search: row.supplierSku.toLowerCase(),
    supplier: row.supplierId,
    category: row.categoryId,
    kind: 'sale',
  };
  assert.deepEqual(
    filterSales(sales, filters).map((item) => item.id),
    [row.id],
  );
  assert.equal(filterSales(sales, { ...filters, from: '2026-10-01' }).length, 0);
  assert.equal(filterSales(sales, { ...defaultFilters, search: 'нет-такого-товара' }).length, 0);
  assert.ok(
    filterSales(sales, { ...defaultFilters, kind: 'bulk' }).every(
      (item) => item.bulk && item.operation === 'sale',
    ),
  );
});

test('returns subtract from revenue and units; chart totals reconcile with filtered rows', () => {
  const rows = filterSales(sales, defaultFilters);
  const result = summarizeSales(rows);
  assert.equal(
    result.revenue,
    rows.filter((row) => row.operation === 'sale').reduce((sum, row) => sum + row.price * row.quantity, 0) -
      rows
        .filter((row) => row.operation === 'return')
        .reduce((sum, row) => sum + row.price * row.quantity, 0),
  );
  assert.equal(
    salesTrend(rows).reduce((sum, day) => sum + day.amount, 0),
    result.revenue,
  );
  const returns = filterSales(sales, { ...defaultFilters, kind: 'return' });
  assert.ok(summarizeSales(returns).revenue < 0);
  assert.ok(Object.values(summarizeSales(returns).units).every((value) => value < 0));
  assert.equal(summarizeSales([]).revenue, 0);
});

test('numeric sorting does not mutate source transactions', () => {
  const ids = sales.map((row) => row.id);
  const sorted = sortSales(sales, 'amount', true);
  assert.ok(sorted.every((row, index) => !index || sorted[index - 1].amount <= row.amount));
  assert.deepEqual(
    sales.map((row) => row.id),
    ids,
  );
  assert.equal(sortSales(sales, 'quantity', true)[0].operation, 'return');
});

test('CSV exports the chosen rows and keeps return amounts numeric', () => {
  const row = sales.find((item) => item.operation === 'return');
  const csv = salesCsv([{ ...row, name: '=FORMULA("test")' }]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.split('\r\n').length, 2);
  assert.ok(csv.includes(`"${row.amount}"`));
  assert.ok(csv.includes('"\'=FORMULA(""test"")"'));
  assert.ok(csv.includes('"Возврат"'));
});
