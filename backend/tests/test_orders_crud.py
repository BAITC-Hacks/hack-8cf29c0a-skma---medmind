from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models as m
from app.db import Base, get_db
from app.main import app

URL = "/api/recommendations"
BODY = {"run_id": "r1", "sku_code": "001", "recommended_qty": 2.5,
        "urgency": "medium", "short_reason": "Ручная заявка", "comment": "Проверить"}


@pytest.fixture
def orders_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        db.add_all([m.Supplier(id="s1", name="Поставщик"), m.Category(id="c1", name="Категория")])
        db.flush()
        db.add(m.Sku(code="001", supplier_id="s1", category_id="c1", name="Кабель", unit="м"))
        db.add(m.CalcRun(id="r1", created_at=datetime.now(), as_of=date.today(), horizon_days=30,
                         status="done", params={}))
        db.commit()

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.pop(get_db)
    engine.dispose()


def test_full_lifecycle_audit_and_forecast_preservation(orders_db):
    client, factory = orders_db
    created = client.post(URL, json=BODY)
    assert created.status_code == 201, created.text
    row = created.json()
    path = f"{URL}/{row['id']}"
    assert row["status"] == "pending" and row["approved_qty"] is None
    assert row["supplier_id"] == "s1" and row["unit"] == "м"
    assert row["has_explanation"] is False
    assert client.get(path).json() == row
    assert client.post(URL, json=BODY).status_code == 409
    assert len(client.get(URL, params={"run_id": "r1"}).json()) == 1
    approved = client.post(f"{path}/approve", json={"approved_qty": 1.25}).json()
    assert approved["status"] == "approved" and approved["approved_qty"] == 1.25
    with factory() as db:
        db.add(m.SkuForecast(run_id="r1", sku_code="001", explanation={"final_qty": 10},
                             monthly_forecast=[], seasonal_index=[]))
        db.commit()
    values = {"recommended_qty": 7.5, "urgency": "high", "short_reason": "Уточнено", "comment": None}
    updated = client.put(path, json=values)
    assert updated.status_code == 200, updated.text
    assert updated.json()["recommended_qty"] == 7.5
    assert updated.json()["has_explanation"] is True
    assert updated.json()["status"] == "pending" and updated.json()["approved_qty"] is None
    assert client.post(f"{path}/reject", json={"comment": "Отмена"}).json()["status"] == "rejected"
    patched = client.patch(path, json={"comment": "Передумали"}).json()
    assert patched["status"] == "pending" and patched["recommended_qty"] == 7.5
    assert client.delete(path).json() == {"deleted": True, "id": row["id"]}
    for method in (client.get, client.delete):
        assert method(path).status_code == 404
    assert client.patch(path, json={"comment": None}).status_code == 404
    assert client.post(f"{path}/approve", json={"approved_qty": 2}).status_code == 404
    assert client.get(URL, params={"run_id": "r1"}).json() == []
    assert client.post(f"{URL}/export", json={"ids": [row["id"]], "format": "csv"}).status_code == 404
    with factory() as db:
        assert db.get(m.SkuForecast, ("r1", "001")).explanation == {"final_qty": 10}
        audit = list(db.scalars(select(m.AuditLog).where(m.AuditLog.entity_id == row["id"])))
        assert [a.action for a in audit] == ["create", "approved", "update", "rejected", "update", "delete"]
        assert audit[2].payload["before"]["approved_qty"] == 1.25
        assert audit[-1].payload["after"] is None
        assert audit[-1].payload["before"]["comment"] == "Передумали"


def test_manual_run_and_noop_preserves_approval(orders_db):
    client, factory = orders_db
    body = {k: v for k, v in BODY.items() if k != "run_id"}
    created = client.post(URL, json=body)
    assert created.status_code == 201
    row = created.json()
    path = f"{URL}/{row['id']}"
    assert row["run_id"] != "r1" and not row["has_explanation"]
    with factory() as db:
        run = db.get(m.CalcRun, row["run_id"])
        assert run.status == "done" and run.params["source"] == "manual"
        assert db.get(m.SkuForecast, (run.id, "001")) is None
    assert client.get(URL, params={"run_id": "r1"}).json() == []
    client.post(f"{path}/approve", json={"approved_qty": 2.5})
    result = client.patch(path, json={"recommended_qty": 2.5})
    assert result.status_code == 200 and result.json()["status"] == "approved"


@pytest.mark.parametrize("invalid", [
    {"recommended_qty": 0}, {"recommended_qty": -1}, {"recommended_qty": 1000001},
    {"recommended_qty": "NaN"}, {"recommended_qty": "Infinity"}, {"recommended_qty": None},
    {"urgency": "other"}, {"short_reason": "   "}, {"short_reason": "x" * 2001},
    {"comment": "x" * 501}, {"status": "approved"}, {"supplier_id": "s2"},
])
def test_invalid_creation_and_patch_are_atomic(orders_db, invalid):
    client, _ = orders_db
    assert client.post(URL, json={**BODY, **invalid}).status_code == 422
    assert client.get(URL).json() == []
    row = client.post(URL, json=BODY).json()
    path = f"{URL}/{row['id']}"
    assert client.patch(path, json=invalid).status_code == 422
    assert client.get(path).json() == row


def test_missing_references_and_calculation_lock(orders_db):
    client, factory = orders_db
    assert client.post(URL, json={**BODY, "sku_code": "missing"}).status_code == 422
    assert client.post(URL, json={**BODY, "run_id": "missing"}).status_code == 404
    row = client.post(URL, json=BODY).json()
    path = f"{URL}/{row['id']}"
    assert client.patch(path, json={}).status_code == 422
    assert client.put(path, json={"comment": None}).status_code == 422
    assert client.post(f"{path}/approve", json={"approved_qty": 0}).status_code == 422
    with factory() as db:
        db.get(m.CalcRun, "r1").status = "running"
        db.commit()
    assert client.post(URL, json=BODY).status_code == 409
    assert client.patch(path, json={"comment": None}).status_code == 409
    assert client.delete(path).status_code == 409
    assert client.post(f"{path}/reject").status_code == 409
    with factory() as db:
        db.get(m.CalcRun, "r1").status = "failed"
        db.commit()
    assert client.patch(path, json={"comment": None}).status_code == 409
    assert client.post(URL, json=BODY).status_code == 409
