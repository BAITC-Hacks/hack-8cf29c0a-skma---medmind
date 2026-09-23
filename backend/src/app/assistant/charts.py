"""Спецификации графиков для фронта (Recharts): данные + описание рядов, без цветов.

Цвета фронт берёт из дизайн-токенов по `kind` ряда (AGENTS.md: цвета не хардкодим).
Формат:
{
  "id": "…", "type": "line", "title": "…", "subtitle": "…" | null,
  "x_key": "period", "y_label": "шт",
  "series": [{"key": "actual", "name": "Факт", "kind": "actual"},
             {"key": "forecast", "name": "Прогноз", "kind": "forecast"}],
  "data": [{"period": "2026-01", "actual": 120, "forecast": null}, …]
}
kind: actual — сплошная линия, forecast — пунктир, series — прочие ряды (сравнения).
"""

import uuid

SERIES_KINDS = ("actual", "forecast", "series")


def line_chart(title: str, series: list[dict], data: list[dict], *, y_label: str = "шт",
               subtitle: str | None = None, x_key: str = "period") -> dict:
    return {
        "id": uuid.uuid4().hex[:12],
        "type": "line",
        "title": title,
        "subtitle": subtitle,
        "x_key": x_key,
        "y_label": y_label,
        "series": series,
        "data": data,
    }


def actual_vs_forecast(title: str, history: list[dict], forecast: list[dict], *, y_label: str = "шт",
                       subtitle: str | None = None, history_key: str = "qty", forecast_key: str = "qty") -> dict:
    """Кривая «факт → прогноз». Прогноз начинается из последней фактической точки, чтобы линия была непрерывной."""
    rows: dict[str, dict] = {}
    for p in history:
        rows[p["period"]] = {"period": p["period"], "actual": p[history_key], "forecast": None}
    if history and forecast:
        last = history[-1]
        rows[last["period"]]["forecast"] = last[history_key]
    for p in forecast:
        row = rows.setdefault(p["period"], {"period": p["period"], "actual": None, "forecast": None})
        row["forecast"] = p[forecast_key]
    return line_chart(
        title,
        [
            {"key": "actual", "name": "Факт", "kind": "actual"},
            {"key": "forecast", "name": "Прогноз", "kind": "forecast"},
        ],
        [rows[k] for k in sorted(rows)],
        y_label=y_label,
        subtitle=subtitle,
    )


def from_trend_points(title: str, points: list[dict], *, y_label: str = "шт", subtitle: str | None = None) -> dict:
    """Точки /analytics/demand-trend ({period, actual_qty, forecast_qty}) → кривая факт/прогноз."""
    history = [{"period": p["period"], "qty": p["actual_qty"]} for p in points if p["forecast_qty"] is None]
    forecast = [{"period": p["period"], "qty": p["forecast_qty"]} for p in points if p["forecast_qty"] is not None]
    return actual_vs_forecast(title, history, forecast, y_label=y_label, subtitle=subtitle)
