import gzip
import hashlib
import json
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

from app import models as m
from app.db import Base, get_db
from app.main import app
from app.services.seed import SEED_DIR, SEED_MODELS, seed


@pytest.fixture
def database(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path / 'seed.db').as_posix()}")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    yield engine
    engine.dispose()


def small_snapshot(tmp_path):
    path = tmp_path / "snapshot"
    path.mkdir()
    rows = {
        "suppliers": [{"id": "test", "name": "Тест", "lead_time_days": 30}],
        "calc_params": [{"id": 1, "forecast_horizon_days": 30, "safety_buffer_days": 14,
                         "outlier_sensitivity": 0.5}],
    }
    manifest = {"format_version": 1, "dataset": "test", "tables": {}}
    for model in SEED_MODELS:
        name = model.__tablename__
        file = path / f"{name}.jsonl.gz"
        with gzip.open(file, "wt", encoding="utf-8") as stream:
            for row in rows.get(name, []):
                stream.write(json.dumps(row) + "\n")
        manifest["tables"][name] = {
            "rows": len(rows.get(name, [])), "sha256": hashlib.sha256(file.read_bytes()).hexdigest(),
        }
    (path / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    return path


def test_bundled_seed_counts_types_api_and_repeat(database):
    manifest = json.loads((SEED_DIR / "manifest.json").read_text(encoding="utf-8"))
    assert "sku_forecasts" not in manifest["tables"]
    with Session(database) as db:
        result = seed(db)
        assert result["status"] == "seeded"
        for model in SEED_MODELS:
            count = db.scalar(select(func.count()).select_from(model))
            # The seeder records its own installation in addition to the snapshot audit.
            assert count == manifest["tables"][model.__tablename__]["rows"] + (model is m.AuditLog)
        assert db.scalar(select(func.count()).select_from(m.SkuForecast)) == 0
        assert isinstance(db.scalars(select(m.StockMonthly)).first().month, date)
        assert isinstance(db.scalars(select(m.SalesLine)).first().ts, datetime)
        assert isinstance(db.scalars(select(m.StockCurrent)).first().locations, dict)
        supplier = db.scalars(select(m.Supplier)).first()
        supplier_id = supplier.id
        supplier.name = "Изменено после загрузки"
        db.commit()
        again = seed(db)
        assert again["status"] == "already_seeded"
        assert db.get(m.Supplier, supplier_id).name == "Изменено после загрузки"
        assert db.scalar(select(func.count()).select_from(m.SalesLine)) == result["rows"]["sales_lines"]

    def get_session():
        with Session(database) as db:
            yield db

    app.dependency_overrides[get_db] = get_session
    try:
        with TestClient(app) as client:
            orders = client.get("/api/recommendations")
            assert orders.status_code == 200 and orders.json()
            assert all(not order["has_explanation"] for order in orders.json())
            assert client.get("/api/suppliers").status_code == 200
            trend = client.get("/api/analytics/demand-trend")
            assert trend.status_code == 200 and trend.json()
            assert all(point["forecast_qty"] is None for point in trend.json())
    finally:
        app.dependency_overrides.pop(get_db, None)


def test_existing_database_is_not_overwritten(database, tmp_path):
    path = small_snapshot(tmp_path)
    with Session(database) as db:
        db.add(m.Supplier(id="existing", name="Существующий", lead_time_days=10))
        db.commit()
        with pytest.raises(ValueError, match="пустой БД"):
            seed(db, path)
        assert db.get(m.Supplier, "existing").name == "Существующий"
        assert db.get(m.Supplier, "test") is None


def test_settings_initialized_before_seed_are_preserved(database, tmp_path):
    path = small_snapshot(tmp_path)
    with Session(database) as db:
        db.add(m.CalcParams(id=1, forecast_horizon_days=75))
        db.commit()
        result = seed(db, path)
        assert result["rows"]["calc_params"] == 0
        assert db.get(m.CalcParams, 1).forecast_horizon_days == 75


@pytest.mark.parametrize("failure", ["checksum", "count"])
def test_failure_rolls_back_all_tables(database, tmp_path, failure):
    path = small_snapshot(tmp_path)
    if failure == "checksum":
        (path / "assistant_messages.jsonl.gz").write_bytes(b"broken")
    else:
        manifest_path = path / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["tables"]["assistant_messages"]["rows"] = 1
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    with Session(database) as db:
        with pytest.raises(ValueError):
            seed(db, path)
        for model in SEED_MODELS:
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_cli_creates_tables_and_seeds_once(database, tmp_path, monkeypatch, capsys):
    from app import cli
    from app.services import seed as service

    path = small_snapshot(tmp_path)
    original_seed = service.seed
    monkeypatch.setattr(service, "seed", lambda db: original_seed(db, path))
    monkeypatch.setattr(cli, "SessionLocal", lambda: Session(database))
    monkeypatch.setattr(cli, "init_db", lambda: Base.metadata.create_all(database))
    monkeypatch.setattr("sys.argv", ["hackalem", "seed"])
    Base.metadata.drop_all(database)
    cli.main()
    assert json.loads(capsys.readouterr().out)["status"] == "seeded"
    cli.main()
    assert json.loads(capsys.readouterr().out)["status"] == "already_seeded"
