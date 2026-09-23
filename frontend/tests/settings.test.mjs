import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApi as loadSharedApi } from './load-api.mjs';
import { draftChanged, numberError, paramsDraft, validateParams } from '../src/pages/SettingsPage/model.ts';

test('settings reject empty, non-finite and fractional day values; allow boundary values', () => {
  for (const invalid of ['', ' ', 'Infinity', 'NaN', 'abc', '-1', '366', '1.5']) {
    assert.ok(numberError(invalid, 1, 365, true), invalid);
  }
  const draft = paramsDraft({ forecast_horizon_days: 365, safety_buffer_days: 0, outlier_sensitivity: 1 });
  assert.ok(Object.values(validateParams(draft)).every(error => error === ''));
  assert.ok(validateParams({ ...draft, forecast_horizon_days: '0' }).forecast_horizon_days);
  assert.ok(validateParams({ ...draft, outlier_sensitivity: '1.01' }).outlier_sensitivity);
  assert.equal(numberError('0', 0), '');
  assert.equal(numberError('1.5', 1), '');
  assert.ok(numberError('0.5', 1));
});

test('dirty detection compares numerical meaning but never treats a blank field as zero', () => {
  assert.equal(draftChanged({ safety_buffer_days: '' }, { safety_buffer_days: 0 }), true);
  assert.equal(draftChanged({ safety_buffer_days: '00' }, { safety_buffer_days: 0 }), false);
  assert.equal(draftChanged({ order_multiple: '5.0' }, { id: '1', order_multiple: 5 }), false);
  assert.equal(draftChanged({ order_multiple: '6' }, { id: '1', order_multiple: 5 }), true);
});

const loadApi = () => loadSharedApi('settings');

test('server contract uses separate supplier lead times, numeric bodies and encoded identifiers', async t => {
  const api = await loadApi();
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : null });
    return Response.json({ ok: true });
  });
  await api.getSettings();
  await api.saveCalcParams({ forecast_horizon_days: 14, safety_buffer_days: 0, outlier_sensitivity: 0.5 });
  await api.saveSupplierRule('rule/1', { min_order_qty: 0, order_multiple: 1.5 });
  await api.saveSupplierLeadTime('supplier/1', 21);
  await api.startCalculation();
  await api.getCalculation('run/1');
  assert.deepEqual(calls.map(c => [c.url, c.method]), [
    ['/api/settings/calc-params', 'GET'], ['/api/suppliers', 'GET'], ['/api/settings/supplier-rules', 'GET'],
    ['/api/settings/calc-params', 'PUT'], ['/api/settings/supplier-rules/rule%2F1', 'PUT'],
    ['/api/suppliers/supplier%2F1', 'PUT'], ['/api/calc-runs', 'POST'], ['/api/calc-runs/run%2F1', 'GET'],
  ]);
  assert.deepEqual(calls[4].body, { min_order_qty: 0, order_multiple: 1.5 });
  assert.deepEqual(calls[5].body, { lead_time_days: 21 });
  assert.deepEqual(calls[6].body, {});
});

test('server failures propagate without silently saving demo data', async t => {
  const api = await loadApi();
  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({ detail: 'Расчёт уже выполняется' }, { status: 409 }));
  await assert.rejects(api.startCalculation(), /Расчёт уже выполняется/);
  fetch.mock.mockImplementation(async () => new Response('offline', { status: 503 }));
  await assert.rejects(api.saveSupplierLeadTime('iek', 7), /503/);
  fetch.mock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(api.getSettings(), /Сервер недоступен/);
});
