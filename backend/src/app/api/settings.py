from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.services.calc_runs import get_params

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("/calc-params", response_model=schemas.CalcParams)
def read_params(db: Session = Depends(get_db)):
    return get_params(db)


@router.put("/calc-params", response_model=schemas.CalcParams)
def update_params(body: schemas.CalcParams, db: Session = Depends(get_db)):
    params = get_params(db)
    for k, v in body.model_dump().items():
        setattr(params, k, v)
    db.commit()
    return params


def _rule(r: models.SupplierRule) -> schemas.SupplierRule:
    return schemas.SupplierRule(id=str(r.id), supplier_id=r.supplier_id, sku_code=r.sku_code,
                                min_order_qty=r.min_order_qty, order_multiple=r.order_multiple)


@router.get("/supplier-rules", response_model=list[schemas.SupplierRule])
def list_rules(supplier_id: str | None = None, db: Session = Depends(get_db)):
    q = select(models.SupplierRule).order_by(models.SupplierRule.supplier_id, models.SupplierRule.sku_code)
    if supplier_id:
        q = q.where(models.SupplierRule.supplier_id == supplier_id)
    return [_rule(r) for r in db.scalars(q)]


@router.put("/supplier-rules/{rule_id}", response_model=schemas.SupplierRule)
def update_rule(rule_id: int, body: schemas.SupplierRuleUpdate, db: Session = Depends(get_db)):
    rule = db.get(models.SupplierRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Правило не найдено")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(rule, k, v)
    db.commit()
    return _rule(rule)
