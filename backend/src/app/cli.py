"""CLI: `uv run hackalem seed | ingest | calc | serve`."""

import argparse
import json
import logging
import time

from app.config import get_settings
from app.db import SessionLocal, init_db


def _ingest(_: argparse.Namespace) -> None:
    from app.etl.loader import ingest

    settings = get_settings()
    t = time.perf_counter()
    with SessionLocal() as db:
        stats = ingest(db, settings.data_dir.resolve())
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    print(f"ingest: {time.perf_counter() - t:.1f} c")


def _seed(_: argparse.Namespace) -> None:
    from app.services.seed import seed

    with SessionLocal() as db:
        try:
            stats = seed(db)
        except (ValueError, OSError) as exc:
            raise SystemExit(str(exc)) from exc
    print(json.dumps(stats, ensure_ascii=False, indent=2))


def _calc(args: argparse.Namespace) -> None:
    from app.services.calc_runs import create_run, execute_run

    t = time.perf_counter()
    with SessionLocal() as db:
        run = create_run(db, horizon_days=args.horizon)
    execute_run(run.id)
    with SessionLocal() as db:
        from app import models

        run = db.get(models.CalcRun, run.id)
        n = db.query(models.OrderRecommendation).filter_by(run_id=run.id).count()
    print(f"run {run.id}: {run.status}, рекомендаций: {n}, {time.perf_counter() - t:.1f} c")
    if run.error:
        print(run.error)


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    parser = argparse.ArgumentParser(prog="hackalem")
    sub = parser.add_subparsers(required=True)

    p = sub.add_parser("seed", help="загрузить тестовые данные без прогнозов (повторный запуск безопасен)")
    p.set_defaults(func=_seed)

    p = sub.add_parser("ingest", help="загрузить xlsx из DATA_DIR в БД")
    p.set_defaults(func=_ingest)

    p = sub.add_parser("calc", help="выполнить расчёт рекомендаций")
    p.add_argument("--horizon", type=int, default=None, help="горизонт, дней (по умолчанию из настроек)")
    p.set_defaults(func=_calc)

    p = sub.add_parser("serve", help="запустить API")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true")
    p.set_defaults(func=_serve)

    args = parser.parse_args()
    init_db()
    args.func(args)


if __name__ == "__main__":
    main()
