import fixture from '../../shared/api/fixtures/orders.json' with { type: 'json' };
import runs from '../../shared/api/fixtures/calc-runs.json' with { type: 'json' };
import type { ExplanationDetail, OrderRecommendation, OrderStatus, Urgency } from '../../shared/api/types.ts';

export const suppliers = fixture.suppliers;
export const categories = fixture.categories;

/** Deterministic demo arithmetic, not the production forecasting algorithm. */
export function createMockRun(runId: string) {
  const runIndex = runs.findIndex((run) => run.id === runId);
  if (runIndex < 0 || runs[runIndex].status !== 'done') return { orders: [], explanations: [] };
  const run = runs[runIndex];
  const explanations: ExplanationDetail[] = [];
  const orders: OrderRecommendation[] = fixture.products.map((product, index) => {
    const base = Math.round((product.base_demand * (1 - runIndex * 0.06) * run.horizon_days) / 30);
    const seasonal = index % 3 === 0 ? 1.2 : 1.1;
    const growth = 1.05;
    const free = product.stock - product.reserved + runIndex * 5;
    const compensation = product.urgency === 'high' ? 20 : 0;
    const buffer = Math.ceil(base * 0.15);
    const final = Math.max(
      0,
      Math.ceil(base * seasonal * growth + compensation + buffer - free - product.transit),
    );
    const short =
      product.urgency === 'high'
        ? 'Низкий свободный остаток · спрос растёт'
        : product.urgency === 'medium'
          ? 'Пополнение с учётом сезонного спроса'
          : 'Плановое пополнение страхового запаса';
    explanations.push({
      sku_code: product.sku_code,
      base_demand: base,
      seasonality_factor: seasonal,
      growth_factor: growth,
      stockout_compensation: compensation,
      current_stock: product.stock + runIndex * 5,
      reserved_stock: product.reserved,
      free_stock: free,
      goods_in_transit: product.transit,
      safety_buffer: buffer,
      final_qty: final,
      bulk_outliers_excluded:
        index % 3 === 0
          ? [
              {
                date: new Date(Date.parse(run.created_at) - 7 * 86_400_000).toISOString().slice(0, 10),
                qty: base * 4,
                document: `РТ-${String(1240 + index).padStart(6, '0')}`,
              },
            ]
          : [],
      narrative: `На ${run.horizon_days} дней рекомендуем заказать ${final} ${product.unit} Базовый спрос — ${base} ${product.unit}, сезонный коэффициент — ×${seasonal}, рост — ×${growth}. Учтены свободный остаток ${free} ${product.unit} и ${product.transit} ${product.unit} в пути. ${compensation ? 'Добавлена компенсация спроса за дни отсутствия товара. ' : ''}Страховой запас — ${buffer} ${product.unit}`,
    });
    const status = (runIndex > 0 && index % 2 === 0 ? 'approved' : product.status) as OrderStatus;
    return {
      id: `${runId}-${product.sku_code}`,
      run_id: runId,
      sku_code: product.sku_code,
      supplier_sku: product.supplier_sku,
      name: product.name,
      supplier_id: product.supplier_id,
      supplier_name: suppliers.find((s) => s.id === product.supplier_id)!.name,
      category_id: product.category_id,
      recommended_qty: final,
      approved_qty: status === 'approved' ? final : null,
      unit: product.unit,
      urgency: product.urgency as Urgency,
      status,
      short_reason: short,
      comment: status === 'rejected' ? 'Достаточно запаса на других складских участках.' : '',
    };
  });
  return { orders, explanations };
}
