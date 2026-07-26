"""graph_motif / path_trace — what shape is the money flow, and how convergent?

Builds a bounded subgraph around the node and measures fan-in breadth and convergence:
  fan_in      = number of distinct feeders (in-degree)
  convergence = in_degree / (in_degree + out_degree)  -> ~1 when many feeders, few exits
  strength    = 0.5 * min(1, fan_in / 6) + 0.5 * convergence
Emits `network_convergence`.

The measured shape is also returned as a `Motif`. It was previously computed and then thrown
away into the claim sentence, so any client that wanted to draw the fan-in had to parse
English to recover numbers the tool already had. One caveat worth stating plainly: this
detects fan-in / fan-out convergence only. It does NOT detect cycles, and nothing downstream
should describe it as cycle detection.
"""

from __future__ import annotations

import duckdb

from . import clamp
from ..graph import ego_subgraph
from ..ledger import EvidenceLedger
from ..schemas import EvidenceRecord, FilterScope, Motif


def measure(
    con: duckdb.DuckDBPyConnection,
    node: str,
    ledger: EvidenceLedger,
    depth: int = 1,
    scope: FilterScope | None = None,
) -> tuple[EvidenceRecord, Motif]:
    """Emit the evidence record AND hand back the structured shape behind it."""
    # Fan-in shape is slice-local: if the analyst asked about cash in March, the motif
    # should describe cash in March.
    g = ego_subgraph(con, node, depth=depth, scope=scope)
    fan_in = g.in_degree(node)
    fan_out = g.out_degree(node)
    convergence = fan_in / (fan_in + fan_out) if (fan_in + fan_out) else 0.0
    strength = clamp(0.5 * min(1.0, fan_in / 6.0) + 0.5 * convergence)

    ring_tx = [
        d["tx_id"] for _, _, d in g.in_edges(node, data=True) if "tx_id" in d
    ]

    record = ledger.add(EvidenceRecord(
        claim_id=ledger.mint_id(),
        family="network_convergence",
        claim=(
            f"{fan_in} counterparties paid into this account while it paid out to "
            f"{fan_out}, so {convergence * 100:.0f}% of its connections point inward"
        ),
        calculation="0.5*min(1, fan_in/6) + 0.5*convergence",
        value=round(convergence, 3),
        direction="high" if strength >= 0.5 else "low",
        strength=round(strength, 3),
        transactions=ring_tx,
    ))

    motif = Motif(
        kind="fan_in" if convergence >= 0.5 else "fan_out",
        node=node,
        fan_in=int(fan_in),
        fan_out=int(fan_out),
        convergence=round(convergence, 4),
        depth=depth,
        feeders=sorted(g.predecessors(node)),
        beneficiaries=sorted(g.successors(node)),
        transactions=[int(t) for t in ring_tx],
    )
    return record, motif


def run(
    con: duckdb.DuckDBPyConnection,
    node: str,
    ledger: EvidenceLedger,
    depth: int = 1,
    scope: FilterScope | None = None,
) -> EvidenceRecord:
    """Evidence-only view, for callers that do not need the structure."""
    record, _ = measure(con, node, ledger, depth=depth, scope=scope)
    return record
