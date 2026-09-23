"""Catalog and sales views backed by the same inputs used by the calculation engine."""

import csv
import io
from datetime import date, datetime, time, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import case, func, or_, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app import input_schemas as s
from app import models as m
from app.db import get_db
from app.services import input_data as data

router = APIRouter(tags=["workspace"])


class StockWrite(s.InputRecord):
    as_of: date
    on_hand: s.NonNegative
    reserved: s.NonNegative = 0


class ProductWrite(s.ProductInput):
    stock: StockWrite | None = None


def product_query():
    latest = select(m.StockMonthly.month).where(m.StockMonthly.sku_code == m.Sku.code).order_by(
        m.StockMonthly.month.desc()).limit(1).scalar_subquery()
    quantity = select(m.StockMonthly.qty).where(m.StockMonthly.sku_code == m.Sku.code).order_by(
        m.StockMonthly.month.desc()).limit(1).scalar_subquery()
    return (select(m.Sku, m.Supplier.name, m.Category.name, m.StockCurrent,
                   latest.label("snapshot_date"), quantity.label("snapshot_qty"))
            .join(m.Supplier, m.Supplier.id == m.Sku.supplier_id)
            .join(m.Category, m.Category.id == m.Sku.category_id)
            .outerjoin(m.StockCurrent, m.StockCurrent.sku_code == m.Sku.code))


def product_json(row):
    sku, supplier, category, stock, snapshot_date, snapshot_qty = row
    return {**data.dump(sku), "supplier_name": supplier, "category_name": category,
            "stock": data.dump(stock) if stock else None,
            "monthly_stock": {"as_of": snapshot_date, "on_hand": snapshot_qty} if snapshot_date else None}


@router.get("/products")
def products(search: str = Query("", max_length=200), category_id: str | None = None,
             sort: Literal["name", "stock", "price"] = "name",
             limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
             db: Session = Depends(get_db)):
    query = product_query()
    if search.strip():
        query = query.where(or_(*(func.lower(col).contains(search.strip().casefold(), autoescape=True) for col in
                                  (m.Sku.code, m.Sku.name, m.Sku.supplier_sku, m.Supplier.name))))
    if category_id:
        query = query.where(m.Sku.category_id == category_id)
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    ordering = {"name": m.Sku.name, "stock": func.coalesce(m.StockCurrent.on_hand,
                query.selected_columns.snapshot_qty), "price": m.Sku.unit_cost}[sort]
    rows = db.execute(query.order_by(ordering.asc().nulls_last(), m.Sku.code).offset(offset).limit(limit))
    return {"items": [product_json(row) for row in rows], "total": total}


def save_product(db, body, code=None):
    try:
        data.begin_write(db)
        existing = db.get(m.Sku, code or body.code)
        if code and existing is None:
            raise HTTPException(404, "Товар не найден")
        if not code and existing is not None:
            raise HTTPException(409, "Товар с таким кодом уже существует")
        if code and code != body.code:
            raise HTTPException(422, "Код товара изменять нельзя")
        data.save(db, "products", body.model_dump(exclude={"stock"}), existing)
        if body.stock is not None:
            stock = db.get(m.StockCurrent, body.code)
            values = data.validate(data.resource("stock-current"), {
                **body.stock.model_dump(), "sku_code": body.code,
                "locations": stock.locations if stock else {},
            })
            data.save(db, "stock-current", values, stock)
        db.commit()
        return product_json(db.execute(product_query().where(m.Sku.code == body.code)).one())
    except (IntegrityError, OperationalError) as exc:
        db.rollback()
        raise HTTPException(409, "Не удалось сохранить товар. Обновите каталог и повторите действие.") from exc


@router.post("/products", status_code=201)
def create_product(body: ProductWrite, db: Session = Depends(get_db)):
    return save_product(db, body)


@router.put("/products/{code}")
def update_product(code: str, body: ProductWrite, db: Session = Depends(get_db)):
    return save_product(db, body, code)


def sales_query(search, supplier_id, category_id, from_, to):
    query = (select(m.SalesLine.id, m.SalesLine.ts, m.SalesLine.document, m.SalesLine.doc_type,
                    m.SalesLine.qty, m.SalesLine.sku_code,
                    m.Sku.name, m.Sku.supplier_sku, m.Sku.unit, m.Sku.supplier_id, m.Sku.category_id,
                    m.Supplier.name.label("supplier"), m.Category.name.label("category"))
             .outerjoin(m.Sku, m.Sku.code == m.SalesLine.sku_code)
             .outerjoin(m.Supplier, m.Supplier.id == m.Sku.supplier_id)
             .outerjoin(m.Category, m.Category.id == m.Sku.category_id))
    if from_ and to and from_ > to:
        raise HTTPException(422, "Начальная дата должна быть не позже конечной")
    if from_:
        query = query.where(m.SalesLine.ts >= datetime.combine(from_, time.min))
    if to:
        query = query.where(m.SalesLine.ts < datetime.combine(to, time.min) + timedelta(days=1))
    if supplier_id:
        query = query.where(m.Sku.supplier_id == supplier_id)
    if category_id:
        query = query.where(m.Sku.category_id == category_id)
    if search.strip():
        query = query.where(or_(*(func.lower(col).contains(search.strip().casefold(), autoescape=True) for col in
                                  (m.SalesLine.document, m.SalesLine.sku_code, m.Sku.name, m.Sku.supplier_sku))))
    return query


def sales_kind(query, kind):
    if kind == "sale":
        return query.where(m.SalesLine.qty > 0)
    if kind == "return":
        return query.where(m.SalesLine.qty < 0)
    return query


def sales_order(query, sort, ascending):
    column = {"date": m.SalesLine.ts, "name": m.Sku.name, "quantity": m.SalesLine.qty}[sort]
    return query.order_by(column.asc() if ascending else column.desc(), m.SalesLine.id.desc())


@router.get("/sales")
def sales(search: str = Query("", max_length=200), supplier_id: str | None = None,
          category_id: str | None = None, from_: date | None = Query(None, alias="from"),
          to: date | None = None, kind: Literal["", "sale", "return"] = "",
          sort: Literal["date", "name", "quantity"] = "date", ascending: bool = False,
          limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0),
          db: Session = Depends(get_db)):
    base = sales_query(search, supplier_id, category_id, from_, to)
    all_rows = base.subquery()
    counts = db.execute(select(func.count(), func.sum(case((all_rows.c.qty > 0, 1), else_=0)),
                               func.sum(case((all_rows.c.qty < 0, 1), else_=0)))).one()
    query = sales_kind(base, kind)
    rows = query.subquery()
    total = db.scalar(select(func.count()).select_from(rows))
    documents = select(rows.c.supplier_id, rows.c.document, rows.c.doc_type,
                       func.date(rows.c.ts)).distinct().subquery()
    summary = {"documents": db.scalar(select(func.count()).select_from(documents)),
               "skus": db.scalar(select(func.count(func.distinct(rows.c.sku_code)))),
               "returns": db.scalar(select(func.count()).select_from(rows).where(rows.c.qty < 0)),
               "operations": total}
    # Aggregate on the server across all matching records, never only the current page.
    day = func.date(rows.c.ts)
    trend = [{"date": d, "operations": n} for d, n in db.execute(
        select(day, func.count()).group_by(day).order_by(day))]
    first, last = db.execute(select(func.min(m.SalesLine.ts), func.max(m.SalesLine.ts))).one()
    items = db.execute(sales_order(query, sort, ascending).offset(offset).limit(limit)).mappings().all()
    return {"items": [dict(row) for row in items], "total": total, "summary": summary, "trend": trend,
            "counts": {"all": counts[0], "sale": counts[1] or 0, "return": counts[2] or 0},
            "range": {"from": first.date() if first else None, "to": last.date() if last else None}}


@router.get("/sales/export")
def export_sales(search: str = Query("", max_length=200), supplier_id: str | None = None,
                 category_id: str | None = None, from_: date | None = Query(None, alias="from"),
                 to: date | None = None, kind: Literal["", "sale", "return"] = "",
                 sort: Literal["date", "name", "quantity"] = "date", ascending: bool = False,
                 db: Session = Depends(get_db, scope="request")):
    query = sales_order(sales_kind(sales_query(search, supplier_id, category_id, from_, to), kind), sort, ascending)

    def content():
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";")
        yield "\ufeff"
        writer.writerow(["Дата", "Документ", "Тип документа", "Код 1С", "Артикул", "Товар",
                         "Поставщик", "Категория", "Количество", "Единица"])
        yield buffer.getvalue()
        for row in db.execute(query.execution_options(yield_per=500)).mappings():
            buffer.seek(0)
            buffer.truncate(0)
            values = [row[key] for key in ("ts", "document", "doc_type", "sku_code", "supplier_sku",
                                          "name", "supplier", "category", "qty", "unit")]
            writer.writerow([("'" + v if v.lstrip().startswith(("=", "+", "-", "@")) else v)
                             if isinstance(v, str) else v for v in values])
            yield buffer.getvalue()

    return StreamingResponse(content(), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": 'attachment; filename="sales-history.csv"'})
