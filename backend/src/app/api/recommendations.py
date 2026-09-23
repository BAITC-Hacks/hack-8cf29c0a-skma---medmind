import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import models, schemas
from app.config import get_settings
from app.db import get_db
from app.services import exporter
from app.services.calc_runs import latest_done_run_id
from app.services.input_data import begin_write, dump

router = APIRouter(tags=["recommendations"])

_URGENCY_ORDER = {"high": 0, "medium": 1, "low": 2}


def _resolve_run_id(db: Session, run_id: str | None) -> str | None:
    if run_id:
        if db.get(models.CalcRun, run_id) is None:
            raise HTTPException(404, f"Расчёт {run_id} не найден")
        return run_id
    return latest_done_run_id(db)


def _rec_query():
    has_explanation = select(models.SkuForecast.sku_code).where(
        models.SkuForecast.run_id == models.OrderRecommendation.run_id,
        models.SkuForecast.sku_code == models.OrderRecommendation.sku_code,
    ).exists()
    return (
        select(models.OrderRecommendation, models.Sku, models.Supplier, has_explanation)
        .join(models.Sku, models.Sku.code == models.OrderRecommendation.sku_code, isouter=True)
        .join(models.Supplier, models.Supplier.id == models.OrderRecommendation.supplier_id, isouter=True)
    )


def _to_schema(rec: models.OrderRecommendation, sku: models.Sku | None,
               supplier: models.Supplier | None, has_explanation: bool) -> schemas.OrderRecommendation:
    return schemas.OrderRecommendation(
        id=rec.id,
        run_id=rec.run_id,
        sku_code=rec.sku_code,
        supplier_sku=(sku.supplier_sku if sku else None) or "",
        name=sku.name if sku else rec.sku_code,
        supplier_id=rec.supplier_id,
        supplier_name=supplier.name if supplier else rec.supplier_id,
        category_id=rec.category_id,
        recommended_qty=rec.recommended_qty,
        approved_qty=rec.approved_qty,
        unit=sku.unit if sku else "шт",
        urgency=rec.urgency,
        status=rec.status,
        short_reason=rec.short_reason,
        days_of_cover=rec.days_of_cover,
        comment=rec.comment,
        has_explanation=has_explanation,
    )


def _get_rec(db: Session, rec_id: str) -> schemas.OrderRecommendation:
    row = db.execute(_rec_query().where(models.OrderRecommendation.id == rec_id)).first()
    if row is None:
        raise HTTPException(404, "Рекомендация не найдена")
    return _to_schema(*row)


def _editable(db: Session, rec_id: str):
    rec = db.get(models.OrderRecommendation, rec_id)
    if rec is None:
        raise HTTPException(404, "Заказ не найден")
    run = db.get(models.CalcRun, rec.run_id)
    if run is None or run.status != "done":
        raise HTTPException(409, "Заказы можно изменять только в завершённом расчёте")
    return rec


def _audit(db: Session, rec, action: str, before):
    db.add(models.AuditLog(ts=datetime.now(), action=action, entity="order_recommendation", entity_id=rec.id,
                           payload={"before": before, "after": None if action == "delete" else dump(rec)}))


@router.post("/recommendations", response_model=schemas.OrderRecommendation, status_code=201)
def create_order(body: schemas.OrderCreate, db: Session = Depends(get_db)):
    """Создать позицию. Без run_id создаётся отдельный набор ручных заказов, без запуска прогноза."""
    begin_write(db)
    sku = db.get(models.Sku, body.sku_code)
    if sku is None:
        raise HTTPException(422, "Товар не найден в каталоге")
    if body.run_id:
        run = db.get(models.CalcRun, body.run_id)
        if run is None:
            raise HTTPException(404, "Расчёт не найден")
        if run.status != "done":
            raise HTTPException(409, "Выберите завершённый расчёт")
    else:
        now = datetime.now()
        run = models.CalcRun(id=f"manual-{uuid.uuid4().hex}", created_at=now, finished_at=now,
                             as_of=now.date(), horizon_days=30, status="done", params={"source": "manual"})
        db.add(run)
        db.flush()
    rec = models.OrderRecommendation(
        id=uuid.uuid4().hex, run_id=run.id, sku_code=sku.code, supplier_id=sku.supplier_id,
        category_id=sku.category_id, status="pending", approved_qty=None,
        **body.model_dump(exclude={"sku_code", "run_id"}),
    )
    db.add(rec)
    try:
        db.flush()
        _audit(db, rec, "create", None)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            409, "Этот товар уже есть в выбранном расчёте; отредактируйте существующую позицию"
        ) from exc
    return _get_rec(db, rec.id)


@router.get("/recommendations/{rec_id}", response_model=schemas.OrderRecommendation)
def read_order(rec_id: str, db: Session = Depends(get_db)):
    return _get_rec(db, rec_id)


def _update_order(db: Session, rec_id: str, values: dict):
    begin_write(db)
    rec = _editable(db, rec_id)
    before = dump(rec)
    if any(getattr(rec, key) != value for key, value in values.items()):
        for key, value in values.items():
            setattr(rec, key, value)
        rec.status, rec.approved_qty, rec.decided_at = "pending", None, None
        _audit(db, rec, "update", before)
    db.commit()
    return _get_rec(db, rec.id)


@router.put("/recommendations/{rec_id}", response_model=schemas.OrderRecommendation)
def replace_order(rec_id: str, body: schemas.OrderFields, db: Session = Depends(get_db)):
    return _update_order(db, rec_id, body.model_dump())


@router.patch("/recommendations/{rec_id}", response_model=schemas.OrderRecommendation)
def patch_order(rec_id: str, body: schemas.OrderPatch, db: Session = Depends(get_db)):
    return _update_order(db, rec_id, body.model_dump(exclude_unset=True))


@router.delete("/recommendations/{rec_id}")
def delete_order(rec_id: str, db: Session = Depends(get_db)):
    begin_write(db)
    rec = _editable(db, rec_id)
    _audit(db, rec, "delete", dump(rec))
    db.delete(rec)
    db.commit()
    return {"deleted": True, "id": rec_id}


@router.get("/recommendations", response_model=list[schemas.OrderRecommendation])
def list_recommendations(
    run_id: str | None = None,
    supplier_id: list[str] | None = Query(None),
    category_id: list[str] | None = Query(None),
    urgency: list[schemas.Urgency] | None = Query(None),
    status: list[schemas.RecStatus] | None = Query(None),
    db: Session = Depends(get_db),
):
    """Фильтры принимают несколько значений: `?supplier_id=iek&supplier_id=se`."""
    run_id = _resolve_run_id(db, run_id)
    if run_id is None:
        return []
    R = models.OrderRecommendation
    q = _rec_query().where(R.run_id == run_id)
    if supplier_id:
        q = q.where(R.supplier_id.in_(supplier_id))
    if category_id:
        q = q.where(R.category_id.in_(category_id))
    if urgency:
        q = q.where(R.urgency.in_(urgency))
    if status:
        q = q.where(R.status.in_(status))
    items = [_to_schema(*row) for row in db.execute(q).all()]
    items.sort(key=lambda r: (r.supplier_name, _URGENCY_ORDER[r.urgency], r.days_of_cover or 0))
    return items


@router.get("/recommendations/{sku_code}/explain", response_model=schemas.ExplanationDetail)
def explain(sku_code: str, run_id: str | None = None, db: Session = Depends(get_db)):
    run_id = _resolve_run_id(db, run_id)
    fc = db.get(models.SkuForecast, (run_id, sku_code)) if run_id else None
    if fc is None:
        raise HTTPException(404, "Для этого SKU в расчёте нет данных (нет продаж за последние 24 мес.)")
    return schemas.ExplanationDetail(**fc.explanation)


def _decide(db: Session, rec_id: str, status: str, approved_qty: float | None, comment: str | None):
    begin_write(db)
    rec = _editable(db, rec_id)
    rec.status = status
    rec.approved_qty = approved_qty
    rec.comment = comment
    rec.decided_at = datetime.now()
    db.add(models.AuditLog(
        ts=rec.decided_at, action=status, entity="order_recommendation", entity_id=rec_id,
        payload={"approved_qty": approved_qty, "recommended_qty": rec.recommended_qty, "comment": comment},
    ))
    db.commit()
    return _get_rec(db, rec_id)


@router.post("/recommendations/{rec_id}/approve", response_model=schemas.OrderRecommendation)
def approve(rec_id: str, body: schemas.ApproveRequest, db: Session = Depends(get_db)):
    """Утверждение фиксирует количество. Заказ поставщику НЕ отправляется — только экспорт по запросу."""
    return _decide(db, rec_id, "approved", body.approved_qty, body.comment)


@router.post("/recommendations/{rec_id}/reject", response_model=schemas.OrderRecommendation)
def reject(rec_id: str, body: schemas.RejectRequest | None = None, db: Session = Depends(get_db)):
    return _decide(db, rec_id, "rejected", None, body.comment if body else None)


@router.post("/recommendations/export", response_model=schemas.ExportResponse)
def export(body: schemas.ExportRequest, db: Session = Depends(get_db)):
    rows = db.execute(_rec_query().where(models.OrderRecommendation.id.in_(body.ids))).all()
    if not rows:
        raise HTTPException(404, "Ни одна из рекомендаций не найдена")
    items = [_to_schema(*row) for row in rows]
    try:
        filename = exporter.export(items, body.format, get_settings().export_dir)
    except NotImplementedError as exc:
        raise HTTPException(501, str(exc)) from exc
    return schemas.ExportResponse(download_url=f"/api/exports/{filename}")
