"""ORM-модели. Схема повторяет ARCHITECTURE.md §3.1 с поправками по реальным данным.

Данные поставщиков (skus, sales_lines, stock_*, goods_in_transit, supplier_rules, ...) полностью
перезаливаются при ingest. Результаты расчётов (calc_runs, sku_forecasts, order_recommendations,
audit_log) и настройки (calc_params, suppliers.lead_time_days) переживают перезаливку.
"""

from datetime import date, datetime

from sqlalchemy import JSON, Date, DateTime, Float, ForeignKey, Index, Integer, LargeBinary, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AssistantCredential(Base):
    """Server-only credential, excluded from data exports and demo seeds."""

    __tablename__ = "assistant_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    api_key: Mapped[str] = mapped_column(Text)


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    lead_time_days: Mapped[int] = mapped_column(Integer, default=30)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    # Множитель страхового запаса для категории (справочник категорий у партнёра пока не получен → 1.0)
    buffer_multiplier: Mapped[float] = mapped_column(Float, default=1.0)


class Sku(Base):
    __tablename__ = "skus"

    code: Mapped[str] = mapped_column(String(64), primary_key=True)  # Код 1С
    supplier_id: Mapped[str] = mapped_column(ForeignKey("suppliers.id"), index=True)
    supplier_sku: Mapped[str | None] = mapped_column(String(128))  # Артикул поставщика
    name: Mapped[str] = mapped_column(String(500))
    unit: Mapped[str] = mapped_column(String(16), default="шт")
    category_id: Mapped[str] = mapped_column(ForeignKey("categories.id"), index=True)
    unit_cost: Mapped[float | None] = mapped_column(Float)  # «СС реал» — себестоимость, если известна


class SalesLine(Base):
    """Строка документа из «Динамики продаж». qty > 0 — отгрузка, qty < 0 — возврат."""

    __tablename__ = "sales_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku_code: Mapped[str] = mapped_column(String(64))
    ts: Mapped[datetime] = mapped_column(DateTime)
    document: Mapped[str] = mapped_column(String(32))
    doc_type: Mapped[str] = mapped_column(String(64))
    qty: Mapped[float] = mapped_column(Float)

    __table_args__ = (Index("ix_sales_sku_ts", "sku_code", "ts"),)


class StockMonthly(Base):
    """Остаток на начало месяца."""

    __tablename__ = "stock_monthly"

    sku_code: Mapped[str] = mapped_column(String(64), primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True)  # первое число месяца
    qty: Mapped[float] = mapped_column(Float)


class StockCurrent(Base):
    """Снимок остатков на дату с разбивкой по суб-локациям (есть только у Systeme Electric)."""

    __tablename__ = "stock_current"

    sku_code: Mapped[str] = mapped_column(String(64), primary_key=True)
    as_of: Mapped[date] = mapped_column(Date)
    on_hand: Mapped[float] = mapped_column(Float)
    reserved: Mapped[float] = mapped_column(Float, default=0)
    free: Mapped[float] = mapped_column(Float)
    locations: Mapped[dict] = mapped_column(JSON, default=dict)


class GoodsInTransit(Base):
    __tablename__ = "goods_in_transit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku_code: Mapped[str] = mapped_column(String(64), index=True)
    supplier_id: Mapped[str] = mapped_column(String(32))
    order_ref: Mapped[str] = mapped_column(String(200))
    expected_date: Mapped[date | None] = mapped_column(Date)
    qty: Mapped[float] = mapped_column(Float)


class SupplierRule(Base):
    """MOQ/кратность. IEK «Мин. разр. к отгр.» → min_order_qty; SE «Кратность» → order_multiple."""

    __tablename__ = "supplier_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[str] = mapped_column(String(32), index=True)
    sku_code: Mapped[str] = mapped_column(String(64), unique=True)
    min_order_qty: Mapped[float] = mapped_column(Float, default=1)
    order_multiple: Mapped[float] = mapped_column(Float, default=1)


class SupplierSeasonality(Base):
    """Выручка компании по поставщику помесячно (файлы «Сезонность»)."""

    __tablename__ = "supplier_seasonality"

    supplier_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    year: Mapped[int] = mapped_column(Integer, primary_key=True)
    month: Mapped[int] = mapped_column(Integer, primary_key=True)
    revenue: Mapped[float] = mapped_column(Float)


class ReferenceMetric(Base):
    """Ручной расчёт менеджера из файла «Товар в пути_SystemElectric» — эталон для валидации."""

    __tablename__ = "reference_metrics"

    sku_code: Mapped[str] = mapped_column(String(64), primary_key=True)
    growth_coef: Mapped[float | None] = mapped_column(Float)  # «Кэф. Роста»
    seasonality_coef: Mapped[float | None] = mapped_column(Float)  # «Кэф. Сез-ти»
    cover_months: Mapped[float | None] = mapped_column(Float)  # «Запас»
    order_qty: Mapped[float | None] = mapped_column(Float)  # «Заказ»


class CalcParams(Base):
    __tablename__ = "calc_params"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    forecast_horizon_days: Mapped[int] = mapped_column(Integer, default=30)
    safety_buffer_days: Mapped[int] = mapped_column(Integer, default=14)
    outlier_sensitivity: Mapped[float] = mapped_column(Float, default=0.5)


class CalcRun(Base):
    __tablename__ = "calc_runs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime)
    as_of: Mapped[date | None] = mapped_column(Date)
    horizon_days: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="running")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    error: Mapped[str | None] = mapped_column(Text)


class SkuForecast(Base):
    """Полный расчёт по каждому SKU прогона (в т.ч. с нулевой потребностью) — для explain и аналитики."""

    __tablename__ = "sku_forecasts"

    run_id: Mapped[str] = mapped_column(ForeignKey("calc_runs.id", ondelete="CASCADE"), primary_key=True)
    sku_code: Mapped[str] = mapped_column(String(64), primary_key=True)
    explanation: Mapped[dict] = mapped_column(JSON)
    monthly_forecast: Mapped[list] = mapped_column(JSON)  # [{period: YYYY-MM, qty}]
    seasonal_index: Mapped[list] = mapped_column(JSON)  # 12 коэффициентов


class OrderRecommendation(Base):
    __tablename__ = "order_recommendations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("calc_runs.id", ondelete="CASCADE"), index=True)
    sku_code: Mapped[str] = mapped_column(String(64))
    supplier_id: Mapped[str] = mapped_column(String(32))
    category_id: Mapped[str] = mapped_column(String(32))
    recommended_qty: Mapped[float] = mapped_column(Float)
    approved_qty: Mapped[float | None] = mapped_column(Float)
    urgency: Mapped[str] = mapped_column(String(8))
    status: Mapped[str] = mapped_column(String(16), default="pending")
    short_reason: Mapped[str] = mapped_column(Text)
    days_of_cover: Mapped[float | None] = mapped_column(Float)
    comment: Mapped[str | None] = mapped_column(Text)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime)

    __table_args__ = (Index("ix_rec_run_sku", "run_id", "sku_code", unique=True),)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime)
    action: Mapped[str] = mapped_column(String(32))
    entity: Mapped[str] = mapped_column(String(64))
    entity_id: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)


class ImportIdentity(Base):
    """Stable 1C row identity for incremental imports of sales and transit."""

    __tablename__ = "import_identities"

    resource: Mapped[str] = mapped_column(String(32), primary_key=True)
    source: Mapped[str] = mapped_column(String(100), primary_key=True)
    external_id: Mapped[str] = mapped_column(String(200), primary_key=True)
    record_key: Mapped[str] = mapped_column(String(200), index=True)


class AssistantConversation(Base):
    """Диалог «ленивого режима». История хранится у нас, в OpenAI — без сохранения (store=false)."""

    __tablename__ = "assistant_conversations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    title: Mapped[str] = mapped_column(String(200), default="Новый диалог")
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)


class AssistantMessage(Base):
    __tablename__ = "assistant_messages"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16))  # user | assistant
    content: Mapped[str] = mapped_column(Text)
    charts: Mapped[list] = mapped_column(JSON, default=list)
    file_ids: Mapped[list] = mapped_column(JSON, default=list)
    tool_calls: Mapped[list] = mapped_column(JSON, default=list)  # [{name, arguments}] — для прозрачности
    model: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime)


class AssistantFile(Base):
    """Файл пользователя (CSV/XLSX). Разбирается на сервере; в OpenAI уходят только агрегаты."""

    __tablename__ = "assistant_files"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    conversation_id: Mapped[str] = mapped_column(
        ForeignKey("assistant_conversations.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    size: Mapped[int] = mapped_column(Integer)
    content: Mapped[bytes] = mapped_column(LargeBinary)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime)
