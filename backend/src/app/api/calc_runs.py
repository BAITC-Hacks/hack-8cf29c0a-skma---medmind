from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import models, schemas
from app.db import get_db
from app.services.calc_runs import create_run, execute_run

router = APIRouter(tags=["calc-runs"])


def _to_schema(run: models.CalcRun) -> schemas.CalcRun:
    return schemas.CalcRun(
        id=run.id, created_at=run.created_at, horizon_days=run.horizon_days, status=run.status,
        as_of=run.as_of.isoformat() if run.as_of else None, finished_at=run.finished_at, error=run.error,
    )


@router.get("/calc-runs", response_model=list[schemas.CalcRun])
def list_runs(limit: int = Query(20, ge=1, le=200), db: Session = Depends(get_db)):
    runs = db.scalars(select(models.CalcRun).order_by(models.CalcRun.created_at.desc()).limit(limit)).all()
    return [_to_schema(r) for r in runs]


@router.get("/calc-runs/{run_id}", response_model=schemas.CalcRun)
def get_run(run_id: str, db: Session = Depends(get_db)):
    run = db.get(models.CalcRun, run_id)
    if run is None:
        raise HTTPException(404, "Расчёт не найден")
    return _to_schema(run)


@router.post("/calc-runs", response_model=schemas.CalcRun, status_code=202)
def start_run(background: BackgroundTasks, body: schemas.CalcRunCreate | None = None, db: Session = Depends(get_db)):
    """Запускает пересчёт с текущими настройками. Ответ сразу (status=running); статус — GET /calc-runs/{id}."""
    if db.scalar(select(models.CalcRun.id).where(models.CalcRun.status == "running")):
        raise HTTPException(409, "Расчёт уже выполняется")
    if db.scalar(select(models.Sku.code).limit(1)) is None:
        raise HTTPException(409, "В каталоге нет товаров. Загрузите отчёты или добавьте товары перед расчётом.")
    run = create_run(db, horizon_days=body.horizon_days if body else None)
    background.add_task(execute_run, run.id)
    return _to_schema(run)
