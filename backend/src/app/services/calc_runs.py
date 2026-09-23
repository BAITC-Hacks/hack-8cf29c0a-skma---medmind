"""Прогон расчёта: загрузка входных данных из БД → движок → сохранение результатов."""

import logging
import traceback
import uuid
from datetime import datetime

import pandas as pd
from sqlalchemy import delete, insert, select
from sqlalchemy.orm import Session

from app import models
from app.db import SessionLocal
from app.engine.core import EngineInputs, EngineParams, run_engine

log = logging.getLogger(__name__)


def _df(db: Session, stmt) -> pd.DataFrame:
    return pd.read_sql(stmt, db.connection())


def load_inputs(db: Session) -> EngineInputs:
    m = models
    skus = _df(db, select(m.Sku.code.label("sku_code"), m.Sku.supplier_id, m.Sku.category_id, m.Sku.name,
                          m.Sku.unit, m.Sku.unit_cost))
    sales = _df(db, select(m.SalesLine.sku_code, m.SalesLine.ts, m.SalesLine.document, m.SalesLine.doc_type,
                           m.SalesLine.qty))
    sales["ts"] = pd.to_datetime(sales["ts"])
    return EngineInputs(
        skus=skus,
        sales=sales,
        stock_monthly=_df(db, select(m.StockMonthly.sku_code, m.StockMonthly.month, m.StockMonthly.qty)),
        stock_current=_df(db, select(m.StockCurrent.sku_code, m.StockCurrent.as_of, m.StockCurrent.on_hand,
                                     m.StockCurrent.reserved, m.StockCurrent.free)),
        transit=_df(db, select(m.GoodsInTransit.sku_code, m.GoodsInTransit.order_ref,
                               m.GoodsInTransit.expected_date, m.GoodsInTransit.qty)),
        rules=_df(db, select(m.SupplierRule.sku_code, m.SupplierRule.min_order_qty, m.SupplierRule.order_multiple)),
        suppliers=_df(db, select(m.Supplier.id, m.Supplier.name, m.Supplier.lead_time_days)),
        categories=_df(db, select(m.Category.id, m.Category.buffer_multiplier)),
        supplier_seasonality=_df(db, select(m.SupplierSeasonality.supplier_id, m.SupplierSeasonality.year,
                                            m.SupplierSeasonality.month, m.SupplierSeasonality.revenue)),
    )


def get_params(db: Session) -> models.CalcParams:
    params = db.get(models.CalcParams, 1)
    if params is None:
        params = models.CalcParams(id=1)
        db.add(params)
        db.commit()
    return params


def create_run(db: Session, horizon_days: int | None = None) -> models.CalcRun:
    p = get_params(db)
    now = datetime.now()
    run = models.CalcRun(
        id=f"run-{now:%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}",
        created_at=now,
        horizon_days=horizon_days or p.forecast_horizon_days,
        status="running",
        params={
            "forecast_horizon_days": horizon_days or p.forecast_horizon_days,
            "safety_buffer_days": p.safety_buffer_days,
            "outlier_sensitivity": p.outlier_sensitivity,
        },
    )
    db.add(run)
    db.commit()
    return run


def execute_run(run_id: str) -> None:
    """Выполняется в фоне (BackgroundTasks) или синхронно из CLI. Открывает собственную сессию."""
    with SessionLocal() as db:
        run = db.get(models.CalcRun, run_id)
        try:
            output = run_engine(load_inputs(db), EngineParams(**run.params))
            db.execute(delete(models.SkuForecast).where(models.SkuForecast.run_id == run_id))
            db.execute(delete(models.OrderRecommendation).where(models.OrderRecommendation.run_id == run_id))
            forecasts, recs = [], []
            for r in output.results:
                forecasts.append({
                    "run_id": run_id, "sku_code": r.sku_code, "explanation": r.explanation,
                    "monthly_forecast": r.monthly_forecast, "seasonal_index": r.seasonal_index,
                })
                if r.recommended_qty > 0:
                    recs.append({
                        "id": uuid.uuid4().hex[:16], "run_id": run_id, "sku_code": r.sku_code,
                        "supplier_id": r.supplier_id, "category_id": r.category_id,
                        "recommended_qty": r.recommended_qty, "approved_qty": None, "urgency": r.urgency,
                        "status": "pending", "short_reason": r.short_reason, "days_of_cover": r.days_of_cover,
                    })
            if forecasts:
                db.execute(insert(models.SkuForecast), forecasts)
            if recs:
                db.execute(insert(models.OrderRecommendation), recs)
            run.as_of = output.as_of
            run.status = "done"
        except Exception as exc:  # прогон не должен ронять API — ошибка сохраняется в run.error
            log.exception("calc run %s failed", run_id)
            db.rollback()
            run = db.get(models.CalcRun, run_id)
            run.status = "failed"
            run.error = f"{exc}\n{traceback.format_exc(limit=5)}"
        run.finished_at = datetime.now()
        db.commit()


def latest_done_run_id(db: Session) -> str | None:
    return db.scalar(
        select(models.CalcRun.id).where(models.CalcRun.status == "done").order_by(models.CalcRun.created_at.desc())
    )
