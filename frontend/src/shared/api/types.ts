export type CalcRunStatus = 'running' | 'done' | 'failed';

export interface CalcRun {
  id: string;
  created_at: string;
  horizon_days: number;
  status: CalcRunStatus;
}

export type Urgency = 'high' | 'medium' | 'low';
export type OrderStatus = 'pending' | 'approved' | 'rejected';

export interface OrderRecommendation {
  id: string;
  run_id: string;
  sku_code: string;
  supplier_sku: string;
  name: string;
  supplier_id: string;
  supplier_name: string;
  category_id: string;
  recommended_qty: number;
  approved_qty: number | null;
  unit: string;
  urgency: Urgency;
  status: OrderStatus;
  short_reason: string;
  comment?: string | null;
  has_explanation?: boolean;
}

export interface OrderFields {
  recommended_qty: number;
  urgency: Urgency;
  short_reason: string;
  comment: string | null;
}

export interface OrderCreate extends OrderFields {
  run_id: string | null;
  sku_code: string;
}

export interface OrderProduct {
  code: string;
  name: string;
  supplier_id: string;
  category_id: string;
  supplier_sku: string | null;
  unit: string;
}

export interface ExplanationDetail {
  sku_code: string;
  base_demand: number;
  seasonality_factor: number;
  growth_factor: number;
  stockout_compensation: number;
  current_stock: number;
  reserved_stock: number;
  free_stock: number;
  goods_in_transit: number;
  safety_buffer: number;
  bulk_outliers_excluded: { date: string; qty: number; document: string }[];
  final_qty: number;
  narrative: string;
}

export interface Supplier {
  id: string;
  name: string;
  lead_time_days: number;
}
export interface Category {
  id: string;
  name: string;
}
