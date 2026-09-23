"""Supplier ZIP reports reuse the actual IEK/SE adapters without replacing other suppliers."""

from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory

from fastapi import HTTPException
from sqlalchemy import String, cast, delete, select
from sqlalchemy.orm import Session

from app import models as m
from app.etl import iek, systeme
from app.etl.loader import _bulk_insert, _records
from app.services import input_data as data
from app.services.tabular_import import check_zip

MAX_BUNDLE_BYTES = 64 * 1024 * 1024
ADAPTERS = {"iek": iek.load, "se": systeme.load}


def load_bundle(blob: bytes, supplier: str):
    try:
        return _load_bundle(blob, supplier)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(422, "Не удалось прочитать ZIP/XLSX: архив повреждён или формат не поддерживается") from exc


def _load_bundle(blob: bytes, supplier: str):
    if supplier not in ADAPTERS:
        raise HTTPException(422, "Адаптеры доступны для iek и se")
    if len(blob) > MAX_BUNDLE_BYTES:
        raise HTTPException(413, "Максимальный размер ZIP — 64 МБ")
    with TemporaryDirectory(prefix="hackalem-upload-") as directory:
        with check_zip(blob, max_entries=100, max_size=256 * 1024 * 1024) as archive:
            names = set()
            expanded_total = 0
            for entry in archive.infolist():
                path = PurePosixPath(entry.filename.replace("\\", "/"))
                if path.is_absolute() or ".." in path.parts or ":" in entry.filename:
                    raise HTTPException(422, "Недопустимый путь в архиве")
                if entry.is_dir() or path.suffix.lower() != ".xlsx" or path.name.startswith("~$"):
                    continue
                if path.name.casefold() in names:
                    raise HTTPException(422, "В архиве повторяются имена Excel-файлов")
                names.add(path.name.casefold())
                contents = archive.read(entry)
                # Bound the second compression layer (XLSX is itself a ZIP).
                with check_zip(contents, max_entries=1000, max_size=256 * 1024 * 1024) as workbook:
                    expanded_total += sum(entry.file_size for entry in workbook.infolist())
                    if expanded_total > 512 * 1024 * 1024:
                        raise HTTPException(413, "Суммарное содержимое XLSX превышает 512 МБ")
                Path(directory, path.name).write_bytes(contents)
            if not names:
                raise HTTPException(422, "В архиве нет XLSX-файлов")
        try:
            return ADAPTERS[supplier](Path(directory))
        except (ValueError, KeyError, FileNotFoundError, IndexError) as exc:
            # Adapter errors may include temporary paths; return a portable message.
            message = f"Комплект {supplier} не соответствует формату отчётов: {type(exc).__name__}"
            raise HTTPException(422, message) from exc


def import_bundle(db: Session, blob: bytes, supplier_id: str, dry_run: bool):
    bundle = load_bundle(blob, supplier_id)
    if bundle.skus.empty:
        raise HTTPException(422, "Комплект не содержит товаров")
    if bundle.skus["sku_code"].duplicated().any():
        raise HTTPException(422, "Коды товаров в комплекте повторяются")
    data.begin_write(db)
    codes = set(bundle.skus["sku_code"])
    # Reject collisions before any deletion; SKU code is globally unique.
    other_codes = set(db.scalars(select(m.Sku.code).where(m.Sku.supplier_id != supplier_id)))
    collision = codes & other_codes
    if collision:
        raise HTTPException(409, {"message": "Коды уже принадлежат другому поставщику",
                                  "sku_codes": sorted(collision)[:50]})
    old_codes = set(db.scalars(select(m.Sku.code).where(m.Sku.supplier_id == supplier_id)))
    # Retain old catalog rows for historic recommendations; inputs are replaced only for this supplier.
    all_codes = codes | old_codes
    counts = {"products": len(codes), "sales": len(bundle.sales), "stock_monthly": len(bundle.stock_monthly),
              "stock_current": len(bundle.stock_current), "transit": len(bundle.transit),
              "supplier_rules": len(bundle.rules), "seasonality": len(bundle.seasonality)}
    for frame in (bundle.sales, bundle.stock_monthly, bundle.stock_current, bundle.transit,
                  bundle.rules, bundle.reference):
        if not frame.empty and not set(frame["sku_code"]).issubset(codes):
            raise HTTPException(422, "В отчётах есть строки с товаром, отсутствующим в справочнике комплекта")
    if dry_run:
        db.rollback()
        return {"dry_run": True, "applied": False, "supplier_id": supplier_id,
                "counts": counts, "warnings": bundle.warnings}

    # Remove identity mappings by the IDs being replaced, not by caller-controlled source names.
    # Chunk SKU filters to work on SQLite builds with a low host-parameter limit.
    code_list = sorted(all_codes)
    for start in range(0, len(code_list), 500):
        for name, model in (("sales", m.SalesLine), ("transit", m.GoodsInTransit)):
            ids = select(cast(model.id, String)).where(model.sku_code.in_(code_list[start:start + 500]))
            db.execute(delete(m.ImportIdentity).where(m.ImportIdentity.resource == name,
                                                      m.ImportIdentity.record_key.in_(ids)))
        for model in (m.SalesLine, m.StockMonthly, m.StockCurrent, m.GoodsInTransit, m.SupplierRule, m.ReferenceMetric):
            db.execute(delete(model).where(model.sku_code.in_(code_list[start:start + 500])))
    db.execute(delete(m.SupplierSeasonality).where(m.SupplierSeasonality.supplier_id == supplier_id))
    supplier = db.get(m.Supplier, supplier_id)
    if supplier is None:
        supplier = m.Supplier(id=supplier_id, name=bundle.supplier_name, lead_time_days=bundle.default_lead_time_days)
        db.add(supplier)
    db.flush()
    skus = bundle.skus.copy()
    skus["category_id"] = skus["category_id"].fillna("none")
    for category in set(skus["category_id"]):
        if db.get(m.Category, category) is None:
            db.add(m.Category(id=category, name="Без категории" if category == "none" else f"Категория {category}"))
    db.flush()
    existing = {sku.code: sku for sku in db.scalars(select(m.Sku).where(m.Sku.supplier_id == supplier_id))}
    for values in _records(skus.rename(columns={"sku_code": "code"})):
        sku = existing.get(values["code"]) or m.Sku(code=values["code"])
        for field, value in values.items():
            setattr(sku, field, value)
        sku.supplier_id = supplier_id
        db.add(sku)
    db.flush()
    frames = ((m.SalesLine, bundle.sales),
              (m.StockMonthly, bundle.stock_monthly.drop_duplicates(["sku_code", "month"], keep="last")),
              (m.StockCurrent, bundle.stock_current),
              (m.GoodsInTransit, bundle.transit.assign(supplier_id=supplier_id)),
              (m.SupplierRule, bundle.rules.assign(supplier_id=supplier_id)),
              (m.SupplierSeasonality, bundle.seasonality.assign(supplier_id=supplier_id)),
              (m.ReferenceMetric, bundle.reference))
    for model, frame in frames:
        if not frame.empty:
            _bulk_insert(db, model, frame)
    data.audit(db, "supplier-bundle", supplier_id, "replace", None, counts, source="supplier-zip")
    db.commit()
    return {"dry_run": False, "applied": True, "supplier_id": supplier_id,
            "counts": counts, "warnings": bundle.warnings}
