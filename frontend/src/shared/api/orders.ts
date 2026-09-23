import { API_BASE, USE_MOCK } from './client';
import type { Category, ExplanationDetail, OrderRecommendation, Supplier } from './types';
import { categories, createMockRun, suppliers } from '../../features/orders/mock';

// Session-scoped demo data: navigation and refetching preserve decisions; reload resets them.
const mockRuns = new Map<string, ReturnType<typeof createMockRun>>();
function mockRun(runId: string) {
  if (!mockRuns.has(runId)) mockRuns.set(runId, createMockRun(runId));
  return mockRuns.get(runId)!;
}
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) throw new Error(`Не удалось выполнить запрос (${response.status}). Попробуйте ещё раз.`);
  return response.json() as Promise<T>;
}
export async function getRecommendations(runId: string): Promise<OrderRecommendation[]> {
  if (USE_MOCK) return structuredClone(mockRun(runId).orders);
  return request(`/recommendations?run_id=${encodeURIComponent(runId)}`);
}
export async function getOrderLookups(): Promise<{ suppliers: Supplier[]; categories: Category[] }> {
  if (USE_MOCK) return { suppliers, categories };
  const [supplierList, categoryList] = await Promise.all([
    request<Supplier[]>('/suppliers'),
    request<Category[]>('/categories'),
  ]);
  return { suppliers: supplierList, categories: categoryList };
}
export async function getExplanation(runId: string, sku: string): Promise<ExplanationDetail> {
  if (USE_MOCK) {
    const detail = mockRun(runId).explanations.find((item) => item.sku_code === sku);
    if (!detail) throw new Error('Обоснование для этой позиции не найдено.');
    return structuredClone(detail);
  }
  return request(`/recommendations/${encodeURIComponent(sku)}/explain?run_id=${encodeURIComponent(runId)}`);
}
export async function decideOrder(
  order: OrderRecommendation,
  quantity: number,
  status: 'approved' | 'rejected',
  comment: string,
): Promise<OrderRecommendation> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000)
    throw new Error('Укажите целое количество от 1 до 1 000 000.');
  if (USE_MOCK) {
    const data = mockRun(order.run_id);
    const index = data.orders.findIndex((item) => item.id === order.id);
    if (index < 0) throw new Error('Позиция не найдена в выбранном расчёте.');
    const updated = {
      ...data.orders[index],
      approved_qty: status === 'approved' ? quantity : null,
      status,
      comment,
    };
    data.orders[index] = updated;
    return structuredClone(updated);
  }
  if (status === 'rejected') throw new Error('Отклонение пока доступно только в деморежиме.');
  return request(`/recommendations/${encodeURIComponent(order.id)}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved_qty: quantity, comment }),
  });
}
