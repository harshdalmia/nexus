"""Plain facts about the account under investigation: how much, when, in what form.

The evidence records answer "why is this suspicious?" but they never answer the three
questions an analyst asks first — how much money, over what period, and through which
payment channel. Before this module the narrative could tell you an account had a 7.8
robust-z peer deviation without ever mentioning a currency amount or a date.

Reads only the twelve normalized transaction columns, honours the query's filter scope, and
computes no score of any kind. Three aggregate queries, run once per narrated case.
"""

from __future__ import annotations

import duckdb

from . import scope as scope_mod
from .config import Settings
from .schemas import FilterScope, SubjectContext

# Both sides of the ledger for one account, as a single SQL clause.
_EITHER_SIDE = (
    "((to_bank = ? AND receiver_account = ?) OR (from_bank = ? AND sender_account = ?))"
)


def _split(node: str) -> tuple[str, str]:
    bank, acct = node.split("|", 1)
    return bank, acct


def _side(
    con: duckdb.DuckDBPyConnection,
    node: str,
    bank_col: str,
    acct_col: str,
    peer_bank_col: str,
    peer_acct_col: str,
    scope: FilterScope | None,
) -> tuple[int, float, int, object, object, int]:
    """Aggregate one direction of the account's activity."""
    bank, acct = _split(node)
    clause, params = scope_mod.where(scope, f"{bank_col} = ?", f"{acct_col} = ?")
    row = con.execute(
        f"""
        SELECT COUNT(*),
               COALESCE(SUM(amount_base), 0.0),
               COUNT(DISTINCT {peer_bank_col} || '|' || {peer_acct_col}),
               MIN(timestamp), MAX(timestamp),
               COUNT(DISTINCT CAST(timestamp AS DATE))
        FROM transactions {clause}
        """,
        [bank, acct] + params,
    ).fetchone()
    if row is None:
        return 0, 0.0, 0, None, None, 0
    return (
        int(row[0] or 0), float(row[1] or 0.0), int(row[2] or 0),
        row[3], row[4], int(row[5] or 0),
    )


def summarize(
    con: duckdb.DuckDBPyConnection,
    node: str,
    scope: FilterScope | None = None,
    settings: Settings | None = None,
) -> SubjectContext:
    """Descriptive context for one account. Never raises on an unknown account."""
    settings = settings or Settings()

    in_count, in_value, in_peers, in_first, in_last, in_days = _side(
        con, node, "to_bank", "receiver_account", "from_bank", "sender_account", scope,
    )
    out_count, out_value, out_peers, out_first, out_last, out_days = _side(
        con, node, "from_bank", "sender_account", "to_bank", "receiver_account", scope,
    )

    firsts = [t for t in (in_first, out_first) if t is not None]
    lasts = [t for t in (in_last, out_last) if t is not None]
    first_seen = min(firsts) if firsts else None
    last_seen = max(lasts) if lasts else None
    span_days = None
    if first_seen is not None and last_seen is not None:
        span_days = max((last_seen.date() - first_seen.date()).days + 1, 1)

    # One grouped pass over both sides for the channel and currency mix.
    bank, acct = _split(node)
    clause, params = scope_mod.where(scope, _EITHER_SIDE)
    rows = con.execute(
        f"""
        SELECT payment_format, payment_currency, COUNT(*) AS n
        FROM transactions {clause}
        GROUP BY 1, 2
        """,
        [bank, acct, bank, acct] + params,
    ).fetchall()

    by_format: dict[str, int] = {}
    by_currency: dict[str, int] = {}
    for fmt, ccy, n in rows:
        by_format[str(fmt)] = by_format.get(str(fmt), 0) + int(n)
        by_currency[str(ccy)] = by_currency.get(str(ccy), 0) + int(n)

    def _top(counts: dict[str, int]) -> tuple[str | None, int]:
        if not counts:
            return None, 0
        # Count descending, name ascending -> deterministic.
        name = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        return name, counts[name]

    top_format, top_format_count = _top(by_format)
    top_currency, top_currency_count = _top(by_currency)

    return SubjectContext(
        node=node,
        scope_active=scope_mod.is_active(scope),
        scope=scope_mod.applied(scope),
        base_currency=settings.base_currency,
        inbound_count=in_count,
        inbound_value=round(in_value, 2),
        inbound_counterparties=in_peers,
        outbound_count=out_count,
        outbound_value=round(out_value, 2),
        outbound_counterparties=out_peers,
        first_seen=first_seen,
        last_seen=last_seen,
        span_days=span_days,
        active_days=max(in_days, out_days),
        top_payment_format=top_format,
        top_payment_format_count=top_format_count,
        top_currency=top_currency,
        top_currency_count=top_currency_count,
        currencies=sorted(by_currency),
    )


def numbers(context: SubjectContext | None) -> list[float]:
    """Every figure this context contributes to a narrative, for the claim validator.

    The validator's job is to reject numbers with no provenance. These have provenance —
    they were measured by the queries above — so they are handed to it explicitly rather
    than by widening what it trusts in general.
    """
    if context is None:
        return []
    values: list[float] = [
        context.inbound_count, context.inbound_value, context.inbound_counterparties,
        context.outbound_count, context.outbound_value, context.outbound_counterparties,
        context.top_payment_format_count, context.top_currency_count,
        len(context.currencies),
    ]
    for optional in (context.span_days, context.active_days):
        if optional is not None:
            values.append(optional)
    if context.first_seen is not None:
        values.extend([context.first_seen.year, context.first_seen.month,
                       context.first_seen.day])
    if context.last_seen is not None:
        values.extend([context.last_seen.year, context.last_seen.month,
                       context.last_seen.day])
    return [float(v) for v in values]
