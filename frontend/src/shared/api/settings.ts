import { request, jsonRequest } from './client';
import type { CalcRun, Supplier } from './types';
import type { CalcParams, SupplierRule } from '../../pages/SettingsPage/model';

export interface AssistantSettings {
  configured: boolean;
  source: 'settings' | 'environment' | null;
}

export const getAssistantSettings = () => request<AssistantSettings>('/settings/assistant');
export const saveAssistantKey = (apiKey: string) =>
  request<AssistantSettings>('/settings/assistant', jsonRequest('PUT', { api_key: apiKey }));
export const deleteAssistantKey = () => request<AssistantSettings>('/settings/assistant', { method: 'DELETE' });

export async function getSettings() {
  const [params, suppliers, rules] = await Promise.all([
    request<CalcParams>('/settings/calc-params'), request<Supplier[]>('/suppliers'),
    request<SupplierRule[]>('/settings/supplier-rules'),
  ]);
  return { params, suppliers, rules };
}
export const saveCalcParams = (params: CalcParams) => request<CalcParams>('/settings/calc-params', jsonRequest('PUT', params));
export const saveSupplierRule = (id: string, values: Pick<SupplierRule, 'min_order_qty' | 'order_multiple'>) =>
  request<SupplierRule>(`/settings/supplier-rules/${encodeURIComponent(id)}`, jsonRequest('PUT', values));
export const saveSupplierLeadTime = (id: string, days: number) =>
  request<Supplier>(`/suppliers/${encodeURIComponent(id)}`, jsonRequest('PUT', { lead_time_days: days }));
export const startCalculation = () => request<CalcRun>('/calc-runs', jsonRequest('POST', {}));
export const getCalculation = (id: string) => request<CalcRun & { error?: string | null }>(`/calc-runs/${encodeURIComponent(id)}`);
