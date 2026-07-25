"""Claim validator: every number in a narrative must trace back to the case.

The rule is unchanged — a figure with no provenance fails the narrative — but the set of
figures *with* provenance is now stated properly, because the previous version was rejecting
legitimate prose and the failure was silent.

What it now accepts, and why each one has provenance:

* **Thousands separators.** `74,496` and `74496` are the same measurement. The old extractor
  read `74,496` as two numbers, `74` and `496`, so any narrative that formatted a figure
  readably was guaranteed to fail.
* **Rounded forms.** A narrative saying "risk 53" where the case says `53.18` is rounding, not
  inventing. A candidate is accepted when some allowed value rounds to it *at the candidate's
  own precision*, so `53` and `53.2` both pass against `53.18` while `54` does not.
* **Weighted contributions.** `risk.risk_score` already publishes per-family contributions;
  a narrative that reports which family produced how many points is quoting the engine.
* **Descriptive subject facts.** Amounts, counterparty counts and the activity window carried
  on `Case.context`, measured by `subject.summarize`. These are handed to the validator
  explicitly rather than by relaxing what it trusts in general.

Anything else is still unsupported, and one unsupported figure still discards the whole
narration in favour of the deterministic template.
"""

from __future__ import annotations

import re
from typing import Iterable

from .risk import risk_score
from .schemas import Case
from .subject import numbers as _subject_numbers

# Thousands-grouped or plain, with an optional decimal part. Matching the group as ONE token
# is what stops "9,000" being read as 9 and 000.
_NUM = re.compile(r"\d+(?:,\d{3})*(?:\.\d+)?")
# Account identifiers are references, not quantitative claims, so they are removed first.
_NODE = re.compile(r"\d+\|[0-9A-Za-z]+")

_EPS = 1e-9


def _values(text: str) -> list[float]:
    """Every numeric token in `text`, separators removed."""
    out: list[float] = []
    for token in _NUM.findall(text):
        try:
            out.append(float(token.replace(",", "")))
        except ValueError:  # pragma: no cover - regex cannot produce this
            continue
    return out


def _precision(token: str) -> int:
    clean = token.replace(",", "")
    return len(clean.split(".", 1)[1]) if "." in clean else 0


def _allowed(case: Case) -> set[float]:
    """Every figure this case entitles a narrative to state."""
    allowed: set[float] = set()

    for record in case.evidence:
        allowed.update(_values(record.claim))
        allowed.update(_values(record.calculation))
        allowed.add(float(record.value))
        allowed.add(float(record.strength))

    allowed.add(float(case.risk))

    # System-generated exclusion reasons are trusted case facts (e.g. "out-degree 5").
    for _, reason in case.excluded:
        allowed.update(_values(reason))

    # Structural counts a narrative may cite, including the total connected counterparties
    # (included + excluded), which is the denominator of the exclusion summary.
    allowed.update(float(n) for n in (
        len(case.members),
        len(case.feeders_included),
        len(case.beneficiaries),
        len(case.excluded),
        len(case.feeders_included) + len(case.excluded),
        len(case.evidence),
    ))

    # The risk engine's own published arithmetic: the total and each family's contribution.
    result = risk_score(list(case.evidence), case.typology)
    allowed.add(float(result.score))
    allowed.update(float(v) for v in result.contributions.values())

    # Descriptive facts measured for the subject account, when they were gathered.
    allowed.update(_subject_numbers(getattr(case, "context", None)))

    allowed.update({0.0, 100.0})  # "adds no points"; risk is out of 100
    return allowed


def _supported(candidate: float, precision: int, allowed: set[float]) -> bool:
    if any(abs(candidate - value) < _EPS for value in allowed):
        return True
    # Rounding is quotation, not invention: accept when an allowed value rounds to the
    # candidate at the precision the candidate itself was written to.
    return any(abs(round(value, precision) - candidate) < _EPS for value in allowed)


def _format(candidate: float) -> str:
    text = f"{candidate:.4f}".rstrip("0").rstrip(".")
    return text or "0"


def validate(
    narrative: str, case: Case, extra: Iterable[float] = ()
) -> tuple[bool, list[str]]:
    """Return (ok, unsupported_numbers).

    `extra` admits figures measured outside the case object — used when a caller has facts
    the Case does not carry. Account identifiers are stripped before extraction because they
    are references, not quantitative claims.
    """
    allowed = _allowed(case) | {float(value) for value in extra}
    scrubbed = _NODE.sub("", narrative)

    unsupported: list[str] = []
    for token in _NUM.findall(scrubbed):
        try:
            candidate = float(token.replace(",", ""))
        except ValueError:  # pragma: no cover
            continue
        if not _supported(candidate, _precision(token), allowed):
            rendered = _format(candidate)
            if rendered not in unsupported:
                unsupported.append(rendered)
    return (len(unsupported) == 0), unsupported
