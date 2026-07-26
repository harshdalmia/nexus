"""Which claims cited which transaction.

The engine scores **accounts**, not transactions: risk is a weighted sum over an account's
evidence families. So there is no per-transaction risk value to publish, and this module
does not invent one.

What it does publish is attribution. Every `EvidenceRecord` the pipeline emits already
carries the exact `tx_ids` behind its claim — the proof-of-work. Joining those ids back to
ledger rows answers the question an analyst actually asks of a row in a case: *which claim
used this, from which evidence family, and how strong was it?* The account's own score
travels alongside, labelled as the account's.

Read-only, and derived entirely from a run already held in the run store.
"""

from __future__ import annotations

from typing import Any

from ... import risk as risk_mod
from ...schemas import NEUTRAL_FAMILIES
from ..schemas.views import (
    AttributedTransactionView,
    AttributionView,
    ClaimCitationView,
)
from ..state import EngineState
from . import transactions as tx_service
from .runs import StoredRun

# A single run cites tens of transactions, not thousands, but the cap keeps a pathological
# run from turning one request into a 5,000-row id list.
MAX_CITED_TRANSACTIONS = 500


def _weighted(family: str, typology: str) -> bool:
    """Does this family carry weight in the risk profile actually used for the run?"""
    return family in risk_mod.weights_for(typology) and family not in NEUTRAL_FAMILIES


def citation_map(result: Any) -> dict[int, list[ClaimCitationView]]:
    """tx_id -> the claims that cite it, across every finding in the run.

    Built from findings rather than the top case alone, so a row cited by a lower-ranked
    account is still explained.
    """
    typology = result.spec.typology
    out: dict[int, list[ClaimCitationView]] = {}

    for finding in result.findings:
        for record in finding.evidence:
            citation = ClaimCitationView(
                claim_id=record.claim_id,
                family=record.family,
                claim=record.claim,
                calculation=record.calculation,
                direction=record.direction,
                strength=round(record.strength, 4),
                weighted=_weighted(record.family, typology),
                node=finding.node,
                tx_count=len(record.transactions),
            )

            for tx_id in record.transactions:
                out.setdefault(int(tx_id), []).append(citation)

    return out


def _account_index(result: Any) -> dict[str, tuple[float, str]]:
    return {finding.node: (finding.risk, finding.tier) for finding in result.findings}


def annotate(
    engine: EngineState, run: StoredRun, limit: int = MAX_CITED_TRANSACTIONS
) -> AttributionView:
    """Every cited transaction in a run, as a ledger row plus its citing claims."""
    result = run.result
    citations = citation_map(result)
    accounts = _account_index(result)

    claim_count = sum(len(finding.evidence) for finding in result.findings)
    cited = sorted(citations)
    truncated = len(cited) > limit
    rows = tx_service.by_ids(engine, cited[:limit])
    by_id = {row.tx_id: row for row in rows}

    annotated: list[AttributedTransactionView] = []

    for tx_id in cited[:limit]:
        row = by_id.get(tx_id)

        if row is None:
            # A cited id that no longer resolves would be a data-integrity problem, not
            # something to paper over: skip it and let the count disclose the gap.
            continue

        claims = citations[tx_id]
        weighted_strengths = [claim.strength for claim in claims if claim.weighted]
        owner = claims[0].node
        risk, tier = accounts.get(owner, (None, None))

        annotated.append(AttributedTransactionView(
            transaction=row,
            citations=claims,
            families=sorted({claim.family for claim in claims}),
            peak_strength=round(max(weighted_strengths), 4) if weighted_strengths else None,
            account=owner,
            account_risk=risk,
            account_tier=tier,
        ))

    # Strongest evidence first: that is the order an analyst reads a case in.
    annotated.sort(key=lambda item: (-(item.peak_strength or 0.0), item.transaction.tx_id))

    return AttributionView(
        run_id=run.run_id,
        case_id=run.case_id,
        query=run.query,
        typology=result.spec.typology,
        cited_transactions=len(citations),
        claims=claim_count,
        published_transactions=len(annotated),
        rows=annotated,
        note=(
            "Attribution, not per-transaction scoring: the engine scores accounts, so "
            "`account_risk` belongs to the account a claim was made about. Only "
            "transactions an evidence record cites appear here"
            + (f"; capped at {limit}." if truncated else ".")
        ),
    )
