from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models as m
from app.db import Base, get_db
from app.main import app
from app.services.calc_runs import create_run


@pytest.fixture
def workspace():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, autoflush=False, expire_on_commit=False)

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        client.post("/api/input-data/suppliers", json={"id": "s", "name": "Поставщик"})
        client.post("/api/input-data/categories", json={"id": "c", "name": "Кабель"})
        yield client, factory
    app.dependency_overrides.pop(get_db)
    engine.dispose()


def product(code="001", **values):
    return {"code": code, "name": "Кабель", "supplier_id": "s", "category_id": "c", "unit": "м", **values}


def test_catalog_saves_product_and_stock_atomically(workspace):
    client, factory = workspace
    body = product(stock={"as_of": "2026-09-22", "on_hand": 12.5, "reserved": 2.5})
    response = client.post("/api/products", json=body)
    assert response.status_code == 201, response.text
    assert response.json()["stock"]["free"] == 10
    assert response.json()["unit_cost"] is None
    assert client.post("/api/products", json=body).status_code == 409
    assert client.put("/api/products/001", json={**body, "name": "Изменён", "stock": {
        "as_of": "2026-09-22", "on_hand": 1, "reserved": 2,
    }}).status_code == 422
    result = client.get("/api/products", params={"search": "Поставщик", "limit": 1}).json()
    assert result["total"] == 1
    assert result["items"][0]["name"] == "Кабель"  # stock validation rolls back the product too
    assert client.put("/api/products/001", json=product(unit_cost=23)).status_code == 200
    assert client.get("/api/products").json()["items"][0]["stock"]["on_hand"] == 12.5
    with factory() as db:
        assert db.get(m.Sku, "001").unit_cost == 23
        assert db.get(m.StockCurrent, "001").free == 10
    assert client.delete("/api/input-data/products/001").status_code == 409
    assert client.post("/api/products", json=product("002")).status_code == 201
    assert client.delete("/api/input-data/products/002").status_code == 200
    assert client.get("/api/products", params={"category_id": "missing"}).json()["total"] == 0
    assert client.get("/api/products", params={"search": "кабель"}).json()["total"] == 1
    client.post("/api/products", json=product("003"))
    with factory() as db:
        db.add_all([m.StockMonthly(sku_code="003", month=date(2026, month, 1), qty=qty)
                    for month, qty in [(8, 100), (9, 5)]])
        db.commit()
    ordered = client.get("/api/products", params={"sort": "stock"}).json()["items"]
    assert ordered[0]["code"] == "003"
    assert ordered[0]["monthly_stock"] == {"as_of": "2026-09-01", "on_hand": 5}


def test_sales_summary_paging_filters_and_complete_export(workspace):
    client, factory = workspace
    client.post("/api/products", json=product())
    client.post("/api/products", json=product("002"))
    with factory() as db:
        db.add_all([m.SalesLine(sku_code=sku, ts=datetime(2026, 9, day, 23, 59), document=doc,
                               doc_type="Расходная накладная", qty=qty) for sku, day, doc, qty in [
            ("001", 21, "Д1", 10), ("002", 21, "Д1", 2), ("001", 22, "Возврат", -3),
            ("001", 23, "=formula", 4), ("orphan", 23, "Д3", 1),
        ]])
        db.commit()
    result = client.get("/api/sales", params={"limit": 1, "from": "2026-09-21", "to": "2026-09-22"}).json()
    assert len(result["items"]) == 1 and result["total"] == 3
    assert result["items"][0]["qty"] == -3
    assert result["summary"] == {"documents": 2, "operations": 3, "returns": 1, "skus": 2}
    assert result["counts"] == {"all": 3, "sale": 2, "return": 1}
    assert sum(p["operations"] for p in result["trend"]) == 3
    assert result["range"] == {"from": "2026-09-21", "to": "2026-09-23"}
    returns = client.get("/api/sales", params={"kind": "return", "supplier_id": "s"}).json()
    assert returns["total"] == 1 and returns["counts"]["all"] == 4
    assert client.get("/api/sales", params={"search": "002"}).json()["total"] == 1
    assert client.get("/api/sales", params={"search": "кабель"}).json()["total"] == 4
    assert client.get("/api/sales", params={"search": "%"}).json()["total"] == 0
    assert client.get("/api/sales", params={"from": "2026-09-24", "to": "2026-09-22"}).status_code == 422
    exported = client.get("/api/sales/export", params={"to": "2026-09-22"})
    assert exported.status_code == 200
    assert len(exported.text.lstrip("\ufeff").splitlines()) == 4
    assert "'=formula" in client.get("/api/sales/export").text
    assert client.get("/api/sales", params={"offset": 99}).json()["items"] == []


def test_dashboard_uses_selected_run_and_category_without_fake_forecasts(workspace):
    client, factory = workspace
    client.post("/api/products", json=product())
    with factory() as db:
        db.add_all([m.CalcRun(id=run, created_at=datetime(2026, 9, 23), as_of=date(2026, 9, 23),
                             horizon_days=30, status="done") for run in ("r1", "r2")])
        db.flush()
        db.add_all([m.OrderRecommendation(id=run, run_id=run, sku_code="001", supplier_id="s",
                                         category_id="c", recommended_qty=10, urgency=urgency,
                                         status="pending", short_reason="Пополнение", days_of_cover=2)
                    for run, urgency in (("r1", "high"), ("r2", "low"))])
        db.add(m.SalesLine(sku_code="001", ts=datetime(2026, 8, 1), document="Д1",
                          doc_type="Расходная накладная", qty=10))
        db.commit()
    one = client.get("/api/analytics/dashboard", params={"run_id": "r1"}).json()
    assert one["summary"] == {"orders": 1, "high": 1, "suppliers": 1}
    assert one["risks"][0]["id"] == "r1"
    assert one["seasonality"] == []
    assert one["trend"] == [{"period": "2026-08", "actual_qty": 10, "forecast_qty": None}]
    assert client.get("/api/analytics/dashboard", params={"run_id": "r2"}).json()["summary"]["high"] == 0
    empty = client.get("/api/analytics/dashboard", params={"run_id": "r1", "category_id": "none"}).json()
    assert empty["summary"]["orders"] == 0
    assert client.get("/api/analytics/dashboard", params={"run_id": "missing"}).status_code == 404
    with factory() as db:
        db.add(m.SkuForecast(run_id="r1", sku_code="001", explanation={},
                             monthly_forecast=[{"period": "2026-10", "qty": 20}], seasonal_index=[1] * 12))
        db.commit()
    forecast = client.get("/api/analytics/dashboard", params={"run_id": "r1"}).json()
    assert forecast["trend"][-1] == {"period": "2026-10", "actual_qty": None, "forecast_qty": 20}
    assert len(forecast["seasonality"]) == 12
    client.delete("/api/recommendations/r1")
    assert client.get("/api/analytics/dashboard", params={"run_id": "r1"}).json()["summary"]["orders"] == 0
    with factory() as db:
        assert db.scalar(select(m.OrderRecommendation.id).where(m.OrderRecommendation.run_id == "r2")) == "r2"


def test_active_calculation_blocks_conflicting_writes_and_duplicate_start(workspace):
    client, factory = workspace
    client.post("/api/products", json=product())
    client.post("/api/input-data/supplier-rules", json={"sku_code": "001", "supplier_id": "s"})
    rule_id = client.get("/api/settings/supplier-rules").json()[0]["id"]
    with factory() as db:
        run = create_run(db)
        assert run.status == "running"
        assert db.get(m.CalcParams, 1).forecast_horizon_days == 30
    assert client.post("/api/calc-runs", json={}).status_code == 409
    assert client.post("/api/products", json=product("002")).status_code == 409
    assert client.put("/api/suppliers/s", json={"lead_time_days": 2}).status_code == 409
    assert client.put(f"/api/settings/supplier-rules/{rule_id}", json={"min_order_qty": 3}).status_code == 409
    with factory() as db:
        assert len(db.scalars(select(m.CalcRun)).all()) == 1
