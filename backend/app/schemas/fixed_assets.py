from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class AssetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    cost: Decimal = Field(gt=0)
    in_service_date: date
    life_months: int = Field(gt=0)
    asset_combination_id: uuid.UUID
    accum_depr_combination_id: uuid.UUID | None = None
    depr_expense_combination_id: uuid.UUID | None = None
    salvage_value: Decimal = Field(default=Decimal("0"), ge=0)
    category: str | None = None
    description: str | None = None
    fund_value: str | None = None


class AssetOut(BaseModel):
    id: uuid.UUID
    asset_number: str
    name: str
    category: str | None
    fund_value: str
    cost: Decimal
    salvage_value: Decimal
    in_service_date: date
    life_months: int
    method: str
    accumulated_depreciation: Decimal
    net_book_value: Decimal
    status: str
    disposal_date: date | None
    disposal_proceeds: Decimal
    model_config = {"from_attributes": True}


class DisposeIn(BaseModel):
    disposal_date: date
    proceeds: Decimal = Field(default=Decimal("0"), ge=0)
    cash_combination_id: uuid.UUID | None = None
    gain_loss_combination_id: uuid.UUID | None = None


class DeprRunIn(BaseModel):
    period_name: str


class ForecastRow(BaseModel):
    period: str
    amount: Decimal
    accumulated: Decimal


class StudyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    study_year: int
    notes: str | None = None


class StudyOut(BaseModel):
    id: uuid.UUID
    name: str
    study_year: int
    status: str
    model_config = {"from_attributes": True}


class ComponentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    category: str | None = None
    fund_value: str = "RESV"
    asset_id: uuid.UUID | None = None
    useful_life_years: int | None = None
    remaining_life_years: int | None = None
    replacement_cost: Decimal = Field(default=Decimal("0"), ge=0)
    planned_year: int | None = None
    planned_amount: Decimal = Field(default=Decimal("0"), ge=0)


class ComponentOut(ComponentCreate):
    id: uuid.UUID
    study_id: uuid.UUID
    model_config = {"from_attributes": True}


class ReserveVsActualRow(BaseModel):
    component: str
    category: str
    fund_value: str
    planned_year: int | None
    planned_amount: Decimal
    actual: Decimal
    variance: Decimal
