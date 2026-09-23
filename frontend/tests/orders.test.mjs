import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockRun } from '../src/features/orders/mock.ts';
import {
  emptyFilters,
  filterOrders,
  ordersToCsv,
  parseQuantity,
  sortOrders,
} from '../src/features/orders/model.ts';

const latest = createMockRun('run-2026-09-23');

test('demo runs have isolated identities, varied values and no data for failed runs', () => {
  const previous = createMockRun('run-2026-09-16');
  assert.equal(latest.orders.length, 20);
  assert.equal(new Set(latest.orders.map((order) => order.supplier_id)).size, 2);
  assert.equal(new Set(latest.orders.map((order) => order.status)).size, 3);
  assert.equal(new Set(latest.orders.map((order) => order.urgency)).size, 3);
  assert.notEqual(latest.orders[0].id, previous.orders[0].id);
  assert.notEqual(latest.orders[0].recommended_qty, previous.orders[0].recommended_qty);
  assert.deepEqual(createMockRun('run-2026-09-02').orders, []);
  assert.deepEqual(createMockRun('unknown').orders, []);
});

test('every explanation reconciles with its recommendation and historical date', () => {
  for (const id of ['run-2026-09-23', 'run-2026-09-16', 'run-2026-09-09', 'run-2026-08-26']) {
    const data = createMockRun(id);
    data.orders.forEach((order) => {
      const detail = data.explanations.find((item) => item.sku_code === order.sku_code);
      assert.ok(detail);
      assert.equal(detail.free_stock, detail.current_stock - detail.reserved_stock);
      assert.equal(detail.final_qty, order.recommended_qty);
      assert.equal(
        order.recommended_qty,
        Math.max(
          0,
          Math.ceil(
            detail.base_demand * detail.seasonality_factor * detail.growth_factor +
              detail.stockout_compensation +
              detail.safety_buffer -
              detail.free_stock -
              detail.goods_in_transit,
          ),
        ),
      );
      assert.ok(order.recommended_qty > 0);
      detail.bulk_outliers_excluded.forEach((item) => assert.ok(item.date < id.slice(4)));
    });
  }
});

test('all four filters and case-insensitive search combine without leaking hidden rows', () => {
  const result = filterOrders(latest.orders, {
    search: '  ва47  ',
    suppliers: ['iek'],
    categories: ['protection'],
    urgency: 'high',
    status: 'pending',
  });
  assert.deepEqual(
    result.map((order) => order.sku_code),
    ['00018452', '00018453'],
  );
  assert.equal(filterOrders(latest.orders, { ...emptyFilters, search: 'ez9f34116' })[0].sku_code, '00060211');
  assert.equal(filterOrders(latest.orders, { ...emptyFilters, search: '00018452' }).length, 1);
  assert.equal(filterOrders(latest.orders, { ...emptyFilters, suppliers: ['iek', 'se'] }).length, 20);
  assert.equal(filterOrders(latest.orders, { ...emptyFilters, search: 'nonexistent' }).length, 0);
});

test('quantity validation rejects zero, negatives, fractions, exponent syntax and unsafe ranges', () => {
  for (const value of ['', ' ', '0', '-1', '1.5', '1e3', 'NaN', 'Infinity', '1000001', '9007199254740993'])
    assert.equal(parseQuantity(value), null, value);
  assert.equal(parseQuantity(' 320 '), 320);
  assert.equal(parseQuantity('1000000'), 1000000);
});

test('sorting uses numbers, urgency and edited quantities, preserving the input array', () => {
  const before = latest.orders.map((order) => order.id);
  const ascending = sortOrders(latest.orders, 'recommended_qty', 'asc');
  assert.ok(
    ascending.every((order, i) => i === 0 || ascending[i - 1].recommended_qty <= order.recommended_qty),
  );
  assert.equal(sortOrders(latest.orders, 'urgency', 'asc')[0].urgency, 'high');
  assert.equal(sortOrders(latest.orders, 'urgency', 'desc')[0].urgency, 'low');
  assert.equal(
    sortOrders(latest.orders, 'approved_qty', 'desc', { [latest.orders[0].id]: '9999' })[0].id,
    latest.orders[0].id,
  );
  assert.deepEqual(
    latest.orders.map((order) => order.id),
    before,
  );
});

test('CSV includes only passed rows, approved quantities and spreadsheet-safe escaped text', () => {
  const row = {
    ...latest.orders[0],
    approved_qty: 320,
    status: 'approved',
    name: 'Товар; "особый"',
    comment: '=HYPERLINK("example")',
  };
  const csv = ordersToCsv([row], { protection: 'Модульное оборудование' });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.equal(csv.split('\r\n').length, 2);
  assert.ok(csv.includes('"Товар; ""особый"""'));
  assert.ok(csv.includes('"\'=HYPERLINK(""example"")"'));
  assert.ok(csv.includes('"320"'));
  assert.ok(csv.includes('"00018452"'));
  assert.ok(!csv.includes('00018453'));
});
