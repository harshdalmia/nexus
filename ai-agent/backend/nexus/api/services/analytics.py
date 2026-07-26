"""Dataset-derived analytics: series, distributions, segments, flows, timelines.

Every function is a read-only aggregation over the normalised transaction store, the
warmup profile table, the peer model built at warmup, or the bounded subgraph the
pipeline's own graph module returns. None of it scores, infers or ranks anything the
engine did not already rank.
"""

from __future__ import annotations

import math
from typing import Any

from ... import graph as graph_mod, screener
from ...profiles import CLUSTER_FEATURES
from ..core.config import api_settings
from ..errors import ApiError
from ..schemas.analytics import (
    BandView,
    CandidatePointView,
    CandidateScatterView,
    CorridorCellView,
    CorridorHeatView,
    DistributionsView,
    EntityEventView,
    EntityTimelineView,
    FlowLinkView,
    FlowNodeView,
    MoneyFlowView,
    SegmentsView,
    SegmentView,
    SeriesPointView,
    VolumeSeriesView,
)
from ..state import EngineState

BUCKETS = ("day", "week", "month")

# Amount bands, in base currency. The 9,000–9,999 band is called out because it is the
# structuring band the engine's own near-threshold rule looks at.
AMOUNT_BANDS: tuple[tuple[str, float, float | None], ...] = (
    ("under $1k", 0.0, 1_000.0),
    ("$1k – $5k", 1_000.0, 5_000.0),
    ("$5k – $9k", 5_000.0, 9_000.0),
    ("$9k – $9.99k", 9_000.0, 10_000.0),
    ("$10k – $50k", 10_000.0, 50_000.0),
    ("$50k and above", 50_000.0, None),
)


def _float(value: Any, digits: int = 2) -> float:
    if value is None:
        return 0.0

    number = float(value)

    return 0.0 if math.isnan(number) else round(number, digits)


def _node_predicate(node: str) -> tuple[str, list[str]]:
    bank, separator, account = node.partition("|")

    if not separator or not bank or not account:
        raise ApiError(
            400, "INVALID_NODE", "An account node must be formatted as 'bank|account'.",
            {"received": node},
        )

    return (
        "((from_bank = ? AND sender_account = ?) OR (to_bank = ? AND receiver_account = ?))",
        [bank, account, bank, account],
    )


# ------------------------------------------------------------------ volume series

def volume_series(
    engine: EngineState, bucket: str = "week", node: str | None = None, limit: int = 60
) -> VolumeSeriesView:
    """Transaction count and value per period, optionally for one account."""
    if bucket not in BUCKETS:
        raise ApiError(
            400, "INVALID_BUCKET", f"bucket must be one of {', '.join(BUCKETS)}.",
            {"received": bucket},
        )

    where = "WHERE timestamp IS NOT NULL"
    params: list[Any] = []

    if node is not None:
        clause, node_params = _node_predicate(node)
        where = f"{where} AND {clause}"
        params.extend(node_params)

    with engine.lock:
        rows = engine.ds.con.execute(
            f"SELECT date_trunc('{bucket}', timestamp) AS bucket, COUNT(*), "
            f"SUM(amount_base) FROM transactions {where} GROUP BY 1 ORDER BY 1 "
            "LIMIT ?",
            [*params, limit],
        ).fetchall()

    points = [
        SeriesPointView(
            bucket=stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp),
            count=int(count),
            value=_float(total),
        )
        for stamp, count, total in rows
        if stamp is not None
    ]

    return VolumeSeriesView(
        bucket=bucket,
        node=node,
        points=points,
        total_count=sum(point.count for point in points),
        total_value=_float(sum(point.value for point in points)),
    )


# ------------------------------------------------------------------ distributions

def distributions(engine: EngineState) -> DistributionsView:
    """Amount bands, payment formats and currencies over the loaded slice."""
    band_sql = " ".join(
        f"WHEN amount_base >= {lower} AND amount_base < {upper} THEN '{label}'"
        if upper is not None
        else f"WHEN amount_base >= {lower} THEN '{label}'"
        for label, lower, upper in AMOUNT_BANDS
    )

    with engine.lock:
        total = engine.ds.con.execute("SELECT COUNT(*) FROM transactions").fetchone()[0]
        bands = engine.ds.con.execute(
            f"SELECT CASE {band_sql} ELSE 'unpriced' END AS band, COUNT(*), "
            "SUM(amount_base) FROM transactions GROUP BY 1"
        ).fetchall()
        formats = engine.ds.con.execute(
            "SELECT payment_format, COUNT(*), SUM(amount_base) FROM transactions "
            "GROUP BY 1 ORDER BY 2 DESC"
        ).fetchall()
        currencies = engine.ds.con.execute(
            "SELECT payment_currency, COUNT(*), SUM(amount_base) FROM transactions "
            "GROUP BY 1 ORDER BY 2 DESC LIMIT 15"
        ).fetchall()

    order = {label: index for index, (label, _, _) in enumerate(AMOUNT_BANDS)}
    band_views = sorted(
        (
            BandView(
                label=str(label), count=int(count), value=_float(value),
                lower=next((low for name, low, _ in AMOUNT_BANDS if name == label), None),
                upper=next((high for name, _, high in AMOUNT_BANDS if name == label), None),
            )
            for label, count, value in bands
        ),
        key=lambda band: order.get(band.label, len(order)),
    )

    return DistributionsView(
        transactions=int(total),
        amount_bands=band_views,
        payment_formats=[
            BandView(label=str(label), count=int(count), value=_float(value))
            for label, count, value in formats
        ],
        currencies=[
            BandView(label=str(label), count=int(count), value=_float(value))
            for label, count, value in currencies
        ],
    )


# ------------------------------------------------------------------ corridor heat

def corridor_heat(engine: EngineState, bucket: str = "month", rows: int = 6) -> CorridorHeatView:
    """Currency corridor intensity per period, normalised 0–1 per the whole grid."""
    if bucket not in BUCKETS:
        raise ApiError(400, "INVALID_BUCKET", f"bucket must be one of {', '.join(BUCKETS)}.")

    with engine.lock:
        top = engine.ds.con.execute(
            "SELECT payment_currency FROM transactions GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT ?",
            [rows],
        ).fetchall()
        currencies = [str(value) for (value,) in top]

        if not currencies:
            return CorridorHeatView(note="the loaded slice holds no priced transactions")

        placeholders = ", ".join(["?"] * len(currencies))
        grid = engine.ds.con.execute(
            f"SELECT payment_currency, date_trunc('{bucket}', timestamp) AS bucket, "
            "SUM(amount_base) FROM transactions "
            f"WHERE timestamp IS NOT NULL AND payment_currency IN ({placeholders}) "
            "GROUP BY 1, 2 ORDER BY 2",
            currencies,
        ).fetchall()

    columns: list[str] = []
    values: dict[tuple[str, str], float] = {}

    for currency, stamp, total in grid:
        label = stamp.date().isoformat() if hasattr(stamp, "date") else str(stamp)

        if label not in columns:
            columns.append(label)

        values[(str(currency), label)] = _float(total)

    peak = max(values.values(), default=0.0) or 1.0

    return CorridorHeatView(
        rows=[
            CorridorCellView(
                row=currency,
                values=[round(values.get((currency, column), 0.0) / peak, 4) for column in columns],
            )
            for currency in currencies
        ],
        columns=columns,
        note=(
            "AMLworld carries no country data, so rows are payment currencies rather than "
            "jurisdictions; intensity is value share of the busiest cell"
        ),
    )


# ------------------------------------------------------------------ peer segments

def segments(engine: EngineState) -> SegmentsView:
    """Behavioural peer clusters as sized segments, read from the warmup peer model."""
    peers = engine.peers
    # `_size` is the peer model's own cluster histogram; reading it avoids re-clustering
    # 515k accounts just to count them.
    sizes: dict[int, int] = dict(getattr(peers, "_size", {}) or {})  # noqa: SLF001

    if not sizes:
        return SegmentsView(available=False, reason="the peer model published no clusters")

    accounts = sum(sizes.values())

    return SegmentsView(
        clusters=[
            SegmentView(
                label=f"cluster {cluster}",
                accounts=int(count),
                share=round(count / accounts, 4) if accounts else 0.0,
            )
            for cluster, count in sorted(sizes.items(), key=lambda kv: -kv[1])
        ],
        accounts=accounts,
        features=list(CLUSTER_FEATURES),
    )


# ------------------------------------------------------------------ candidates

def candidate_scatter(engine: EngineState, limit: int = 120) -> CandidateScatterView:
    """The screener's own candidate pool, projected onto two of its ranking features."""
    pool = screener.rank(engine.profiles, None, max_candidates=limit)

    if not pool.candidates:
        return CandidateScatterView(
            available=False, reason=pool.reason, eligible=pool.eligible, dropped=pool.dropped,
        )

    return CandidateScatterView(
        eligible=pool.eligible,
        dropped=pool.dropped,
        points=[
            CandidatePointView(
                node=candidate.node,
                rank=round(candidate.rank, 4),
                x=_float(candidate.features.get("in_degree", 0.0)),
                y=_float(candidate.features.get("in_sum", 0.0)),
                size=_float(candidate.features.get("velocity", 0.0), 4),
            )
            for candidate in pool.candidates
        ],
    )


# ------------------------------------------------------------------ money flow

def money_flow(engine: EngineState, node: str, depth: int = 1) -> MoneyFlowView:
    """Feeders -> hub -> beneficiaries, aggregated from the pipeline's own subgraph."""
    if not engine.has_node(node):
        raise ApiError(
            404, "ACCOUNT_NOT_FOUND",
            f"Account {node} does not exist in {engine.settings.variant}.",
            {"node": node},
        )

    settings = api_settings()
    depth = max(1, min(depth, settings.graph_depth_max))

    with engine.lock:
        subgraph = graph_mod.ego_subgraph(engine.ds.con, node, depth=depth)

    inbound: dict[str, dict[str, float]] = {}
    outbound: dict[str, dict[str, float]] = {}

    for source, target, data in subgraph.edges(data=True):
        amount = float(data.get("amount_base") or 0.0)

        if math.isnan(amount):
            amount = 0.0

        if target == node:
            bucket = inbound.setdefault(source, {"value": 0.0, "count": 0.0})
        elif source == node:
            bucket = outbound.setdefault(target, {"value": 0.0, "count": 0.0})
        else:
            # Second-hop edges between counterparties are not part of the staged flow.
            continue

        bucket["value"] += amount
        bucket["count"] += 1.0

    top_in = sorted(inbound.items(), key=lambda kv: -kv[1]["value"])[:12]
    top_out = sorted(outbound.items(), key=lambda kv: -kv[1]["value"])[:12]
    truncated = len(inbound) > len(top_in) or len(outbound) > len(top_out)

    nodes = [
        *[
            FlowNodeView(id=source, label=source.split("|")[-1], column=0, role="feeder")
            for source, _ in top_in
        ],
        FlowNodeView(id=node, label=node.split("|")[-1], column=1, role="hub"),
        *[
            FlowNodeView(id=target, label=target.split("|")[-1], column=2, role="beneficiary")
            for target, _ in top_out
        ],
    ]

    links = [
        *[
            FlowLinkView(
                source=source, target=node, value=_float(bucket["value"]),
                tx_count=int(bucket["count"]),
            )
            for source, bucket in top_in
        ],
        *[
            FlowLinkView(
                source=node, target=target, value=_float(bucket["value"]),
                tx_count=int(bucket["count"]),
            )
            for target, bucket in top_out
        ],
    ]

    return MoneyFlowView(
        centre=node,
        nodes=nodes,
        links=links,
        inbound_value=_float(sum(bucket["value"] for bucket in inbound.values())),
        outbound_value=_float(sum(bucket["value"] for bucket in outbound.values())),
        truncated=truncated,
    )


# ------------------------------------------------------------------ entity timeline

def entity_timeline(engine: EngineState, node: str, limit: int = 200) -> EntityTimelineView:
    """One account's own transaction history, dated and directional."""
    if not engine.has_node(node):
        raise ApiError(
            404, "ACCOUNT_NOT_FOUND",
            f"Account {node} does not exist in {engine.settings.variant}.",
            {"node": node},
        )

    bank, _, account = node.partition("|")

    with engine.lock:
        rows = engine.ds.con.execute(
            "SELECT tx_id, timestamp, "
            "CASE WHEN to_bank = ? AND receiver_account = ? THEN 'in' ELSE 'out' END AS direction, "
            "CASE WHEN to_bank = ? AND receiver_account = ? "
            "     THEN from_bank || '|' || sender_account "
            "     ELSE to_bank || '|' || receiver_account END AS counterparty, "
            "amount_base, payment_currency, payment_format, is_laundering "
            "FROM transactions "
            "WHERE ((from_bank = ? AND sender_account = ?) OR (to_bank = ? AND receiver_account = ?)) "
            "  AND timestamp IS NOT NULL "
            "ORDER BY timestamp LIMIT ?",
            [
                bank, account, bank, account,
                bank, account, bank, account,
                limit + 1,
            ],
        ).fetchall()

    truncated = len(rows) > limit
    rows = rows[:limit]

    if not rows:
        return EntityTimelineView(node=node)

    stamps = [row[1] for row in rows if row[1] is not None]
    first = min(stamps)
    last = max(stamps)

    events: list[EntityEventView] = []

    for tx_id, stamp, direction, counterparty, amount, currency, payment_format, labelled in rows:
        day = 1 if stamp is None else int((stamp - first).days) + 1
        cash = str(payment_format or "").lower() in {"cash", "atm"}

        events.append(EntityEventView(
            tx_id=int(tx_id),
            at=stamp.isoformat() if stamp is not None else "",
            day=max(day, 1),
            # Lanes the UI already draws: money arriving is a deposit, money leaving is
            # a wire. `cash` distinguishes the channel within those lanes.
            kind="deposit" if direction == "in" else "wire",
            channel="cash" if cash else "electronic",
            direction=str(direction),
            counterparty=str(counterparty),
            amount=_float(amount),
            currency=str(currency or ""),
            payment_format=str(payment_format or ""),
            labelled=bool(labelled),
        ))

    return EntityTimelineView(
        node=node,
        first_seen=first.isoformat(),
        last_seen=last.isoformat(),
        span_days=int((last - first).days) + 1,
        events=events,
        truncated=truncated,
    )
