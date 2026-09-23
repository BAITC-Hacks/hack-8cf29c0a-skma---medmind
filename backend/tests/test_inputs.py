import io
import json
import os
import zipfile
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models as m
from app.db import Base, get_db
from app.etl.common import SupplierBundle
from app.main import app
from app.services import bundle_import
from app.services.calc_runs import load_inputs

PREFIX = "/api/input-data"


@pytest.fixture
def client_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, autoflush=False, expire_on_commit=False)

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.pop(get_db)
    engine.dispose()


def setup_product(client, code="00123", supplier="s1"):
    client.post(f"{PREFIX}/suppliers", json={"id": supplier, "name": supplier})
    client.post(f"{PREFIX}/categories", json={"id": "c1", "name": "Категория"})
    body = {"code": code, "supplier_id": supplier, "category_id": "c1", "name": "Кабель", "unit": "м"}
    assert client.post(f"{PREFIX}/products", json=body).status_code == 201
    return body


def upload(client, resource, text, dry_run=False, options=None, name="data.csv"):
    return client.post(f"{PREFIX}/{resource}/import", files={"file": (name, text)},
                       data={"dry_run": str(dry_run).lower(), "options": json.dumps(options or {})})


def test_product_crud_links_audit_and_openapi(client_db):
    client, factory = client_db
    product = setup_product(client)
    assert client.post(f"{PREFIX}/products", json=product).status_code == 409
    assert client.put(f"{PREFIX}/products/00123", json={**product, "name": "Кабель новый"}).status_code == 200
    assert client.get(f"{PREFIX}/products", params={"search": "новый"}).json()["total"] == 1
    assert client.get(f"{PREFIX}/products/00123").json()["code"] == "00123"
    assert client.delete(f"{PREFIX}/suppliers/s1").status_code == 409
    assert client.delete(f"{PREFIX}/categories/c1").status_code == 409
    assert client.put(f"{PREFIX}/products/00123", json={**product, "code": "002"}).status_code == 422
    assert client.post(f"{PREFIX}/products", json={**product, "code": "2", "supplier_id": "missing"}).status_code == 422
    assert client.delete(f"{PREFIX}/products/00123").status_code == 200
    assert client.get(f"{PREFIX}/products/00123").status_code == 404
    with factory() as db:
        assert len(list(db.scalars(select(m.AuditLog)))) == 5
    schema = client.get("/openapi.json").json()
    body = schema["paths"][f"{PREFIX}/products"]["post"]["requestBody"]
    assert body["content"]["application/json"]["schema"]["$ref"].endswith("ProductInput")


@pytest.mark.parametrize(("resource", "body", "key"), [
    ("sales", {"sku_code": "00123", "ts": "2026-09-01T12:00:00", "document": "0001", "qty": 1.5}, "1"),
    ("stock-monthly", {"sku_code": "00123", "month": "2026-09-01", "qty": 12}, "00123~2026-09-01"),
    ("stock-current", {"sku_code": "00123", "as_of": "2026-09-01", "on_hand": 12, "reserved": 2}, "00123"),
    ("transit", {"sku_code": "00123", "supplier_id": "s1", "order_ref": "P1", "qty": 2.5}, "1"),
    ("supplier-rules", {"sku_code": "00123", "supplier_id": "s1", "order_multiple": 0.5}, "00123"),
    ("seasonality", {"supplier_id": "s1", "year": 2026, "month": 9, "revenue": 12}, "s1~2026~9"),
    ("reference-metrics", {"sku_code": "00123", "growth_coef": -0.5}, "00123"),
])
def test_input_crud(client_db, resource, body, key):
    client, _ = client_db
    setup_product(client)
    created = client.post(f"{PREFIX}/{resource}", json=body)
    assert created.status_code == 201, created.text
    assert client.get(f"{PREFIX}/{resource}/{key}").status_code == 200
    assert client.put(f"{PREFIX}/{resource}/{key}", json=body).status_code == 200
    if resource == "stock-current":
        assert created.json()["free"] == 10
    if resource != "seasonality":
        assert client.delete(f"{PREFIX}/products/00123").status_code == 409
    assert client.delete(f"{PREFIX}/{resource}/{key}").status_code == 200


def test_validation_and_engine_inputs(client_db):
    client, factory = client_db
    setup_product(client)
    path = f"{PREFIX}/stock-current"
    stock = {"sku_code": "00123", "as_of": "2026-09-01", "on_hand": 10, "reserved": 3}
    assert client.post(path, json={**stock, "reserved": 11}).status_code == 422
    assert client.post(path, json={**stock, "free": 99}).status_code == 422
    assert client.post(path, json=stock).status_code == 201
    assert client.post(f"{PREFIX}/stock-monthly", json={"sku_code": "00123", "month": "2026-09-02",
                                                      "qty": 2}).status_code == 422
    assert client.post(f"{PREFIX}/transit", json={"sku_code": "missing", "supplier_id": "s1",
                                                "order_ref": "P", "qty": 1}).status_code == 422
    with factory() as db:
        assert load_inputs(db).stock_current.iloc[0]["free"] == 7
    assert client.put(path + "/00123", json={**stock, "on_hand": 20}).status_code == 200
    with factory() as db:
        assert load_inputs(db).stock_current.iloc[0]["free"] == 17


def test_csv_preview_atomicity_and_repeat_import(client_db):
    client, factory = client_db
    text = "id;name\n0001;Поставщик\n0002;Второй\n".encode("utf-8-sig")
    assert upload(client, "suppliers", text, dry_run=True).json()["created"] == 2
    assert client.get(f"{PREFIX}/suppliers").json()["total"] == 0
    with factory() as db:
        assert list(db.scalars(select(m.AuditLog))) == []
    assert upload(client, "suppliers", text).json()["created"] == 2
    assert upload(client, "suppliers", text).json()["unchanged"] == 2
    assert upload(client, "suppliers", text.replace("Второй".encode(), "Другой".encode())).json()["updated"] == 1
    bad = "id;name\n0003;Третий\n0004;\n".encode()
    response = upload(client, "suppliers", bad)
    assert response.status_code == 422
    assert response.json()["detail"]["errors"][0]["row"] == 3
    assert client.get(f"{PREFIX}/suppliers").json()["total"] == 2
    assert upload(client, "suppliers", b"id;name\nX;One\nX;Two").status_code == 422
    assert client.get(f"{PREFIX}/suppliers/X").status_code == 404


def test_sales_identity_updates_and_mapping(client_db):
    client, _ = client_db
    setup_product(client)
    text = "ИД;Код;Дата;Номер;Количество\nbase/doc/1;00123;01.09.2026 12:00:00;00001;1,5\n".encode("cp1251")
    options = {"encoding": "cp1251", "mapping": {"ИД": "external_id", "Код": "sku_code", "Дата": "ts",
                                                 "Номер": "document", "Количество": "qty"}}
    assert upload(client, "sales", text, options=options).json()["created"] == 1
    assert upload(client, "sales", text.replace(b"1,5", b"2,5"), options=options).json()["updated"] == 1
    rows = client.get(f"{PREFIX}/sales").json()["items"]
    assert len(rows) == 1 and rows[0]["qty"] == 2.5 and rows[0]["document"] == "00001"
    assert client.delete(f"{PREFIX}/sales/{rows[0]['id']}").status_code == 200
    assert upload(client, "sales", text, options=options).json()["created"] == 1
    missing_id = b"sku_code;ts;document;qty\n00123;2026-09-01;D1;2"
    assert upload(client, "sales", missing_id).status_code == 422


def test_xlsx_text_identifiers_and_formula_rejection(client_db):
    client, _ = client_db
    for value, status in [("0001", 200), (123, 422), ('=1+1', 422)]:
        workbook = Workbook()
        workbook.active.append(["id", "name"])
        workbook.active.append([value, "Поставщик"])
        output = io.BytesIO()
        workbook.save(output)
        response = upload(client, "suppliers", output.getvalue(), name="data.xlsx")
        assert response.status_code == status, response.text


def test_running_calculation_and_history_guard(client_db):
    client, factory = client_db
    product = setup_product(client)
    with factory() as db:
        db.add(m.CalcRun(id="busy", created_at=datetime.now(), horizon_days=30, status="running"))
        db.commit()
    assert client.put(f"{PREFIX}/products/00123", json=product).status_code == 409
    assert upload(client, "categories", b"id;name\nnew;Name").status_code == 409
    with factory() as db:
        db.get(m.CalcRun, "busy").status = "done"
        db.add(m.SkuForecast(run_id="busy", sku_code="00123", explanation={}, monthly_forecast=[], seasonal_index=[]))
        db.commit()
    assert client.delete(f"{PREFIX}/products/00123").status_code == 409


def archive_bytes(name="stock.xlsx", contents=b"unused"):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(name, contents)
    return output.getvalue()


def test_zip_paths_and_explicit_replacement(client_db):
    client, _ = client_db
    path = "/api/imports/supplier-bundle/iek"
    assert client.post(path, files={"file": ("test.zip", archive_bytes("../stock.xlsx"))}).status_code == 422
    assert client.post(path, files={"file": ("test.zip", b"broken")}).status_code == 422
    assert client.post(path, files={"file": ("test.zip", b"broken")}, data={"dry_run": "false"}).status_code == 422


def test_bundle_replaces_only_selected_supplier(client_db, monkeypatch):
    client, factory = client_db
    setup_product(client, "other", "other")
    bundle = SupplierBundle(
        supplier_id="iek", supplier_name="IEK", default_lead_time_days=45,
        skus=pd.DataFrame([{"sku_code": "NEW", "supplier_sku": "ART", "name": "New", "unit": "шт",
                            "category_id": None, "unit_cost": None}]),
        sales=pd.DataFrame([{"sku_code": "NEW", "ts": datetime(2026, 9, 1), "document": "D1",
                             "doc_type": "Расходная накладная", "qty": 10}]),
        stock_monthly=pd.DataFrame([{"sku_code": "NEW", "month": date(2026, 9, 1), "qty": 2}]),
        transit=pd.DataFrame(columns=["sku_code", "order_ref", "expected_date", "qty"]),
        rules=pd.DataFrame([{"sku_code": "NEW", "min_order_qty": 1, "order_multiple": 1}]),
        seasonality=pd.DataFrame(columns=["year", "month", "revenue"]),
    )
    monkeypatch.setattr(bundle_import, "load_bundle", lambda *_: bundle)
    path = "/api/imports/supplier-bundle/iek"
    for _ in range(2):
        response = client.post(path, files={"file": ("test.zip", b"test")},
                               data={"dry_run": "false", "replace_supplier": "true"})
        assert response.status_code == 200, response.text
    assert client.get(f"{PREFIX}/products").json()["total"] == 2
    assert client.get(f"{PREFIX}/sales").json()["total"] == 1
    with factory() as db:
        assert db.get(m.Sku, "other").supplier_id == "other"

    # A failure after deletion must restore the supplier's old data as well as other suppliers.
    from sqlalchemy.exc import IntegrityError

    def fail_insert(*_):
        raise IntegrityError("test insert", {}, Exception("forced failure"))

    monkeypatch.setattr(bundle_import, "_bulk_insert", fail_insert)
    failed = client.post(path, files={"file": ("test.zip", b"test")},
                         data={"dry_run": "false", "replace_supplier": "true"})
    assert failed.status_code == 409
    assert client.get(f"{PREFIX}/sales").json()["total"] == 1
    assert client.get(f"{PREFIX}/products").json()["total"] == 2


def test_import_limits_and_malformed_uploads(client_db, monkeypatch):
    from app.services import tabular_import

    client, _ = client_db
    assert upload(client, "suppliers", archive_bytes("random.xml", b"<invalid"), name="bad.xlsx").status_code == 422
    assert upload(client, "suppliers", b"id;name\nX;One", name="data.xml").status_code == 415
    assert upload(client, "suppliers", b"id;id\nX;One").status_code == 422
    assert upload(client, "suppliers", b"id;name\nX;One;extra").status_code == 422
    assert upload(client, "suppliers", b"id;name\nX;One", options={"mapping": {"missing": "name"}}).status_code == 422
    monkeypatch.setattr(tabular_import, "MAX_ROWS", 1)
    assert upload(client, "suppliers", b"id;name\nX;One\nY;Two").status_code == 413
    assert client.get(f"{PREFIX}/suppliers").json()["total"] == 0


@pytest.mark.skipif(not os.getenv("PARTNER_DATA_DIR"), reason="Optional local partner archive integration")
@pytest.mark.parametrize(("supplier", "filename"), [("iek", "IEK.zip"), ("se", "Systeme electric.zip")])
def test_partner_archives(client_db, supplier, filename):
    client, _ = client_db
    blob = (Path(os.environ["PARTNER_DATA_DIR"]) / filename).read_bytes()
    for dry_run in (True, False):
        response = client.post(f"/api/imports/supplier-bundle/{supplier}", files={"file": (filename, blob)},
                               data={"dry_run": str(dry_run).lower(), "replace_supplier": "true"})
        assert response.status_code == 200, response.text
        assert response.json()["counts"]["products"] > 0
    assert client.get(f"{PREFIX}/products").json()["total"] > 0
