"""Initialize fresh Docker volumes without replacing existing application data."""

import os
import sys


def initialize_database() -> None:
    from sqlalchemy import select

    from app import models
    from app.db import SessionLocal, init_db
    from app.services.seed import SEED_MODELS, seed

    init_db()
    if os.environ.get("SEED_ON_START", "true").lower() not in {"true", "1", "yes"}:
        return

    with SessionLocal() as db:
        occupied = any(
            db.execute(select(model).limit(1)).first() is not None
            for model in (*SEED_MODELS, models.SkuForecast)
            if model is not models.CalcParams
        )
    if occupied:
        print("Database already contains data; skipping demo seed.", flush=True)
        return

    with SessionLocal() as db:
        result = seed(db)
    print(f"Demo data initialized: {result['status']}", flush=True)


if __name__ == "__main__":
    command = sys.argv[1:]
    if not command:
        raise SystemExit("A command is required")
    # Explicit CLI commands such as `hackalem seed` control initialization themselves.
    if command[0] == "uvicorn":
        initialize_database()
    os.execvp(command[0], command)
