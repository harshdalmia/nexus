"""Read-only ledger access.

The pipeline normalises transactions into the DuckDB `transactions` table at ingest; this
service only reads them back with filtering, sorting and pagination so the ledger view has
real rows instead of fixtures. Every predicate is parameterised, the column allow-lists are
closed, and nothing here writes, aggregates into a score, or derives a signal.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from ..core.config import api_settings
from ..core.pagination import PageRequest
from ..errors import ApiError
from ..schemas.views import TransactionView
from ..state import EngineState

# Closed allow-list: a client can only sort by an indexed-ish scalar column.
SORTABLE = (
    "tx_id", "timestamp", "amount_base", "amount_paid", "amount_received",
    "payment_format", "from_bank", "to_bank",
)

_COLUMNS = (
    "tx_id, timestamp, from_bank, sender_account, to_bank, receiver_account, "
    "amount_paid, payment_currency, amount_received, receiving_currency, "
    "amount_base, payment_format, cross_currency, is_laundering"
)


@dataclass(frozen=True)
class TransactionFilters:
    node: str | None = None
    sender: str | None = None
    receiver: str | None = None
    bank: str | None = None
    payment_format: str | None = None
    currency: str | None = None
    min_amount: float | None = None
    max_amount: float | None = None
    start: str | None = None
    end: str | None = None
    laundering_only: bool = False
    cross_currency_only: bool = False

    def as_meta(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for key, value in self.__dict__.items():
            if value in (None, False):
                continue
            out[key] = str(value)
        return out


def _split_node(node: str) -> tuple[str, str]:
    bank, separator, account = node.partition("|")
    if not separator or not bank or not account:
        raise ApiError(
            400, "INVALID_NODE",
            "An account node must be formatted as 'bank|account'.",
            {"received": node},
        )
    return bank, account


def _predicates(filters: TransactionFilters) -> tuple[str, list[Any]]:
    clauses: list[str] = []
    params: list[Any] = []

    if filters.node:
        bank, account = _split_node(filters.node)
        clauses.append(
            "((from_bank = ? AND sender_account = ?) OR (to_bank = ? AND receiver_account = ?))"
        )
        params.extend([bank, account, bank, account])

    if filters.sender:
        bank, account = _split_node(filters.sender)
        clauses.append("(from_bank = ? AND sender_account = ?)")
        params.extend([bank, account])

    if filters.receiver:
        bank, account = _split_node(filters.receiver)
        clauses.append("(to_bank = ? AND receiver_account = ?)")
        params.extend([bank, account])

    if filters.bank:
        clauses.append("(from_bank = ? OR to_bank = ?)")
        params.extend([filters.bank, filters.bank])

    if filters.payment_format:
        clauses.append("payment_format = ?")
        params.append(filters.payment_format)

    if filters.currency:
        clauses.append("(payment_currency = ? OR receiving_currency = ?)")
        params.extend([filters.currency, filters.currency])

    if filters.min_amount is not None:
        clauses.append("amount_base >= ?")
        params.append(filters.min_amount)

    if filters.max_amount is not None:
        clauses.append("amount_base <= ?")
        params.append(filters.max_amount)

    if filters.start:
        clauses.append("timestamp >= ?")
        params.append(filters.start)

    if filters.end:
        clauses.append("timestamp <= ?")
        params.append(filters.end)

    if filters.laundering_only:
        clauses.append("is_laundering")

    if filters.cross_currency_only:
        clauses.append("cross_currency")

    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    return where, params


def _order_by(page: PageRequest) -> str:
    parsed = page.parse_sort(SORTABLE)
    if parsed is None:
        return "ORDER BY tx_id"
    column, descending = parsed
    return f"ORDER BY {column} {'DESC' if descending else 'ASC'}, tx_id"


def _row_to_view(row: tuple) -> TransactionView:
    (
        tx_id, timestamp, from_bank, sender_account, to_bank, receiver_account,
        amount_paid, payment_currency, amount_received, receiving_currency,
        amount_base, payment_format, cross_currency, is_laundering,
    ) = row

    def _float(value: Any) -> float | None:
        if value is None:
            return None
        number = float(value)
        return None if math.isnan(number) else round(number, 2)

    return TransactionView(
        tx_id=int(tx_id),
        timestamp=timestamp.isoformat() if timestamp is not None else None,
        from_bank=str(from_bank),
        sender_account=str(sender_account),
        to_bank=str(to_bank),
        receiver_account=str(receiver_account),
        amount_paid=_float(amount_paid),
        payment_currency=str(payment_currency or ""),
        amount_received=_float(amount_received),
        receiving_currency=str(receiving_currency or ""),
        amount_base=_float(amount_base),
        payment_format=str(payment_format or ""),
        cross_currency=bool(cross_currency),
        is_laundering=bool(is_laundering),
    )


def query(
    engine: EngineState, filters: TransactionFilters, page: PageRequest
) -> tuple[list[TransactionView], int, bool]:
    """Return (rows, total_matching, truncated).

    `total_matching` is capped at the configured scan limit so an unfiltered request cannot
    report a count derived from a full 5M-row pass on every page change.
    """
    settings = api_settings()
    where, params = _predicates(filters)
    order = _order_by(page)

    with engine.lock:
        counted = engine.ds.con.execute(
            f"SELECT COUNT(*) FROM (SELECT tx_id FROM transactions {where} "
            f"LIMIT {settings.transaction_scan_limit + 1})",
            params,
        ).fetchone()[0]

        rows = engine.ds.con.execute(
            f"SELECT {_COLUMNS} FROM transactions {where} {order} LIMIT ? OFFSET ?",
            [*params, page.page_size, page.offset],
        ).fetchall()

    truncated = counted > settings.transaction_scan_limit
    total = min(int(counted), settings.transaction_scan_limit)
    return [_row_to_view(row) for row in rows], total, truncated


def by_ids(engine: EngineState, tx_ids: list[int]) -> list[TransactionView]:
    """Fetch specific transactions — the proof-of-work behind an evidence record."""
    if not tx_ids:
        return []
    if len(tx_ids) > 500:
        raise ApiError(
            400, "TOO_MANY_IDS", "At most 500 transaction ids may be requested at once.",
            {"requested": len(tx_ids)},
        )
    placeholders = ", ".join(["?"] * len(tx_ids))
    with engine.lock:
        rows = engine.ds.con.execute(
            f"SELECT {_COLUMNS} FROM transactions WHERE tx_id IN ({placeholders}) "
            "ORDER BY tx_id",
            tx_ids,
        ).fetchall()
    return [_row_to_view(row) for row in rows]


def facets(engine: EngineState) -> dict[str, list[dict[str, Any]]]:
    """Distinct payment formats and currencies with counts — filter chips for the ledger."""
    with engine.lock:
        formats = engine.ds.con.execute(
            "SELECT payment_format, COUNT(*) FROM transactions GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall()
        currencies = engine.ds.con.execute(
            "SELECT payment_currency, COUNT(*) FROM transactions GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall()
        span = engine.ds.con.execute(
            "SELECT MIN(timestamp), MAX(timestamp) FROM transactions"
        ).fetchone()

    return {
        "payment_formats": [
            {"value": str(value), "count": int(count)} for value, count in formats
        ],
        "currencies": [
            {"value": str(value), "count": int(count)} for value, count in currencies
        ],
        "time_span": [
            {
                "first": span[0].isoformat() if span and span[0] is not None else None,
                "last": span[1].isoformat() if span and span[1] is not None else None,
            }
        ],
    }
