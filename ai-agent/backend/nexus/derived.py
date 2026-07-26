"""Derived presentation series: money flow, activity timeline, volume buckets, distributions.

These are datasets the UI can draw but nothing produced. They live here rather than in
`charts.py` on purpose: that module holds a hard invariant — it copies numbers and never
computes them, with `round(x, 2)` as the only arithmetic it is allowed — and that invariant is
what lets the proof-carrying claim extend to the visuals. Putting a `GROUP BY` inside it would
quietly break the guarantee, so the aggregation happens here and `charts.py` keeps copying.

Everything here is descriptive. Nothing scores, ranks or decides, and no held-out artefact is
read. Only the twelve normalized transaction columns are touched.

RELATIONSHIP TO `api/services/analytics.py`, stated because the overlap is real and would
otherwise look accidental. That module answers *dataset* questions: population volume, the
whole screener pool, one account's full history, asked directly by the population workspaces
and served from `/analytics/*`. This module answers *run* questions, and differs in three ways
that matter:

  1. It honours the run's `FilterScope`, so a query about cash in March produces series about
     cash in March. The analytics endpoints are deliberately unfiltered.
  2. It overlays the run's own finding risk onto flow nodes rather than rescoring anything.
  3. Its output travels inside the run snapshot, so every panel in one dossier describes the
     same investigation. Fetching the analytics endpoints alongside a run could interleave a
     later dataset state with an earlier run.

If those three requirements ever stop applying, this module should be deleted and the
analytics service used directly — it is the older and more general of the two.
"""

from __future__ import annotations

import duckdb
import networkx as nx

from . import scope as scope_mod
from .graph import ego_subgraph
from .schemas import (
    CandidatePool, FilterScope, FlowGraph, FlowLink, FlowNode, RankBucket,
    ScatterPoint, TimelineEvent, VolumeBucket,
)

# Bounds, so a hub with hundreds of counterparties cannot produce an unusable payload.
_MAX_FLOW_NODES = 60
_MAX_TIMELINE_EVENTS = 200
_MAX_SCATTER_POINTS = 300
_RANK_BUCKETS = 10

# A single transaction at or above this share of the subject's inbound total is worth
# emphasising in the flow diagram.
_MAJOR_LINK_SHARE = 0.15


def _split(node: str) -> tuple[str, str]:
    bank, acct = node.split("|", 1)
    return bank, acct


# --------------------------------------------------------------------------- money flow


def flow_graph(
    con: duckdb.DuckDBPyConnection,
    center: str,
    depth: int = 1,
    scope: FilterScope | None = None,
    risk_by_node: dict[str, float] | None = None,
) -> FlowGraph:
    """Staged node/link lists for a Sankey-style money-flow diagram.

    `column` is the layer a node belongs to, derived from its shortest hop distance to the
    subject: negative upstream, 0 for the subject, positive downstream. That is a real
    property of the ego graph rather than a layout guess, so two renderers will agree.
    """
    graph = ego_subgraph(con, center, depth=depth, scope=scope)
    risk_by_node = risk_by_node or {}

    # Hop distance measured on the undirected view, then signed by direction of flow.
    undirected = graph.to_undirected(as_view=True)
    try:
        hops = nx.single_source_shortest_path_length(undirected, center, cutoff=depth + 1)
    except Exception:  # pragma: no cover - center is always in the graph
        hops = {center: 0}

    edge_totals: dict[tuple[str, str], tuple[float, int, list[int]]] = {}
    for src, dst, data in graph.edges(data=True):
        key = (src, dst)
        amount = float(data.get("amount_base") or 0.0)
        total, count, tx_ids = edge_totals.get(key, (0.0, 0, []))
        tx_id = data.get("tx_id")
        if tx_id is not None and len(tx_ids) < 25:
            tx_ids.append(int(tx_id))
        edge_totals[key] = (total + amount, count + 1, tx_ids)

    inbound_total = sum(
        total for (_, dst), (total, _, _) in edge_totals.items() if dst == center
    )

    def _column(node: str) -> int:
        distance = hops.get(node, depth + 1)
        if node == center:
            return 0
        # Downstream if the subject can reach it, upstream otherwise.
        return distance if nx.has_path(graph, center, node) else -distance

    # Keep the subject plus its highest-value counterparties.
    weight_by_node: dict[str, float] = {}
    for (src, dst), (total, _, _) in edge_totals.items():
        weight_by_node[src] = weight_by_node.get(src, 0.0) + total
        weight_by_node[dst] = weight_by_node.get(dst, 0.0) + total
    ordered = sorted(
        weight_by_node,
        key=lambda node: (0 if node == center else 1, -weight_by_node.get(node, 0.0), node),
    )
    kept = set(ordered[:_MAX_FLOW_NODES]) | {center}

    nodes = [
        FlowNode(
            id=node,
            label=node,
            column=_column(node),
            value=round(weight_by_node.get(node, 0.0), 2),
            risk=risk_by_node.get(node),
            role=(
                "subject" if node == center
                else "payer" if _column(node) < 0
                else "beneficiary"
            ),
        )
        for node in sorted(kept, key=lambda n: (_column(n), n))
    ]

    links: list[FlowLink] = []
    for (src, dst), (total, count, tx_ids) in sorted(edge_totals.items()):
        if src not in kept or dst not in kept:
            continue
        share = (total / inbound_total) if inbound_total > 0 else 0.0
        links.append(FlowLink(
            source=src, target=dst, value=round(total, 2), tx_count=count,
            tx_ids=tx_ids,
            severity="review" if share >= _MAJOR_LINK_SHARE else "clear",
        ))

    return FlowGraph(
        center=center,
        depth=depth,
        nodes=nodes,
        links=links,
        truncated=len(weight_by_node) > len(kept),
        scope_active=scope_mod.is_active(scope),
    )


# ------------------------------------------------------------------------------ timeline


def timeline(
    con: duckdb.DuckDBPyConnection,
    nodes: list[str],
    scope: FilterScope | None = None,
) -> list[TimelineEvent]:
    """Dated transaction events for one or more accounts, oldest first.

    Severity marks direction, not risk: `review` for money arriving at a subject account,
    `clear` for money leaving. The engine scores accounts, not transactions, so nothing here
    claims a per-transaction risk.
    """
    if not nodes:
        return []

    pairs = ", ".join(["(?, ?)"] * len(nodes))
    params: list = []
    for node in nodes:
        bank, acct = _split(node)
        params.extend([bank, acct])

    clause, scope_params = scope_mod.where(
        scope,
        f"((to_bank, receiver_account) IN ({pairs}) OR (from_bank, sender_account) "
        f"IN ({pairs}))",
    )
    rows = con.execute(
        f"""
        SELECT tx_id, timestamp,
               from_bank || '|' || sender_account AS src,
               to_bank || '|' || receiver_account AS dst,
               amount_base, payment_format, payment_currency
        FROM transactions {clause}
        ORDER BY timestamp NULLS LAST, tx_id
        LIMIT {_MAX_TIMELINE_EVENTS}
        """,
        params + params + scope_params,
    ).fetchall()

    subjects = set(nodes)
    events: list[TimelineEvent] = []
    for tx_id, ts, src, dst, amount, fmt, ccy in rows:
        inbound = dst in subjects
        events.append(TimelineEvent(
            at=ts,
            tx_id=int(tx_id),
            kind="inbound" if inbound else "outbound",
            label=f"{fmt} {'from' if inbound else 'to'} {src if inbound else dst}",
            detail=f"{float(amount or 0.0):,.2f} base currency, paid in {ccy}",
            amount=round(float(amount or 0.0), 2),
            counterparty=src if inbound else dst,
            payment_format=str(fmt),
            severity="review" if inbound else "clear",
        ))
    return events


# ------------------------------------------------------------------------ volume series


def volume_series(
    con: duckdb.DuckDBPyConnection,
    nodes: list[str] | None = None,
    scope: FilterScope | None = None,
    grain: str = "day",
) -> list[VolumeBucket]:
    """Transaction count and value per time bucket. `grain` is day, week or month."""
    unit = {"day": "day", "week": "week", "month": "month"}.get(grain, "day")

    clauses: list[str] = []
    params: list = []
    if nodes:
        pairs = ", ".join(["(?, ?)"] * len(nodes))
        for node in nodes:
            bank, acct = _split(node)
            params.extend([bank, acct])
        params = params + list(params)
        clauses.append(
            f"((to_bank, receiver_account) IN ({pairs}) OR (from_bank, sender_account) "
            f"IN ({pairs}))"
        )
    clauses.append("timestamp IS NOT NULL")

    clause, scope_params = scope_mod.where(scope, *clauses)
    rows = con.execute(
        f"""
        SELECT DATE_TRUNC('{unit}', timestamp) AS bucket,
               COUNT(*) AS n,
               COALESCE(SUM(amount_base), 0.0) AS value
        FROM transactions {clause}
        GROUP BY 1 ORDER BY 1
        """,
        params + scope_params,
    ).fetchall()

    return [
        VolumeBucket(
            bucket=bucket, grain=unit, count=int(n), value=round(float(value or 0.0), 2)
        )
        for bucket, n, value in rows
    ]


# ---------------------------------------------------- screening rank distribution/scatter


def rank_distribution(pool: CandidatePool | None) -> list[RankBucket]:
    """Histogram of the screener's composite rank across the candidate pool.

    Named for what it is. This is a SCREENING RANK distribution, not a risk distribution:
    only the small number of accounts that reached the expensive stage ever receive a risk
    score, so a "risk distribution" over the pool would be a fabrication.
    """
    if pool is None or not pool.candidates:
        return []

    width = 1.0 / _RANK_BUCKETS
    counts = [0] * _RANK_BUCKETS
    for candidate in pool.candidates:
        index = min(int(candidate.rank / width), _RANK_BUCKETS - 1)
        counts[max(index, 0)] += 1

    return [
        RankBucket(
            band=f"{index * width:.1f}-{(index + 1) * width:.1f}",
            min_rank=round(index * width, 4),
            max_rank=round((index + 1) * width, 4),
            count=count,
        )
        for index, count in enumerate(counts)
    ]


def candidate_scatter(
    pool: CandidatePool | None,
    x: str = "in_degree",
    y: str = "velocity",
) -> list[ScatterPoint]:
    """Two-feature projection of the candidate pool, sized by composite rank.

    Uses the feature snapshot the screener already stored on each candidate, so this is a
    reshape rather than a computation, and no dimensionality reduction is implied.
    """
    if pool is None or not pool.candidates:
        return []
    out: list[ScatterPoint] = []
    for candidate in pool.candidates[:_MAX_SCATTER_POINTS]:
        features = candidate.features
        if x not in features or y not in features:
            continue
        out.append(ScatterPoint(
            id=candidate.node,
            x=round(float(features[x]), 4),
            y=round(float(features[y]), 4),
            size=round(candidate.rank, 4),
            x_feature=x,
            y_feature=y,
        ))
    return out
