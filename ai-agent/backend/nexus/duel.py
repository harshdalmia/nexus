"""The Hypothesis Duel — every evidence record re-scores all hypotheses.

The one rule (design §7.8):
  family in fingerprint & direction matches  -> score += importance * strength
  family in fingerprint & direction clashes  -> score -= importance * strength
  family absent from fingerprint             -> neutral (no change)

Subtracting on mismatch is the false-positive killer: contradicting evidence actively
demolishes the wrong theory instead of merely failing to support it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .schemas import EvidenceRecord, Hypothesis

# Normalized-score label bands (design §8.4).
_STRONG = 0.66
_MODERATE = 0.33
_WEAK = 0.10
_CONTRADICTED = -0.50


@dataclass
class HypothesisScore:
    id: str
    label: str
    kind: str
    raw: float
    normalized: float
    band: str
    matched: list[str] = field(default_factory=list)
    contradicted: list[str] = field(default_factory=list)

    @property
    def observed_count(self) -> int:
        """How many fingerprint families this hypothesis actually saw evidence for."""
        return len(self.matched) + len(self.contradicted)


def _band(normalized: float) -> str:
    if normalized >= _STRONG:
        return "strong"
    if normalized >= _MODERATE:
        return "moderate"
    if normalized >= _WEAK:
        return "weak"
    if normalized > -_WEAK:
        return "neutral"
    if normalized > _CONTRADICTED:
        return "weakened"
    return "contradicted"


def score_one(hyp: Hypothesis, records: list[EvidenceRecord]) -> HypothesisScore:
    raw = 0.0
    matched: list[str] = []
    contradicted: list[str] = []
    observed: set[str] = set()
    for r in records:
        fe = hyp.fingerprint.get(r.family)
        if fe is None:
            continue  # neutral
        observed.add(r.family)
        delta = fe.importance * r.strength
        if fe.expects == r.direction:
            raw += delta
            matched.append(r.family)
        else:
            raw -= delta
            contradicted.append(r.family)
    # Normalize by the importances of families actually OBSERVED, so extending a
    # fingerprint with new families never dilutes a score when they aren't tested.
    denom = sum(hyp.fingerprint[f].importance for f in observed)
    normalized = raw / denom if denom else 0.0
    return HypothesisScore(
        id=hyp.id, label=hyp.label, kind=hyp.kind, raw=round(raw, 4),
        normalized=round(normalized, 4), band=_band(normalized),
        matched=matched, contradicted=contradicted,
    )


def score_all(
    hypotheses: list[Hypothesis], records: list[EvidenceRecord]
) -> list[HypothesisScore]:
    """Score every hypothesis, returned sorted by normalized score (winner first)."""
    scores = [score_one(h, records) for h in hypotheses]
    scores.sort(key=lambda s: s.normalized, reverse=True)
    return scores


def winner(scores: list[HypothesisScore]) -> HypothesisScore:
    return scores[0]


def is_indeterminate(scores: list[HypothesisScore]) -> bool:
    """True when the evidence does not separate the theories.

    Without this guard, an all-zero scoreboard (no evidence, or nothing discriminating)
    would let the stable sort hand victory to whichever hypothesis is first in the library
    — labelling an unknown/inactive account 'suspicious' by accident.
    """
    if not scores:
        return True
    if all(s.observed_count == 0 for s in scores):
        return True
    # Nothing rose above the neutral band -> no theory is actually supported.
    return max(s.normalized for s in scores) < _WEAK


def verdict(scores: list[HypothesisScore]) -> tuple[HypothesisScore | None, str]:
    """Return (winning_score_or_None, kind) where kind is suspicious/benign/indeterminate."""
    if is_indeterminate(scores):
        return (scores[0] if scores else None), "indeterminate"
    top = scores[0]
    return top, top.kind


# Confidence band cutoffs: (minimum margin, minimum corroborating families, band).
_CONFIDENCE_BANDS: tuple[tuple[float, int, str], ...] = (
    (0.9, 3, "high"),
    (0.5, 2, "strong"),
    (0.25, 0, "moderate"),
)


@dataclass(frozen=True)
class Confidence:
    """How separated the winner was, and on how much corroboration.

    `band` is what the pipeline has always returned. `margin` and `corroborating` are the two
    quantities the band was already computed from, now published rather than thrown away —
    a UI that wants a numeric confidence readout should use the margin, because it is a real
    measurement, where a 0-1 "confidence score" would be a manufactured one.

    Read the margin as a statement about HYPOTHESIS SEPARATION, not about evidence quality:
    a large margin means the runner-up was clearly worse, which is not the same as the winner
    being well corroborated. `corroborating` is the count that speaks to that, and it is why
    the `high` band demands three families rather than a wide margin alone.
    """

    band: str
    margin: float
    corroborating: int
    winner_id: str = ""
    runner_up_id: str | None = None
    runner_up_normalized: float | None = None


def confidence_detail(scores: list[HypothesisScore]) -> Confidence:
    """Confidence band plus the two numbers it is derived from."""
    if not scores:
        return Confidence(band="weak", margin=0.0, corroborating=0)

    top = scores[0]
    runner_up = scores[1] if len(scores) > 1 else None
    # With a single hypothesis there is no runner-up, so -1.0 stands in for "nothing else was
    # even in contention" — the same convention the band cutoffs were calibrated against.
    baseline = runner_up.normalized if runner_up is not None else -1.0
    margin = top.normalized - baseline
    corroborating = len(top.matched)

    band = "weak"
    for min_margin, min_families, name in _CONFIDENCE_BANDS:
        if margin >= min_margin and corroborating >= min_families:
            band = name
            break

    return Confidence(
        band=band,
        margin=round(margin, 4),
        corroborating=corroborating,
        winner_id=top.id,
        runner_up_id=runner_up.id if runner_up is not None else None,
        runner_up_normalized=(
            round(runner_up.normalized, 4) if runner_up is not None else None
        ),
    )


def confidence(scores: list[HypothesisScore]) -> str:
    """Confidence level (not a fake probability): from margin + corroboration.

    Uses the gap between the top two hypotheses and how many families corroborate the
    winner. Returns weak / moderate / strong / high.
    """
    return confidence_detail(scores).band
