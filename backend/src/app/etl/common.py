"""Общие утилиты ETL и нормализованная схема, в которую приводят данные адаптеры поставщиков."""

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import pandas as pd

_MONTH_PREFIX = {
    "янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6,
    "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
}
_MONTH_HEADER_RE = re.compile(r"^\s*([а-яё]+)\.?\s+(\d{4})", re.IGNORECASE)
_DATE_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})")

SHIPMENT_DOC_TYPE = "Расходная накладная"


def parse_month_header(value: object) -> date | None:
    """«янв. 2024», «сент. 2026», «Январь 2024 г.» → date(2024, 1, 1)."""
    if not isinstance(value, str):
        return None
    m = _MONTH_HEADER_RE.match(value)
    if not m:
        return None
    month = _MONTH_PREFIX.get(m.group(1).lower()[:3])
    return date(int(m.group(2)), month, 1) if month else None


def parse_ru_date(text: str) -> date | None:
    """Первая дата вида dd.mm.yyyy в строке."""
    m = _DATE_RE.search(text or "")
    return date(int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else None


def norm_code(value: object) -> str | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    s = str(value).strip()
    return s or None


def norm_header(value: object) -> str:
    return " ".join(str(value).split()) if value is not None else ""


def to_num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").fillna(0.0).astype(float)


def read_raw(path: Path, sheet: int | str = 0) -> pd.DataFrame:
    """Лист целиком без заголовка — структура файлов 1С «плавает», заголовок ищем сами."""
    return pd.read_excel(path, sheet_name=sheet, header=None, engine="calamine")


def find_header_row(raw: pd.DataFrame, marker: str, max_rows: int = 15) -> int:
    for i in range(min(max_rows, len(raw))):
        if any(norm_header(v) == marker for v in raw.iloc[i].tolist()):
            return i
    raise ValueError(f"Не найдена строка заголовка с колонкой «{marker}»")


def with_header(raw: pd.DataFrame, header_row: int) -> pd.DataFrame:
    df = raw.iloc[header_row + 1 :].copy()
    df.columns = [norm_header(v) or f"_col{i}" for i, v in enumerate(raw.iloc[header_row].tolist())]
    return df.reset_index(drop=True)


def month_matrix_to_long(df: pd.DataFrame, code_col: str) -> pd.DataFrame:
    """Матрица SKU × «янв. 2024 … сент. 2026» → long (sku_code, month, qty). Колонка «Итого» отбрасывается."""
    month_cols = {c: parse_month_header(c) for c in df.columns}
    month_cols = {c: m for c, m in month_cols.items() if m is not None}
    data = df[[code_col, *month_cols]].copy()
    data["sku_code"] = data[code_col].map(norm_code)
    data = data[data["sku_code"].notna()]
    long = data.melt(id_vars="sku_code", value_vars=list(month_cols), var_name="col", value_name="qty")
    long["month"] = long["col"].map(month_cols)
    long["qty"] = to_num(long["qty"])
    return long[["sku_code", "month", "qty"]]


def find_file(folder: Path, *keywords: str) -> Path:
    """xlsx в папке поставщика, имя которого содержит все ключевые слова (без учёта регистра)."""
    matches = [
        p for p in folder.rglob("*.xlsx")
        if not p.name.startswith("~$") and all(k.lower() in p.name.lower() for k in keywords)
    ]
    if not matches:
        raise FileNotFoundError(f"В {folder} нет файла с {keywords}")
    if len(matches) > 1:
        raise ValueError(f"В {folder} несколько файлов с {keywords}: {[m.name for m in matches]}")
    return matches[0]


def read_sales(path: Path) -> pd.DataFrame:
    """«Динамика продаж» — формат одинаков у обоих поставщиков."""
    df = pd.read_excel(path, engine="calamine", dtype={"Номер": str, "Код": str})
    df["ts"] = pd.to_datetime(df["Дата"], format="%d.%m.%Y %H:%M:%S", errors="coerce")
    df = df[df["ts"].notna()]  # отбрасывает строку «Итого»
    out = pd.DataFrame({
        "sku_code": df["Код"].map(norm_code),
        "ts": df["ts"],
        "document": df["Номер"].astype(str).str.strip(),
        "doc_type": df["Документ"].astype(str).str.split(" ").str[:2].str.join(" "),
        "qty": to_num(df["Количество"]),
        "name": df["Номенклатура"].astype(str).str.strip(),
        "unit": df["Ед."].astype(str).str.strip(),
    })
    return out[out["sku_code"].notna()].reset_index(drop=True)


def read_company_seasonality(path: Path) -> pd.DataFrame:
    """Таблица «год × янв…дек» (выручка) → long (year, month, revenue)."""
    xls = pd.ExcelFile(path, engine="calamine")
    for sheet in xls.sheet_names:
        raw = read_raw(path, sheet)
        try:
            hr = find_header_row(raw, "год")
        except ValueError:
            continue
        rows = []
        for _, r in raw.iloc[hr + 1 :].iterrows():
            year = pd.to_numeric(r.iloc[0], errors="coerce")
            if pd.isna(year):
                break
            for m in range(1, 13):
                v = pd.to_numeric(r.iloc[m], errors="coerce")
                if pd.notna(v):
                    rows.append({"year": int(year), "month": m, "revenue": float(v)})
        return pd.DataFrame(rows, columns=["year", "month", "revenue"])
    raise ValueError(f"В {path.name} не найдена таблица сезонности")


@dataclass
class SupplierBundle:
    """Нормализованные данные одного поставщика — единый формат для загрузчика и расчёта."""

    supplier_id: str
    supplier_name: str
    default_lead_time_days: int
    skus: pd.DataFrame  # sku_code, supplier_sku, name, unit, category_id, unit_cost
    sales: pd.DataFrame  # sku_code, ts, document, doc_type, qty
    stock_monthly: pd.DataFrame  # sku_code, month, qty
    transit: pd.DataFrame  # sku_code, order_ref, expected_date, qty
    rules: pd.DataFrame  # sku_code, min_order_qty, order_multiple
    seasonality: pd.DataFrame  # year, month, revenue
    # sku_code, as_of, on_hand, reserved, free, locations
    stock_current: pd.DataFrame = field(default_factory=pd.DataFrame)
    reference: pd.DataFrame = field(default_factory=pd.DataFrame)  # sku_code, growth_coef, seasonality_coef, ...
    warnings: list[str] = field(default_factory=list)


def build_sku_master(*sources: pd.DataFrame) -> pd.DataFrame:
    """Склейка справочника SKU из нескольких файлов: первое непустое значение по порядку источников."""
    cols = ["sku_code", "supplier_sku", "name", "unit", "category_id", "unit_cost"]
    frames = [s.reindex(columns=cols) for s in sources if not s.empty]
    merged = pd.concat(frames, ignore_index=True)
    merged = merged.replace({"": None, "nan": None, "None": None})
    master = merged.groupby("sku_code", sort=False).first().reset_index()
    master["unit"] = master["unit"].fillna("шт")
    master["name"] = master["name"].fillna(master["sku_code"])
    return master[cols]
