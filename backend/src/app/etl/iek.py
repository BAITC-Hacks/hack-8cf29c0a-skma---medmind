"""Адаптер IEK. Особенности: товар в пути — отдельная колонка на каждую поставку с датой поступления
в заголовке; MOQ — «Мин. разр. к отгр.» (минимальная партия); текущего снимка остатков нет."""

import re
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

SUPPLIER_ID = "iek"
SUPPLIER_NAME = "IEK"
DEFAULT_LEAD_TIME_DAYS = 45  # по файлу «Путь»: от заказа до поступления ~30–40 дней + приёмка

_ARRIVAL_RE = re.compile(r"поступление до\s*(\d{2}\.\d{2}\.\d{4})", re.IGNORECASE)


def load(folder: Path) -> SupplierBundle:
    warnings: list[str] = []

    sales = read_sales(find_file(folder, "Динамика продаж"))

    stock_df = with_header(raw := read_raw(find_file(folder, "остатки")), find_header_row(raw, "Номенклатура.Код"))
    stock_monthly = month_matrix_to_long(stock_df, "Номенклатура.Код")
    stock_skus = pd.DataFrame({
        "sku_code": stock_df["Номенклатура.Код"].map(norm_code),
        "name": stock_df["Номенклатура"].astype(str).str.strip(),
        "unit": stock_df["Ед."].astype(str).str.strip(),
    }).dropna(subset=["sku_code"])

    moq = with_header(raw := read_raw(find_file(folder, "MOQ")), find_header_row(raw, "Код 1с"))
    moq["sku_code"] = moq["Код 1с"].map(norm_code)
    moq = moq[moq["sku_code"].notna()]
    moq_min = to_num(moq["Мин. разр. к отгр."]).clip(lower=1)
    rules = pd.DataFrame({"sku_code": moq["sku_code"], "min_order_qty": moq_min, "order_multiple": 1.0})
    moq_skus = pd.DataFrame({
        "sku_code": moq["sku_code"],
        "supplier_sku": moq["Артикул поставщика"].map(norm_code),
        "name": moq["Наименование"].astype(str).str.strip(),
    })

    transit_path = find_file(folder, "Путь")
    tr = with_header(raw := read_raw(transit_path), find_header_row(raw, "Код 1с"))
    tr["sku_code"] = tr["Код 1с"].map(norm_code)
    tr = tr[tr["sku_code"].notna()]
    shipment_cols = [c for c in tr.columns if _ARRIVAL_RE.search(c)]
    if not shipment_cols:
        warnings.append(f"{transit_path.name}: не найдено ни одной колонки поставки")
    transit_rows = []
    for col in shipment_cols:
        qty = to_num(tr[col])
        arrival = parse_ru_date(_ARRIVAL_RE.search(col).group(1))
        order_ref = col.split(" от ")[0].strip()
        for code, q in zip(tr["sku_code"], qty, strict=True):
            if q > 0:
                transit_rows.append({"sku_code": code, "order_ref": order_ref, "expected_date": arrival, "qty": q})
    transit = pd.DataFrame(transit_rows, columns=["sku_code", "order_ref", "expected_date", "qty"])
    transit_skus = pd.DataFrame({
        "sku_code": tr["sku_code"],
        "supplier_sku": tr["Артикул ИЭК"].map(norm_code),
        "name": tr["Наименование"].astype(str).str.strip(),
    })

    sales_skus = sales.drop_duplicates("sku_code", keep="last")[["sku_code", "name", "unit"]]
    skus = build_sku_master(moq_skus, transit_skus, sales_skus, stock_skus)

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
        warnings=warnings,
    )
