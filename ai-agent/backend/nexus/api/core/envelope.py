"""One response shape for every successful endpoint.

    { "data": <payload>, "meta": { "request_id": "...", "generated_at": "...", ... } }

Errors use the pre-existing error envelope in `nexus.api.errors`, so a client has exactly
two shapes to handle: `data` present, or `error` present. `meta.source` states where the
payload came from — pipeline output, a direct dataset read, or a static declaration such
as the tool roster — because the frontend surfaces provenance to the analyst.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Generic, Literal, TypeVar

from pydantic import BaseModel, Field

from .logging import current_request_id

T = TypeVar("T")

Source = Literal["pipeline", "dataset", "static", "cache"]


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


class PageMeta(BaseModel):
    """Pagination facts for collection endpoints."""

    page: int = Field(..., ge=1)
    page_size: int = Field(..., ge=1)
    total: int = Field(..., ge=0)
    total_pages: int = Field(..., ge=0)
    has_next: bool = False
    has_previous: bool = False
    sort: str | None = None
    filters: dict[str, str] = Field(default_factory=dict)
    # `truncated` marks a capped scan, so the UI can say "first N of many"
    truncated: bool = False


class Meta(BaseModel):
    request_id: str = Field(default_factory=current_request_id)
    generated_at: str = Field(default_factory=_now)
    source: Source = "pipeline"
    variant: str | None = None
    run_id: str | None = None
    duration_ms: float | None = None
    page: PageMeta | None = None
    notes: list[str] = Field(default_factory=list)


class Envelope(BaseModel, Generic[T]):
    data: T
    meta: Meta = Field(default_factory=Meta)


def ok(
    data: T,
    *,
    source: Source = "pipeline",
    variant: str | None = None,
    run_id: str | None = None,
    duration_ms: float | None = None,
    page: PageMeta | None = None,
    notes: list[str] | None = None,
) -> dict:
    """Build the success envelope as a plain dict.

    Returning a dict (rather than the model) keeps routers free to declare
    `response_model=Envelope[X]` for documentation without paying double validation.
    """
    meta = Meta(
        source=source, variant=variant, run_id=run_id,
        duration_ms=duration_ms, page=page, notes=notes or [],
    )
    return {"data": data, "meta": meta.model_dump()}


def page_meta(
    *,
    page: int,
    page_size: int,
    total: int,
    sort: str | None = None,
    filters: dict[str, str] | None = None,
    truncated: bool = False,
) -> PageMeta:
    total_pages = (total + page_size - 1) // page_size if page_size else 0
    return PageMeta(
        page=page,
        page_size=page_size,
        total=total,
        total_pages=total_pages,
        has_next=page < total_pages,
        has_previous=page > 1,
        sort=sort,
        filters={k: v for k, v in (filters or {}).items() if v is not None},
        truncated=truncated,
    )
