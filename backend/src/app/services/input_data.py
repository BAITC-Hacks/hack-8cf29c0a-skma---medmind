"""Input CRUD, referential integrity and audits. No implicit cascading deletes."""

from dataclasses import dataclass
from datetime import date, datetime

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, ValidationError
from sqlalchemy import delete, inspect, select, text
from sqlalchemy.orm import Session

from app import input_schemas as s
from app import models as m


@dataclass(frozen=True)
class Resource:
    model: type
    schema: type[BaseModel]
    keys: tuple[str, ...]
    generated: bool = False


RESOURCES = {
    "products": Resource(m.Sku, s.ProductInput, ("code",)),
    "suppliers": Resource(m.Supplier, s.SupplierInput, ("id",)),
    "categories": Resource(m.Category, s.CategoryInput, ("id",)),
    "sales": Resource(m.SalesLine, s.SalesInput, ("id",), True),
    "stock-monthly": Resource(m.StockMonthly, s.MonthlyStockInput, ("sku_code", "month")),
    "stock-current": Resource(m.StockCurrent, s.CurrentStockInput, ("sku_code",)),
    "transit": Resource(m.GoodsInTransit, s.TransitInput, ("id",), True),
    "supplier-rules": Resource(m.SupplierRule, s.RuleInput, ("sku_code",)),
    "seasonality": Resource(m.SupplierSeasonality, s.SeasonalityInput, ("supplier_id", "year", "month")),
    "reference-metrics": Resource(m.ReferenceMetric, s.ReferenceInput, ("sku_code",)),
}


def resource(name: str) -> Resource:
    if name not in RESOURCES:
        raise HTTPException(404, "Неизвестный вид входных данных")
    return RESOURCES[name]


def begin_write(db: Session):
    # Serialize writers before checking a running calculation or import identities.
    db.execute(text("BEGIN IMMEDIATE"))
    if db.scalar(select(m.CalcRun.id).where(m.CalcRun.status == "running").limit(1)):
        raise HTTPException(409, "Дождитесь завершения текущего расчёта")


def validate(spec: Resource, payload: dict) -> dict:
    try:
        values = spec.schema.model_validate(payload).model_dump()
    except ValidationError as exc:
        raise HTTPException(422, exc.errors(include_url=False, include_context=False, include_input=False)) from exc
    if spec.model is m.StockCurrent:
        values["free"] = values["on_hand"] - values["reserved"]
    return values


def record_key(spec: Resource, values: dict) -> str:
    return "~".join(str(values[k]) for k in spec.keys)


def dump(record) -> dict:
    return jsonable_encoder({col.key: getattr(record, col.key) for col in inspect(type(record)).columns})


def find(db: Session, spec: Resource, key: str):
    parts = key.split("~")
    if len(parts) != len(spec.keys):
        raise HTTPException(422, "Некорректный составной ключ")
    query = select(spec.model)
    try:
        for field, value in zip(spec.keys, parts, strict=True):
            col = getattr(spec.model, field)
            kind = col.type.python_type
            value = date.fromisoformat(value) if kind is date else kind(value)
            query = query.where(col == value)
    except ValueError as exc:
        raise HTTPException(422, "Некорректный ключ записи") from exc
    return db.scalar(query)


def dependencies(db: Session, spec: Resource, record):
    checks = []
    if spec.model is m.Sku:
        checks = [(model, model.sku_code == record.code) for model in (
            m.SalesLine, m.StockMonthly, m.StockCurrent, m.GoodsInTransit, m.SupplierRule,
            m.ReferenceMetric, m.SkuForecast, m.OrderRecommendation,
        )]
    elif spec.model is m.Supplier:
        checks = [(model, model.supplier_id == record.id) for model in (
            m.Sku, m.GoodsInTransit, m.SupplierRule, m.SupplierSeasonality, m.OrderRecommendation,
        )]
    elif spec.model is m.Category:
        checks = [(model, model.category_id == record.id) for model in (m.Sku, m.OrderRecommendation)]
    return [model.__tablename__ for model, condition in checks
            if db.scalar(select(model).where(condition).limit(1)) is not None]


def check_links(db: Session, spec: Resource, values: dict, existing=None):
    for field, model in (("supplier_id", m.Supplier), ("category_id", m.Category), ("sku_code", m.Sku)):
        if field in values and db.get(model, values[field]) is None:
            raise HTTPException(422, f"{field}: запись {values[field]} не найдена")
    if "sku_code" in values and "supplier_id" in values:
        sku = db.get(m.Sku, values["sku_code"])
        if sku.supplier_id != values["supplier_id"]:
            raise HTTPException(422, "Поставщик не соответствует товару")
    if spec.model is m.Sku and existing and existing.supplier_id != values["supplier_id"]:
        if dependencies(db, spec, existing):
            raise HTTPException(409, "Нельзя сменить поставщика товара со связанными данными")


def audit(db: Session, name: str, key: str, action: str, before, after, source="manual"):
    db.add(m.AuditLog(ts=datetime.now(), action=action, entity=f"input:{name}", entity_id=key[:64],
                      payload={"key": key, "source": source, "before": before, "after": after}))


def save(db: Session, name: str, values: dict, existing=None, source="manual"):
    spec = resource(name)
    check_links(db, spec, values, existing)
    before = dump(existing) if existing else None
    record = existing or spec.model()
    for field, value in values.items():
        setattr(record, field, value)
    db.add(record)
    db.flush()
    after = dump(record)
    if before != after:
        audit(db, name, record_key(spec, after), "update" if before else "create", before, after, source)
    return record


def remove(db: Session, name: str, record):
    spec = resource(name)
    blocked = dependencies(db, spec, record)
    if blocked:
        raise HTTPException(409, {"message": "Есть связанные записи; удаление отменено", "tables": blocked})
    before = dump(record)
    key = record_key(spec, before)
    db.execute(delete(m.ImportIdentity).where(m.ImportIdentity.resource == name, m.ImportIdentity.record_key == key))
    audit(db, name, key, "delete", before, None)
    db.delete(record)
