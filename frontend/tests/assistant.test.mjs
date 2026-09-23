import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeFile,
  formatBytes,
  formatPeriod,
  parseInline,
  parseMarkdown,
  seriesSlot,
  seriesStroke,
  summarizeTools,
  validateFile,
  yDomain,
  isOrderLink,
} from '../src/features/assistant/model.ts';
import { MOCK_NOTICE, mockReply } from '../src/features/assistant/mock.ts';

test('order links render next to products; unsafe and unrelated URLs stay plain text', () => {
  const href = '/assistant?c=conv-1&order=rec_2';
  assert.deepEqual(parseInline(`Кабель — [Открыть заказ и утвердить](${href})`), [
    { type: 'text', text: 'Кабель — ' }, { type: 'link', text: 'Открыть заказ и утвердить', href },
  ]);
  for (const url of ['javascript:alert(1)', '//evil.test', 'https://evil.test', '/orders',
    '/assistant?c=x', '/assistant?c=x&order=y&approve=true', '/assistant?c=x&order=y#hash',
    '/assistant?c=x&order=%0a', '/assistant?c=x&c=y']) {
    assert.equal(isOrderLink(url), false, url);
    assert.ok(parseInline(`[Ссылка](${url})`).every((part) => part.type !== 'link'));
  }
});

test('markdown: paragraphs, headings, both list types, bold and code — no HTML passthrough', () => {
  const blocks = parseMarkdown(
    '## Итог\nСпрос **вырос**\nна 5%.\n\n- первый `030200192_`\n- второй\n\n1. раз\n2. два\n\n<b>не html</b>',
  );
  assert.deepEqual(blocks.map((b) => b.type), ['h', 'p', 'ul', 'ol', 'p']);
  assert.deepEqual(blocks[1].inline, [
    { type: 'text', text: 'Спрос ' },
    { type: 'bold', text: 'вырос' },
    { type: 'text', text: ' на 5%.' },
  ]);
  assert.equal(blocks[2].items.length, 2);
  assert.deepEqual(blocks[2].items[0][1], { type: 'code', text: '030200192_' });
  assert.equal(blocks[3].items[1][0].text, 'два');
  assert.deepEqual(blocks[4].inline, [{ type: 'text', text: '<b>не html</b>' }]);
});

test('markdown: list item continuation and CRLF', () => {
  const blocks = parseMarkdown('- пункт\r\n  продолжение\r\nабзац');
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].items[0].map((p) => p.text).join(''), 'пункт продолжение');
  assert.deepEqual(parseInline('без разметки'), [{ type: 'text', text: 'без разметки' }]);
});

test('chart series use palette slots in order, forecast is dashed', () => {
  assert.deepEqual([0, 1, 7, 12].map(seriesSlot), [1, 2, 8, 8]);
  const actual = seriesStroke({ key: 'a', name: 'Факт', kind: 'actual' }, 0);
  const forecast = seriesStroke({ key: 'f', name: 'Прогноз', kind: 'forecast' }, 1);
  assert.equal(actual.stroke, 'var(--chart-series-1)');
  assert.equal(actual.strokeDasharray, undefined);
  assert.equal(forecast.stroke, 'var(--chart-series-2)');
  assert.equal(forecast.strokeDasharray, '6 5');
});

test('y axis: wide or non-positive ranges start at zero, narrow positive ranges fit the data', () => {
  const s = [{ key: 'v', name: 'v', kind: 'series' }];
  assert.deepEqual(yDomain(s, [{ v: 100 }, { v: 240000 }]), [0, 'auto']);
  assert.deepEqual(yDomain(s, [{ v: -5 }, { v: 10 }]), [0, 'auto']);
  assert.deepEqual(yDomain(s, []), [0, 'auto']);
  const [lo, hi] = yDomain(s, [{ v: 0.76 }, { v: 1.23 }, { v: null }]);
  assert.ok(lo > 0 && lo < 0.76 && hi > 1.23 && hi < 1.5, `${lo}..${hi}`);
});

test('formatting helpers', () => {
  assert.equal(formatPeriod('2026-03'), 'мар 2026');
  assert.equal(formatPeriod('окт'), 'окт');
  assert.equal(formatBytes(512), '512 Б');
  assert.equal(formatBytes(3 * 1024 * 1024 + 200_000), '3,2 МБ');
  assert.equal(
    describeFile({ kind_label: 'помесячная матрица', period_from: '2024-01', period_to: '2026-09', skus: 554 }),
    'помесячная матрица · янв 2024 — сен 2026 · товаров: 554',
  );
});

test('file validation before upload', () => {
  assert.equal(validateFile({ name: 'sales.XLSX', size: 10 }), null);
  assert.match(validateFile({ name: 'report.pdf', size: 10 }), /CSV и XLSX/);
  assert.match(validateFile({ name: 'big.csv', size: 21 * 1024 * 1024 }), /20 МБ/);
  assert.match(validateFile({ name: 'empty.csv', size: 0 }), /пустой/);
});

test('tool calls are grouped with human labels', () => {
  const tools = summarizeTools([{ name: 'search_skus' }, { name: 'get_demand_trend' }, { name: 'search_skus' }, { name: 'x' }]);
  assert.deepEqual(tools, [
    { name: 'search_skus', label: 'Поиск товаров', count: 2 },
    { name: 'get_demand_trend', label: 'Динамика спроса', count: 1 },
    { name: 'x', label: 'x', count: 1 },
  ]);
});

test('demo replies: trend chart joins forecast to last actual point; file forecast; honest demo notice', () => {
  const trend = mockReply('Покажи динамику спроса', [], 'standard');
  assert.equal(trend.charts.length, 1);
  const data = trend.charts[0].data;
  const lastActual = data.filter((p) => p.actual !== null).at(-1);
  assert.equal(lastActual.forecast, lastActual.actual);
  assert.ok(data.some((p) => p.actual === null && typeof p.forecast === 'number'));
  assert.ok(trend.content.endsWith(MOCK_NOTICE));

  const file = { id: 'f1', filename: 'продажи.xlsx', size: 1, summary: {}, created_at: '' };
  const forecast = mockReply('дай прогноз', [file], 'deep');
  assert.match(forecast.charts[0].title, /продажи\.xlsx/);
  assert.deepEqual(forecast.tool_calls.map((c) => c.name), ['analyze_file', 'forecast_from_file']);

  const season = mockReply('сравни сезонность', [], 'fast');
  assert.deepEqual(season.charts[0].series.map((s) => s.kind), ['series', 'series']);
  assert.equal(mockReply('привет', [], 'fast').charts.length, 0);
});
