"""Разбор файлов, которые пользователь прикладывает в «ленивом режиме».

Поддерживаются два вида таблиц:
  * «длинная» — строка = документ/день: колонка даты + колонка количества (+ код товара), например
    выгрузка «Динамика продаж» из 1С;
  * «широкая» — строка = товар, колонки = месяцы («янв. 2025», «Январь 2025 г.», «2025-01»), например
    «Ежемесячные продажи».
Файл целиком в OpenAI не отправляется: модель получает описание структуры и агрегаты через инструменты.
"""

import csv
import io
import re

import numpy as np
import pandas as pd

from app.engine.core import detect_bulk_outliers
from app.engine.timeseries import forecast_monthly
from app.etl.common import norm_code, norm_header, parse_month_header

MAX_FILE_BYTES = 20 * 1024 * 1024
MAX_ROWS = 300_000
ALLOWED_EXT = (".csv", ".xlsx", ".xlsm", ".txt")

_DATE_HINTS = ("дата", "date", "период", "period", "день", "месяц")
_QTY_HINTS = ("колич", "кол-во", "qty", "quantity", "продаж", "отгруз", "шт", "объем", "объём", "sales")
_SKU_HINTS = ("код", "sku", "артикул", "article")
_NAME_HINTS = ("номенклатура", "наименование", "товар", "name", "product")
_DOC_HINTS = ("номер", "документ", "document", "doc")
_ISO_MONTH_RE = re.compile(r"^\d{4}-\d{2}$")


class FileParseError(ValueError):
    pass


# ---------------------------------------------------------------- чтение

def _read_csv(blob: bytes) -> pd.DataFrame:
    for encoding in ("utf-8-sig", "cp1251"):
        try:
            text = blob.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise FileParseError("Не удалось определить кодировку CSV (ожидается UTF-8 или Windows-1251)")
    try:
        delimiter = csv.Sniffer().sniff(text[:10_000], delimiters=";,\t").delimiter
    except csv.Error:
        delimiter = ";"
    return pd.read_csv(io.StringIO(text), sep=delimiter, header=None, dtype=str, nrows=MAX_ROWS + 50)


def _read_excel(blob: bytes) -> pd.DataFrame:
    try:
        return pd.read_excel(io.BytesIO(blob), header=None, engine="calamine", nrows=MAX_ROWS + 50)
    except Exception as exc:  # повреждённый/не-xlsx файл
        raise FileParseError(f"Не удалось прочитать Excel: {exc}") from exc


def _pick_header_row(raw: pd.DataFrame) -> int:
    """Строка заголовка — первая из первых 15, где больше всего непустых текстовых ячеек."""
    best, best_score = 0, -1
    for i in range(min(15, len(raw))):
        row = raw.iloc[i]
        score = sum(isinstance(v, str) and v.strip() != "" and not _looks_numeric(v) for v in row)
        if score > best_score:
            best, best_score = i, score
    return best


def _looks_numeric(v: str) -> bool:
    try:
        float(str(v).replace(" ", "").replace(",", "."))
        return True
    except ValueError:
        return False


def load_table(blob: bytes, filename: str) -> pd.DataFrame:
    if len(blob) > MAX_FILE_BYTES:
        raise FileParseError("Файл больше 20 МБ")
    name = filename.lower()
    if not name.endswith(ALLOWED_EXT):
        raise FileParseError("Поддерживаются CSV и XLSX")
    raw = _read_csv(blob) if name.endswith((".csv", ".txt")) else _read_excel(blob)
    raw = raw.dropna(how="all").dropna(axis=1, how="all").reset_index(drop=True)
    if raw.empty:
        raise FileParseError("Файл пустой")
    hr = _pick_header_row(raw)
    df = raw.iloc[hr + 1 :].copy()
    cols, seen = [], {}
    for i, v in enumerate(raw.iloc[hr].tolist()):
        c = norm_header(v) if v is not None and not (isinstance(v, float) and np.isnan(v)) else ""
        c = c or f"Колонка {i + 1}"
        seen[c] = seen.get(c, 0) + 1
        cols.append(c if seen[c] == 1 else f"{c} ({seen[c]})")
    df.columns = cols
    df = df.dropna(how="all").reset_index(drop=True)
    if len(df) > MAX_ROWS:
        raise FileParseError(f"В файле больше {MAX_ROWS} строк")
    return df


# ---------------------------------------------------------------- схема

def _find_col(columns: list[str], hints: tuple[str, ...], exclude: set[str] = frozenset()) -> str | None:
    for c in columns:
        low = c.lower()
        if c not in exclude and any(h in low for h in hints):
            return c
    return None


def _month_of(col: str):
    if _ISO_MONTH_RE.match(col):
        return pd.Period(col, freq="M")
    d = parse_month_header(col)
    return pd.Period(d, freq="M") if d else None


def _to_number(s: pd.Series) -> pd.Series:
    if s.dtype == object or pd.api.types.is_string_dtype(s):
        s = s.astype(str).str.replace(" ", "", regex=False).str.replace(" ", "", regex=False)
        s = s.str.replace(",", ".", regex=False)
    return pd.to_numeric(s, errors="coerce")


def _to_datetime(s: pd.Series) -> pd.Series:
    if pd.api.types.is_datetime64_any_dtype(s):
        return s
    parsed = pd.to_datetime(s, errors="coerce", dayfirst=True, format="mixed")
    return parsed


def detect_schema(df: pd.DataFrame) -> dict:
    columns = list(df.columns)
    month_cols = {c: m for c in columns if (m := _month_of(c)) is not None}
    sku_col = _find_col(columns, _SKU_HINTS)
    name_col = _find_col(columns, _NAME_HINTS, exclude={sku_col} if sku_col else set())
    if len(month_cols) >= 3:
        return {"kind": "wide", "sku_col": sku_col, "name_col": name_col,
                "month_cols": {c: str(m) for c, m in month_cols.items()}}

    date_col = _find_col(columns, _DATE_HINTS)
    if date_col is None:  # колонка, где большинство значений парсится как дата
        for c in columns:
            if _to_datetime(df[c].head(200)).notna().mean() > 0.8:
                date_col = c
                break
    qty_col = _find_col(columns, _QTY_HINTS, exclude={date_col, sku_col, name_col} - {None})
    if qty_col is None:
        numeric = [c for c in columns
                   if c not in {date_col, sku_col} and _to_number(df[c].head(200)).notna().mean() > 0.8]
        qty_col = numeric[-1] if numeric else None
    if date_col is None or qty_col is None:
        raise FileParseError(
            "Не удалось найти колонку даты и колонку количества. Ожидается таблица «Дата | Код | Количество» "
            "или «Товар | янв. 2025 | февр. 2025 | …»"
        )
    return {"kind": "long", "date_col": date_col, "qty_col": qty_col, "sku_col": sku_col,
            "name_col": name_col, "doc_col": _find_col(columns, _DOC_HINTS, exclude={sku_col} - {None})}


# ---------------------------------------------------------------- нормализация

def normalize(df: pd.DataFrame, schema: dict) -> pd.DataFrame:
    """→ long: sku, name, period, qty[, ts, document]. В «длинной» таблице строки сохраняются для детекции выбросов."""
    if schema["kind"] == "wide":
        month_cols = schema["month_cols"]
        data = pd.DataFrame({
            "sku": df[schema["sku_col"]].map(norm_code) if schema["sku_col"] else "Итого",
            "name": df[schema["name_col"]].astype(str).str.strip() if schema["name_col"] else None,
        })
        for c in month_cols:
            data[c] = _to_number(df[c]).fillna(0.0)
        data = data[data["sku"].notna()]
        # строки «Итого» в выгрузках 1С дублируют сумму — отбрасываем
        if schema["name_col"]:
            data = data[~data["name"].str.lower().str.startswith("итог")]
        long = data.melt(id_vars=["sku", "name"], value_vars=list(month_cols), var_name="col", value_name="qty")
        long["period"] = long["col"].map(lambda c: pd.Period(month_cols[c], freq="M"))
        return long[["sku", "name", "period", "qty"]]

    ts = _to_datetime(df[schema["date_col"]])
    out = pd.DataFrame({
        "ts": ts,
        "qty": _to_number(df[schema["qty_col"]]),
        "sku": df[schema["sku_col"]].map(norm_code) if schema["sku_col"] else "Итого",
        "name": df[schema["name_col"]].astype(str).str.strip() if schema["name_col"] else None,
        "document": df[schema["doc_col"]].astype(str) if schema.get("doc_col") else None,
    })
    out = out[out["ts"].notna() & out["qty"].notna()]
    out["sku"] = out["sku"].fillna("—")
    out["period"] = out["ts"].dt.to_period("M")
    return out.reset_index(drop=True)


def summarize(df: pd.DataFrame, schema: dict) -> dict:
    """Описание файла для модели: структура, период, объёмы, топ товаров. Без сырых строк."""
    data = normalize(df, schema)
    if data.empty:
        raise FileParseError("В файле не нашлось строк с датой/месяцем и количеством")
    by_sku = data.groupby("sku")["qty"].sum().sort_values(ascending=False)
    names = data.dropna(subset=["name"]).drop_duplicates("sku").set_index("sku")["name"] if "name" in data else {}
    monthly = data.groupby("period")["qty"].sum().sort_index()
    return {
        "kind": schema["kind"],
        "kind_label": "строки документов (дата + количество)" if schema["kind"] == "long" else "помесячная матрица",
        "columns": list(df.columns)[:40],
        "detected": {k: v for k, v in schema.items() if k != "month_cols"},
        "rows": int(len(df)),
        "skus": int(by_sku.size),
        "period_from": str(monthly.index.min()),
        "period_to": str(monthly.index.max()),
        "months": int(monthly.size),
        "total_qty": round(float(data["qty"].sum()), 2),
        "negative_rows": int((data["qty"] < 0).sum()),
        "top_skus": [
            {"sku": s, "name": (names.get(s) if hasattr(names, "get") else None), "qty": round(float(q), 2)}
            for s, q in by_sku.head(10).items()
        ],
        "monthly_totals_tail": [{"period": str(p), "qty": round(float(q), 2)} for p, q in monthly.tail(6).items()],
    }


def file_forecast(df: pd.DataFrame, schema: dict, sku: str | None, horizon_months: int,
                  exclude_outliers: bool = True, sensitivity: float = 0.5) -> dict:
    """Помесячная история + прогноз по SKU (или по всем товарам, если sku не задан)."""
    full = normalize(df, schema)
    data = full
    title = "все товары файла"
    if sku:
        match = data[data["sku"].astype(str).str.casefold() == sku.casefold()]
        if match.empty and "name" in data:  # поиск по наименованию
            match = data[data["name"].astype(str).str.casefold().str.contains(sku.casefold(), regex=False, na=False)]
        if match.empty:
            raise FileParseError(f"В файле нет товара «{sku}»")
        if match["sku"].nunique() > 1:  # не суммируем молча разные товары — пусть модель уточнит
            candidates = match.drop_duplicates("sku")[["sku", "name"]].head(10)
            listing = "; ".join(f"{r.sku} — {r.name}" for r in candidates.itertuples())
            raise FileParseError(f"Под «{sku}» подходит {match['sku'].nunique()} товаров, уточните код: {listing}")
        data = match
        first_name = data["name"].dropna().iloc[0] if data["name"].notna().any() else None
        title = f"{data['sku'].iloc[0]}" + (f" — {first_name}" if first_name else "")

    excluded = []
    excluded_total = 0.0
    if exclude_outliers and schema["kind"] == "long":
        ship = data[data["qty"] > 0].rename(columns={"sku": "sku_code"})
        flags = detect_bulk_outliers(ship, sensitivity)
        if flags.any():
            out_rows = ship[flags].sort_values("qty", ascending=False)
            excluded = [
                {"date": r.ts.date().isoformat(), "qty": float(r.qty), "sku": r.sku_code,
                 "document": None if r.document is None else str(r.document)}
                for r in out_rows.head(20).itertuples()
            ]
            excluded_total = float(out_rows["qty"].sum())
            data = data.drop(index=ship.index[flags])

    # отгрузки как спрос; возвраты (отрицательные) в прогноз не идут
    series = data[data["qty"] > 0].groupby("period")["qty"].sum()
    notes = []
    last = _partial_last_month(full, schema)
    if last is not None and last in series.index:
        series = series.drop(last)
        notes.append(f"{last} — неполный месяц, в историю не включён; прогноз начинается с него")
    result = forecast_monthly(series, horizon_months)
    result["notes"] = notes + result["notes"]
    if not sku and data["sku"].nunique() > 1:
        result["notes"].append("Прогноз по сумме всех товаров — единицы измерения могут различаться (шт, м, упак)")
    result.update({"title": title, "bulk_outliers_excluded": excluded,
                   "bulk_outliers_count": int(flags.sum()) if excluded else 0,
                   "bulk_outliers_total_qty": round(excluded_total, 2)})
    return result


def _partial_last_month(data: pd.DataFrame, schema: dict) -> pd.Period | None:
    """Последний месяц файла неполный, если выгрузка обрывается раньше чем за 3 дня до конца месяца (строки
    документов) или если это текущий календарный месяц (помесячная матрица). Считается по всему файлу."""
    if data.empty:
        return None
    last = data["period"].max()
    if schema["kind"] == "long":
        max_day = data["ts"].max()
        return last if max_day.day < max_day.days_in_month - 3 else None
    return last if last == pd.Period(pd.Timestamp.today(), freq="M") else None
