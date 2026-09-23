from datetime import date

import pytest
from conftest import steady_sales
from fastapi.testclient import TestClient
from sqlalchemy import insert

from app import models
from app.db import SessionLocal, init_db
from app.main import app
from app.services.calc_runs import create_run, execute_run


@pytest.fixture(scope="module")
def client():
    init_db()
    with SessionLocal() as db:
        db.add_all([
            models.Supplier(id="iek", name="IEK", lead_time_days=45),
            models.Category(id="none", name="Без категории"),
            models.CalcParams(id=1),
            models.Sku(code="A_", supplier_id="iek", supplier_sku="ART-A", name="Товар A", unit="шт",
                       category_id="none"),
            models.Sku(code="B_", supplier_id="iek", supplier_sku="ART-B", name="Товар B", unit="шт",
                       category_id="none"),
            models.SupplierRule(supplier_id="iek", sku_code="A_", min_order_qty=10, order_multiple=10),
            models.StockCurrent(sku_code="A_", as_of=date(2026, 9, 22), on_hand=20, reserved=0, free=20),
            models.StockCurrent(sku_code="B_", as_of=date(2026, 9, 22), on_hand=5000, reserved=0, free=5000),
        ])
        db.execute(insert(models.SalesLine), steady_sales("A_", 200) + steady_sales("B_", 20))
        db.commit()
        run = create_run(db)
    execute_run(run.id)
    with TestClient(app) as c:
        yield c


def test_calc_runs(client):
    runs = client.get("/api/calc-runs").json()
    assert runs[0]["status"] == "done" and runs[0]["as_of"] == "2026-09-22"


def test_recommendations_and_filters(client):
    recs = client.get("/api/recommendations").json()
    assert [r["sku_code"] for r in recs] == ["A_"]  # B_ покрыт остатком
    r = recs[0]
    assert r["supplier_name"] == "IEK" and r["supplier_sku"] == "ART-A" and r["status"] == "pending"
    assert r["recommended_qty"] % 10 == 0
    assert client.get("/api/recommendations", params={"urgency": ["low"]}).json() == []
    assert len(client.get("/api/recommendations", params={"supplier_id": ["iek", "se"]}).json()) == 1


def test_explain(client):
    e = client.get("/api/recommendations/A_/explain").json()
    for key in ("base_demand", "seasonality_factor", "growth_factor", "stockout_compensation", "free_stock",
                "goods_in_transit", "safety_buffer", "bulk_outliers_excluded", "final_qty", "narrative"):
        assert key in e
    assert e["base_demand"] == pytest.approx(200, rel=0.01)
    # B_ не рекомендован, но обоснование «заказ не требуется» доступно
    assert "не требуется" in client.get("/api/recommendations/B_/explain").json()["narrative"]
    assert client.get("/api/recommendations/NOPE/explain").status_code == 404


def test_approve_reject_and_export(client, tmp_dir):
    rec = client.get("/api/recommendations").json()[0]
    approved = client.post(f"/api/recommendations/{rec['id']}/approve",
                           json={"approved_qty": 120, "comment": "скорректировано"}).json()
    assert approved["status"] == "approved" and approved["approved_qty"] == 120
    assert client.post(f"/api/recommendations/{rec['id']}/approve", json={"approved_qty": -1}).status_code == 422

    for fmt in ("csv", "xlsx"):
        resp = client.post("/api/recommendations/export", json={"ids": [rec["id"]], "format": fmt})
        assert resp.status_code == 200
        file = client.get(resp.json()["download_url"])
        assert file.status_code == 200 and len(file.content) > 0
        if fmt == "csv":
            text = file.content.decode("utf-8-sig")
            assert text.splitlines()[1].split(";")[5] == "120"
    assert client.post("/api/recommendations/export", json={"ids": [rec["id"]], "format": "pdf"}).status_code == 501
    assert client.get("/api/exports/..%2F..%2Fsecret.txt").status_code == 404

    rejected = client.post(f"/api/recommendations/{rec['id']}/reject", json={"comment": "не нужно"}).json()
    assert rejected["status"] == "rejected" and rejected["approved_qty"] is None


def test_settings(client):
    assert client.get("/api/settings/calc-params").json()["forecast_horizon_days"] == 30
    new = {"forecast_horizon_days": 45, "safety_buffer_days": 7, "outlier_sensitivity": 0.8}
    assert client.put("/api/settings/calc-params", json=new).json() == new
    bad = {**new, "outlier_sensitivity": 1.5}
    assert client.put("/api/settings/calc-params", json=bad).status_code == 422

    rules = client.get("/api/settings/supplier-rules", params={"supplier_id": "iek"}).json()
    rule = client.put(f"/api/settings/supplier-rules/{rules[0]['id']}", json={"order_multiple": 25}).json()
    assert rule["order_multiple"] == 25 and rule["min_order_qty"] == 10

    assert client.put("/api/suppliers/iek", json={"lead_time_days": 60}).json()["lead_time_days"] == 60


def test_analytics(client):
    trend = client.get("/api/analytics/demand-trend", params={"sku_code": "A_", "from": "2026-06"}).json()
    assert trend[0]["period"] == "2026-06" and trend[0]["actual_qty"] == pytest.approx(200)
    assert any(p["forecast_qty"] for p in trend)
    season = client.get("/api/analytics/seasonality", params={"supplier_id": "iek"}).json()
    assert [p["month"] for p in season] == list(range(1, 13))
    assert sum(p["factor"] for p in season) / 12 == pytest.approx(1, abs=0.01)


def test_start_run(client):
    resp = client.post("/api/calc-runs", json={"horizon_days": 20})
    assert resp.status_code == 202 and resp.json()["horizon_days"] == 20
    # TestClient выполняет BackgroundTasks синхронно — к этому моменту расчёт завершён
    assert client.get(f"/api/calc-runs/{resp.json()['id']}").json()["status"] == "done"
