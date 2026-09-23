import type { CalcRun } from './types';

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '/api').replace(/\/$/, '');

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(`${API_BASE}${path}`, init); }
  catch { throw new Error('Сервер недоступен. Проверьте подключение и повторите попытку.'); }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const detail = body?.detail;
    const message = typeof detail === 'string' ? detail
      : detail?.message ?? (Array.isArray(detail) ? detail.map(item => item.msg).join('; ') : '');
    throw new Error(message || `Не удалось выполнить запрос (${response.status}). Попробуйте ещё раз.`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
export function jsonRequest(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
export const getCalcRuns = () => request<CalcRun[]>('/calc-runs');
