"""Человекочитаемые обоснования рекомендаций (explainability)."""


def _n(value: float) -> str:
    """Число для текста: целые без дробной части, остальные — до 1 знака, разделитель тысяч — пробел."""
    if value is None:
        return "—"
    v = round(float(value), 1)
    s = f"{v:,.0f}" if v == int(v) else f"{v:,.1f}"
    return s.replace(",", " ")


def _pct(factor: float) -> str:
    d = (factor - 1.0) * 100
    return f"{'+' if d >= 0 else '−'}{abs(d):.0f}%"


def build_short_reason(f: dict) -> str:
    u = f["unit"]
    parts = [f"Спрос ≈{_n(f['base_demand'])} {u}/мес"]
    if abs(f["seasonality_factor"] - 1) >= 0.05:
        parts.append(f"сезонность {_pct(f['seasonality_factor'])}")
    if abs(f["growth_factor"] - 1) >= 0.05:
        parts.append(f"тренд {_pct(f['growth_factor'])}")
    parts.append(f"свободно {_n(f['free_stock'])} + в пути {_n(f['goods_in_transit'])}")
    if f["stockout_day"] is not None:
        parts.append(f"остаток кончится через {f['stockout_day']} дн. (поставка {f['lead_time_days']} дн.)")
    return "; ".join(parts)


def build_narrative(f: dict) -> str:
    u = f["unit"]
    s: list[str] = []

    s.append(
        f"Базовый спрос — {_n(f['base_demand'])} {u}/мес: среднее за {f['base_months']} полных мес. "
        f"до {f['as_of'][:7]}."
    )
    if f["bulk_outliers_count"]:
        s.append(
            f"Из истории исключено {f['bulk_outliers_count']} разовых/оптовых отгрузок на "
            f"{_n(f['bulk_outliers_total_qty'])} {u} — они нетипично велики для этого товара и не отражают "
            "регулярный спрос."
        )
    if f["stockout_compensation"] > 0:
        s.append(
            f"В {len(f['stockout_months'])} мес. товара не было в наличии — спрос этих месяцев досчитан до "
            f"нормального уровня ({_n(f['stockout_reference_demand'])} {u}/мес), что добавило "
            f"{_n(f['stockout_compensation'])} {u}/мес к базе."
        )
    if abs(f["growth_factor"] - 1) >= 0.02:
        direction = "рост" if f["growth_factor"] > 1 else "снижение"
        s.append(
            f"Тренд: {direction} продаж год к году (последние 6 мес.: {_n(f['growth_last6'])} {u} против "
            f"{_n(f['growth_ly6'])} {u} годом ранее) → коэффициент ×{f['growth_factor']:.2f}."
        )
    if abs(f["seasonality_factor"] - 1) >= 0.02:
        season = "сезонный подъём" if f["seasonality_factor"] > 1 else "сезонный спад"
        s.append(f"На период покрытия приходится {season}: коэффициент ×{f['seasonality_factor']:.2f}.")

    s.append(
        f"Заказ должен покрыть срок поставки {f['lead_time_days']} дн. + горизонт {f['horizon_days']} дн.: "
        f"прогноз {_n(f['forecast_demand'])} {u} плюс страховой запас {_n(f['safety_buffer'])} {u} "
        f"({f['safety_buffer_days']} дн.)."
    )

    stock = f"Свободный остаток {_n(f['free_stock'])} {u}"
    if f["reserved_stock"]:
        stock += f" (всего {_n(f['current_stock'])}, в резерве {_n(f['reserved_stock'])})"
    if f["stock_source"] == "estimated":
        stock += " — оценка: остаток на начало месяца минус отгрузки с начала месяца"
    elif f["stock_source"] == "unknown":
        stock += " — данных об остатке нет, принят 0"
    stock += f", в пути {_n(f['goods_in_transit'])} {u}."
    s.append(stock)

    if f["stockout_day"] is not None:
        s.append(f"При текущем темпе остаток закончится через {f['stockout_day']} дн.")

    if f["final_qty"] > 0:
        rounding = ""
        if f["final_qty"] > max(f["net_requirement"], 0) + 0.5:
            rounding = (
                f" Потребность {_n(f['net_requirement'])} {u} округлена по условиям поставщика "
                f"(мин. партия {_n(f['min_order_qty'])}, кратность {_n(f['order_multiple'])})."
            )
            if f["net_requirement"] > 0 and f["final_qty"] >= 3 * f["net_requirement"]:
                rounding += " Внимание: минимальная партия заметно превышает потребность."
        s.append(f"Рекомендуется заказать {_n(f['final_qty'])} {u}.{rounding}")
    else:
        s.append("Остатка и товара в пути достаточно — заказ не требуется.")
    return " ".join(s)
