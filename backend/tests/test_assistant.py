"""«Ленивый режим»: агентный цикл на фейковом клиенте OpenAI, инструменты, файлы, графики."""

import io
import json
from datetime import date
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from conftest import steady_sales
from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine, insert
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models as m
from app.assistant import agent, tools
from app.config import get_settings
from app.db import Base, get_db
from app.engine.timeseries import forecast_monthly
from app.main import app
from app.services import calc_runs


@pytest.fixture
def env(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        db.add_all([
            m.Supplier(id="iek", name="IEK", lead_time_days=45),
            m.Category(id="none", name="Без категории"),
            m.CalcParams(id=1),
            m.Sku(code="A_", supplier_id="iek", supplier_sku="ART-A", name="Кабель ВВГ", unit="м", category_id="none"),
            m.Sku(code="B_", supplier_id="iek", supplier_sku="ART-B", name="Розетка", unit="шт", category_id="none"),
            m.StockCurrent(sku_code="A_", as_of=date(2026, 9, 22), on_hand=10, reserved=0, free=10),
            m.StockCurrent(sku_code="B_", as_of=date(2026, 9, 22), on_hand=900, reserved=0, free=900),
        ])
        db.execute(insert(m.SalesLine), steady_sales("A_", 300) + steady_sales("B_", 20))
        db.commit()
        monkeypatch.setattr(calc_runs, "SessionLocal", factory)
        run = calc_runs.create_run(db)
    calc_runs.execute_run(run.id)

    def override():
        with factory() as db:
            yield db

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.pop(get_db)
    engine.dispose()


def _call(name: str, args: dict, call_id: str):
    return SimpleNamespace(type="function_call", name=name, arguments=json.dumps(args), call_id=call_id)


class FakeResponses:
    """Сценарий: каждый create() отдаёт следующий шаг. Запоминает, что модель получила на вход."""

    def __init__(self, steps: list[list]):
        self.steps = steps
        self.requests: list[dict] = []

    def create(self, **kwargs):
        self.requests.append(kwargs)
        output = self.steps[len(self.requests) - 1]
        text = next((o.text for o in output if getattr(o, "type", None) == "message"), "")
        return SimpleNamespace(output=output, output_text=text)


def _text(t: str):
    return SimpleNamespace(type="message", text=t)


def _xlsx(rows: list[list]) -> bytes:
    wb = Workbook()
    for r in rows:
        wb.active.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ---------------------------------------------------------------- статус / отключённый режим

def test_status_and_disabled_without_key(env, monkeypatch):
    client, _ = env
    monkeypatch.setattr(get_settings(), "openai_api_key", None)
    st = client.get("/api/assistant/status").json()
    assert st["enabled"] is False and {x["mode"] for x in st["models"]} == {"fast", "standard", "deep"}
    conv = client.post("/api/assistant/conversations", json={}).json()
    r = client.post(f"/api/assistant/conversations/{conv['id']}/messages", json={"content": "привет"})
    assert r.status_code == 503 and "OPENAI_API_KEY" in r.json()["detail"]


# ---------------------------------------------------------------- агентный цикл

def test_chat_turn_with_tools_and_chart(env, monkeypatch):
    client, _ = env
    fake = FakeResponses([
        [_call("search_skus", {"query": "кабель", "limit": None}, "c1")],
        [_call("get_demand_trend", {"sku_code": "A_", "category_id": None, "supplier_id": None,
                                    "from_period": None, "to_period": None, "plot": True}, "c2"),
         _call("get_sku_details", {"sku_code": "A_"}, "c3")],
        [_text("Спрос на кабель стабилен ~300 м/мес, нужен заказ.")],
    ])
    monkeypatch.setattr(agent, "get_client", lambda db: fake)

    conv = client.post("/api/assistant/conversations", json={}).json()
    r = client.post(f"/api/assistant/conversations/{conv['id']}/messages",
                    json={"content": "Покажи динамику по кабелю", "mode": "fast"})
    assert r.status_code == 200, r.text
    reply = r.json()["assistant_message"]
    assert reply["content"].startswith("Спрос на кабель")
    assert reply["model"] == get_settings().openai_model_fast
    assert [c["name"] for c in reply["tool_calls"]] == ["search_skus", "get_demand_trend", "get_sku_details"]

    chart = reply["charts"][0]
    assert chart["type"] == "line" and {s["kind"] for s in chart["series"]} == {"actual", "forecast"}
    actual = [p for p in chart["data"] if p["actual"] is not None]
    assert actual[-1]["forecast"] == actual[-1]["actual"]  # прогноз стыкуется с фактом
    assert any(p["actual"] is None and p["forecast"] for p in chart["data"])

    # вход второго запроса содержит результат поиска; store=false; инструменты объявлены
    second = fake.requests[1]
    outputs = [i for i in second["input"] if isinstance(i, dict) and i.get("type") == "function_call_output"]
    assert "A_" in outputs[0]["output"]
    assert second["store"] is False and len(second["tools"]) == len(tools.TOOLS)

    detail = client.get(f"/api/assistant/conversations/{conv['id']}").json()
    assert detail["title"] == "Покажи динамику по кабелю"
    assert [x["role"] for x in detail["messages"]] == ["user", "assistant"]

    # следующий вопрос получает историю диалога
    fake2 = FakeResponses([[_text("Да.")]])
    monkeypatch.setattr(agent, "get_client", lambda db: fake2)
    client.post(f"/api/assistant/conversations/{conv['id']}/messages", json={"content": "Точно?"})
    roles = [i["role"] for i in fake2.requests[0]["input"]]
    assert roles == ["user", "assistant", "user"]


def test_tool_errors_are_returned_to_model(env):
    _, factory = env
    with factory() as db:
        ctx = tools.ToolContext(db=db, conversation_id="x")
        out = json.loads(tools.execute(ctx, "get_sku_details", json.dumps({"sku_code": "NOPE"})))
        assert "search_skus" in out["error"]
        assert "error" in json.loads(tools.execute(ctx, "unknown_tool", "{}"))
        assert "error" in json.loads(tools.execute(ctx, "search_skus", "{bad json"))


def test_order_links_point_to_real_recommendations_and_allow_manual_approval(env):
    client, factory = env
    with factory() as db:
        ctx = tools.ToolContext(db=db, conversation_id="conversation-1")
        overview = tools.get_overview(ctx)
        search = tools.search_skus(ctx, "кабель", None)
        details = tools.get_sku_details(ctx, "A_")
        listing = tools.list_recommendations(ctx, None, None, None, None, None, None)
        urls = [overview['most_urgent'][0]['order_url'], search['matches'][0]['order_url'],
                details['recommendation']['order_url'], listing['items'][0]['order_url']]
        for url in urls:
            parsed = urlsplit(url)
            params = parse_qs(parsed.query)
            assert parsed.path == '/assistant'
            assert params['c'] == ['conversation-1']
            rec = db.get(m.OrderRecommendation, params['order'][0])
            assert rec is not None and rec.status == 'pending'
        order_id = details['recommendation']['id']
        db.add(m.Sku(code='NO-ORDER', name='Без заказа', supplier_id='iek', category_id='none', unit='шт'))
        db.commit()
        assert tools.search_skus(ctx, 'NO-ORDER', None)['matches'][0]['order_url'] is None
    assert client.get(f'/api/recommendations/{order_id}').json()['status'] == 'pending'
    result = client.post(f'/api/recommendations/{order_id}/approve', json={'approved_qty': 25, 'comment': 'Проверено'})
    assert result.status_code == 200, result.text
    assert client.get(f'/api/recommendations/{order_id}').json()['approved_qty'] == 25


def test_tool_round_limit(env, monkeypatch):
    client, _ = env
    monkeypatch.setattr(get_settings(), "assistant_max_tool_rounds", 2)
    loop = [_call("get_overview", {}, "c")]
    fake = FakeResponses([loop, loop, [_text("Итог по собранным данным.")]])
    monkeypatch.setattr(agent, "get_client", lambda db: fake)
    conv = client.post("/api/assistant/conversations", json={}).json()
    reply = client.post(f"/api/assistant/conversations/{conv['id']}/messages",
                        json={"content": "обзор"}).json()["assistant_message"]
    assert reply["content"] == "Итог по собранным данным."
    assert fake.requests[-1]["tool_choice"] == "none"


def test_upstream_error_does_not_leak_key_or_save_messages(env, monkeypatch, caplog):
    from openai import AuthenticationError

    client, _ = env
    secret = "test-secret-never-show"

    class FailingResponses:
        def create(self, **kwargs):
            response = httpx.Response(401, request=httpx.Request("POST", "https://api.openai.com/v1/responses"))
            raise AuthenticationError(f"Incorrect API key: {secret}", response=response, body=None)

    monkeypatch.setattr(agent, "get_client", lambda db: FailingResponses())
    conv = client.post("/api/assistant/conversations", json={}).json()
    url = f"/api/assistant/conversations/{conv['id']}"
    result = client.post(f"{url}/messages", json={"content": "Привет"})
    assert result.status_code == 502
    assert "API-ключ" in result.json()["detail"]
    assert secret not in result.text + caplog.text
    assert client.get(url).json()["messages"] == []


@pytest.mark.parametrize("status, answer", [("completed", ""), ("incomplete", "Частичный ответ")])
def test_empty_or_incomplete_response_is_not_saved(env, monkeypatch, status, answer):
    client, _ = env
    fake = SimpleNamespace(create=lambda **kwargs: SimpleNamespace(output=[], output_text=answer, status=status))
    monkeypatch.setattr(agent, "get_client", lambda db: fake)
    conv = client.post("/api/assistant/conversations", json={}).json()
    url = f"/api/assistant/conversations/{conv['id']}"
    assert client.post(f"{url}/messages", json={"content": "Привет"}).status_code == 502
    assert client.get(url).json()["messages"] == []


def test_followup_keeps_attached_file_context(env, monkeypatch):
    client, _ = env
    conv = client.post("/api/assistant/conversations", json={}).json()
    url = f"/api/assistant/conversations/{conv['id']}"
    csv = "Номенклатура;Номенклатура.Код;янв. 2026;февр. 2026;март 2026\nРозетка;R1;10;12;14\n"
    upload = client.post(f"{url}/files", files={"file": ("sales.csv", csv.encode(), "text/csv")})
    assert upload.status_code == 201, upload.text
    file = upload.json()
    fake = FakeResponses([[_text("Принято")], [_text("Прогноз")]])
    monkeypatch.setattr(agent, "get_client", lambda db: fake)
    assert client.post(f"{url}/messages", json={"content": "Изучи файл", "file_ids": [file['id']]}).status_code == 200
    assert client.post(f"{url}/messages", json={"content": "Теперь дай прогноз"}).status_code == 200
    assert file['id'] in fake.requests[1]["input"][0]["content"]


# ---------------------------------------------------------------- файлы и прогноз

def test_upload_long_file_and_forecast_tool(env):
    client, factory = env
    rows = [["Дата", "Номер", "Код", "Номенклатура", "Количество"]]
    for y, mth in [(2025, mm) for mm in range(1, 13)] + [(2026, mm) for mm in range(1, 9)]:
        for d in (3, 10, 17, 28):
            rows.append([f"{d:02d}.{mth:02d}.{y} 10:00:00", f"D{y}{mth}{d}", "X1", "Автомат 16А", 25])
    rows.append(["15.06.2026 12:00:00", "BULK", "X1", "Автомат 16А", 5000])  # разовая оптовая отгрузка
    rows.append(["05.08.2026 12:00:00", "D2", "Y2", "Выключатель", 3])
    conv = client.post("/api/assistant/conversations", json={}).json()
    r = client.post(f"/api/assistant/conversations/{conv['id']}/files",
                    files={"file": ("sales.xlsx", _xlsx(rows), "application/octet-stream")})
    assert r.status_code == 201, r.text
    info = r.json()
    assert info["summary"]["kind"] == "long" and info["summary"]["months"] == 20

    with factory() as db:
        ctx = tools.ToolContext(db=db, conversation_id=conv["id"])
        out = json.loads(tools.execute(ctx, "forecast_from_file", json.dumps(
            {"file_id": info["id"], "sku": "автомат", "horizon_months": 3, "exclude_outliers": True, "plot": True})))
        assert out["bulk_outliers_excluded"][0]["document"] == "BULK"
        assert out["base_demand"] == pytest.approx(100, rel=0.01)
        assert [p["period"] for p in out["forecast"]] == ["2026-09", "2026-10", "2026-11"]
        assert ctx.charts and ctx.charts[0]["title"].startswith("Прогноз по файлу")
        assert not out["notes"]  # август закрыт (продажи до 28-го) — неполного месяца нет
        # несколько товаров под одним запросом — модель должна уточнить, а не получить сумму
        ambiguous = json.loads(tools.execute(ctx, "forecast_from_file", json.dumps(
            {"file_id": info["id"], "sku": "а", "horizon_months": 3, "exclude_outliers": True, "plot": False})))
        assert "уточните" in ambiguous.get("error", "")
        # файл из другого диалога недоступен
        other = tools.ToolContext(db=db, conversation_id="other")
        assert "error" in json.loads(tools.execute(other, "analyze_file", json.dumps({"file_id": info["id"]})))


def test_partial_last_month_is_dropped(env):
    client, factory = env
    rows = [["Дата", "Код", "Количество"]]
    for mth in range(1, 10):
        last_day = 22 if mth == 9 else 28  # выгрузка обрывается 22.09 — как реальные данные партнёра
        rows += [[f"{d:02d}.{mth:02d}.2026", "X1", 10] for d in (1, 8, 15, last_day)]
    conv = client.post("/api/assistant/conversations", json={}).json()
    info = client.post(f"/api/assistant/conversations/{conv['id']}/files",
                       files={"file": ("s.xlsx", _xlsx(rows), "application/octet-stream")}).json()
    with factory() as db:
        ctx = tools.ToolContext(db=db, conversation_id=conv["id"])
        out = json.loads(tools.execute(ctx, "forecast_from_file", json.dumps(
            {"file_id": info["id"], "sku": None, "horizon_months": 2, "exclude_outliers": False, "plot": False})))
    assert out["forecast"][0]["period"] == "2026-09"
    assert any("неполный месяц" in n for n in out["notes"])


def test_upload_wide_file_csv(env):
    client, _ = env
    csv_text = "Номенклатура;Номенклатура.Код;янв. 2026;февр. 2026;март 2026;апр. 2026\n" \
               "Розетка;R1;10;12;14;16\nИтого;;10;12;14;16\n"
    conv = client.post("/api/assistant/conversations", json={}).json()
    r = client.post(f"/api/assistant/conversations/{conv['id']}/files",
                    files={"file": ("m.csv", csv_text.encode("cp1251"), "text/csv")})
    assert r.status_code == 201, r.text
    s = r.json()["summary"]
    assert s["kind"] == "wide" and s["skus"] == 1 and s["total_qty"] == 52  # строка «Итого» отброшена


def test_upload_rejects_bad_files(env):
    client, _ = env
    conv = client.post("/api/assistant/conversations", json={}).json()
    url = f"/api/assistant/conversations/{conv['id']}/files"
    assert client.post(url, files={"file": ("x.pdf", b"%PDF", "application/pdf")}).status_code == 422
    assert client.post(url, files={"file": ("x.csv", b"a;b\nx;y\n", "text/csv")}).status_code == 422
    r = client.post(f"/api/assistant/conversations/{conv['id']}/messages",
                    json={"content": "?", "file_ids": ["nope"]})
    assert r.status_code == 404


def test_delete_conversation(env):
    client, _ = env
    conv = client.post("/api/assistant/conversations", json={"title": "t"}).json()
    assert client.delete(f"/api/assistant/conversations/{conv['id']}").status_code == 204
    assert client.get(f"/api/assistant/conversations/{conv['id']}").status_code == 404


# ---------------------------------------------------------------- прогноз ряда

def test_forecast_monthly_growth_and_short_history():
    import pandas as pd

    idx = pd.period_range("2025-01", "2026-08", freq="M")
    s = pd.Series([100.0 * (1.02 ** i) for i in range(len(idx))], index=idx)  # стабильный рост ~27%/год
    res = forecast_monthly(s, 3)
    assert res["forecast"][0]["qty"] > s.iloc[-12:].mean()  # тренд учтён
    assert res["months_used"] == 20 and not res["notes"]

    short = forecast_monthly(s.iloc[-5:], 2)
    assert any("сезонность не оценивалась" in n for n in short["notes"])
    assert forecast_monthly(pd.Series(dtype=float), 3)["forecast"] == []
