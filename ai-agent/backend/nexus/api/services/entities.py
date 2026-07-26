"""Entity profile and entity-graph payloads.

Both read existing pipeline output: the profile table built at warmup, and
`nexus.graph.ego_subgraph`, which is the same traversal the graph_motif tool uses. The
service serialises the returned NetworkX graph into nodes/edges/clusters — the pipeline
never emitted JSON for it — and computes no new analytics. No layout is produced: the
frontend runs its own dagre pass.
"""

from __future__ import annotations

import math
from typing import Any

import pandas as pd

from ... import graph as graph_mod
from ..core.config import api_settings
from ..errors import ApiError
from ..schemas.views import (
    EntityProfileView,
    GraphClusterView,
    GraphEdgeView,
    GraphNodeView,
    GraphView,
)
from ..state import EngineState


def _clean(value: Any) -> Any:
    """DuckDB/pandas give back NaN and NaT; JSON does not have either."""
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    if value is pd.NaT:
        return None
    return value


def _num(row: pd.Series, column: str, default: float = 0.0) -> float:
    value = _clean(row.get(column))
    return float(value) if value is not None else default


def require_node(engine: EngineState, node: str) -> None:
    if not engine.has_node(node):
        raise ApiError(
            404, "ACCOUNT_NOT_FOUND",
            f"Account {node} does not exist in {engine.settings.variant}.",
            {"node": node, "variant": engine.settings.variant},
        )


def profile(engine: EngineState, node: str) -> EntityProfileView:
    """One account's behavioural profile, straight out of the warmup profile table."""
    require_node(engine, node)
    row = engine.profiles.loc[node]
    bank, _, account = node.partition("|")

    entity_id = None
    entity_name = None
    dataset = engine.ds
    mapping = getattr(dataset, "account_to_entity", None) or {}
    entity_id = mapping.get((bank, account))
    if entity_id is not None:
        for account_record in getattr(dataset, "accounts", []) or []:
            if account_record.entity_id == entity_id:
                entity_name = account_record.entity_name
                break

    return EntityProfileView(
        node=node,
        bank=bank,
        account=account,
        entity_id=entity_id,
        entity_name=entity_name,
        in_count=int(_num(row, "in_count")),
        out_count=int(_num(row, "out_count")),
        in_sum=round(_num(row, "in_sum"), 2),
        out_sum=round(_num(row, "out_sum"), 2),
        in_degree=int(_num(row, "in_degree")),
        out_degree=int(_num(row, "out_degree")),
        txn_count=int(_num(row, "txn_count")),
        velocity=round(_num(row, "velocity"), 4),
        span_days=round(_num(row, "span_days"), 2),
        peer_cluster=(
            int(_num(row, "cluster")) if "cluster" in row.index else None
        ),
    )


def _severity(risk: float | None) -> str | None:
    if risk is None:
        return None
    if risk >= 70.0:
        return "severe"
    if risk >= 40.0:
        return "review"
    return "clear"


def ego_graph(
    engine: EngineState,
    node: str,
    depth: int,
    risk_by_node: dict[str, float] | None = None,
    roles: dict[str, str] | None = None,
) -> GraphView:
    """Serialise the bounded ego network around `node`.

    `risk_by_node` and `roles` are optional overlays from a completed run, so the graph a
    finding produced can be coloured with that finding's own numbers rather than a second
    scoring pass.
    """
    require_node(engine, node)
    settings = api_settings()
    depth = max(1, min(depth, settings.graph_depth_max))
    risk_by_node = risk_by_node or {}
    roles = roles or {}

    with engine.lock:
        subgraph = graph_mod.ego_subgraph(engine.ds.con, node, depth=depth)
        out_degree = graph_mod.out_degrees(engine.ds.con, list(subgraph.nodes))

    # Aggregate parallel edges: one API edge per (source, target) pair.
    aggregated: dict[tuple[str, str], dict[str, Any]] = {}
    for source, target, data in subgraph.edges(data=True):
        key = (source, target)
        bucket = aggregated.setdefault(
            key,
            {"weight": 0.0, "tx_ids": [], "first": None, "last": None},
        )
        amount = _clean(data.get("amount_base")) or 0.0
        bucket["weight"] += float(amount)
        tx_id = _clean(data.get("tx_id"))
        if tx_id is not None:
            bucket["tx_ids"].append(int(tx_id))
        stamp = _clean(data.get("timestamp"))
        if stamp is not None:
            text = str(stamp)
            bucket["first"] = text if bucket["first"] is None else min(bucket["first"], text)
            bucket["last"] = text if bucket["last"] is None else max(bucket["last"], text)

    values = [bucket["weight"] for bucket in aggregated.values()]
    large = max(values) * 0.5 if values else 0.0

    edges: list[GraphEdgeView] = []
    for (source, target), bucket in aggregated.items():
        weight = round(bucket["weight"], 2)
        edges.append(GraphEdgeView(
            id=f"e-{source}-{target}",
            source=source,
            target=target,
            kind="large-transfer" if large and weight >= large else "transfer",
            label=f"{weight:,.2f}",
            weight=weight,
            tx_count=len(bucket["tx_ids"]),
            tx_ids=bucket["tx_ids"][:25],
            first_seen=bucket["first"],
            last_seen=bucket["last"],
        ))

    truncated = len(subgraph.nodes) > settings.graph_node_limit
    node_ids = list(subgraph.nodes)[: settings.graph_node_limit]
    kept = set(node_ids)
    edges = [edge for edge in edges if edge.source in kept and edge.target in kept]

    nodes: list[GraphNodeView] = []
    for identifier in node_ids:
        bank, _, account = identifier.partition("|")
        in_value = sum(edge.weight for edge in edges if edge.target == identifier)
        out_value = sum(edge.weight for edge in edges if edge.source == identifier)
        in_degree = sum(1 for edge in edges if edge.target == identifier)
        profile_row = (
            engine.profiles.loc[identifier]
            if identifier in engine.profiles.index else None
        )
        risk_value = risk_by_node.get(identifier)
        role = roles.get(identifier, "center" if identifier == node else "counterparty")

        facts: list[dict[str, str]] = [
            {"label": "in / out value", "value": f"{in_value:,.2f} / {out_value:,.2f}"},
            {"label": "distinct receivers", "value": str(out_degree.get(identifier, 0))},
        ]
        if profile_row is not None:
            facts.append({
                "label": "transactions",
                "value": f"{int(_num(profile_row, 'txn_count')):,}",
            })
            facts.append({
                "label": "velocity",
                "value": f"{_num(profile_row, 'velocity'):.2f}/day",
            })

        nodes.append(GraphNodeView(
            id=identifier,
            label=account or identifier,
            bank=bank,
            account=account,
            kind=(
                "hub" if identifier == node
                else "feeder" if role == "feeder"
                else "beneficiary" if role == "beneficiary"
                else "account"
            ),
            role=role,
            hop=0 if identifier == node else 1,
            risk=risk_value,
            severity=_severity(risk_value),
            in_degree=in_degree,
            out_degree=out_degree.get(identifier, 0),
            in_value=round(in_value, 2),
            out_value=round(out_value, 2),
            entity_id=(
                getattr(engine.ds, "account_to_entity", {}) or {}
            ).get((bank, account)),
            facts=facts,
        ))

    clusters: list[GraphClusterView] = []
    for role_name in ("feeder", "beneficiary"):
        members = [item.id for item in nodes if item.role == role_name]
        if members:
            clusters.append(GraphClusterView(
                id=f"cluster-{role_name}",
                label=f"{role_name.title()}s of {node}",
                role=role_name,
                members=members,
            ))

    return GraphView(
        center=node,
        depth=depth,
        truncated=truncated,
        nodes=nodes,
        edges=edges,
        clusters=clusters,
        stats={
            "nodes": float(len(nodes)),
            "edges": float(len(edges)),
            "total_value": round(sum(edge.weight for edge in edges), 2),
            "transactions": float(sum(edge.tx_count for edge in edges)),
        },
    )


def graph_for_run(engine: EngineState, result: Any, node: str | None = None) -> GraphView:
    """The graph around a run's top finding, coloured with that run's own risk values."""
    findings = list(result.findings)
    if not findings:
        raise ApiError(
            404, "NO_FINDINGS",
            "This run flagged no account, so it has no entity graph.",
            {"reason": result.no_findings_reason},
        )

    target = node or findings[0].node
    match = next((item for item in findings if item.node == target), None)
    if match is None:
        raise ApiError(
            404, "NODE_NOT_IN_RUN",
            f"{target} is not among this run's findings.",
            {"nodes": [item.node for item in findings]},
        )

    roles = {member: "member" for member in match.case.members}
    roles.update({feeder: "feeder" for feeder in match.case.feeders_included})
    roles.update({node_id: "beneficiary" for node_id in match.case.beneficiaries})
    roles[target] = "hub"

    return ego_graph(
        engine, target, depth=result.spec.trace_depth,
        risk_by_node={item.node: item.risk for item in findings},
        roles=roles,
    )
