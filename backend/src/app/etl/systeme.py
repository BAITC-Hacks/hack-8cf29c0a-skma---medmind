"""Адаптер Systeme Electric. Особенности: MOQ — «Кратность» (лот); товар в пути — одна агрегированная
колонка «СЭ в пути dd.mm»; файл «Товар в пути» содержит снимок остатков по суб-локациям, категорию,
себестоимость и ручной расчёт менеджера (эталон)."""

import re
from datetime import date
from pathlib import Path

import pandas as pd

from app.etl.common import (
    SupplierBundle,
    build_sku_master,
    find_file,
    find_header_row,
    month_matrix_to_long,
    norm_code,
    parse_ru_date,
    read_company_seasonality,
    read_raw,
    read_sales,
    to_num,
    with_header,
)

SUPPLIER_ID = "se"
SUPPLIER_NAME = "Systeme Electric"
DEFAULT_LEAD_TIME_DAYS = 30

# Суб-локации, которые менеджер учитывает как доступный запас (формула «Запас» в эталонном файле).
# «РЦ ЕКТ Рыскулова» в формулу не входит — храним, но в свободный остаток не добавляем.
_AVAILABLE_LOCATIONS = ["Витрина", "Остаток ТЗ", "Розничный склад"]
_OTHER_LOCATIONS = ["РЦ ЕКТ Рыскулова"]
_TRANSIT_RE = re.compile(r"^СЭ в пути\s*(\d{2})\.(\d{2})", re.IGNORECASE)


def _col(df: pd.DataFrame, name: str) -> pd.Series:
    return df[name] if name in df.columns else pd.Series(0.0, index=df.index)


def load(folder: Path) -> SupplierBundle:
    warnings: list[str] = []

    sales = read_sales(find_file(folder, "Динамика продаж"))

    stock_df = with_header(raw := read_raw(find_file(folder, "остатки")), find_header_row(raw, "Номенклатура.Код"))
    stock_monthly = month_matrix_to_long(stock_df, "Номенклатура.Код")
    stock_skus = pd.DataFrame({
        "sku_code": stock_df["Номенклатура.Код"].map(norm_code),
        "name": stock_df["Номенклатура"].astype(str).str.strip(),
        "unit": stock_df["Ед.изм"].astype(str).str.strip(),
    }).dropna(subset=["sku_code"])

    moq = with_header(raw := read_raw(find_file(folder, "MOQ")), find_header_row(raw, "Номенклатура.Код"))
    moq["sku_code"] = moq["Номенклатура.Код"].map(norm_code)
    moq = moq[moq["sku_code"].notna()]
    multiple = to_num(moq["Кратность"]).clip(lower=1)
    rules = pd.DataFrame({"sku_code": moq["sku_code"], "min_order_qty": multiple, "order_multiple": multiple})
    moq_skus = pd.DataFrame({
        "sku_code": moq["sku_code"],
        "supplier_sku": moq["Артикул"].map(norm_code),
        "name": moq["Номенклатура"].astype(str).str.strip(),
    })

    ref_path = find_file(folder, "Товар в пути")
    as_of = parse_ru_date(ref_path.name) or sales["ts"].max().date()
    ref = with_header(raw := read_raw(ref_path), find_header_row(raw, "Код 1с"))
    ref["sku_code"] = ref["Код 1с"].map(norm_code)
    ref = ref[ref["sku_code"].notna()].drop_duplicates("sku_code", keep="last").reset_index(drop=True)

    category = ref["Категория 2026"].map(norm_code)
    category = category.str.replace(r"\.0$", "", regex=True)
    ref_skus = pd.DataFrame({
        "sku_code": ref["sku_code"],
        "supplier_sku": ref["Артикул поставщика"].map(norm_code),
        "name": ref["Наименование"].astype(str).str.strip(),
        "category_id": category,
        "unit_cost": pd.to_numeric(ref["СС реал"], errors="coerce"),
    })

    locations = {loc: to_num(_col(ref, loc)) for loc in _AVAILABLE_LOCATIONS + _OTHER_LOCATIONS}
    main_on_hand = to_num(ref["Остаток"])
    reserved = to_num(ref["Зарезервировано"])
    main_free = to_num(ref["Свободный остаток"])
    available_extra = sum(locations[loc] for loc in _AVAILABLE_LOCATIONS)
    stock_current = pd.DataFrame({
        "sku_code": ref["sku_code"],
        "as_of": as_of,
        "on_hand": main_on_hand + available_extra,
        "reserved": reserved,
        "free": main_free + available_extra,
        "locations": [
            {"Основной склад": float(main_on_hand[i]), **{k: float(v[i]) for k, v in locations.items()}}
            for i in range(len(ref))
        ],
    })

    transit_cols = [c for c in ref.columns if _TRANSIT_RE.match(c)]
    transit_rows = []
    for col in transit_cols:
        m = _TRANSIT_RE.match(col)
        arrival = date(as_of.year, int(m.group(2)), int(m.group(1)))
        for code, q in zip(ref["sku_code"], to_num(ref[col]), strict=True):
            if q > 0:
                transit_rows.append({"sku_code": code, "order_ref": col, "expected_date": arrival, "qty": q})
    if not transit_cols:
        warnings.append(f"{ref_path.name}: не найдена колонка «СЭ в пути …»")
    transit = pd.DataFrame(transit_rows, columns=["sku_code", "order_ref", "expected_date", "qty"])

    reference = pd.DataFrame({
        "sku_code": ref["sku_code"],
        "growth_coef": pd.to_numeric(ref["Кэф. Роста"], errors="coerce"),
        "seasonality_coef": pd.to_numeric(ref["Кэф. Сез-ти"], errors="coerce"),
        "cover_months": pd.to_numeric(ref["Запас"], errors="coerce"),
        "order_qty": pd.to_numeric(_col(ref, "Заказ"), errors="coerce"),
    })

    sales_skus = sales.drop_duplicates("sku_code", keep="last")[["sku_code", "name", "unit"]]
    skus = build_sku_master(ref_skus, moq_skus, sales_skus, stock_skus)

    return SupplierBundle(
        supplier_id=SUPPLIER_ID,
        supplier_name=SUPPLIER_NAME,
        default_lead_time_days=DEFAULT_LEAD_TIME_DAYS,
        skus=skus,
        sales=sales[["sku_code", "ts", "document", "doc_type", "qty"]],
        stock_monthly=stock_monthly,
        transit=transit,
        rules=rules.drop_duplicates("sku_code", keep="last"),
        seasonality=read_company_seasonality(find_file(folder, "Сезонность")),
        stock_current=stock_current,
        reference=reference,
        warnings=warnings,
    )
