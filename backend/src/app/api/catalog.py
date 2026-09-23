from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.services.input_data import begin_write

router = APIRouter(tags=["catalog"])


@router.get("/suppliers", response_model=list[schemas.Supplier])
def list_suppliers(db: Session = Depends(get_db)):
    return db.scalars(select(models.Supplier).order_by(models.Supplier.name)).all()


@router.put("/suppliers/{supplier_id}", response_model=schemas.Supplier)
def update_supplier(supplier_id: str, body: schemas.SupplierUpdate, db: Session = Depends(get_db)):
    """Срок поставки поставщика (дней) — участвует в расчёте потребности и срочности."""
    begin_write(db)
    supplier = db.get(models.Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(404, "Поставщик не найден")
    supplier.lead_time_days = body.lead_time_days
    db.commit()
    return supplier


@router.get("/categories", response_model=list[schemas.Category])
def list_categories(db: Session = Depends(get_db)):
    return db.scalars(select(models.Category).order_by(models.Category.id)).all()
