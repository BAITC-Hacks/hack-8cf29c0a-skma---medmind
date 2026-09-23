"""Инструменты ИИ-ассистента (function calling). Модель не имеет доступа к БД напрямую — только через
эти функции; все числа в ответах берутся отсюда. Выходы компактные (JSON, ограниченные списки)."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import models
from app.assistant import charts
from app.services import analytics
from app.services import assistant_files as af
from app.services.calc_runs import get_params

MAX_LIST = 50
_URGENCY_RANK = {"high": 0, "medium": 1, "low": 2}


class ToolError(ValueError):
    """Ошибка, которую стоит показать модели (она переформулирует запрос), а не пользователю."""


def order_url(ctx: "ToolContext", order_id: str) -> str:
    return "/assistant?" + urlencode({"c": ctx.conversation_id, "order": order_id})


@dataclass
class ToolContext:
    db: Session
    conversation_id: str
    charts: list[dict] = field(default_factory=list)
    _tables: dict[str, tuple[pd.DataFrame, dict]] = field(default_factory=dict)

    def latest_run(self) -> models.CalcRun:
        run = analytics.resolve_run(self.db, None)
        if run is None:
            raise ToolError("Расчётов ещё нет — нужно выполнить загрузку данных и расчёт")
        return run

    def table(self, file_id: str) -> tuple[pd.DataFrame, dict]:
        if file_id not in self._tables:
            f = self.db.get(models.AssistantFile, file_id)
            if f is None or f.conversation_id != self.conversation_id:
                raise ToolError(f"Файл {file_id} не найден в этом диалоге")
            df = af.load_table(f.content, f.filename)
            self._tables[file_id] = (df, af.detect_schema(df))
        return self._tables[file_id]


@dataclass(frozen=True)
class Tool:
    name: str
    description: str
    parameters: dict
    fn: Callable[..., Any]

    def spec(self) -> dict:
        return {"type": "function", "name": self.name, "description": self.description,
                "parameters": self.parameters, "strict": True}


def _obj(props: dict, required: list[str] | None = None) -> dict:
    """strict-схема: все поля обязательны, необязательность выражается типом null."""
    return {"type": "object", "properties": props, "required": required or list(props),
            "additionalProperties": False}


def _opt(type_: str, description: str, **extra) -> dict:
    return {"type": [type_, "null"], "description": description, **extra}


_PERIOD = {"pattern": r"^\d{4}-\d{2}$"}


# ---------------------------------------------------------------- инструменты по данным компании

def get_overview(ctx: ToolContext) -> dict:
    run = ctx.latest_run()
    db = ctx.db
    R = models.OrderRecommendation
    rows = db.execute(
        select(R.supplier_id, R.urgency, R.status, func.count(), func.sum(R.recommended_qty))
        .where(R.run_id == run.id).group_by(R.supplier_id, R.urgency, R.status)
    ).all()
    suppliers = {s.id: s for s in db.scalars(select(models.Supplier))}
    summary: dict[str, dict] = {}
    for sid, urgency, status, n, qty in rows:
        s = summary.setdefault(suppliers[sid].name if sid in suppliers else sid,
                               {"positions": 0, "units": 0.0, "by_urgency": {}, "by_status": {}})
        s["positions"] += n
        s["units"] += qty or 0
        s["by_urgency"][urgency] = s["by_urgency"].get(urgency, 0) + n
        s["by_status"][status] = s["by_status"].get(status, 0) + n
    top = db.execute(
        select(R.sku_code, models.Sku.name, R.recommended_qty, R.days_of_cover, R.supplier_id, R.id)
        .join(models.Sku, models.Sku.code == R.sku_code)
        .where(R.run_id == run.id, R.urgency == "high")
        .order_by(R.days_of_cover.asc().nulls_last(), R.recommended_qty.desc()).limit(10)
    ).all()
    sales_from, sales_to = db.execute(select(func.min(models.SalesLine.ts), func.max(models.SalesLine.ts))).one()
    params = get_params(db)
    return {
        "calc_run": {"id": run.id, "as_of": run.as_of.isoformat() if run.as_of else None,
                     "horizon_days": run.horizon_days, "params": run.params},
        "current_settings": {"forecast_horizon_days": params.forecast_horizon_days,
                             "safety_buffer_days": params.safety_buffer_days,
                             "outlier_sensitivity": params.outlier_sensitivity},
        "suppliers": [{"id": s.id, "name": s.name, "lead_time_days": s.lead_time_days} for s in suppliers.values()],
        "recommendations_by_supplier": {k: {**v, "units": round(v["units"], 1)} for k, v in summary.items()},
        "most_urgent": [
            {"sku_code": c, "name": n, "recommended_qty": q, "days_of_cover": d, "supplier_id": s,
             "order_url": order_url(ctx, rid)}
            for c, n, q, d, s, rid in top
        ],
        "sales_data_range": [str(sales_from)[:10] if sales_from else None, str(sales_to)[:10] if sales_to else None],
    }


def search_skus(ctx: ToolContext, query: str, limit: int | None) -> dict:
    words = query.casefold().split()
    if not words or len("".join(words)) < 2:
        raise ToolError("Запрос слишком короткий")
    S = models.Sku
    run = analytics.resolve_run(ctx.db, None)
    # Фильтр в Python: LIKE в SQLite нечувствителен к регистру только для латиницы («кабель» ≠ «Кабель»).
    # Справочник — единицы тысяч SKU, это дёшево. Все слова запроса должны встретиться в коде/названии/артикуле.
    rows = [
        r for r in ctx.db.execute(select(S.code, S.name, S.supplier_sku, S.supplier_id, S.category_id, S.unit))
        if all(w in f"{r.code} {r.name} {r.supplier_sku or ''}".casefold() for w in words)
    ][: min(limit or 15, MAX_LIST)]
    recs = {}
    if run and rows:
        R = models.OrderRecommendation
        recs = {r.sku_code: r for r in ctx.db.scalars(
            select(R).where(R.run_id == run.id, R.sku_code.in_([r.code for r in rows])))}
    return {"matches": [
        {"sku_code": r.code, "name": r.name, "supplier_sku": r.supplier_sku, "supplier_id": r.supplier_id,
         "category_id": r.category_id, "unit": r.unit,
         "recommended_qty": recs[r.code].recommended_qty if r.code in recs else 0,
         "urgency": recs[r.code].urgency if r.code in recs else None,
         "order_url": order_url(ctx, recs[r.code].id) if r.code in recs else None}
        for r in rows
    ]}


_EXPLAIN_KEYS = (
    "name", "unit", "base_demand", "seasonality_factor", "growth_factor", "stockout_compensation", "current_stock",
    "reserved_stock", "free_stock", "goods_in_transit", "safety_buffer", "forecast_demand", "net_requirement",
    "final_qty", "min_order_qty", "order_multiple", "lead_time_days", "horizon_days", "safety_buffer_days",
    "days_of_cover", "stockout_day", "urgency", "stock_source", "stockout_months", "bulk_outliers_count",
    "bulk_outliers_total_qty", "goods_in_transit_detail", "unit_cost", "narrative",
)


def get_sku_details(ctx: ToolContext, sku_code: str) -> dict:
    run = ctx.latest_run()
    fc = ctx.db.get(models.SkuForecast, (run.id, sku_code))
    sku = ctx.db.get(models.Sku, sku_code)
    if sku is None:
        raise ToolError(f"SKU {sku_code} не найден. Используй search_skus, чтобы найти код")
    out: dict = {"sku_code": sku_code, "supplier_id": sku.supplier_id, "supplier_sku": sku.supplier_sku,
                 "category_id": sku.category_id}
    rec = ctx.db.scalar(select(models.OrderRecommendation).where(
        models.OrderRecommendation.run_id == run.id, models.OrderRecommendation.sku_code == sku_code))
    out["recommendation"] = None if rec is None else {
        "id": rec.id, "order_url": order_url(ctx, rec.id),
        "recommended_qty": rec.recommended_qty, "approved_qty": rec.approved_qty,
        "status": rec.status, "urgency": rec.urgency, "comment": rec.comment}
    if fc is None:
        out["note"] = "За последние 24 мес. продаж нет — прогноз и рекомендация не считались"
        out["name"] = sku.name
        return out
    e = fc.explanation
    out.update({k: e.get(k) for k in _EXPLAIN_KEYS})
    out["bulk_outliers_excluded"] = e.get("bulk_outliers_excluded", [])[:10]
    out["monthly_history_last_12"] = [
        {"period": h["period"], "actual": h["actual_qty"], "regular": h["regular_qty"],
         "availability": h["availability"]} for h in e.get("monthly_history", [])[-12:]
    ]
    out["monthly_forecast"] = fc.monthly_forecast
    return out


def list_recommendations(ctx: ToolContext, supplier_id: str | None, category_id: str | None,
                         urgency: str | None, status: str | None, sort_by: str | None, limit: int | None) -> dict:
    run = ctx.latest_run()
    R = models.OrderRecommendation
    q = select(R, models.Sku.name, models.Sku.unit, models.Sku.unit_cost).join(
        models.Sku, models.Sku.code == R.sku_code).where(R.run_id == run.id)
    if supplier_id:
        q = q.where(R.supplier_id == supplier_id)
    if category_id:
        q = q.where(R.category_id == category_id)
    if urgency:
        q = q.where(R.urgency == urgency)
    if status:
        q = q.where(R.status == status)
    rows = ctx.db.execute(q).all()
    key = {
        "qty": lambda r: -r[0].recommended_qty,
        "days_of_cover": lambda r: (r[0].days_of_cover if r[0].days_of_cover is not None else 1e9),
        "value": lambda r: -(r[0].recommended_qty * (r[3] or 0)),
    }.get(sort_by or "urgency", lambda r: (_URGENCY_RANK[r[0].urgency], r[0].days_of_cover or 0))
    rows.sort(key=key)
    lim = min(limit or 20, MAX_LIST)
    return {
        "total": len(rows),
        "total_units": round(sum(r[0].recommended_qty for r in rows), 1),
        "shown": min(lim, len(rows)),
        "items": [
            {"id": r.id, "order_url": order_url(ctx, r.id),
             "sku_code": r.sku_code, "name": name, "unit": unit, "supplier_id": r.supplier_id,
             "recommended_qty": r.recommended_qty, "approved_qty": r.approved_qty, "urgency": r.urgency,
             "status": r.status, "days_of_cover": r.days_of_cover, "short_reason": r.short_reason,
             "value": round(r.recommended_qty * cost, 2) if cost else None}
            for r, name, unit, cost in rows[:lim]
        ],
    }


def _slice_title(ctx: ToolContext, sku_code: str | None, category_id: str | None, supplier_id: str | None) -> str:
    if sku_code:
        sku = ctx.db.get(models.Sku, sku_code)
        if sku is None:
            raise ToolError(f"SKU {sku_code} не найден. Используй search_skus")
        return f"{sku_code} — {sku.name}"
    parts = []
    if supplier_id:
        s = ctx.db.get(models.Supplier, supplier_id)
        parts.append(s.name if s else supplier_id)
    if category_id:
        c = ctx.db.get(models.Category, category_id)
        parts.append(c.name if c else category_id)
    return ", ".join(parts) or "Все товары"


def get_demand_trend(ctx: ToolContext, sku_code: str | None, category_id: str | None, supplier_id: str | None,
                     from_period: str | None, to_period: str | None, plot: bool) -> dict:
    title = _slice_title(ctx, sku_code, category_id, supplier_id)
    points = analytics.demand_trend(ctx.db, sku_code=sku_code, category_id=category_id, supplier_id=supplier_id,
                                    from_=from_period, to=to_period)
    if not points:
        raise ToolError("Нет данных о продажах для этого среза")
    history = [p for p in points if p["forecast_qty"] is None]
    result: dict = {"title": title, "points": points}
    if len(history) >= 15:
        last3 = sum(p["actual_qty"] for p in history[-3:])
        ly = {p["period"]: p["actual_qty"] for p in history}
        ly3 = sum(ly.get(f"{int(p['period'][:4]) - 1}{p['period'][4:]}", 0) for p in history[-3:])
        result["last_3_months_vs_last_year"] = {"last_3": last3, "same_3_last_year": ly3,
                                                "change_pct": round((last3 / ly3 - 1) * 100, 1) if ly3 else None}
    if plot:
        chart = charts.from_trend_points(f"Динамика спроса: {title}", points,
                                         subtitle="Факт — отгрузки по месяцам, прогноз — по последнему расчёту")
        ctx.charts.append(chart)
        result["chart_id"] = chart["id"]
    return result


def get_seasonality(ctx: ToolContext, sku_code: str | None, category_id: str | None, supplier_id: str | None,
                    plot: bool) -> dict:
    title = _slice_title(ctx, sku_code, category_id, supplier_id)
    try:
        factors = analytics.seasonality(ctx.db, sku_code=sku_code, category_id=category_id, supplier_id=supplier_id)
    except analytics.NoData as exc:
        raise ToolError(str(exc)) from exc
    result: dict = {"title": title, "factors": factors}
    if plot:
        months = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
        chart = charts.line_chart(
            f"Сезонность: {title}",
            [{"key": "factor", "name": "Коэффициент сезонности", "kind": "series"}],
            [{"period": months[f["month"] - 1], "factor": f["factor"]} for f in factors],
            y_label="× к среднему", subtitle="1.0 — средний месяц",
        )
        ctx.charts.append(chart)
        result["chart_id"] = chart["id"]
    return result


# ---------------------------------------------------------------- файлы пользователя

def list_files(ctx: ToolContext) -> dict:
    files = ctx.db.scalars(select(models.AssistantFile).where(
        models.AssistantFile.conversation_id == ctx.conversation_id).order_by(models.AssistantFile.created_at)).all()
    return {"files": [{"file_id": f.id, "filename": f.filename, "summary": f.summary} for f in files]}


def analyze_file(ctx: ToolContext, file_id: str) -> dict:
    df, schema = ctx.table(file_id)
    try:
        return af.summarize(df, schema)
    except af.FileParseError as exc:
        raise ToolError(str(exc)) from exc


def forecast_from_file(ctx: ToolContext, file_id: str, sku: str | None, horizon_months: int | None,
                       exclude_outliers: bool, plot: bool) -> dict:
    df, schema = ctx.table(file_id)
    horizon = max(1, min(horizon_months or 6, 24))
    try:
        res = af.file_forecast(df, schema, sku, horizon, exclude_outliers,
                               get_params(ctx.db).outlier_sensitivity)
    except af.FileParseError as exc:
        raise ToolError(str(exc)) from exc
    out = {k: v for k, v in res.items() if k != "history"}
    out["history_last_12"] = res["history"][-12:]
    out["history_months"] = len(res["history"])
    if plot and res["history"]:
        chart = charts.actual_vs_forecast(
            f"Прогноз по файлу: {res['title']}", res["history"], res["forecast"],
            subtitle="Факт — из загруженного файла"
            + (", без разовых отгрузок" if res["bulk_outliers_excluded"] else ""),
        )
        ctx.charts.append(chart)
        out["chart_id"] = chart["id"]
    return out


def plot_curve(ctx: ToolContext, title: str, y_label: str | None, series: list[dict]) -> dict:
    """Произвольная кривая из уже полученных чисел (например, сравнение двух SKU)."""
    if not series or len(series) > 6:
        raise ToolError("Нужно от 1 до 6 рядов")
    rows: dict[str, dict] = {}
    spec = []
    for i, s in enumerate(series):
        key = f"s{i + 1}"
        kind = s.get("kind") if s.get("kind") in charts.SERIES_KINDS else "series"
        spec.append({"key": key, "name": s["name"], "kind": kind})
        for p in s["points"][:120]:
            rows.setdefault(p["period"], {"period": p["period"]})[key] = p["value"]
    data = [{**{sp["key"]: None for sp in spec}, **rows[k]} for k in sorted(rows)]
    chart = charts.line_chart(title, spec, data, y_label=y_label or "шт")
    ctx.charts.append(chart)
    return {"chart_id": chart["id"], "points": len(data)}


# ---------------------------------------------------------------- реестр

_SLICE = {
    "sku_code": _opt("string", "Код 1С товара (из search_skus)"),
    "category_id": _opt("string", "ID категории"),
    "supplier_id": _opt("string", "ID поставщика: iek или se"),
}

TOOLS: list[Tool] = [
    Tool("get_overview",
         "Сводка по последнему расчёту: дата данных, параметры, число позиций и штук к заказу по поставщикам, "
         "срочность и статусы, самые срочные позиции, сроки поставки. Вызывай первым для общих вопросов.",
         _obj({}), get_overview),
    Tool("search_skus", "Поиск товаров по коду 1С, артикулу или части наименования.",
         _obj({"query": {"type": "string", "description": "Часть кода, артикула или названия"},
               "limit": _opt("integer", "Сколько вернуть, по умолчанию 15")}), search_skus),
    Tool("get_sku_details",
         "Всё по одному товару: разложение расчёта (базовый спрос, сезонность, тренд, stockout, остатки, товар в "
         "пути, буфер, MOQ), история за 12 мес., прогноз на 6 мес., исключённые разовые отгрузки, рекомендация.",
         _obj({"sku_code": {"type": "string", "description": "Код 1С"}}), get_sku_details),
    Tool("list_recommendations", "Список рекомендованных заказов последнего расчёта с фильтрами и сортировкой.",
         _obj({"supplier_id": _SLICE["supplier_id"], "category_id": _SLICE["category_id"],
               "urgency": _opt("string", "Срочность", enum=["high", "medium", "low", None]),
               "status": _opt("string", "Статус", enum=["pending", "approved", "rejected", None]),
               "sort_by": _opt("string", "Сортировка: urgency (по умолч.), qty, days_of_cover, value (сумма)",
                               enum=["urgency", "qty", "days_of_cover", "value", None]),
               "limit": _opt("integer", "Сколько строк вернуть, до 50")}), list_recommendations),
    Tool("get_demand_trend",
         "Помесячная динамика отгрузок (факт) и прогноз по товару, категории, поставщику или всем товарам. "
         "plot=true — построить кривую для пользователя.",
         _obj({**_SLICE, "from_period": _opt("string", "С месяца YYYY-MM", **_PERIOD),
               "to_period": _opt("string", "По месяц YYYY-MM", **_PERIOD),
               "plot": {"type": "boolean", "description": "Показать график"}}), get_demand_trend),
    Tool("get_seasonality", "Коэффициенты сезонности по месяцам (1.0 — средний месяц).",
         _obj({**_SLICE, "plot": {"type": "boolean", "description": "Показать график"}}), get_seasonality),
    Tool("list_files", "Файлы, которые пользователь загрузил в этот диалог, с кратким описанием.",
         _obj({}), list_files),
    Tool("analyze_file",
         "Структура и сводка загруженного файла: тип таблицы, период, число товаров, итоги, топ-10 товаров, "
         "последние месяцы. Сырые строки не возвращаются.",
         _obj({"file_id": {"type": "string"}}), analyze_file),
    Tool("forecast_from_file",
         "Прогноз спроса по данным загруженного файла (по одному товару или по всем): история по месяцам, "
         "прогноз на horizon_months, исключённые разовые отгрузки. plot=true — кривая факт/прогноз.",
         _obj({"file_id": {"type": "string"},
               "sku": _opt("string", "Код или часть названия товара; null — все товары файла"),
               "horizon_months": _opt("integer", "Горизонт прогноза, мес. (1–24, по умолч. 6)"),
               "exclude_outliers": {"type": "boolean", "description": "Исключать разовые оптовые отгрузки"},
               "plot": {"type": "boolean", "description": "Показать график"}}), forecast_from_file),
    Tool("plot_curve",
         "Построить произвольную кривую по уже полученным числам (сравнение товаров, поставщиков и т.п.). "
         "Числа бери только из результатов других инструментов.",
         _obj({"title": {"type": "string"}, "y_label": _opt("string", "Подпись оси Y"),
               "series": {"type": "array", "maxItems": 6, "items": _obj({
                   "name": {"type": "string"},
                   "kind": {"type": "string", "enum": ["actual", "forecast", "series"]},
                   "points": {"type": "array", "items": _obj({
                       "period": {"type": "string", "description": "YYYY-MM"},
                       "value": {"type": "number"}})}})}}), plot_curve),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


def execute(ctx: ToolContext, name: str, arguments: str) -> str:
    """Выполняет вызов модели; ошибки возвращаются модели текстом, чтобы она могла исправиться."""
    tool = TOOLS_BY_NAME.get(name)
    if tool is None:
        return json.dumps({"error": f"Неизвестный инструмент {name}"}, ensure_ascii=False)
    try:
        args = json.loads(arguments or "{}")
        result = tool.fn(ctx, **args)
    except ToolError as exc:
        result = {"error": str(exc)}
    except (TypeError, json.JSONDecodeError) as exc:
        result = {"error": f"Некорректные аргументы: {exc}"}
    return json.dumps(result, ensure_ascii=False, default=str)
