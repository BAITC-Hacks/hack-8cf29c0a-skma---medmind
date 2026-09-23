export interface Product {
  code: string;
  name: string;
  supplier_sku: string | null;
  supplier_id: string;
  supplier_name: string;
  category_id: string;
  category_name: string;
  unit: string;
  unit_cost: number | null;
  stock: { as_of: string; on_hand: number; reserved: number; free: number } | null;
  monthly_stock: { as_of: string; on_hand: number } | null;
}
export type ProductWrite = Pick<Product, 'code' | 'name' | 'supplier_sku' | 'supplier_id' | 'category_id' | 'unit' | 'unit_cost'> & {
  stock: Pick<NonNullable<Product['stock']>, 'as_of' | 'on_hand' | 'reserved'> | null;
};
