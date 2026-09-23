"""Прогноз помесячного ряда — для файлов, которые пользователь загружает в «ленивом режиме».

Методика совпадает с основным движком (engine/core.py), но без остатков/MOQ — только спрос:
база = среднее за последние 12 мес.; сезонность — по последнему 12-мес. циклу без линейного тренда,
стянутая к 1 для коротких/малых рядов; тренд — год к году за 6 мес., стянутый к 1 и
экстраполированный на расстояние до прогнозного месяца.
"""

import numpy as np
import pandas as pd

GROWTH_SHRINK_UNITS = 20.0
SEASON_SHRINK_MONTHS = 12.0


def _seasonal_index(last12: pd.Series) -> np.ndarray:
    """12 коэффициентов (среднее = 1) по последнему году ряда; при нехватке данных — единицы."""
    idx = np.ones(12)
    if len(last12) < 12 or last12.sum() <= 0:
        return idx
    values = last12.to_numpy(dtype=float)
    t = np.arange(12) - 5.5
    level = values.mean()
    slope = (values * t).sum() / (t**2).sum()
    fitted = np.maximum(level + slope * t, 0.2 * level)
    raw = values / fitted
    active = (values > 0).sum()
    w = min(active / (active + SEASON_SHRINK_MONTHS), values.sum() / (values.sum() + 100.0))
    for period, r in zip(last12.index, raw, strict=True):
        idx[period.month - 1] = w * r + (1 - w)
    idx = np.clip(idx, 0.25, 4.0)
    return idx / idx.mean()


def forecast_monthly(series: pd.Series, horizon_months: int = 6) -> dict:
    """series: индекс — pd.Period (M), значения — количество. Пропущенные месяцы считаются нулями."""
    if series.empty:
        return {"history": [], "forecast": [], "base_demand": 0.0, "growth_factor": 1.0,
                "seasonal_index": [1.0] * 12, "months_used": 0, "notes": ["Нет данных для прогноза"]}
    s = series.groupby(level=0).sum().sort_index()
    s = s.reindex(pd.period_range(s.index.min(), s.index.max(), freq="M"), fill_value=0.0).astype(float)
    notes: list[str] = []

    last12 = s.iloc[-12:]
    base = float(last12.mean())
    if len(s) < 12:
        notes.append(f"История всего {len(s)} мес. — сезонность не оценивалась, база по доступным месяцам")
    idx = _seasonal_index(last12)

    ratio = 1.0
    ly_total = 0.0
    if len(s) >= 18:
        recent = s.iloc[-6:]
        year_ago = s.reindex([p - 12 for p in recent.index], fill_value=0.0)
        ly_total = float(year_ago.sum())
        if ly_total > 0:
            raw = float(recent.sum()) / ly_total
            ratio = 1.0 + (ly_total / (ly_total + GROWTH_SHRINK_UNITS)) * (raw - 1.0)
    else:
        notes.append("История короче 18 мес. — тренд год к году не считался (×1.00)")

    last = s.index.max()
    forecast = []
    for k in range(1, horizon_months + 1):
        p = last + k
        growth_k = float(np.clip(max(ratio, 1e-6) ** ((6 + k) / 12), 0.5, 2.0))
        forecast.append({"period": p.strftime("%Y-%m"), "qty": round(float(base * idx[p.month - 1] * growth_k), 2)})

    return {
        "history": [{"period": p.strftime("%Y-%m"), "qty": round(float(v), 2)} for p, v in s.items()],
        "forecast": forecast,
        "base_demand": round(base, 2),
        "growth_factor": round(float(np.clip(max(ratio, 1e-6) ** 0.5, 0.5, 2.0)), 3),
        "seasonal_index": [round(float(v), 3) for v in idx],
        "months_used": len(s),
        "notes": notes,
    }
