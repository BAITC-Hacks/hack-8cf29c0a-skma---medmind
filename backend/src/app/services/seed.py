"""Install the bundled demo snapshot atomically, without generating forecasts."""

import base64
import gzip
import hashlib
import json
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import Date, DateTime, LargeBinary, select, text
from sqlalchemy.orm import Session

from app import models as m

SEED_DIR = Path(__file__).resolve().parents[1] / "seed_data"
# Explicit allowlist in dependency order. Forecasts must never enter the seed.
SEED_MODELS = (
    m.Supplier, m.Category, m.Sku, m.SalesLine, m.StockMonthly, m.StockCurrent,
    m.GoodsInTransit, m.SupplierRule, m.SupplierSeasonality, m.ReferenceMetric,
    m.CalcParams, m.CalcRun, m.OrderRecommendation, m.AuditLog, m.ImportIdentity,
    m.AssistantConversation, m.AssistantFile, m.AssistantMessage,
)
BATCH_SIZE = 2_000


def _decode(table, row: dict) -> dict:
    if set(row) != set(table.columns.keys()):
        raise ValueError(f"Неверные колонки сидера: {table.name}")
    for column in table.columns:
        value = row[column.name]
        if value is None:
            continue
        if isinstance(column.type, DateTime):
            row[column.name] = datetime.fromisoformat(value)
        elif isinstance(column.type, Date):
            row[column.name] = date.fromisoformat(value)
        elif isinstance(column.type, LargeBinary):
            row[column.name] = base64.b64decode(value, validate=True)
    return row


def seed(db: Session, data_dir: Path = SEED_DIR) -> dict:
    """Fresh DB only; repeat calls preserve edits. Caller supplies a fresh session."""
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    names = {model.__tablename__ for model in SEED_MODELS}
    if manifest["format_version"] != 1 or set(manifest["tables"]) != names:
        raise ValueError("Неподдерживаемый формат или состав таблиц сидера")

    with db.begin():
        # Serialize concurrent seed/import attempts before testing for existing data.
        if db.get_bind().dialect.name == "sqlite":
            db.execute(text("BEGIN IMMEDIATE"))
        installed = db.scalar(select(m.AuditLog).where(
            m.AuditLog.action == "seed", m.AuditLog.entity == "dataset",
        ).limit(1))
        if installed:
            if installed.entity_id != manifest["dataset"]:
                raise ValueError("В БД уже установлен другой сидер; используйте отдельную пустую БД")
            return {"status": "already_seeded", "dataset": installed.entity_id, **installed.payload}

        occupied = [
            model.__tablename__ for model in (*SEED_MODELS, m.SkuForecast)
            if model is not m.CalcParams and db.execute(select(model).limit(1)).first() is not None
        ]
        if occupied:
            raise ValueError(
                "Сидер предназначен для пустой БД. Данные не изменены. "
                "Укажите отдельный DATABASE_URL. Заполнены таблицы: " + ", ".join(occupied)
            )

        counts = {}
        for model in SEED_MODELS:
            table = model.__table__
            info = manifest["tables"][table.name]
            path = data_dir / f"{table.name}.jsonl.gz"
            with path.open("rb") as stream:
                if hashlib.file_digest(stream, "sha256").hexdigest() != info["sha256"]:
                    raise ValueError(f"Повреждён файл сидера: {path.name}")
            # Settings may already have been initialized by GET /settings/calc-params.
            preserve_params = model is m.CalcParams and db.get(m.CalcParams, 1) is not None
            count = 0
            batch = []
            with gzip.open(path, "rt", encoding="utf-8") as stream:
                for line in stream:
                    batch.append(_decode(table, json.loads(line)))
                    count += 1
                    if len(batch) == BATCH_SIZE:
                        if not preserve_params:
                            db.execute(table.insert(), batch)
                        batch.clear()
            if batch and not preserve_params:
                db.execute(table.insert(), batch)
            if count != info["rows"]:
                raise ValueError(f"Неверное количество строк сидера: {table.name}")
            counts[table.name] = 0 if preserve_params else count

        db.add(m.AuditLog(
            ts=datetime.now(), action="seed", entity="dataset", entity_id=manifest["dataset"],
            payload={"rows": counts},
        ))
    return {"status": "seeded", "dataset": manifest["dataset"], "rows": counts}
