from __future__ import annotations

import uuid
from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.models.kff import ACCOUNT_TYPES, MAX_SEGMENTS, SEGMENT_QUALIFIERS

# --- Structures ------------------------------------------------------------
class StructureCreate(BaseModel):
    model_config = {"extra": "forbid"}

    structure_code: str = Field(min_length=2, max_length=60, pattern=r"^[A-Z0-9_]+$")
    title: str = Field(min_length=2, max_length=150)
    description: str | None = None
    segment_separator: str = Field(default="-", min_length=1, max_length=1)


class StructureUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    title: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = None
    segment_separator: str | None = Field(default=None, min_length=1, max_length=1)
    enabled: bool | None = None


class StructureOut(BaseModel):
    id: uuid.UUID
    structure_code: str
    title: str
    description: str | None
    segment_separator: str
    enabled: bool
    is_coa: bool
    created_at: datetime

    model_config = {"from_attributes": True}


# --- Value sets ------------------------------------------------------------
class ValueSetCreate(BaseModel):
    model_config = {"extra": "forbid"}

    code: str = Field(min_length=1, max_length=60)
    name: str = Field(min_length=1, max_length=150)
    description: str | None = None
    validation_type: str = Field(default="INDEPENDENT")
    format_type: str = Field(default="CHAR")
    max_size: int = Field(default=25, ge=1, le=240)
    uppercase_only: bool = True
    zero_fill: bool = False
    numbers_only: bool = False

    @field_validator("validation_type")
    @classmethod
    def _vt(cls, v):
        allowed = {"NONE", "INDEPENDENT", "DEPENDENT", "TABLE"}
        if v.upper() not in allowed:
            raise ValueError(f"validation_type must be one of {allowed}")
        return v.upper()

    @field_validator("format_type")
    @classmethod
    def _ft(cls, v):
        if v.upper() not in {"CHAR", "NUMBER"}:
            raise ValueError("format_type must be CHAR or NUMBER")
        return v.upper()


class ValueSetOut(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    validation_type: str
    format_type: str
    max_size: int
    uppercase_only: bool
    zero_fill: bool
    numbers_only: bool

    model_config = {"from_attributes": True}


class ValueCreate(BaseModel):
    model_config = {"extra": "forbid"}

    value: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=240)
    enabled: bool = True
    summary_flag: bool = False
    allow_posting: bool = True
    parent_value: str | None = None
    account_type: str | None = None
    start_date: date | None = None
    end_date: date | None = None

    @field_validator("account_type")
    @classmethod
    def _at(cls, v):
        if v is not None and v.upper() not in ACCOUNT_TYPES:
            raise ValueError(f"account_type must be one of {ACCOUNT_TYPES}")
        return v.upper() if v else v


class ValueOut(BaseModel):
    id: uuid.UUID
    value_set_id: uuid.UUID
    value: str
    description: str | None
    enabled: bool
    summary_flag: bool
    allow_posting: bool
    parent_value: str | None
    account_type: str | None
    start_date: date | None
    end_date: date | None

    model_config = {"from_attributes": True}


# --- Segments --------------------------------------------------------------
class SegmentCreate(BaseModel):
    model_config = {"extra": "forbid"}

    segment_number: int = Field(ge=1, le=MAX_SEGMENTS)
    name: str = Field(min_length=1, max_length=120)
    prompt: str = Field(min_length=1, max_length=120)
    value_set_id: uuid.UUID | None = None
    qualifier: str = "none"
    displayed: bool = True
    enabled: bool = True
    required: bool = True
    default_value: str | None = None

    @field_validator("qualifier")
    @classmethod
    def _q(cls, v):
        if v not in SEGMENT_QUALIFIERS:
            raise ValueError(f"qualifier must be one of {SEGMENT_QUALIFIERS}")
        return v


class SegmentUpdate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str | None = Field(default=None, min_length=1, max_length=120)
    prompt: str | None = Field(default=None, min_length=1, max_length=120)
    segment_number: int | None = Field(default=None, ge=1, le=MAX_SEGMENTS)
    value_set_id: uuid.UUID | None = None
    qualifier: str | None = None
    displayed: bool | None = None
    enabled: bool | None = None
    required: bool | None = None
    default_value: str | None = None

    @field_validator("qualifier")
    @classmethod
    def _q(cls, v):
        if v is not None and v not in SEGMENT_QUALIFIERS:
            raise ValueError(f"qualifier must be one of {SEGMENT_QUALIFIERS}")
        return v


class SegmentOut(BaseModel):
    id: uuid.UUID
    structure_id: uuid.UUID
    segment_number: int
    name: str
    prompt: str
    column_name: str
    value_set_id: uuid.UUID | None
    qualifier: str
    displayed: bool
    enabled: bool
    required: bool
    default_value: str | None

    model_config = {"from_attributes": True}


class StructureDetailOut(StructureOut):
    segments: list[SegmentOut] = []


# --- Cross-validation rules ------------------------------------------------
class CrossValidationLineIn(BaseModel):
    include_exclude: str = Field(default="INCLUDE", pattern=r"^(INCLUDE|EXCLUDE)$")
    segment_number: int = Field(ge=1, le=MAX_SEGMENTS)
    low_value: str
    high_value: str


class CrossValidationRuleCreate(BaseModel):
    model_config = {"extra": "forbid"}

    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    error_message: str | None = None
    enabled: bool = True
    lines: list[CrossValidationLineIn] = []


class CrossValidationRuleOut(BaseModel):
    id: uuid.UUID
    structure_id: uuid.UUID
    name: str
    description: str | None
    error_message: str | None
    enabled: bool
    lines: list[CrossValidationLineIn] = []

    model_config = {"from_attributes": True}


# --- Code combinations -----------------------------------------------------
class CodeCombinationCreate(BaseModel):
    model_config = {"extra": "forbid"}

    # Map of segment_number -> value, e.g. {"1": "0100", "2": "OPER", ...}
    segments: dict[int, str]
    allow_posting: bool = True
    enabled: bool = True
    start_date_active: date | None = None
    end_date_active: date | None = None


class CodeCombinationOut(BaseModel):
    id: uuid.UUID
    structure_id: uuid.UUID
    concatenated_segments: str
    balancing_segment_value: str | None
    natural_account_value: str | None
    cost_center_value: str | None
    fund_value: str | None
    account_type: str | None
    enabled: bool
    allow_posting: bool
    summary_flag: bool

    model_config = {"from_attributes": True}
