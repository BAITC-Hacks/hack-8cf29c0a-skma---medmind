export interface CalcParams {
  forecast_horizon_days: number;
  safety_buffer_days: number;
  outlier_sensitivity: number;
}

export interface SupplierRule {
  id: string;
  supplier_id: string;
  sku_code: string;
  min_order_qty: number;
  order_multiple: number;
}

export type ParamDraft = { [K in keyof CalcParams]: string };
export type RuleDraft = { min_order_qty: string; order_multiple: string };

export function numberError(value: string, min: number, max = Infinity, integer = false): string {
  if (!value.trim()) return 'Заполните поле.';
  const number = Number(value);
  if (!Number.isFinite(number)) return 'Введите число.';
  if (integer && !Number.isInteger(number)) return 'Введите целое число.';
  if (number < min || number > max) return Number.isFinite(max)
    ? `Укажите значение от ${min} до ${max}.` : `Минимальное значение — ${min}.`;
  return '';
}

export function paramsDraft(params: CalcParams): ParamDraft {
  return {
    forecast_horizon_days: String(params.forecast_horizon_days),
    safety_buffer_days: String(params.safety_buffer_days),
    outlier_sensitivity: String(params.outlier_sensitivity),
  };
}

export function validateParams(draft: ParamDraft) {
  return {
    forecast_horizon_days: numberError(draft.forecast_horizon_days, 1, 365, true),
    safety_buffer_days: numberError(draft.safety_buffer_days, 0, 365, true),
    outlier_sensitivity: numberError(draft.outlier_sensitivity, 0, 1),
  };
}

export function ruleDraft(rule: SupplierRule): RuleDraft {
  return { min_order_qty: String(rule.min_order_qty), order_multiple: String(rule.order_multiple) };
}

export function draftChanged<K extends string>(draft: Record<K, string>, saved: Record<NoInfer<K>, unknown>): boolean {
  return (Object.keys(draft) as K[]).some(key => !draft[key].trim() || Number(draft[key]) !== saved[key]);
}
