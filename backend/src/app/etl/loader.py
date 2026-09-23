"""Загрузка xlsx партнёра в БД. Новый поставщик = новый модуль-адаптер + строка в ADAPTERS."""

import logging
import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import pandas as pd
from sqlalchemy import delete, insert
from sqlalchemy.orm import Session

from app import models
from app.etl import iek, systeme
from app.etl.common import SupplierBundle

log = logging.getLogger(__name__)

NO_CATEGORY_ID = "none"


@dataclass(frozen=True)
class Adapter:
    folder_keyword: str  # подпапка DATA_DIR, в названии которой есть это слово
    load: Callable[[Path], SupplierBundle]


ADAPTERS: list[Adapter] = [
    Adapter("iek", iek.load),
    Adapter("systeme", systeme.load),
]

_DATA_TABLES = [
    models.SalesLine, models.StockMonthly, models.StockCurrent, models.GoodsInTransit,
    models.SupplierRule, models.SupplierSeasonality, models.ReferenceMetric, models.Sku,
]


def _find_folder(data_dir: Path, keyword: str) -> Path:
    for p in sorted(data_dir.iterdir()):
        if p.is_dir() and keyword in p.name.lower():
            return p
    raise FileNotFoundError(f"В {data_dir} нет папки поставщика с «{keyword}» в названии")


def _records(df: pd.DataFrame) -> list[dict]:
    """DataFrame → список dict с None вместо NaN/NaT и нативными python-типами."""
    out = df.astype(object).where(df.notna(), None).to_dict("records")
    for rec in out:
        for k, v in rec.items():
            if isinstance(v, pd.Timestamp):
                rec[k] = v.to_pydatetime()
            elif isinstance(v, float) and math.isnan(v):
                rec[k] = None
    return out


def _bulk_insert(db: Session, model, df: pd.DataFrame, chunk: int = 20_000) -> None:
    for start in range(0, len(df), chunk):
        db.execute(insert(model), _records(df.iloc[start : start + chunk]))


def load_bundles(data_dir: Path) -> list[SupplierBundle]:
    bundles = []
    for adapter in ADAPTERS:
        folder = _find_folder(data_dir, adapter.folder_keyword)
        log.info("ETL %s ← %s", adapter.folder_keyword, folder)
        bundles.append(adapter.load(folder))
    return bundles


def ingest(db: Session, data_dir: Path) -> dict:
    """Полная перезаливка данных поставщиков. Возвращает статистику по загруженным строкам."""
    bundles = load_bundles(data_dir)

    # Full replacement invalidates IDs of previously imported sales/transit rows.
    db.execute(delete(models.ImportIdentity))

    for model in _DATA_TABLES:
        db.execute(delete(model))

    seen_codes: set[str] = set()
    stats: dict = {"suppliers": {}, "warnings": []}
    category_ids: set[str] = {NO_CATEGORY_ID}

    for b in bundles:
        supplier = db.get(models.Supplier, b.supplier_id)
        if supplier is None:
            db.add(models.Supplier(id=b.supplier_id, name=b.supplier_name, lead_time_days=b.default_lead_time_days))
        else:
            supplier.name = b.supplier_name  # lead_time_days — пользовательская настройка, не трогаем

        # Код 1С — глобальный ключ; если SKU внезапно есть у двух поставщиков, побеждает первый.
        dup = b.skus["sku_code"].isin(seen_codes)
        if dup.any():
            stats["warnings"].append(f"{b.supplier_id}: {int(dup.sum())} SKU уже есть у другого поставщика, пропущены")
        skus = b.skus[~dup].copy()
        seen_codes.update(skus["sku_code"])
        skus["supplier_id"] = b.supplier_id
        skus["category_id"] = skus["category_id"].fillna(NO_CATEGORY_ID)
        category_ids.update(skus["category_id"])

        _bulk_insert(db, models.Sku, skus.rename(columns={"sku_code": "code"}))
        _bulk_insert(db, models.SalesLine, b.sales)
        _bulk_insert(db, models.StockMonthly, b.stock_monthly.drop_duplicates(["sku_code", "month"], keep="last"))
        if not b.stock_current.empty:
            _bulk_insert(db, models.StockCurrent, b.stock_current)
        _bulk_insert(db, models.GoodsInTransit, b.transit.assign(supplier_id=b.supplier_id))
        rules = b.rules[b.rules["sku_code"].isin(skus["sku_code"])]
        _bulk_insert(db, models.SupplierRule, rules.assign(supplier_id=b.supplier_id))
        _bulk_insert(db, models.SupplierSeasonality, b.seasonality.assign(supplier_id=b.supplier_id))
        if not b.reference.empty:
            _bulk_insert(db, models.ReferenceMetric, b.reference)

        stats["suppliers"][b.supplier_id] = {
            "skus": len(skus),
            "sales_lines": len(b.sales),
            "stock_monthly": len(b.stock_monthly),
            "stock_current": len(b.stock_current),
            "transit": len(b.transit),
            "rules": len(b.rules),
            "reference": len(b.reference),
        }
        stats["warnings"].extend(b.warnings)

    for cid in sorted(category_ids):
        if db.get(models.Category, cid) is None:
            name = "Без категории" if cid == NO_CATEGORY_ID else f"Категория {cid}"
            db.add(models.Category(id=cid, name=name, buffer_multiplier=1.0))

    if db.get(models.CalcParams, 1) is None:
        db.add(models.CalcParams(id=1))

    db.commit()
    return stats
