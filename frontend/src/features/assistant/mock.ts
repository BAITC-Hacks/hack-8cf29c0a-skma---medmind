// Фикстуры для тестов: детерминированные ответы и графики на тестовых данных,
// без обращения к серверу и ИИ. Реальные ответы строит backend (/api/assistant/*).
import type {
  AssistantFile,
  AssistantMode,
  AssistantStatus,
  ChartSpec,
  ConversationDetail,
  ToolCall,
} from './types.ts';

export const MOCK_NOTICE = 'Демо-режим: ответ собран из тестовых данных, без обращения к ИИ.';

export const mockStatus: AssistantStatus = {
  enabled: true,
  reason: null,
  default_mode: 'standard',
  models: [
    { mode: 'fast', model: 'gpt-6-luna', description: 'Быстрые справки: «сколько заказать X», «что срочно»' },
    { mode: 'standard', model: 'gpt-6-sol', description: 'Анализ данных, графики, прогноз по файлам — по умолчанию' },
    { mode: 'deep', model: 'gpt-6-astra', description: 'Сложные разборы: сравнения, аномалии, большие файлы' },
  ],
};

const HISTORY = [
  '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02',
  '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08',
];
const FORECAST = ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02'];
const SEASON = [0.79, 0.8, 0.79, 0.85, 0.95, 1.03, 1.13, 1.17, 1.12, 1.23, 1.1, 1.03];

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function demandChart(title: string, base: number, seed: number): ChartSpec {
  const rnd = seeded(seed);
  const monthOf = (p: string) => Number(p.slice(5)) - 1;
  const history = HISTORY.map((period) => ({
    period,
    actual: Math.round(base * SEASON[monthOf(period)] * (0.9 + rnd() * 0.2)),
    forecast: null as number | null,
  }));
  history[history.length - 1].forecast = history[history.length - 1].actual;
  const forecast = FORECAST.map((period) => ({
    period,
    actual: null,
    forecast: Math.round(base * 1.04 * SEASON[monthOf(period)]),
  }));
  return {
    id: `demo-${seed}`,
    type: 'line',
    title,
    subtitle: 'Демо: факт по месяцам и прогноз',
    x_key: 'period',
    y_label: 'шт',
    series: [
      { key: 'actual', name: 'Факт', kind: 'actual' },
      { key: 'forecast', name: 'Прогноз', kind: 'forecast' },
    ],
    data: [...history, ...forecast],
  };
}

function seasonalityChart(): ChartSpec {
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const se = [0.76, 0.87, 0.78, 1.05, 1.02, 1.07, 1.04, 1.2, 1.17, 1.07, 1.05, 0.94];
  return {
    id: 'demo-season',
    type: 'line',
    title: 'Сезонность: IEK и Systeme Electric',
    subtitle: '1,0 — средний месяц',
    x_key: 'period',
    y_label: '× к среднему',
    series: [
      { key: 's1', name: 'IEK', kind: 'series' },
      { key: 's2', name: 'Systeme Electric', kind: 'series' },
    ],
    data: months.map((period, i) => ({ period, s1: SEASON[i], s2: se[i] })),
  };
}

interface MockReply {
  content: string;
  charts: ChartSpec[];
  tool_calls: ToolCall[];
}

const call = (name: string, args: object = {}): ToolCall => ({ name, arguments: JSON.stringify(args) });

/** Ответ демо-ассистента по ключевым словам вопроса. */
export function mockReply(question: string, files: AssistantFile[], mode: AssistantMode): MockReply {
  const q = question.toLowerCase();
  const suffix = `\n\n${MOCK_NOTICE}`;
  const modeNote = mode === 'deep' ? ' Разбор выполнен в глубоком режиме.' : '';

  if (files.length && /прогноз|динамик|файл|спрос/.test(q)) {
    const file = files[files.length - 1];
    return {
      content:
        `По файлу **${file.filename}** спрос стабилен, с сезонным подъёмом осенью.\n\n` +
        '- Базовый спрос: **≈ 1 250 шт/мес** (среднее за 12 мес.)\n' +
        '- Разовые оптовые отгрузки исключены: 3 строки на 4 800 шт\n' +
        '- Прогноз на октябрь–ноябрь: 1 450–1 520 шт/мес\n\n' +
        `Кривая ниже: сплошная линия — факт из файла, пунктир — прогноз.${modeNote}${suffix}`,
      charts: [demandChart(`Прогноз по файлу: ${file.filename}`, 1250, 7)],
      tool_calls: [call('analyze_file', { file_id: file.id }), call('forecast_from_file', { file_id: file.id })],
    };
  }
  if (/сезон/.test(q)) {
    return {
      content:
        'Пик спроса у IEK — **октябрь (×1,23)** и июль–август, провал — январь–март (×0,8). ' +
        `У Systeme Electric сезонность мягче, пик в августе–сентябре.${modeNote}${suffix}`,
      charts: [seasonalityChart()],
      tool_calls: [call('get_seasonality', { supplier_id: 'iek' }), call('get_seasonality', { supplier_id: 'se' }), call('plot_curve')],
    };
  }
  if (/динамик|тренд|график|продаж|кривая/.test(q)) {
    return {
      content:
        'Продажи IEK за год снизились в январе–феврале и восстановились к лету: июль — максимум года. ' +
        `Прогноз на осень выше прошлогоднего уровня на ~4% с учётом сезонного пика в октябре.${modeNote}${suffix}`,
      charts: [demandChart('Динамика спроса: IEK', 180000, 3)],
      tool_calls: [call('get_demand_trend', { supplier_id: 'iek', plot: true })],
    };
  }
  if (/срочн|заказ|дефицит|купить/.test(q)) {
    return {
      content:
        'Самые срочные позиции — остаток закончится раньше, чем придёт новая поставка:\n\n' +
        '1. **030300014_** Распределительная коробка У-192 — остатка на 3 дня, к заказу 24 472 шт\n' +
        '2. **030200239_** Розетка 2-я «ХИТ» — остатка нет, к заказу 10 240 шт\n' +
        '3. **130300791_** Кабель — остатка нет, к заказу 8 964 м\n\n' +
        `Утвердить заказы можно на экране «Заказы» — ассистент ничего не отправляет поставщику.${modeNote}${suffix}`,
      charts: [],
      tool_calls: [call('get_overview'), call('list_recommendations', { urgency: 'high' })],
    };
  }
  return {
    content:
      'Я помогу разобраться в данных закупок. Например, спросите:\n\n' +
      '- что срочно заказать и почему;\n' +
      '- как менялся спрос по товару или поставщику (покажу кривую);\n' +
      `- прогноз по вашей выгрузке продаж — прикрепите CSV или XLSX.${suffix}`,
    charts: [],
    tool_calls: [],
  };
}

export function emptyConversation(id: string, now: string): ConversationDetail {
  return { id, title: 'Новый диалог', created_at: now, updated_at: now, messages: [], files: [] };
}
