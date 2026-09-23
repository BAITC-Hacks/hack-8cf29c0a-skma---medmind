export const categories = [{ value: 'all', label: 'Все категории' }, { value: 'cable', label: 'Кабельная продукция' }, { value: 'light', label: 'Освещение' }, { value: 'equipment', label: 'Электрооборудование' }];
const products = [
  { sku: 'КБ-001', name: 'Кабель ВВГнг 3×2,5', category: 'cable', supplier: 'КазКабель', unit: 'м', daily: 84, stock: 168, lead: 7 },
  { sku: 'СВ-014', name: 'Панель LED 36 Вт', category: 'light', supplier: 'Световые решения', unit: 'шт.', daily: 12, stock: 36, lead: 8 },
  { sku: 'ЭО-028', name: 'Автоматический выключатель C16', category: 'equipment', supplier: 'ЭлектроСнаб', unit: 'шт.', daily: 18, stock: 72, lead: 10 },
  { sku: 'КБ-008', name: 'Провод ПВС 2×1,5', category: 'cable', supplier: 'КазКабель', unit: 'м', daily: 56, stock: 280, lead: 9 },
  { sku: 'СВ-032', name: 'Лампа LED E27 12 Вт', category: 'light', supplier: 'Световые решения', unit: 'шт.', daily: 24, stock: 144, lead: 10 },
  { sku: 'ЭО-041', name: 'Розетка с заземлением', category: 'equipment', supplier: 'ЭлектроСнаб', unit: 'шт.', daily: 16, stock: 320, lead: 7 },
];
// Deterministic synthetic fixtures, scoped to the selected calculation and category.
export function getDashboardData(runId: string, createdAt: string, category: string, weeks: number) {
  const seed = [...runId].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7;
  const orders = products.filter(p => category === 'all' || p.category === category).map(p => {
    const daily = p.daily + seed;
    const daysLeft = Math.round(p.stock / daily * 10) / 10;
    return { ...p, daily, daysLeft, quantity: Math.max(0, daily * (p.lead + 7) - p.stock), high: daysLeft < p.lead };
  }).filter(p => p.quantity > 0);
  const demand = orders.reduce((sum, p) => sum + p.daily, 0);
  const trend = Array.from({ length: weeks }, (_, i) => {
    const date = new Date(createdAt);
    date.setUTCDate(date.getUTCDate() - (weeks - 1 - i) * 7);
    const wave = 0.78 + (12 - weeks + i) * 0.035 + [0.06, -0.04, 0.1, 0.02][(12 - weeks + i) % 4];
    return { date: date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Almaty' }), actual: Math.round(demand * 7 * wave), forecast: Math.round(demand * 7 * (wave + [0.05, 0.03, -0.04][(12 - weeks + i) % 3])) };
  });
  const seasonality = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'].map((month, i) => ({ month, coefficient: Number(([0.72, 0.76, 0.91, 1.02, 1.12, 1.18, 1.09, 1.16, 1.24, 1.08, 0.92, 0.8][i] + (category === 'light' ? 0.12 : 0)).toFixed(2)) }));
  return { orders, risks: orders.filter(p => p.high).sort((a, b) => a.daysLeft - b.daysLeft), suppliers: [...new Set(orders.map(p => p.supplier))], trend, seasonality };
}
