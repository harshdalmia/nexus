"""Network expansion + case compression: one seed flag -> one network case.

Flow:
  1. Run the tools on the seed and hold the duel.
  2. BENIGN GATE — if a benign theory wins, the duel gates the risk: escalation drops to
     monitor and we do NOT expand (a legitimate hub's counterparties are not scooped up).
  3. Otherwise expand the ring. EARN-YOUR-FLAG: a connected feeder joins only if it has its
     own supporting evidence (here: mule-thin, i.e. it pays almost no one but the hub). A
     salary payer / employer (high out-degree) is connected but excluded.

Two additive, keyword-only extras (Phase 6), both defaulting to today's behaviour:
  `scope`    — restrict the slice-local tools to the filters the analyst asked for.
  `recorder` — time each tool and roll its evidence back if it raises.
"""

from __future__ import annotations

from contextlib import nullcontext

import duckdb

from .config import Settings
from .duel import confidence_detail, score_all, verdict
from .graph import ego_subgraph, out_degrees
from .hypotheses import load_hypotheses
from .ledger import EvidenceLedger
from .peers import PeerModel
from .risk import risk_score
from .schemas import Case, FilterScope
from .tools import (
    benign_signals, graph_motif, isolation_forest, near_threshold, peer_comparison,
    rapid_pass_through,
)

# A feeder is "mule-thin" (earns its flag) if it sends to at most this many distinct
# receivers — i.e. it exists mostly to feed the hub. Employers/merchants pay many.
THIN_MAX = 2

# Tools whose calibration is full-history and would shift if the slice narrowed.
# peer_comparison reads a PeerModel fitted with MiniBatchKMeans over full-history profiles:
# filtering it would change the clusters, the medians and the MADs, and move the anchors.
UNFILTERED_TOOLS = ("peer_comparison", "isolation_forest", "feature_builder",
                    "candidate_screener")


def _step(recorder, tool: str, ledger: EvidenceLedger):
    """Recorder context if we have one, otherwise a no-op so behaviour is unchanged."""
    if recorder is None:
        return nullcontext(None)
    return recorder.step(tool, ledger=ledger)


def _run_tools(
    con, peers, node, typology, ledger, settings, anomaly_model, profiles,
    scope=None, recorder=None, depth: int = 1, motifs: list | None = None,
) -> None:
    """Route which sensors run based on the typology under investigation.

    `motifs` collects the structured shapes the graph tool measured, so the case can publish
    them instead of leaving them inside a claim sentence.
    """
    if typology == "structuring":
        with _step(recorder, "peer_comparison", ledger):
            peer_comparison.run(con, peers, node, ledger)
        with _step(recorder, "near_threshold", ledger) as h:
            rec = near_threshold.run(con, node, ledger, settings, scope=scope)
            if h is not None:
                h.rows(rows_out=len(rec.transactions))
        # Independent benign evidence. Without this the structuring "duel" was one record
        # voted twice: `typology_rule` supported H1 at importance 1.0 and contradicted H2 at
        # importance 1.0, so the margin between them — and therefore the reported confidence
        # band — was arithmetically fixed the moment n_near >= 2. It could read "strong"
        # while resting on a single measurement. retention/recurrence/stability are absent
        # from RISK_PROFILES["structuring"], so this adds discrimination without moving any
        # score, and no anchor is a structuring case.
        with _step(recorder, "benign_signals", ledger) as h:
            recs = benign_signals.run(con, node, ledger, scope=scope)
            if h is not None:
                h.rows(rows_out=len(recs))
    else:  # smurfing / consolidation
        with _step(recorder, "peer_comparison", ledger):
            peer_comparison.run(con, peers, node, ledger)
        with _step(recorder, "rapid_pass_through", ledger) as h:
            rec = rapid_pass_through.run(con, node, ledger, scope=scope)
            if h is not None:
                h.rows(rows_out=len(rec.transactions))
        with _step(recorder, "graph_motif", ledger) as h:
            rec, motif = graph_motif.measure(con, node, ledger, depth=depth, scope=scope)
            if motifs is not None:
                motifs.append(motif)
            if h is not None:
                h.rows(rows_out=len(rec.transactions))
        with _step(recorder, "benign_signals", ledger) as h:
            recs = benign_signals.run(con, node, ledger, scope=scope)
            if h is not None:
                h.rows(rows_out=len(recs))
        if anomaly_model is not None and profiles is not None:
            with _step(recorder, "isolation_forest", ledger):
                isolation_forest.run(con, anomaly_model, node, profiles, ledger)


def investigate(
    con: duckdb.DuckDBPyConnection,
    peers: PeerModel,
    seed: str,
    typology: str = "smurfing",
    trace_depth: int = 1,
    settings: Settings | None = None,
    anomaly_model=None,
    profiles=None,
    *,
    scope: FilterScope | None = None,
    recorder=None,
) -> Case:
    settings = settings or Settings()
    ledger = EvidenceLedger()
    motifs: list = []
    _run_tools(
        con, peers, seed, typology, ledger, settings, anomaly_model, profiles,
        scope=scope, recorder=recorder, depth=1, motifs=motifs,
    )

    scores = score_all(load_hypotheses(typology), ledger.records)
    top, kind = verdict(scores)
    detail = confidence_detail(scores)
    conf = detail.band
    risk = risk_score(ledger.records, typology)

    # INDETERMINATE GATE: nothing separated the theories (e.g. inactive/unknown account).
    # Never assert a verdict on absent evidence.
    if kind == "indeterminate":
        return Case(
            seed=seed, typology=typology,
            winning_hypothesis=(top.id if top else ""), winning_kind="indeterminate",
            confidence="weak", risk=0.0, tier="low", escalation="monitor",
            # No verdict was asserted, so no separation is claimed for one either.
            confidence_margin=None, corroborating_families=0,
            members=[seed], evidence=ledger.records, motifs=motifs,
        )

    # BENIGN GATE: the duel gates the risk. No expansion for a legitimate hub.
    if kind == "benign":
        return Case(
            seed=seed, typology=typology, winning_hypothesis=top.id, winning_kind="benign",
            confidence=conf, risk=risk.score, tier="low", escalation="monitor",
            confidence_margin=detail.margin,
            corroborating_families=detail.corroborating,
            members=[seed], evidence=ledger.records, motifs=motifs,
        )

    # SUSPICIOUS: expand the ring with the earn-your-flag rule.
    g = ego_subgraph(con, seed, depth=trace_depth, scope=scope)
    feeders = list(g.predecessors(seed))
    # One grouped query instead of one per feeder. Deliberately UNFILTERED: the gate asks
    # about the counterparty's whole behaviour, so a salary payer still looks like one.
    degrees = out_degrees(con, feeders)
    included: list[str] = []
    excluded: list[tuple[str, str]] = []
    for feeder in feeders:
        od = degrees.get(feeder, 0)
        if od <= THIN_MAX:
            included.append(feeder)
        else:
            excluded.append((feeder, f"out-degree {od}: pays many parties, not mule-like"))

    beneficiaries = list(g.successors(seed))
    members = [seed] + included + beneficiaries

    return Case(
        seed=seed, typology=typology, winning_hypothesis=top.id, winning_kind="suspicious",
        confidence=conf, risk=risk.score, tier=risk.tier, escalation=risk.escalation,
        confidence_margin=detail.margin, corroborating_families=detail.corroborating,
        members=members, feeders_included=included, beneficiaries=beneficiaries,
        excluded=excluded, evidence=ledger.records, motifs=motifs,
    )
