from collections import defaultdict

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.etl.common import SHIPMENT_DOC_TYPE
from app.services.calc_runs import latest_done_run_id

router = APIRouter(prefix="/analytics", tags=["analytics"])

_PERIOD_RE = r"^\d{4}-\d{2}$"


def _sku_filter(sku_code: str | None, category_id: str | None, supplier_id: str | None):
    """Условие на Sku.code для выбранного среза; None — все SKU."""
    if sku_code:
        return select(models.Sku.code).where(models.Sku.code == sku_code)
    q = select(models.Sku.code)
    if category_id:
        q = q.where(models.Sku.category_id == category_id)
    if supplier_id:
        q = q.where(models.Sku.supplier_id == supplier_id)
    return q if (category_id or supplier_id) else None


def _run(db: Session, run_id: str | None) -> models.CalcRun | None:
    run_id = run_id or latest_done_run_id(db)
    return db.get(models.CalcRun, run_id) if run_id else None


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
    run = _run(db, run_id)
    skus = _sku_filter(sku_code, category_id, supplier_id)

    q = select(models.SalesLine.ts, models.SalesLine.qty).where(
        models.SalesLine.doc_type == SHIPMENT_DOC_TYPE, models.SalesLine.qty > 0
    )
    if skus is not None:
        q = q.where(models.SalesLine.sku_code.in_(skus))
    df = pd.read_sql(q, db.connection())
    actual: dict[str, float] = {}
    if not df.empty:
        df["ts"] = pd.to_datetime(df["ts"])
        if run and run.as_of:
            df = df[df["ts"] < pd.Timestamp(run.as_of.replace(day=1))]
        actual = df.groupby(df["ts"].dt.strftime("%Y-%m"))["qty"].sum().to_dict()

    forecast: dict[str, float] = defaultdict(float)
    if run:
        fq = select(models.SkuForecast.monthly_forecast).where(models.SkuForecast.run_id == run.id)
        if skus is not None:
            fq = fq.where(models.SkuForecast.sku_code.in_(skus))
        for points in db.scalars(fq):
            for p in points:
                forecast[p["period"]] += p["qty"]

    periods = sorted(set(actual) | set(forecast))
    if from_:
        periods = [p for p in periods if p >= from_]
    if to:
        periods = [p for p in periods if p <= to]
    return [
        schemas.TrendPoint(
            period=p,
            actual_qty=round(actual.get(p, 0.0), 2),
            forecast_qty=round(forecast[p], 2) if p in forecast else None,
        )
        for p in periods
    ]



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
    run = _run(db, run_id)
    if run is None:
        raise HTTPException(404, "Нет завершённых расчётов")
    q = select(models.SkuForecast.seasonal_index, models.SkuForecast.monthly_forecast).where(
        models.SkuForecast.run_id == run.id
    )
    skus = _sku_filter(sku_code, category_id, supplier_id)
    if skus is not None:
        q = q.where(models.SkuForecast.sku_code.in_(skus))
    rows = db.execute(q).all()
    if not rows:
        raise HTTPException(404, "Нет данных для выбранного среза")
    idx = np.array([r.seasonal_index for r in rows], dtype=float)
    weights = np.array([sum(p["qty"] for p in r.monthly_forecast) for r in rows], dtype=float)
    factor = np.average(idx, axis=0, weights=weights) if weights.sum() > 0 else idx.mean(axis=0)
    return [schemas.SeasonalityPoint(month=m + 1, factor=round(float(f), 3)) for m, f in enumerate(factor)]
