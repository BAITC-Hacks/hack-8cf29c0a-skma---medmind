from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.services import analytics as svc

router = APIRouter(prefix="/analytics", tags=["analytics"])

_PERIOD_RE = r"^\d{4}-\d{2}$"


@router.get("/dashboard")
def dashboard(run_id: str, category_id: str | None = None, months: int = Query(12, ge=1, le=36),
              db: Session = Depends(get_db)):
    run = db.get(models.CalcRun, run_id)
    if run is None:
        raise HTTPException(404, "Расчёт не найден")
    if run.status != "done":
        raise HTTPException(409, "Аналитика доступна после завершения расчёта")
    rec = models.OrderRecommendation
    query = select(rec).where(rec.run_id == run_id)
    if category_id:
        query = query.where(rec.category_id == category_id)
    rows = query.subquery()
    total = db.scalar(select(func.count()).select_from(rows))
    high = db.scalar(select(func.count()).select_from(rows).where(rows.c.urgency == "high"))
    suppliers = db.scalar(select(func.count(func.distinct(rows.c.supplier_id))))
    risks = db.execute(
        select(rec, models.Sku.name, models.Sku.unit, models.Supplier.name)
        .outerjoin(models.Sku, models.Sku.code == rec.sku_code)
        .outerjoin(models.Supplier, models.Supplier.id == rec.supplier_id)
        .where(rec.id.in_(select(rows.c.id)), rec.urgency == "high")
        .order_by(rec.days_of_cover.asc().nulls_last(), rec.sku_code).limit(10)
    )
    risk_items = [{"id": r.id, "sku": r.sku_code, "name": name or r.sku_code,
                   "supplier": supplier or r.supplier_id, "unit": unit or "",
                   "quantity": r.recommended_qty, "days_of_cover": r.days_of_cover,
                   "reason": r.short_reason} for r, name, unit, supplier in risks]
    trend = svc.demand_trend(db, run_id=run_id, category_id=category_id)
    if run.as_of:
        for point in trend:
            if point["period"] >= run.as_of.strftime("%Y-%m"):
                point["actual_qty"] = None
    try:
        factors = svc.seasonality(db, run_id=run_id, category_id=category_id)
    except svc.NoData:
        factors = []
    return {"summary": {"orders": total, "high": high, "suppliers": suppliers},
            "risks": risk_items, "trend": trend[-months:], "seasonality": factors}


@router.get("/demand-trend", response_model=list[schemas.TrendPoint])
def demand_trend(
    sku_code: str | None = None,
    category_id: str | None = None,
    supplier_id: str | None = None,
    from_: str | None = Query(None, alias="from", pattern=_PERIOD_RE, description="YYYY-MM"),
    to: str | None = Query(None, pattern=_PERIOD_RE, description="YYYY-MM"),
    run_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Фактические отгрузки по месяцам (все строки, включая оптовые) + прогноз расчёта на будущие месяцы.
    Текущий неполный месяц в факт не включается."""
    return svc.demand_trend(db, sku_code=sku_code, category_id=category_id, supplier_id=supplier_id,
                            from_=from_, to=to, run_id=run_id)


@router.get("/seasonality", response_model=list[schemas.SeasonalityPoint])
def seasonality(
    sku_code: str | None = None,
    category_id: str | None = None,
    supplier_id: str | None = None,
    run_id: str | None = None,
    db: Session = Depends(get_db),
):
    """Сезонные коэффициенты (среднее = 1). Для SKU — индекс из расчёта; для категории/поставщика/всех —
    индексы SKU, взвешенные по прогнозному спросу."""
    try:
        return svc.seasonality(db, sku_code=sku_code, category_id=category_id, supplier_id=supplier_id,
                               run_id=run_id)
    except svc.NoData as exc:
        raise HTTPException(404, str(exc)) from exc
