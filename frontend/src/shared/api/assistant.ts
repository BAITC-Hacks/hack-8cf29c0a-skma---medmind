// Ассистент всегда использует сервер и реальные модели, независимо от деморежима заказов.
import type {
  AssistantFile,
  AssistantMode,
  AssistantStatus,
  Conversation,
  ConversationDetail,
  TurnResult,
} from '../../features/assistant/types';
import type { OrderRecommendation } from './types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function request<T>(path: string, init?: RequestInit, prefix = '/assistant'): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${prefix}${path}`, init);
  } catch {
    throw new Error('Сервер недоступен. Проверьте подключение и попробуйте ещё раз.');
  }
  if (!response.ok) {
    // FastAPI возвращает {detail: "..."} — показываем пользователю текст ошибки сервера
    const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
    const detail = typeof body?.detail === 'string' ? body.detail : null;
    throw new Error(detail ?? `Не удалось выполнить запрос (${response.status}). Попробуйте ещё раз.`);
  }
  return (response.status === 204 ? undefined : await response.json()) as T;
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ---------------------------------------------------------------- API

// Всегда реальный заказ из ответа модели, независимо от деморежима других экранов.
export function getAssistantOrder(id: string): Promise<OrderRecommendation> {
  return request(`/recommendations/${encodeURIComponent(id)}`, undefined, '');
}

export function approveAssistantOrder(id: string, quantity: number, comment: string): Promise<OrderRecommendation> {
  return request(`/recommendations/${encodeURIComponent(id)}/approve`, json({ approved_qty: quantity, comment }), '');
}

export async function getAssistantStatus(): Promise<AssistantStatus> {
  return request('/status');
}

export async function listConversations(): Promise<Conversation[]> {
  return request('/conversations');
}

export async function createConversation(): Promise<Conversation> {
  return request('/conversations', json({}));
}

export async function getConversation(id: string): Promise<ConversationDetail> {
  return request(`/conversations/${encodeURIComponent(id)}`);
}

export async function deleteConversation(id: string): Promise<void> {
  await request(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function uploadAssistantFile(conversationId: string, file: File): Promise<AssistantFile> {
  const form = new FormData();
  form.append('file', file);
  return request(`/conversations/${encodeURIComponent(conversationId)}/files`, { method: 'POST', body: form });
}

export async function sendAssistantMessage(
  conversationId: string,
  body: { content: string; file_ids: string[]; mode: AssistantMode },
): Promise<TurnResult> {
  return request(`/conversations/${encodeURIComponent(conversationId)}/messages`, json(body));
}
