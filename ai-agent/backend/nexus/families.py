"""Human names for evidence families, and the scoring / context split.

The pipeline speaks in slugs (`peer_deviation`, `typology_rule`, `flow_through`). An analyst
reads English. This is the one place a slug becomes a phrase, so the narrative, the API and
the report all say the same words.

The split is the more important half. A family can be load-bearing in the hypothesis duel
and carry ZERO weight in the risk profile for the same typology, because the duel decides
*which* story and the risk engine decides *how severe*. Structuring is exactly that case:
`peer_deviation` has importance 0.4 in the H1 fingerprint but no entry in
`RISK_PROFILES["structuring"]`, so an account can show a peer deviation at full strength 1.0
and still take none of its risk points from it. Presenting both records in one flat list —
which is what the narrative used to do — makes the score impossible to reconstruct: the
biggest number on the page turns out to be the one that did nothing. So every consumer asks
this module which records moved the score and which are context.

Nothing here computes a new score. Contributions are read back out of `risk.risk_score`,
which stays the only place risk arithmetic happens.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import risk as risk_mod
from .schemas import NEUTRAL_FAMILIES, EvidenceRecord

# Family slug -> the phrase an analyst reads. Every family emitted anywhere in the pipeline
# appears here; `label()` degrades gracefully for anything added later.
LABELS: dict[str, str] = {
    "peer_deviation": "peer deviation",
    "flow_through": "rapid pass-through",
    "network_convergence": "fan-in convergence",
    "temporal_coordination": "coordinated timing",
    "typology_rule": "near-threshold deposits",
    "recurrence": "recurring counterparties",
    "stability": "balance stability",
    "retention": "funds retained",
    "anomaly": "unsupervised anomaly score",
    "data_profile": "data profile",
    "feature_coverage": "feature coverage",
}

# One plain sentence per family: what it measures, for tooltips and report footnotes.
MEANINGS: dict[str, str] = {
    "peer_deviation": "how far the account sits from behaviourally similar accounts",
    "flow_through": "how quickly money that arrived was sent on again",
    "network_convergence": "how many counterparties pay in versus how many are paid out",
    "temporal_coordination": "whether inbound payments cluster together in time",
    "typology_rule": "how many inbound deposits sit just below the reporting threshold",
    "recurrence": "whether the same counterparties pay in on a repeating schedule",
    "stability": "whether the account's behaviour is steady over time",
    "retention": "whether funds stay in the account rather than passing through",
    "anomaly": "an unsupervised model's novelty score, deliberately outside the risk weights",
    "data_profile": "descriptive statistics for the slice that was searched",
    "feature_coverage": "which engineered features were available for this account",
}


# Engineered feature column -> the phrase an analyst reads. Tools quote these in their claim
# text so a claim never reads `in_sum is 3.1 robust-z`.
FEATURE_LABELS: dict[str, str] = {
    "in_count": "number of payments received",
    "in_sum": "total value received",
    "in_degree": "number of counterparties paying in",
    "out_count": "number of payments sent",
    "out_sum": "total value sent",
    "out_degree": "number of counterparties paid",
    "txn_count": "total payment count",
    "span_days": "days between first and last activity",
    "velocity": "payments per active day",
    "io_ratio": "ratio of value in to value out",
}


def label(family: str) -> str:
    """Human phrase for a family slug."""
    return LABELS.get(family, family.replace("_", " "))


def feature_label(feature: str) -> str:
    """Human phrase for an engineered feature column."""
    return FEATURE_LABELS.get(feature, feature.replace("_", " "))


def peer_set_phrase(peer_set: str, peer_count: int) -> str:
    """Describe which population an account was compared against.

    `PeerModel.deviation` reports its comparison set as a terse token (`cluster 7`,
    `global`, `global(zero-spread)`, `none`). Quoting that token verbatim left the reader to
    guess; and "cluster 0" beside a peer count in the tens of thousands deserves saying out
    loud rather than hiding, since a 74,000-member "peer group" is a weak comparison.
    """
    accounts = f"{peer_count:,} accounts"
    if peer_set.startswith("cluster"):
        return f"its behavioural peer group ({peer_set}, {accounts})"
    if peer_set == "global(zero-spread)":
        return (
            f"the whole profiled population ({accounts}), because its own peer group showed "
            "no spread to measure against"
        )
    if peer_set == "global":
        return f"the whole profiled population ({accounts})"
    return "no comparable population"


def meaning(family: str) -> str:
    return MEANINGS.get(family, "")


def is_neutral(family: str) -> bool:
    """Neutral families are excluded from every fingerprint and every risk weight."""
    return family in NEUTRAL_FAMILIES


@dataclass(frozen=True)
class EvidenceLine:
    """One evidence record, annotated with what it did to the score."""

    record: EvidenceRecord
    label: str
    weight: float          # family weight under this typology; 0.0 when unweighted
    contribution: float    # points (0-100 scale) this record put into the score
    scoring: bool          # did it move the score at all?
    note: str              # when it did not, why not

    @property
    def family(self) -> str:
        return self.record.family

    @property
    def claim(self) -> str:
        return self.record.claim


def _note_for(record: EvidenceRecord, typology: str, weighted: bool, superseded: bool) -> str:
    """Why a record contributed nothing. Phrased as a standalone clause so callers can
    prefix it without fighting the grammar."""
    if not weighted:
        if is_neutral(record.family):
            return (
                "this family is neutral by design and carries weight in no risk profile, so "
                "it is context only"
            )
        return (
            f"this family carries no weight in the {typology} risk profile, so it helped "
            "choose the explanation without adding any points"
        )
    if record.direction == "low":
        return "the signal points away from suspicion rather than towards it"
    if superseded:
        return f"a stronger {label(record.family)} record already counted for this family"
    return ""


def lines(records: list[EvidenceRecord], typology: str) -> list[EvidenceLine]:
    """Annotate every record with its actual contribution to the risk score.

    Contributions are per FAMILY (the risk engine takes the strongest suspicious record per
    family), so when two records share a family the points are attributed to the one that
    achieved the maximum and the other is marked superseded. That keeps the printed
    contributions summing to the published score.
    """
    weights = risk_mod.weights_for(typology)
    result = risk_mod.risk_score(records, typology)
    strengths = risk_mod.family_strengths(records, weights)

    # First record (in ledger order) that achieved its family's counted strength.
    counted: dict[str, str] = {}
    for record in records:
        family = record.family
        if family not in weights or record.direction != "high":
            continue
        if family in counted:
            continue
        if record.strength == strengths.get(family):
            counted[family] = record.claim_id

    out: list[EvidenceLine] = []
    for record in records:
        family = record.family
        weight = weights.get(family, 0.0)
        is_weighted = family in weights
        owns = counted.get(family) == record.claim_id
        contribution = result.contributions.get(family, 0.0) if owns else 0.0
        superseded = is_weighted and record.direction == "high" and not owns
        out.append(EvidenceLine(
            record=record,
            label=label(family),
            weight=round(weight, 4),
            contribution=round(contribution, 2),
            scoring=contribution > 0.0,
            note=_note_for(record, typology, is_weighted, superseded),
        ))
    return out


def split(
    records: list[EvidenceRecord], typology: str
) -> tuple[list[EvidenceLine], list[EvidenceLine]]:
    """(evidence that set the score, evidence that is context) — scoring lines first.

    Scoring lines are ordered by contribution descending so the load-bearing record leads,
    which is the whole point: the reader should meet the number that produced the score
    before any number that did not.
    """
    annotated = lines(records, typology)
    scoring = sorted(
        [line for line in annotated if line.scoring],
        key=lambda line: (-line.contribution, line.family),
    )
    context = [line for line in annotated if not line.scoring]
    return scoring, context
