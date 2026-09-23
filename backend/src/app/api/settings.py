from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, SecretStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.services import assistant_settings
from app.services.calc_runs import get_params
from app.services.input_data import begin_write

router = APIRouter(prefix="/settings", tags=["settings"])


class AssistantKeyUpdate(BaseModel):
    api_key: SecretStr


@router.get("/assistant")
def read_assistant_settings(db: Session = Depends(get_db)):
    return assistant_settings.status(db)


@router.put("/assistant")
def update_assistant_settings(body: AssistantKeyUpdate, db: Session = Depends(get_db)):
    key = body.api_key.get_secret_value().strip()
    if not key or len(key) > 4096 or any(c.isspace() or not c.isascii() or not c.isprintable() for c in key):
        raise HTTPException(422, "Введите API-ключ без пробелов (до 4096 символов).")
    credential = db.get(models.AssistantCredential, 1)
    if credential is None:
        db.add(models.AssistantCredential(id=1, api_key=key))
    else:
        credential.api_key = key
    db.commit()
    return assistant_settings.status(db)


@router.delete("/assistant")
def delete_assistant_settings(db: Session = Depends(get_db)):
    credential = db.get(models.AssistantCredential, 1)
    if credential is not None:
        db.delete(credential)
        db.commit()
    return assistant_settings.status(db)


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
    begin_write(db)
    rule = db.get(models.SupplierRule, rule_id)
    if rule is None:
        raise HTTPException(404, "Правило не найдено")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(rule, k, v)
    db.commit()
    return _rule(rule)
