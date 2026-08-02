"""GL accounting period helpers (monthly calendar)."""
from __future__ import annotations

from datetime import date

_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
           "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def period_name(d: date) -> str:
    return f"{_MONTHS[d.month - 1]}-{d.year}"


def period_parts(d: date) -> tuple[str, int, int]:
    """Return (period_name, period_year, period_num)."""
    return period_name(d), d.year, d.month
