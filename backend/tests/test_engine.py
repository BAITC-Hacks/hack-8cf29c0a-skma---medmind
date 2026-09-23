from datetime import date, datetime

import numpy as np
import pandas as pd
import pytest
from conftest import AS_OF, month_starts, steady_sales

from app.engine.core import (
    EngineInputs,
    EngineParams,
    apply_order_rules,
    compensate_stockouts,
    detect_bulk_outliers,
    run_engine,
    stockout_day,
    supplier_seasonal_index,
)
from app.etl.common import parse_month_header, parse_ru_date


def _lines(qtys: list[float], sku: str = "A", months: int = 10) -> pd.DataFrame:
    periods = pd.period_range("2025-11", periods=months, freq="M")
    return pd.DataFrame({
        "sku_code": sku,
        "qty": qtys,
        "period": [periods[i % months] for i in range(len(qtys))],
    })


def make_inputs(sales: list[dict], *, stock: dict[str, float] | None = None, transit: list[dict] | None = None,
                rules: list[dict] | None = None, stock_history: list[dict] | None = None) -> EngineInputs:
    codes = sorted({r["sku_code"] for r in sales})
    stock = stock or {}
    return EngineInputs(
        skus=pd.DataFrame({"sku_code": codes, "supplier_id": "s1", "category_id": "none", "name": codes,
                           "unit": "шт", "unit_cost": None}),
        sales=pd.DataFrame(sales),
        stock_monthly=pd.DataFrame(stock_history or [], columns=["sku_code", "month", "qty"]),
        stock_current=pd.DataFrame([
            {"sku_code": k, "as_of": AS_OF, "on_hand": v, "reserved": 0.0, "free": v} for k, v in stock.items()
        ], columns=["sku_code", "as_of", "on_hand", "reserved", "free"]),
        transit=pd.DataFrame(transit or [], columns=["sku_code", "order_ref", "expected_date", "qty"]),
        rules=pd.DataFrame(rules or [], columns=["sku_code", "min_order_qty", "order_multiple"]),
        suppliers=pd.DataFrame([{"id": "s1", "name": "S1", "lead_time_days": 30}]),
        categories=pd.DataFrame([{"id": "none", "buffer_multiplier": 1.0}]),
        supplier_seasonality=pd.DataFrame(columns=["supplier_id", "year", "month", "revenue"]),
        as_of=AS_OF,
    )


# ---------------------------------------------------------------- ETL-утилиты

@pytest.mark.parametrize("header, expected", [
    ("янв. 2024", date(2024, 1, 1)),
    ("сент. 2026", date(2026, 9, 1)),
    ("май 2025", date(2025, 5, 1)),
    ("Январь 2024 г.", date(2024, 1, 1)),
    ("Итого", None),
    (None, None),
])
def test_parse_month_header(header, expected):
    assert parse_month_header(header) == expected


def test_parse_ru_date():
    assert parse_ru_date("РФ УТ-7583 от 31 августа (поступление до 10.10.2026)") == date(2026, 10, 10)
    assert parse_ru_date("без даты") is None


# ---------------------------------------------------------------- выбросы

def test_single_bulk_line_is_flagged():
    flags = detect_bulk_outliers(_lines([10] * 40 + [500]), sensitivity=0.5)
    assert flags.sum() == 1 and flags.iloc[-1]


def test_regular_wholesale_is_not_flagged():
    # крупные строки идут каждый месяц — это регулярный опт, а не разовая сделка
    qtys = [50] * 60 + [2000] * 10
    flags = detect_bulk_outliers(_lines(qtys), sensitivity=0.5)
    assert flags.sum() == 0


def test_sensitivity_controls_threshold():
    qtys = [10] * 40 + [55]  # median 10, σ̂ = 5: порог 3σ → 25 (выброс), 10σ → 60 (не выброс)
    assert detect_bulk_outliers(_lines(qtys), sensitivity=1.0).sum() == 1
    assert detect_bulk_outliers(_lines(qtys), sensitivity=0.0).sum() == 0


def test_sparse_sku_single_huge_line():
    flags = detect_bulk_outliers(_lines([210_000], months=1), sensitivity=0.5)
    assert flags.all()
    flags = detect_bulk_outliers(_lines([2], months=1), sensitivity=0.5)  # мелкая единичная продажа — не выброс
    assert not flags.any()


# ---------------------------------------------------------------- stockout

def test_stockout_compensation_fills_to_reference():
    periods = pd.period_range("2026-01", periods=4, freq="M")
    demand = pd.DataFrame([[100.0, 100.0, 20.0, 0.0]], index=["A"], columns=periods)
    avail = pd.DataFrame([[1.0, 1.0, 0.5, 0.0]], index=["A"], columns=periods)
    corrected, ref = compensate_stockouts(demand, avail)
    assert ref["A"] == 100
    assert corrected.loc["A"].tolist() == [100, 100, 60, 100]


# ---------------------------------------------------------------- сезонность

def test_supplier_index_removes_trend():
    # выручка = сильный линейный рост × сезонность с пиком в июле; тренд не должен попасть в индекс
    true = np.array([0.8, 0.8, 0.9, 1.0, 1.0, 1.1, 1.4, 1.2, 1.0, 1.0, 0.9, 0.9])
    true = true / true.mean()
    rows = []
    for t, (y, m) in enumerate((y, m) for y in (2024, 2025, 2026) for m in range(1, 13)):
        rows.append({"year": y, "month": m, "revenue": (100 + 5 * t) * true[m - 1]})
    idx = supplier_seasonal_index(pd.DataFrame(rows))
    assert np.allclose(idx, true, atol=0.03)


# ---------------------------------------------------------------- MOQ / срочность

@pytest.mark.parametrize("net, min_q, mult, expected", [
    (0.3, 10, 1, 0),  # потребность ниже порога — не заказываем
    (3.2, 1, 1, 4),
    (3.2, 10, 1, 10),  # минимальная партия
    (23, 1, 10, 30),  # кратность
    (23, 25, 10, 30),  # мин. партия + кратность
])
def test_apply_order_rules(net, min_q, mult, expected):
    assert apply_order_rules(net, min_q, mult) == expected


def test_stockout_day_accounts_for_transit():
    daily = np.full(60, 10.0)
    assert stockout_day(55, [], daily) == 6
    assert stockout_day(55, [(3, 100)], daily) == 16
    assert stockout_day(1000, [], daily) is None


# ---------------------------------------------------------------- пайплайн целиком

def test_run_engine_end_to_end():
    sales = steady_sales("A", per_month=300) + steady_sales("B", per_month=30)
    # разовая оптовая отгрузка по A — должна быть исключена и показана в обосновании
    sales.append({"sku_code": "A", "ts": datetime(2026, 6, 15, 12), "document": "BULK1",
                  "doc_type": "Расходная накладная", "qty": 5000})
    inp = make_inputs(
        sales,
        stock={"A": 50, "B": 1000},
        rules=[{"sku_code": "A", "min_order_qty": 1, "order_multiple": 50}],
        transit=[{"sku_code": "A", "order_ref": "PO-1", "expected_date": date(2026, 10, 1), "qty": 100}],
    )
    out = run_engine(inp, EngineParams(forecast_horizon_days=30, safety_buffer_days=14))
    res = {r.sku_code: r for r in out.results}
    assert out.as_of == AS_OF

    a = res["A"]
    assert a.explanation["base_demand"] == pytest.approx(300, rel=0.01)
    assert [o["document"] for o in a.explanation["bulk_outliers_excluded"]] == ["BULK1"]
    assert a.recommended_qty > 0 and a.recommended_qty % 50 == 0
    assert a.urgency == "high"  # 50 шт. хватит на ~5 дней при сроке поставки 30 дн.
    # потребность: ~300/мес на 60 дней + буфер − 50 остаток − 100 в пути
    assert 400 <= a.recommended_qty <= 650
    assert "BULK1" not in a.short_reason and a.explanation["narrative"]

    b = res["B"]
    assert b.recommended_qty == 0  # остатка 1000 шт. хватит надолго
    assert b.urgency == "low"


def test_stockout_months_raise_demand():
    sales = [r for r in steady_sales("A", per_month=100) if r["ts"] < datetime(2026, 5, 1)]
    history = [{"sku_code": "A", "month": m, "qty": 0.0 if m >= date(2026, 5, 1) else 200.0}
               for m in month_starts(21, end=date(2026, 9, 1))]
    out = run_engine(make_inputs(sales, stock_history=history), EngineParams())
    e = out.results[0].explanation
    assert e["stockout_months"] == ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]
    assert e["stockout_compensation"] > 0
    assert e["base_demand"] == pytest.approx(100, rel=0.05)  # без компенсации было бы ~58
