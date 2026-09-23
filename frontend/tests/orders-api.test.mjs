import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApi } from './load-api.mjs';
const api = await loadApi('orders');

test('order CRUD, catalog search and decisions use the production API contract', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    return Response.json({ id: 'o/1', fromServer: true });
  });
  const order = { id: 'o/1', run_id: 'r/1' };
  const fields = { recommended_qty: 1.25, urgency: 'high', short_reason: 'Пополнение', comment: null };
  const body = { ...fields, sku_code: '001', run_id: 'r/1' };
  assert.equal((await api.createOrder(body)).fromServer, true);
  await api.getOrder(order.run_id, order.id);
  await api.updateOrder(order, fields);
  await api.decideOrder(order, 0.5, 'approved', 'Проверено');
  await api.decideOrder(order, 0, 'rejected', 'Отмена');
  await api.deleteOrder(order);
  await api.findOrderProducts('a&b');
  await api.getRecommendations(order.run_id);
  assert.deepEqual(calls.map(c => [c.init?.method ?? 'GET', c.url]), [
    ['POST', '/api/recommendations'],
    ['GET', '/api/recommendations/o%2F1'],
    ['PUT', '/api/recommendations/o%2F1'],
    ['POST', '/api/recommendations/o%2F1/approve'],
    ['POST', '/api/recommendations/o%2F1/reject'],
    ['DELETE', '/api/recommendations/o%2F1'],
    ['GET', '/api/input-data/products?limit=50&search=a%26b'],
    ['GET', '/api/recommendations?run_id=r%2F1'],
  ]);
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
  assert.deepEqual(JSON.parse(calls[2].init.body), fields);
  assert.deepEqual(JSON.parse(calls[3].init.body), { approved_qty: 0.5, comment: 'Проверено' });
  assert.deepEqual(JSON.parse(calls[4].init.body), { comment: 'Отмена' });
});

test('order server errors are surfaced, with no fallback to demo data', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ detail: 'Этот товар уже есть в выбранном расчёте' }, { status: 409 }));
  await assert.rejects(api.createOrder({}), /уже есть/);
  fetch.mock.mockImplementation(async () => Response.json({ detail: [] }, { status: 422 }));
  await assert.rejects(api.updateOrder({ id: '1' }, {}), /422/);
  fetch.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.getOrder('r1', '1'), /Сервер недоступен/);
});
