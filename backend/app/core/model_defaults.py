"""Transient-default hydration.

SQLAlchemy applies ``mapped_column(default=...)`` only on flush. When a ``get_*``
singleton returns an *unsaved* default object (no row exists yet) and that object
is serialized through a Pydantic schema, any newly-added required column whose value
was never set is ``None`` → a serialization error.

``hydrate_defaults`` fills every column that is still ``None`` with its Python-side
column default (scalar or callable), so transient defaults serialize cleanly. Use
``make_default(Model, **overrides)`` to build a fully-hydrated transient instance.
"""
from __future__ import annotations

from typing import TypeVar

from sqlalchemy import inspect as sa_inspect

T = TypeVar("T")


def hydrate_defaults(obj: T) -> T:
    """Set any None-valued column to its Python column default (skips primary keys)."""
    mapper = sa_inspect(type(obj))
    for col in mapper.columns:
        if col.primary_key:
            continue
        key = col.key
        if getattr(obj, key, None) is not None:
            continue
        default = col.default
        if default is None:
            continue
        if getattr(default, "is_scalar", False):
            setattr(obj, key, default.arg)
        elif getattr(default, "is_callable", False):
            try:
                setattr(obj, key, default.arg(None))
            except Exception:  # pragma: no cover - context-dependent callables are skipped
                pass
    return obj


def make_default(model: type[T], **overrides) -> T:
    """Construct a transient model instance with all column defaults hydrated."""
    return hydrate_defaults(model(**overrides))
