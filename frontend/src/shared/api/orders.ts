import { request, jsonRequest } from './client';
import type { Category, ExplanationDetail, OrderCreate, OrderFields, OrderProduct, OrderRecommendation, Supplier } from './types';

export const getRecommendations = (runId: string) => request<OrderRecommendation[]>(`/recommendations?run_id=${encodeURIComponent(runId)}`);
export async function getOrderLookups(): Promise<{ suppliers: Supplier[]; categories: Category[] }> {
  const [suppliers, categories] = await Promise.all([request<Supplier[]>('/suppliers'), request<Category[]>('/categories')]);
  return { suppliers, categories };
}
export const getExplanation = (runId: string, sku: string) => request<ExplanationDetail>(`/recommendations/${encodeURIComponent(sku)}/explain?run_id=${encodeURIComponent(runId)}`);
export async function decideOrder(order: OrderRecommendation, quantity: number, status: 'approved' | 'rejected', comment: string): Promise<OrderRecommendation> {
  if (status === 'approved' && (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000))
    throw new Error('Укажите количество больше 0 и не больше 1 000 000.');
  return request(`/recommendations/${encodeURIComponent(order.id)}/${status === 'approved' ? 'approve' : 'reject'}`,
    jsonRequest('POST', status === 'approved' ? { approved_qty: quantity, comment } : { comment }));
}
export const findOrderProducts = (search: string) => request<{ items: OrderProduct[]; total: number }>(`/input-data/products?limit=50&search=${encodeURIComponent(search)}`);
export const getOrder = (_runId: string, id: string) => request<OrderRecommendation>(`/recommendations/${encodeURIComponent(id)}`);
export const createOrder = (body: OrderCreate) => request<OrderRecommendation>('/recommendations', jsonRequest('POST', body));
export const updateOrder = (order: OrderRecommendation, body: OrderFields) => request<OrderRecommendation>(`/recommendations/${encodeURIComponent(order.id)}`, jsonRequest('PUT', body));
export async function deleteOrder(order: OrderRecommendation): Promise<void> {
  await request(`/recommendations/${encodeURIComponent(order.id)}`, { method: 'DELETE' });
}
