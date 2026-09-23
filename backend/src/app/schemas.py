"""Pydantic-схемы API. Поля 1:1 с TS-типами из FRONTEND_TZ.md §0.4; дополнительные поля помечены."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Urgency = Literal["high", "medium", "low"]
RecStatus = Literal["pending", "approved", "rejected"]
RunStatus = Literal["running", "done", "failed"]


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class OrderRecommendation(_Out):
    id: str
    run_id: str
    sku_code: str
    supplier_sku: str
    name: str
    supplier_id: str
    supplier_name: str
    category_id: str
    recommended_qty: float
    approved_qty: float | None
    unit: str
    urgency: Urgency
    status: RecStatus
    short_reason: str
    # сверх контракта
    days_of_cover: float | None = None
    comment: str | None = None


class BulkOutlier(BaseModel):
    date: str
    qty: float
    document: str


class ExplanationDetail(BaseModel):
    model_config = ConfigDict(extra="allow")  # движок отдаёт расширенный набор факторов — пропускаем как есть

    sku_code: str
    base_demand: float
    seasonality_factor: float
    growth_factor: float
    stockout_compensation: float
    current_stock: float
    reserved_stock: float
    free_stock: float
    goods_in_transit: float
    safety_buffer: float
    bulk_outliers_excluded: list[BulkOutlier]
    final_qty: float
    narrative: str


class ApproveRequest(BaseModel):
    approved_qty: float = Field(ge=0)
    comment: str | None = None


class RejectRequest(BaseModel):
    comment: str | None = None


class ExportRequest(BaseModel):
    ids: list[str] = Field(min_length=1)
    format: Literal["csv", "xlsx", "pdf"]


class ExportResponse(BaseModel):
    download_url: str


class Supplier(_Out):
    id: str
    name: str
    lead_time_days: int


class SupplierUpdate(BaseModel):
    lead_time_days: int = Field(ge=1, le=365)


class Category(_Out):
    id: str
    name: str


class CalcRun(_Out):
    id: str
    created_at: datetime
    horizon_days: int
    status: RunStatus
    # сверх контракта
    as_of: str | None = None
    finished_at: datetime | None = None
    error: str | None = None


class CalcRunCreate(BaseModel):
    horizon_days: int | None = Field(default=None, ge=1, le=365)


class TrendPoint(BaseModel):
    period: str
    actual_qty: float
    forecast_qty: float | None = None


class SeasonalityPoint(BaseModel):
    month: int
    factor: float


class CalcParams(_Out):
    forecast_horizon_days: int = Field(ge=1, le=365)
    safety_buffer_days: int = Field(ge=0, le=365)
    outlier_sensitivity: float = Field(ge=0, le=1)


class SupplierRule(BaseModel):
    id: str
    supplier_id: str
    sku_code: str
    min_order_qty: float
    order_multiple: float


class SupplierRuleUpdate(BaseModel):
    min_order_qty: float | None = Field(default=None, ge=0)
    order_multiple: float | None = Field(default=None, ge=1)
