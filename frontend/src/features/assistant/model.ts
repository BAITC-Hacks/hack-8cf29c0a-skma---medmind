// Чистая логика экрана ассистента (без React) — покрыта tests/assistant.test.mjs.
import type { AssistantFileSummary, AssistantMode, ChartSeries } from './types.ts';

export const modeLabels: Record<AssistantMode, string> = {
  fast: 'Быстрый',
  standard: 'Стандарт',
  deep: 'Глубокий',
};

export const toolLabels: Record<string, string> = {
  get_overview: 'Сводка по расчёту',
  search_skus: 'Поиск товаров',
  get_sku_details: 'Разбор расчёта по товару',
  list_recommendations: 'Список рекомендаций',
  get_demand_trend: 'Динамика спроса',
  get_seasonality: 'Сезонность',
  list_files: 'Список файлов',
  analyze_file: 'Анализ файла',
  forecast_from_file: 'Прогноз по файлу',
  plot_curve: 'Построение графика',
};

export const suggestions = [
  'Что срочно нужно заказать и почему?',
  'Покажи динамику спроса по IEK за последний год',
  'Какие заказы Systeme Electric самые дорогие?',
  'Сравни сезонность IEK и Systeme Electric',
];

export const ACCEPTED_FILES = '.csv,.xlsx,.xlsm';
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Уникальные инструменты в порядке первого вызова, с числом вызовов. */
export function summarizeTools(calls: { name: string }[]): { name: string; label: string; count: number }[] {
  const byName = new Map<string, number>();
  for (const call of calls) byName.set(call.name, (byName.get(call.name) ?? 0) + 1);
  return [...byName].map(([name, count]) => ({ name, label: toolLabels[name] ?? name, count }));
}

// ---------------------------------------------------------------- графики

/** Слот категориальной палитры (DESIGN.md §2.4): ряды получают слоты по порядку, максимум 8. */
export function seriesSlot(index: number): number {
  return Math.min(index, 7) + 1;
}

/** Стиль линии: факт — жирная сплошная, прогноз — пунктир, прочие — сплошная обычная. */
export function seriesStroke(series: ChartSeries, index: number) {
  return {
    stroke: `var(--chart-series-${seriesSlot(index)})`,
    strokeWidth: series.kind === 'actual' ? 3 : 2,
    strokeDasharray: series.kind === 'forecast' ? '6 5' : undefined,
  };
}

/** Ось Y линейного графика: широкий диапазон (или значения ≤ 0) — от нуля; узкий диапазон положительных значений
 *  (коэффициенты сезонности 0,8–1,2, стабильный спрос) — по данным, иначе колебания сжимаются у верхнего края. */
export function yDomain(series: ChartSeries[], data: Record<string, unknown>[]): [number, number] | [0, 'auto'] {
  const values = data.flatMap((row) => series.map((s) => row[s.key])).filter((v): v is number => typeof v === 'number');
  if (values.length === 0) return [0, 'auto'];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min <= 0 || (max - min) / max > 0.6) return [0, 'auto'];
  const pad = (max - min) * 0.15 || max * 0.05;
  const step = 10 ** Math.floor(Math.log10(pad));
  return [Math.max(0, Math.floor((min - pad) / step) * step), Math.ceil((max + pad) / step) * step];
}

const numberFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const compactFormat = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

export function formatNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? numberFormat.format(value) : '—';
}

export function formatAxis(value: number): string {
  return Math.abs(value) >= 10_000 ? compactFormat.format(value) : numberFormat.format(value);
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

/** «2026-03» → «мар 2026»; прочие подписи оси (например, «янв» в сезонности) возвращаются как есть. */
export function formatPeriod(value: unknown): string {
  const text = String(value ?? '');
  const match = /^(\d{4})-(\d{2})$/.exec(text);
  if (!match) return text;
  const month = MONTHS[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : text;
}

// ---------------------------------------------------------------- файлы

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

export function describeFile(summary: AssistantFileSummary): string {
  const parts: string[] = [];
  if (summary.kind_label) parts.push(summary.kind_label);
  if (summary.period_from && summary.period_to)
    parts.push(`${formatPeriod(summary.period_from)} — ${formatPeriod(summary.period_to)}`);
  if (typeof summary.skus === 'number') parts.push(`товаров: ${numberFormat.format(summary.skus)}`);
  return parts.join(' · ');
}

/** Проверка до загрузки — сервер проверит ещё раз, но так пользователь узнает об ошибке сразу. */
export function validateFile(file: { name: string; size: number }): string | null {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
  if (!ACCEPTED_FILES.split(',').includes(ext)) return 'Поддерживаются файлы CSV и XLSX.';
  if (file.size > MAX_FILE_BYTES) return 'Файл больше 20 МБ.';
  if (file.size === 0) return 'Файл пустой.';
  return null;
}

// ---------------------------------------------------------------- markdown

export type Inline = { type: 'text' | 'bold' | 'code'; text: string } | { type: 'link'; text: string; href: string };
export type Block =
  | { type: 'p'; inline: Inline[] }
  | { type: 'h'; inline: Inline[] }
  | { type: 'ul' | 'ol'; items: Inline[][] };

/** Только внутренние ссылки на конкретный заказ в диалоге. */
export function isOrderLink(href: string): boolean {
  if (!href.startsWith('/assistant?') || /[\s\\#]/.test(href)) return false;
  const params = new URLSearchParams(href.slice('/assistant?'.length));
  return [...params.keys()].length === 2 && ['c', 'order'].every((key) =>
    /^[a-zA-Z0-9_-]{1,100}$/.test(params.get(key) ?? ''));
}

/** Markdown без HTML; активны только проверенные внутренние ссылки на заказы. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]\n]+)\]\(([^\s]+?)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[3] !== undefined) {
      out.push(isOrderLink(m[4]) ? { type: 'link', text: m[3], href: m[4] } : { type: 'text', text: m[0] });
    } else {
      out.push(m[1] !== undefined ? { type: 'bold', text: m[1] } : { type: 'code', text: m[2] });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

/** Минимальный markdown из ответов модели: абзацы, заголовки, маркированные и нумерованные списки. */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { type: 'ul' | 'ol'; items: Inline[][] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'p', inline: parseInline(paragraph.join(' ')) });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const raw of source.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(line);
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!line) {
      flushParagraph();
      flushList();
    } else if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'h', inline: parseInline(heading[1]) });
    } else if (bullet || numbered) {
      flushParagraph();
      const type = bullet ? 'ul' : 'ol';
      if (!list || list.type !== type) {
        flushList();
        list = { type, items: [] };
      }
      list.items.push(parseInline((bullet ?? numbered)![1]));
    } else if (list && /^\s{2,}/.test(raw)) {
      // продолжение пункта списка на следующей строке
      const lastItem = list.items[list.items.length - 1];
      lastItem.push({ type: 'text', text: ' ' }, ...parseInline(line));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
