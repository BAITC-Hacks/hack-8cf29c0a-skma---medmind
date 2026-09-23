"""Validated input records shared by manual entry and tabular imports."""

from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

Key = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[^~/\\]+$")]
ShortKey = Annotated[str, Field(min_length=1, max_length=32, pattern=r"^[^~/\\]+$")]
NonNegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]


class InputRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)


class SupplierInput(InputRecord):
    id: ShortKey
    name: str = Field(min_length=1, max_length=200)
    lead_time_days: int = Field(default=30, ge=1, le=365)


class CategoryInput(InputRecord):
    id: ShortKey
    name: str = Field(min_length=1, max_length=200)
    buffer_multiplier: NonNegative = 1


class ProductInput(InputRecord):
    code: Key
    supplier_id: ShortKey
    supplier_sku: str | None = Field(default=None, max_length=128)
    name: str = Field(min_length=1, max_length=500)
    unit: str = Field(default="шт", min_length=1, max_length=16)
    category_id: ShortKey
    unit_cost: NonNegative | None = None


class SalesInput(InputRecord):
    sku_code: Key
    ts: datetime
    document: str = Field(min_length=1, max_length=32)
    doc_type: str = Field(default="Расходная накладная", min_length=1, max_length=64)
    qty: float = Field(allow_inf_nan=False)

    @field_validator("ts")
    @classmethod
    def local_time(cls, value):
        if value.tzinfo is not None:
            raise ValueError("Передайте местное время без часового пояса")
        return value

    @field_validator("qty")
    @classmethod
    def nonzero(cls, value):
        if value == 0:
            raise ValueError("Количество продажи не может быть нулевым")
        return value


class MonthlyStockInput(InputRecord):
    sku_code: Key
    month: date
    qty: NonNegative

    @field_validator("month")
    @classmethod
    def month_start(cls, value):
        if value.day != 1:
            raise ValueError("Снимок задаётся на первое число месяца")
        return value


class CurrentStockInput(InputRecord):
    sku_code: Key
    as_of: date
    on_hand: NonNegative
    reserved: NonNegative = 0
    locations: dict[str, NonNegative] = Field(default_factory=dict)

    @model_validator(mode="after")
    def valid_reserve(self):
        if self.reserved > self.on_hand:
            raise ValueError("Резерв не может превышать остаток")
        return self


class TransitInput(InputRecord):
    sku_code: Key
    supplier_id: ShortKey
    order_ref: str = Field(min_length=1, max_length=200)
    expected_date: date | None = None
    qty: float = Field(gt=0, allow_inf_nan=False)


class RuleInput(InputRecord):
    sku_code: Key
    supplier_id: ShortKey
    min_order_qty: NonNegative = 1
    order_multiple: float = Field(default=1, gt=0, allow_inf_nan=False)


class SeasonalityInput(InputRecord):
    supplier_id: ShortKey
    year: int = Field(ge=1900, le=2200)
    month: int = Field(ge=1, le=12)
    revenue: NonNegative


class ReferenceInput(InputRecord):
    sku_code: Key
    growth_coef: float | None = None
    seasonality_coef: float | None = None
    cover_months: NonNegative | None = None
    order_qty: NonNegative | None = None
