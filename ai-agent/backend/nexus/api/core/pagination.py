"""Pagination, sorting and in-memory slicing shared by every collection endpoint.

Sort is expressed as `field:direction` (`risk:desc`). Fields are validated against an
allow-list per endpoint so a client cannot sort by an arbitrary attribute — which for the
ledger would mean an unbounded ORDER BY over millions of rows.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Sequence

from fastapi import Query

from ..errors import ApiError
from .config import api_settings


@dataclass(frozen=True)
class PageRequest:
    page: int
    page_size: int
    sort: str | None = None

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.page_size

    def parse_sort(self, allowed: Sequence[str]) -> tuple[str, bool] | None:
        """Return (field, descending) or None. Raises ApiError(400) on a bad field."""
        if not self.sort:
            return None

        raw = self.sort.strip()
        field, _, direction = raw.partition(":")
        field = field.strip()
        direction = (direction or "asc").strip().lower()

        if field not in allowed:
            raise ApiError(
                400, "INVALID_SORT_FIELD",
                f"Cannot sort by {field!r}.",
                {"allowed": list(allowed)},
            )
        if direction not in {"asc", "desc"}:
            raise ApiError(
                400, "INVALID_SORT_DIRECTION",
                f"Sort direction must be 'asc' or 'desc', got {direction!r}.",
            )
        return field, direction == "desc"


def page_params(
    page: int = Query(1, ge=1, description="1-based page number"),
    page_size: int | None = Query(
        None, ge=1, description="items per page; defaults to the server page size"
    ),
    sort: str | None = Query(
        None,
        description="sort as `field:asc` or `field:desc`; allowed fields vary by endpoint",
        max_length=60,
    ),
) -> PageRequest:
    """FastAPI dependency producing a validated PageRequest."""
    settings = api_settings()
    size = page_size or settings.page_size_default

    if size > settings.page_size_max:
        raise ApiError(
            400, "PAGE_SIZE_TOO_LARGE",
            f"page_size may not exceed {settings.page_size_max}.",
            {"max": settings.page_size_max, "requested": size},
        )

    return PageRequest(page=page, page_size=size, sort=sort)


def sort_in_memory(
    rows: Iterable[Any],
    request: PageRequest,
    allowed: Sequence[str],
    key: Callable[[Any, str], Any] | None = None,
) -> list[Any]:
    """Sort a materialised list. Used for pipeline output, which is already bounded."""
    items = list(rows)
    parsed = request.parse_sort(allowed)

    if parsed is None:
        return items

    field, descending = parsed
    getter = key or (lambda row, name: getattr(row, name, None))

    def sort_key(row: Any) -> tuple[int, Any]:
        value = getter(row, field)
        # None sorts last in both directions rather than raising on mixed types.
        return (1, "") if value is None else (0, value)

    items.sort(key=sort_key, reverse=descending)
    return items


def slice_page(rows: Sequence[Any], request: PageRequest) -> list[Any]:
    return list(rows[request.offset : request.offset + request.page_size])
