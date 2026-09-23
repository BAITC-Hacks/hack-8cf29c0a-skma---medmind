export interface Product {
  id: string;
  sku: string;
  name: string;
  category: string;
  supplier: string;
  unit: string;
  stock: number;
  price: number;
}

export const storageKey = 'medmind.products.v1';
export const categoryOptions = ['Кабельная продукция', 'Освещение', 'Электрооборудование'];
export const units = ['шт.', 'м', 'кг', 'уп.'];
export const initialProducts: Product[] = [
  { id: 'demo-1', sku: 'КБ-001', name: 'Кабель ВВГнг 3×2,5', category: categoryOptions[0], supplier: 'КазКабель', unit: 'м', stock: 168, price: 520 },
  { id: 'demo-2', sku: 'СВ-014', name: 'Панель LED 36 Вт', category: categoryOptions[1], supplier: 'Световые решения', unit: 'шт.', stock: 36, price: 4800 },
  { id: 'demo-3', sku: 'ЭО-028', name: 'Автоматический выключатель C16', category: categoryOptions[2], supplier: 'ЭлектроСнаб', unit: 'шт.', stock: 72, price: 2350 },
  { id: 'demo-4', sku: 'КБ-008', name: 'Провод ПВС 2×1,5', category: categoryOptions[0], supplier: 'КазКабель', unit: 'м', stock: 280, price: 310 },
  { id: 'demo-5', sku: 'СВ-032', name: 'Лампа LED E27 12 Вт', category: categoryOptions[1], supplier: 'Световые решения', unit: 'шт.', stock: 144, price: 890 },
];

export function isProduct(value: unknown): value is Product {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['id', 'sku', 'name', 'category', 'supplier', 'unit'].every(key => typeof p[key] === 'string' && (p[key] as string).trim().length > 0)
    && typeof p.stock === 'number' && Number.isFinite(p.stock) && p.stock >= 0
    && typeof p.price === 'number' && Number.isFinite(p.price) && p.price >= 0;
}

export function readProducts(): { products: Product[]; raw: string | null; error: string } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw === null) return { products: initialProducts, raw, error: '' };
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isProduct)
      || new Set(parsed.map(p => p.id)).size !== parsed.length
      || new Set(parsed.map(p => p.sku.trim().toLocaleLowerCase('ru-RU'))).size !== parsed.length) throw new Error('Invalid catalog');
    return { products: parsed, raw, error: '' };
  } catch {
    return { products: [], raw: null, error: 'Не удалось прочитать каталог из браузера. Сохранённые данные не изменены. Проверьте доступ к хранилищу и повторите загрузку.' };
  }
}
