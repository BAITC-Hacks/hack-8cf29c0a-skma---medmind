"""CRUD for all engine inputs; static typed schemas exposed for each resource."""

import json
from typing import Annotated

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import ValidationError
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.db import get_db
from app.services import input_data as data
from app.services.tabular_import import MAX_BYTES, ImportOptions, import_table

router = APIRouter(prefix="/input-data", tags=["input-data"])


@router.get("")
def describe_resources():
    return {name: {"key_fields": spec.keys, "generated_key": spec.generated,
                   "schema": spec.schema.model_json_schema()} for name, spec in data.RESOURCES.items()}


def write_conflict(db, exc):
    db.rollback()
    raise HTTPException(409, "Конфликт данных или база занята; обновите данные и повторите запрос") from exc


@router.post("/{resource}/import")
def upload_table(resource: str, file: Annotated[UploadFile, File()], options: str = Form("{}"),
                 dry_run: bool = Form(True), db: Session = Depends(get_db)):
    """CSV/XLSX: options is JSON ImportOptions. Preview by default; errors roll back the entire file."""
    data.resource(resource)
    try:
        settings = ImportOptions.model_validate_json(options)
    except ValidationError as exc:
        raise HTTPException(422, json.loads(exc.json(include_url=False, include_context=False))) from exc
    try:
        blob = file.file.read(MAX_BYTES + 1)
        report = import_table(db, resource, blob, file.filename or "", settings, dry_run)
        if report["errors"]:
            raise HTTPException(422, report)
        return report
    except (IntegrityError, OperationalError) as exc:
        write_conflict(db, exc)
    finally:
        file.file.close()


def register(name, spec):
    # Concrete routes keep JSON request schemas visible in Swagger without duplicating CRUD logic.
    def listing(limit: int = Query(50, ge=1, le=500), offset: int = Query(0, ge=0),
                sku_code: str | None = None, supplier_id: str | None = None,
                category_id: str | None = None, search: str | None = Query(None, max_length=200),
                db: Session = Depends(get_db)):
        query = select(spec.model)
        for field, value in (("sku_code", sku_code), ("supplier_id", supplier_id), ("category_id", category_id)):
            if value is not None:
                column = "code" if field == "sku_code" and name == "products" else field
                if not hasattr(spec.model, column):
                    raise HTTPException(422, f"Фильтр {field} не поддерживается")
                query = query.where(getattr(spec.model, column) == value)
        if search:
            columns = [getattr(spec.model, col) for col in ("name", "code", "supplier_sku", "document", "order_ref")
                       if hasattr(spec.model, col)]
            if not columns:
                raise HTTPException(422, "Поиск для этого ресурса не поддерживается")
            query = query.where(or_(*(func.lower(col).contains(search.casefold(), autoescape=True) for col in columns)))
        total = db.scalar(select(func.count()).select_from(query.subquery()))
        records = db.scalars(query.order_by(*(getattr(spec.model, k) for k in spec.keys)).offset(offset).limit(limit))
        return {"items": [data.dump(r) for r in records], "total": total, "limit": limit, "offset": offset}

    def read(record_key: str, db: Session = Depends(get_db)):
        record = data.find(db, spec, record_key)
        if record is None:
            raise HTTPException(404, "Запись не найдена")
        return data.dump(record)

    def create(body=Body(...), db: Session = Depends(get_db)):
        try:
            data.begin_write(db)
            values = data.validate(spec, body.model_dump())
            if not spec.generated and data.find(db, spec, data.record_key(spec, values)):
                raise HTTPException(409, "Запись с таким ключом уже существует")
            record = data.save(db, name, values)
            db.commit()
            return data.dump(record)
        except (IntegrityError, OperationalError) as exc:
            write_conflict(db, exc)

    def update(record_key: str, body=Body(...), db: Session = Depends(get_db)):
        try:
            data.begin_write(db)
            record = data.find(db, spec, record_key)
            if record is None:
                raise HTTPException(404, "Запись не найдена")
            values = data.validate(spec, body.model_dump())
            if not spec.generated and data.record_key(spec, values) != data.record_key(spec, data.dump(record)):
                raise HTTPException(422, "Ключ записи изменять нельзя")
            record = data.save(db, name, values, record)
            db.commit()
            return data.dump(record)
        except (IntegrityError, OperationalError) as exc:
            write_conflict(db, exc)

    def remove(record_key: str, db: Session = Depends(get_db)):
        try:
            data.begin_write(db)
            record = data.find(db, spec, record_key)
            if record is None:
                raise HTTPException(404, "Запись не найдена")
            data.remove(db, name, record)
            db.commit()
            return {"deleted": True, "key": record_key}
        except (IntegrityError, OperationalError) as exc:
            write_conflict(db, exc)

    create.__annotations__["body"] = spec.schema
    update.__annotations__["body"] = spec.schema
    for path, handler, method, status in (("", listing, "GET", 200), ("", create, "POST", 201),
                                          ("/{record_key}", read, "GET", 200),
                                          ("/{record_key}", update, "PUT", 200),
                                          ("/{record_key}", remove, "DELETE", 200)):
        router.add_api_route(f"/{name}{path}", handler, methods=[method], status_code=status,
                             name=f"{method.lower()}_{name}{'_record' if path else ''}")


for name, spec in data.RESOURCES.items():
    register(name, spec)
