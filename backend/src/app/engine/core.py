"""Расчётный движок рекомендаций. Чистые функции над DataFrame — без БД, тестируются изолированно.

Пайплайн (ARCHITECTURE.md §3.2), всё на уровне SKU:
  1. Исключение разовых/оптовых строк документов: robust z-score по медиане/MAD распределения строк SKU
     + строка сопоставима с месячным спросом (регулярный опт не трогаем).
  2. Компенсация stockout: месяцы без остатка досчитываются до «нормального» спроса месяцев в наличии.
  3. Базовый спрос = среднее скорректированного спроса за 12 последних полных месяцев (сезонно-нейтрально).
  4. Сезонность: индекс SKU по доступной истории (≤ 24 мес.), «стянутый» к индексу поставщика
     (выручка компании за 2024–2026) — шумоустойчиво.
  5. Тренд: год-к-году за последние 6 мес., стянутый к 1 и экстраполированный на окно покрытия.
  6. Потребность = спрос за (срок поставки + горизонт) + страховой запас − свободный остаток − в пути,
     затем MOQ/кратность. Срочность — по дню, когда кончится остаток с учётом поставок в пути.
"""

import math
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np
import pandas as pd

from app.engine.explain import build_narrative, build_short_reason
from app.etl.common import SHIPMENT_DOC_TYPE

DAYS_PER_MONTH = 30.44
HISTORY_MONTHS = 24
BASE_MONTHS = 12
GROWTH_MONTHS = 6
MIN_LINES_FOR_OUTLIERS = 8
SPARSE_MIN_OUTLIER_QTY = 50.0
GROWTH_SHRINK_UNITS = 20.0  # чем меньше продаж год назад, тем сильнее тянем рост к 1
SEASON_SHRINK_MONTHS = 12.0  # чем меньше активных месяцев (из 12), тем сильнее тянем сезонность к поставщику
SEASON_SHRINK_UNITS = 100.0  # ... и чем меньше объём продаж
MIN_NET_REQUIREMENT = 0.5
MAX_OUTLIERS_IN_EXPLANATION = 20


@dataclass
class EngineParams:
    forecast_horizon_days: int = 30
    safety_buffer_days: int = 14
    outlier_sensitivity: float = 0.5  # 0 — почти ничего не исключать, 1 — агрессивно


@dataclass
class EngineInputs:
    skus: pd.DataFrame  # sku_code, supplier_id, category_id, name, unit, unit_cost
    sales: pd.DataFrame  # sku_code, ts, document, doc_type, qty
    stock_monthly: pd.DataFrame  # sku_code, month, qty
    stock_current: pd.DataFrame  # sku_code, as_of, on_hand, reserved, free
    transit: pd.DataFrame  # sku_code, order_ref, expected_date, qty
    rules: pd.DataFrame  # sku_code, min_order_qty, order_multiple
    suppliers: pd.DataFrame  # id, name, lead_time_days
    categories: pd.DataFrame  # id, buffer_multiplier
    supplier_seasonality: pd.DataFrame  # supplier_id, year, month, revenue
    as_of: date | None = None


@dataclass
class SkuResult:
    sku_code: str
    supplier_id: str
    category_id: str
    recommended_qty: float
    urgency: str
    days_of_cover: float | None
    short_reason: str
    explanation: dict
    monthly_forecast: list[dict]
    seasonal_index: list[float]


@dataclass
class EngineOutput:
    as_of: date
    results: list[SkuResult] = field(default_factory=list)


# ---------------------------------------------------------------- шаг 1: выбросы

def _clip01(x: float) -> float:
    return min(max(x, 0.0), 1.0)


def outlier_k(sensitivity: float) -> float:
    """Порог в robust-сигмах: sensitivity 0 → 10σ, 0.5 → 6.5σ, 1 → 3σ."""
    return 3.0 + 7.0 * (1.0 - _clip01(sensitivity))


def outlier_month_share(sensitivity: float) -> float:
    """Минимальный размер выброса в долях типичного месячного спроса: 0 → 1.0, 0.5 → 0.625, 1 → 0.25."""
    return 0.25 + 0.75 * (1.0 - _clip01(sensitivity))


def detect_bulk_outliers(lines: pd.DataFrame, sensitivity: float) -> pd.Series:
    """Флаг «разовая/оптовая строка» для отгрузок (qty > 0). Нужны `sku_code`, `qty`, `period`.

    Строка — выброс, если выполнены ОБА условия:
      1. статистически аномальна: qty > max(median + k·σ̂, p95) распределения строк SKU,
         σ̂ = max(1.4826·MAD, 0.5·median, 1);
      2. сопоставима с целым месяцем продаж: qty > m · медиана месячных отгрузок SKU (по месяцам с продажами).
    Условие 2 отделяет разовые крупные сделки от регулярного опта: у ходовых позиций (монтажные коробки)
    строки по 1–7 тыс. шт. — обычный спрос при ~100 тыс. шт./мес., их исключать нельзя.

    У редких SKU (< 8 строк) статистики нет, поэтому правило другое: строка — разовая, если на неё одну
    приходится больше половины всех отгрузок товара и она не меньше 50 ед. (пример из данных IEK:
    единственная за историю отгрузка 210 000 шт.).
    """
    if lines.empty:
        return pd.Series(False, index=lines.index)
    qty = lines["qty"]
    sku = lines["sku_code"]
    g = qty.groupby(sku)
    med = g.transform("median")
    mad = (qty - med).abs().groupby(sku).transform("median")
    n = g.transform("size")
    p95 = sku.map(g.quantile(0.95))
    scale = np.maximum(1.4826 * mad, np.maximum(0.5 * med, 1.0))
    stat_threshold = np.maximum(med + outlier_k(sensitivity) * scale, p95)

    monthly_median = qty.groupby([sku, lines["period"]]).sum().groupby(level=0).median()
    month_threshold = outlier_month_share(sensitivity) * sku.map(monthly_median)

    frequent = (n >= MIN_LINES_FOR_OUTLIERS) & (qty > stat_threshold) & (qty > month_threshold)
    sparse = (n < MIN_LINES_FOR_OUTLIERS) & (qty > 0.5 * g.transform("sum")) & (qty >= SPARSE_MIN_OUTLIER_QTY)
    return frequent | sparse


# ---------------------------------------------------------------- шаг 2: stockout

def availability_matrix(stock_monthly: pd.DataFrame, codes: pd.Index, months: pd.PeriodIndex,
                        sales_matrix: pd.DataFrame) -> pd.DataFrame:
    """Доля месяца, когда товар был в наличии: 1 / 0.5 / 0 по остаткам на начало этого и следующего месяца.

    Оба остатка ≤ 0 → 0 (но если в месяце были продажи — товар приходил и кончился → 0.5).
    Один из двух ≤ 0 → 0.5. SKU без данных об остатках считаются доступными (компенсации нет).
    """
    if stock_monthly.empty:
        return pd.DataFrame(1.0, index=codes, columns=months)
    sm = stock_monthly.assign(period=pd.PeriodIndex(pd.to_datetime(stock_monthly["month"]), freq="M"))
    s = sm.pivot_table(index="sku_code", columns="period", values="qty", aggfunc="sum")
    known_months = set(s.columns)
    s = s.reindex(index=codes)
    known_sku = s.notna().any(axis=1).to_numpy()
    s = s.fillna(0.0)

    avail = pd.DataFrame(1.0, index=codes, columns=months)
    for m in months:
        if m not in known_months or (m + 1) not in known_months:
            continue
        open_m = s[m].to_numpy() > 0
        open_n = s[m + 1].to_numpy() > 0
        a = np.where(open_m & open_n, 1.0, np.where(~open_m & ~open_n, 0.0, 0.5))
        a = np.where((a == 0.0) & (sales_matrix[m].to_numpy() > 0), 0.5, a)
        avail[m] = np.where(known_sku, a, 1.0)
    return avail


def compensate_stockouts(demand: pd.DataFrame, avail: pd.DataFrame) -> tuple[pd.DataFrame, pd.Series]:
    """corrected = demand + (1 − a)·max(ref − demand, 0), ref — средний спрос месяцев с a = 1."""
    full = avail == 1.0
    ref = demand.where(full).mean(axis=1).fillna(0.0)
    gap = (-demand).add(ref, axis=0).clip(lower=0)
    corrected = demand + (1.0 - avail) * gap
    return corrected, ref


# ---------------------------------------------------------------- шаг 4: сезонность

def supplier_seasonal_index(seasonality: pd.DataFrame) -> np.ndarray:
    """Индекс по выручке компании методом «отношение к скользящему среднему»: ряд делится на центрированное
    12-мес. среднее (2×12 MA), что убирает тренд — иначе рост внутри года (SE 2024: 24 → 99 млн)
    ошибочно читался бы как сезонность. Затем отношения усредняются по календарным месяцам."""
    if seasonality.empty:
        return np.ones(12)
    s = seasonality.sort_values(["year", "month"])
    series = pd.Series(
        s["revenue"].to_numpy(),
        index=pd.PeriodIndex.from_fields(year=s["year"], month=s["month"], freq="M"),
    )
    series = series[series > 0]
    if len(series) < 24:
        return np.ones(12)
    series = series.reindex(pd.period_range(series.index.min(), series.index.max(), freq="M"))
    ma = series.rolling(12, center=True).mean().rolling(2).mean().shift(-1)
    ratio = (series / ma).dropna()
    by_month = ratio.groupby(ratio.index.month).mean().reindex(range(1, 13))
    if by_month.isna().any():
        return np.ones(12)
    idx = by_month.to_numpy()
    return idx / idx.mean()


def sku_seasonal_index(corrected: pd.DataFrame, supplier_idx: pd.DataFrame) -> pd.DataFrame:
    """Индекс SKU (12 колонок) по последним 12 месяцам (ровно один сезонный цикл), очищенный от линейного
    тренда, и «стянутый» к индексу поставщика.

    Почему не вся история: отгрузки в выгрузке есть только с 01.2025, поэтому сен–дек представлены одним
    годом, а янв–авг — двумя; при падении/росте продаж между годами это исказило бы индекс трендом.
    Вес собственного индекса SKU = min(активные месяцы / (активные + 12), штуки / (штуки + 100)) — у
    малообъёмных и редко продающихся товаров помесячные колебания — шум, а не сезонность.
    """
    last = corrected.iloc[:, -12:]
    cal = np.array([p.month for p in last.columns])
    values = last.to_numpy()
    n = values.shape[1]
    t = np.arange(n) - (n - 1) / 2
    level = values.mean(axis=1)
    slope = (values * t).sum(axis=1) / (t**2).sum() if n > 1 else np.zeros(len(values))
    fitted = np.maximum(level[:, None] + slope[:, None] * t, 0.2 * level[:, None])
    raw = np.ones((len(values), 12))
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = np.where(fitted > 0, values / fitted, 1.0)
    for j, m in enumerate(cal):
        raw[:, m - 1] = ratio[:, j]
    active = (values > 0).sum(axis=1)
    units = values.sum(axis=1)
    w = np.minimum(active / (active + SEASON_SHRINK_MONTHS), units / (units + SEASON_SHRINK_UNITS))[:, None]
    sup = supplier_idx.to_numpy()
    idx = np.clip(w * raw + (1 - w) * sup, 0.25, 4.0)
    idx = idx / idx.mean(axis=1, keepdims=True)
    return pd.DataFrame(idx, index=corrected.index, columns=range(1, 13))


# ---------------------------------------------------------------- шаг 6: MOQ

def apply_order_rules(net: float, min_order_qty: float, order_multiple: float) -> float:
    if net < MIN_NET_REQUIREMENT:
        return 0.0
    qty = max(math.ceil(net - 1e-9), min_order_qty)
    mult = max(order_multiple, 1.0)
    return float(math.ceil(qty / mult - 1e-9) * mult)


def stockout_day(free: float, arrivals: list[tuple[int, float]], daily: np.ndarray) -> int | None:
    """Первый день (1..len(daily)), когда остаток уйдёт в минус, с учётом поставок в пути."""
    stock = free
    by_day: dict[int, float] = {}
    for d, q in arrivals:
        by_day[d] = by_day.get(d, 0.0) + q
    for day in range(1, len(daily) + 1):
        stock += by_day.get(day, 0.0)
        stock -= daily[day - 1]
        if stock < 0:
            return day
    return None


# ---------------------------------------------------------------- пайплайн

def run_engine(inp: EngineInputs, params: EngineParams) -> EngineOutput:
    sales = inp.sales[inp.sales["doc_type"] == SHIPMENT_DOC_TYPE]
    # дата расчёта — самые свежие данные: последняя отгрузка или снимок остатков
    as_of = inp.as_of
    if as_of is None:
        dates = [pd.Timestamp(sales["ts"].max()).date()]
        if not inp.stock_current.empty:
            dates.append(pd.Timestamp(inp.stock_current["as_of"].max()).date())
        as_of = max(dates)
    cur_month = pd.Period(as_of, freq="M")
    hist_end = cur_month - 1

    # --- 1. выбросы (статистика по 36 мес., чтобы у распределения было достаточно точек)
    ship = sales[sales["qty"] > 0].assign(period=lambda d: d["ts"].dt.to_period("M"))
    ship = ship[(ship["period"] <= hist_end) & (ship["period"] > hist_end - 36)].copy()
    output = EngineOutput(as_of=as_of)
    if ship.empty:
        return output
    ship["is_outlier"] = detect_bulk_outliers(ship, params.outlier_sensitivity)

    # Окно истории начинается с первого месяца, где вообще есть отгрузки: в выгрузке 1С «Динамика продаж»
    # отгрузки идут только с 01.2025 (раньше — единичные возвраты). Месяцы до начала выгрузки — не «ноль
    # продаж», а отсутствие данных; иначе они занизили бы базу и сезонный индекс.
    data_start = max(ship["period"].min(), hist_end - (HISTORY_MONTHS - 1))
    months = pd.period_range(data_start, hist_end, freq="M")
    months12 = months[-BASE_MONTHS:]
    ship_win = ship[ship["period"] >= months[0]]

    codes = pd.Index(sorted(set(ship_win["sku_code"]) & set(inp.skus["sku_code"])), name="sku_code")
    if codes.empty:
        return output

    def matrix(df: pd.DataFrame) -> pd.DataFrame:
        pv = df.pivot_table(index="sku_code", columns="period", values="qty", aggfunc="sum")
        return pv.reindex(index=codes, columns=months).fillna(0.0)

    actual = matrix(ship_win)
    regular = matrix(ship_win[~ship_win["is_outlier"]])

    # --- 2. stockout
    avail = availability_matrix(inp.stock_monthly, codes, months, regular)
    corrected, ref_demand = compensate_stockouts(regular, avail)

    # --- 3. база
    base = corrected[months12].mean(axis=1)
    stockout_comp = (corrected - regular)[months12].mean(axis=1)

    # --- 5. рост: YoY последних 6 мес. (если истории < 18 мес. — роста не считаем, ly6 = 0 → коэф. 1)
    recent = list(months[-GROWTH_MONTHS:])
    year_ago = [p - 12 for p in recent]
    last6 = corrected[recent].sum(axis=1)
    if all(p in months for p in year_ago):
        ly6 = corrected[year_ago].sum(axis=1)
    else:
        ly6 = pd.Series(0.0, index=codes)

    # --- справочники (dict/numpy: поэлементный доступ к DataFrame в цикле на порядки медленнее)
    skus = inp.skus.set_index("sku_code").reindex(codes)
    sku_rec = skus.to_dict("index")
    lead = inp.suppliers.set_index("id")["lead_time_days"].to_dict()
    cat_mult = inp.categories.set_index("id")["buffer_multiplier"].to_dict()
    rules = inp.rules.set_index("sku_code")[["min_order_qty", "order_multiple"]].to_dict("index")
    cur_stock = (
        inp.stock_current.set_index("sku_code")[["on_hand", "reserved", "free"]].to_dict("index")
        if not inp.stock_current.empty else {}
    )
    transit_by_sku: dict[str, list[dict]] = {}
    for t in inp.transit[inp.transit["sku_code"].isin(codes)].itertuples():
        exp = None if t.expected_date is None or pd.isna(t.expected_date) else pd.Timestamp(t.expected_date).date()
        transit_by_sku.setdefault(t.sku_code, []).append({
            "order_ref": t.order_ref,
            "expected_date": exp.isoformat() if exp else None,
            "qty": float(t.qty),
            "day": (exp - as_of).days if exp else None,
        })

    stock_open: dict[str, float] = {}
    if not inp.stock_monthly.empty:
        sm = inp.stock_monthly
        sm_month = pd.PeriodIndex(pd.to_datetime(sm["month"]), freq="M")
        stock_open = sm[sm_month == cur_month].groupby("sku_code")["qty"].sum().to_dict()
    sold_mtd = (
        sales[sales["ts"].dt.to_period("M") == cur_month]
        .loc[lambda d: d["ts"].dt.date <= as_of]
        .groupby("sku_code")["qty"].sum()
        .to_dict()
    )

    sup_idx = {
        sid: supplier_seasonal_index(inp.supplier_seasonality[inp.supplier_seasonality["supplier_id"] == sid])
        for sid in inp.suppliers["id"]
    }
    sup_idx_rows = pd.DataFrame(
        [sup_idx.get(s, np.ones(12)) for s in skus["supplier_id"]], index=codes, columns=range(1, 13)
    )
    season_a = sku_seasonal_index(corrected, sup_idx_rows).to_numpy()

    outliers_by_sku = {
        k: g.sort_values("ts", ascending=False) for k, g in ship_win[ship_win["is_outlier"]].groupby("sku_code")
    }

    actual_a, regular_a, corrected_a, avail_a = (x.to_numpy() for x in (actual, regular, corrected, avail))
    base_a, comp_a, ref_a = base.to_numpy(), stockout_comp.to_numpy(), ref_demand.to_numpy()
    last6_a, ly6_a = last6.to_numpy(), ly6.to_numpy()
    periods = [p.strftime("%Y-%m") for p in months]
    forecast_periods = [cur_month + k for k in range(6)]

    horizon = int(params.forecast_horizon_days)
    buffer_days = int(params.safety_buffer_days)
    max_window = max((int(v) for v in lead.values()), default=30) + horizon + buffer_days
    day_month = np.array([(as_of + timedelta(days=d)).month - 1 for d in range(1, max_window + 1)])

    for i, code in enumerate(codes):
        sku = sku_rec[code]
        supplier_id = sku["supplier_id"]
        category_id = sku["category_id"]
        lead_days = int(lead.get(supplier_id, 30))
        cover_days = lead_days + horizon
        buffer_mult = float(cat_mult.get(category_id, 1.0))
        base_m = float(base_a[i])
        idx = season_a[i]

        # рост: стянутый к 1 и экстраполированный от центра 12-мес. базы (−6 мес.) до середины окна покрытия
        ly, l6 = float(ly6_a[i]), float(last6_a[i])
        ratio = l6 / ly if ly > 0 else 1.0
        shrunk = 1.0 + (ly / (ly + GROWTH_SHRINK_UNITS)) * (ratio - 1.0)
        exponent = (6.0 + cover_days / DAYS_PER_MONTH / 2.0) / 12.0
        growth = float(np.clip(max(shrunk, 1e-6) ** exponent, 0.5, 2.0))

        daily = base_m / DAYS_PER_MONTH * growth * idx[day_month[: cover_days + buffer_days]]
        demand_cover = float(daily[:cover_days].sum())
        flat = base_m / DAYS_PER_MONTH * growth * cover_days
        seasonality_factor = demand_cover / flat if flat > 0 else float(idx[as_of.month - 1])
        avg_daily = demand_cover / cover_days if cover_days else 0.0
        safety = avg_daily * buffer_days * buffer_mult

        # остатки
        if code in cur_stock:
            row = cur_stock[code]
            on_hand, reserved, free = float(row["on_hand"]), float(row["reserved"]), float(row["free"])
            stock_source = "snapshot"
        elif code in stock_open:
            on_hand = max(0.0, float(stock_open[code]) - float(sold_mtd.get(code, 0.0)))
            reserved, free = 0.0, on_hand
            stock_source = "estimated"
        else:
            on_hand = reserved = free = 0.0
            stock_source = "unknown"
        free = max(free, 0.0)

        tr = transit_by_sku.get(code, [])
        in_transit = float(sum(t["qty"] for t in tr))
        # поставка без даты считается пришедшей через срок поставки
        arrivals = [(t["day"] if t["day"] is not None else lead_days, t["qty"]) for t in tr]
        transit_list = [{k: v for k, v in t.items() if k != "day"} for t in tr]

        need = demand_cover + safety
        net = need - free - in_transit
        rule = rules.get(code)
        min_q = float(rule["min_order_qty"]) if rule else 1.0
        mult = float(rule["order_multiple"]) if rule else 1.0
        qty = apply_order_rules(net, min_q, mult)

        so_day = stockout_day(free, arrivals, daily)
        if so_day is not None and so_day <= lead_days:
            urgency = "high"
        elif so_day is not None and so_day <= lead_days + buffer_days:
            urgency = "medium"
        else:
            urgency = "low"
        days_of_cover = (free / avg_daily) if avg_daily > 0 else None

        out_rows = outliers_by_sku.get(code)
        outliers = []
        outliers_total = 0.0
        if out_rows is not None:
            outliers_total = float(out_rows["qty"].sum())
            outliers = [
                {"date": r.ts.date().isoformat(), "qty": float(r.qty), "document": str(r.document)}
                for r in out_rows.head(MAX_OUTLIERS_IN_EXPLANATION).itertuples()
            ]

        av = avail_a[i]
        stockout_months = [periods[j] for j in range(len(periods)) if av[j] < 1.0]
        history = [
            {
                "period": periods[j],
                "actual_qty": float(actual_a[i, j]),
                "regular_qty": float(regular_a[i, j]),
                "corrected_qty": round(float(corrected_a[i, j]), 2),
                "availability": float(av[j]),
            }
            for j in range(len(periods))
        ]
        monthly_forecast = [
            {"period": p.strftime("%Y-%m"), "qty": round(base_m * growth * float(idx[p.month - 1]), 2)}
            for p in forecast_periods
        ]
        unit_cost = sku.get("unit_cost")

        facts = {
            "sku_code": code,
            "name": sku["name"],
            "unit": sku["unit"],
            "base_demand": round(base_m, 2),
            "seasonality_factor": round(seasonality_factor, 3),
            "growth_factor": round(growth, 3),
            "stockout_compensation": round(float(comp_a[i]), 2),
            "current_stock": round(on_hand, 2),
            "reserved_stock": round(reserved, 2),
            "free_stock": round(free, 2),
            "goods_in_transit": round(in_transit, 2),
            "safety_buffer": round(safety, 2),
            "bulk_outliers_excluded": outliers,
            "final_qty": qty,
            # дополнительные поля (сверх контракта фронта) — для прозрачности и отладки
            "as_of": as_of.isoformat(),
            "base_months": len(months12),
            "history_start": periods[0],
            "lead_time_days": lead_days,
            "horizon_days": horizon,
            "safety_buffer_days": buffer_days,
            "category_buffer_multiplier": buffer_mult,
            "forecast_demand": round(demand_cover, 2),
            "net_requirement": round(net, 2),
            "min_order_qty": min_q,
            "order_multiple": mult,
            "days_of_cover": round(days_of_cover, 1) if days_of_cover is not None else None,
            "stockout_day": so_day,
            "urgency": urgency,
            "stock_source": stock_source,
            "goods_in_transit_detail": transit_list,
            "bulk_outliers_count": len(out_rows) if out_rows is not None else 0,
            "bulk_outliers_total_qty": outliers_total,
            "stockout_months": stockout_months,
            "stockout_reference_demand": round(float(ref_a[i]), 2),
            "growth_last6": l6,
            "growth_ly6": ly,
            "monthly_history": history,
            "unit_cost": None if unit_cost is None or pd.isna(unit_cost) else float(unit_cost),
        }
        facts["narrative"] = build_narrative(facts)

        output.results.append(SkuResult(
            sku_code=code,
            supplier_id=supplier_id,
            category_id=category_id,
            recommended_qty=qty,
            urgency=urgency,
            days_of_cover=facts["days_of_cover"],
            short_reason=build_short_reason(facts),
            explanation=facts,
            monthly_forecast=monthly_forecast,
            seasonal_index=[round(float(v), 3) for v in idx],
        ))
    return output
