"""Narrator: turn a finished Case into something an analyst can actually read.

Two paths. A deterministic template (always valid, always available) and an LLM narrator via
`llm.py`. The orchestrator tries the LLM, runs the claim validator over the result, and falls
back to the template if any number in it lacks provenance. Either way the output is
fact-checked.

Three things this module deliberately does, because the previous version did none of them and
the output was unreadable as a result:

1. **It separates evidence that set the score from evidence that did not.** A family can win
   the duel and carry zero risk weight (structuring: `peer_deviation`, importance 0.4 in the
   fingerprint, absent from the risk profile). Printing both in one flat list meant the
   largest number on the page was the one that contributed nothing. `families.split` answers
   which is which; the scoring record leads.

2. **It aggregates the exclusion list instead of enumerating it.** A real hub has dozens of
   connected-but-excluded feeders, all excluded for the same reason. The old template printed
   one sentence per feeder, so on a 35-exclusion case roughly 80% of the narrative was the
   same sentence repeated with a different account id — and the *included* feeders were never
   named at all, i.e. it listed everything it rejected and nothing it accepted.

3. **It states amounts, dates and the payment channel** when a `SubjectContext` is supplied,
   so the reader learns how much money over what period before being asked to accept a
   verdict about it.

Output is newline-structured (headline, verdict, score, then labelled evidence blocks). Any
renderer must preserve newlines — HTML collapses them, so a `<p>` needs `white-space:
pre-line` or the structure is lost and the reader sees one run-on paragraph.
"""

from __future__ import annotations

from . import families
from .hypotheses import load_hypotheses
from .schemas import Case, InvestigationSpec, SubjectContext

# Enumerate at most this many excluded counterparties before switching to a count.
_MAX_LISTED_EXCLUSIONS = 3
# Same, for the accounts pulled into the network.
_MAX_LISTED_MEMBERS = 5


def _label(typology: str, hyp_id: str) -> str:
    try:
        for h in load_hypotheses(typology):
            if h.id == hyp_id:
                return h.label
    except KeyError:
        pass
    return hyp_id


# --------------------------------------------------------------------------- formatting


def _money(value: float, currency: str) -> str:
    """Thousands-separated amount. The validator strips separators, so this stays checkable."""
    return f"{value:,.2f} {currency}"


def _count(value: int) -> str:
    return f"{value:,}"


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    """`3 payments` / `1 payment`. Narratives are read by people, not by parsers."""
    word = singular if count == 1 else (plural or f"{singular}s")
    return f"{_count(count)} {word}"


def _verb(count: int) -> str:
    return "was" if count == 1 else "were"


def _date(value) -> str:
    return value.strftime("%d %b %Y") if value is not None else "an unknown date"


def _sentence_list(items: list[str], limit: int) -> str:
    shown = items[:limit]
    text = ", ".join(shown)
    remaining = len(items) - len(shown)
    if remaining > 0:
        text += f" and {_count(remaining)} more"
    return text


def _reason_summary(excluded: list[tuple[str, str]]) -> str:
    """Collapse near-identical exclusion reasons into one phrase.

    Every reason the case builder emits has the shape "out-degree N: <explanation>". The
    numbers differ, the explanation does not, so the explanation is quoted once and the
    numbers are given as a range.
    """
    if not excluded:
        return ""
    tails: list[str] = []
    degrees: list[int] = []
    for _, reason in excluded:
        head, _, tail = reason.partition(": ")
        tails.append(tail or reason)
        digits = "".join(ch for ch in head if ch.isdigit())
        if digits:
            degrees.append(int(digits))
    explanation = max(set(tails), key=tails.count).split(":")[-1].strip()
    if degrees:
        low, high = min(degrees), max(degrees)
        span = f"{low}" if low == high else f"{low} to {high}"
        return (
            f"each of them pays {span} other counterparties, which is not how a mule "
            "account behaves"
        )
    return explanation


# ------------------------------------------------------------------------------ sections


def _headline(case: Case, spec: InvestigationSpec) -> list[str]:
    intents = ", ".join(spec.intent) or "detect"
    return [
        f"{spec.typology.title()} review of account {case.seed} "
        f"(query intent: {intents}).",
    ]


def _verdict(case: Case, spec: InvestigationSpec) -> list[str]:
    score = (
        f"Risk {case.risk:g} out of 100, {case.tier} tier. Recommended action: "
        f"{case.escalation}."
    )

    if case.winning_kind == "indeterminate":
        return [
            "Verdict: no conclusion. The evidence gathered does not separate the competing "
            "explanations, so nothing is asserted about this account.",
            score,
        ]

    label = _label(spec.typology, case.winning_hypothesis)
    if case.winning_kind == "benign":
        return [
            f"Verdict: not suspicious. A benign explanation ({label}) fits the evidence "
            f"better than any suspicious one, at {case.confidence} confidence.",
            score,
        ]

    return [
        f"Verdict: suspicious. The best-fitting explanation is {label}, at "
        f"{case.confidence} confidence.",
        score,
    ]


def _activity(context: SubjectContext | None) -> list[str]:
    if context is None:
        return []
    ccy = context.base_currency
    lines = ["Account activity"]

    if context.inbound_count:
        lines.append(
            f"  Received {_money(context.inbound_value, ccy)} across "
            f"{_plural(context.inbound_count, 'payment')} from "
            f"{_plural(context.inbound_counterparties, 'counterparty', 'counterparties')}."
        )
    else:
        lines.append("  No money came in during the period searched.")

    if context.outbound_count:
        lines.append(
            f"  Sent {_money(context.outbound_value, ccy)} across "
            f"{_plural(context.outbound_count, 'payment')} to "
            f"{_plural(context.outbound_counterparties, 'counterparty', 'counterparties')}."
        )
    else:
        lines.append("  No money left the account during the period searched.")

    if context.first_seen is not None and context.last_seen is not None:
        active = (
            f", on {_plural(context.active_days, 'separate day')}"
            if context.active_days else ""
        )
        lines.append(
            f"  Activity runs from {_date(context.first_seen)} to "
            f"{_date(context.last_seen)}{active}."
        )
    if context.top_payment_format:
        lines.append(
            f"  Most of it moved by {context.top_payment_format} "
            f"({_plural(context.top_payment_format_count, 'payment')})."
        )
    if context.scope_active and context.scope:
        applied = ", ".join(f"{k} = {v}" for k, v in context.scope.items())
        lines.append(f"  These figures cover only the filtered slice ({applied}).")
    return lines


def _evidence_sections(case: Case) -> list[str]:
    """Scoring evidence first, with its point contribution; context evidence after."""
    scoring, context = families.split(list(case.evidence), case.typology)
    lines: list[str] = []

    if scoring:
        lines.append(f"What produced the score of {case.risk:g}")
        for item in scoring:
            lines.append(f"  {item.label.capitalize()}: {item.claim}.")
            lines.append(
                f"    Worth {item.contribution:g} of the {case.risk:g} points."
            )
    else:
        lines.append("What produced the score")
        lines.append(
            "  Nothing. No suspicious-direction evidence carries weight under the "
            f"{case.typology} risk profile, which is why the score is {case.risk:g}."
        )

    if context:
        lines.append("Also examined, but it did not affect the score")
        # Grouped by reason: on the smurfing route three benign families share one reason, and
        # repeating it under each of them was three quarters of the block for no information.
        grouped: dict[str, list[str]] = {}
        for item in context:
            grouped.setdefault(item.note, []).append(
                f"  {item.label.capitalize()}: {item.claim}."
            )
        for note, claims in grouped.items():
            lines.extend(claims)
            if note:
                lines.append(f"    Reason it did not count: {note}.")
    return lines


def _network(case: Case) -> list[str]:
    if len(case.members) <= 1 and not case.excluded:
        return []

    lines = ["The network around this account"]
    if len(case.members) > 1:
        parts = [f"{_plural(len(case.feeders_included), 'mule-like feeder')}"]
        if case.beneficiaries:
            parts.append(
                f"{_plural(len(case.beneficiaries), 'beneficiary', 'beneficiaries')}"
            )
        lines.append(
            f"  {_plural(len(case.members), 'account')} form the case: the subject plus "
            f"{' and '.join(parts)}."
        )
        if case.feeders_included:
            lines.append(
                "  Paying in: "
                f"{_sentence_list(case.feeders_included, _MAX_LISTED_MEMBERS)}."
            )
        if case.beneficiaries:
            lines.append(
                "  Money left to: "
                f"{_sentence_list(case.beneficiaries, _MAX_LISTED_MEMBERS)}."
            )

    if case.excluded:
        total_feeders = len(case.feeders_included) + len(case.excluded)
        listed = [node for node, _ in case.excluded]
        lines.append(
            f"  {_count(len(case.excluded))} of {_count(total_feeders)} connected "
            f"counterparties {_verb(len(case.excluded))} deliberately left out of the case "
            f"because {_reason_summary(case.excluded)}."
        )
        lines.append(
            f"  For example {_sentence_list(listed, _MAX_LISTED_EXCLUSIONS)}. The full list "
            "is in the case record."
        )
    return lines


# ---------------------------------------------------------------------------- LLM input


def facts(
    case: Case, spec: InvestigationSpec, context: SubjectContext | None = None
) -> str:
    """Compact, bounded fact sheet the LLM must stay within.

    Bounded matters. This used to emit one line per excluded counterparty, so on a real hub
    roughly 80% of the LLM's context was the same sentence with a different account id — and
    what the model echoed back were exactly the account ids and out-degree integers the claim
    validator then rejected, silently discarding the narration.
    """
    scoring, other = families.split(list(case.evidence), case.typology)
    lines = [
        f"query_intent: {', '.join(spec.intent) or 'detect'}",
        f"typology: {spec.typology}",
        f"subject_account: {case.seed}",
        f"verdict: {case.winning_kind}",
        f"best_explanation: {_label(spec.typology, case.winning_hypothesis)}",
        f"confidence: {case.confidence}",
        f"risk: {case.risk:g} out of 100 ({case.tier} tier)",
        f"recommended_action: {case.escalation}",
    ]
    if case.winning_kind == "indeterminate":
        lines.append("IMPORTANT: indeterminate — do not assert any conclusion")

    if context is not None:
        ccy = context.base_currency
        lines.append(
            f"received: {_money(context.inbound_value, ccy)} in "
            f"{_count(context.inbound_count)} payments from "
            f"{_count(context.inbound_counterparties)} counterparties"
        )
        lines.append(
            f"sent: {_money(context.outbound_value, ccy)} in "
            f"{_count(context.outbound_count)} payments to "
            f"{_count(context.outbound_counterparties)} counterparties"
        )
        if context.first_seen is not None and context.last_seen is not None:
            lines.append(
                f"period: {_date(context.first_seen)} to {_date(context.last_seen)}"
            )
        if context.top_payment_format:
            lines.append(f"main_channel: {context.top_payment_format}")

    for item in scoring:
        lines.append(
            f"scoring_evidence[{item.label}]: {item.claim} | contributed "
            f"{item.contribution:g} of the {case.risk:g} risk points"
        )
    for item in other:
        lines.append(
            f"context_evidence[{item.label}]: {item.claim} | contributed 0 points"
            + (f" ({item.note})" if item.note else "")
        )

    lines.append(
        f"network: {_count(len(case.members))} accounts "
        f"({_count(len(case.feeders_included))} mule-like feeders, "
        f"{_count(len(case.beneficiaries))} beneficiaries)"
    )
    if case.excluded:
        total_feeders = len(case.feeders_included) + len(case.excluded)
        lines.append(
            f"excluded: {_count(len(case.excluded))} of {_count(total_feeders)} connected "
            f"counterparties, because {_reason_summary(case.excluded)}"
        )
    return "\n".join(lines)


# --------------------------------------------------------------------- template narrator


def narrate_template(
    case: Case, spec: InvestigationSpec, context: SubjectContext | None = None
) -> str:
    """Deterministic analyst-readable narrative. Newline-structured; preserve newlines."""
    blocks: list[list[str]] = [
        _headline(case, spec),
        _verdict(case, spec),
        _activity(context),
        _evidence_sections(case),
        _network(case),
    ]
    return "\n\n".join("\n".join(block) for block in blocks if block)


# ---------------------------------------------------------------------------
# Per-finding explanation. A ranked findings list needs one short reason per row, tied to
# the query intent — not one narrative for the whole run.
# ---------------------------------------------------------------------------

_MAX_EXPLANATION = 400


def finding_facts(
    case: Case, spec: InvestigationSpec, context: SubjectContext | None = None
) -> str:
    """Fact sheet for ONE finding. Same contract as `facts`, scoped to one case."""
    return facts(case, spec, context)


def explain_finding(case: Case, spec: InvestigationSpec) -> str:
    """A <=400 character reason for one flagged account, in plain English.

    Always names the risk tier, the recommended action and at least one intent term from the
    query. Names the typology and the winning explanation for suspicious/benign verdicts, and
    deliberately asserts NO conclusion when the duel was indeterminate. Where a driver is
    quoted it is a driver that actually moved the score, not merely the strongest-looking
    record.
    """
    intent = ", ".join(spec.intent) or "detect"

    verdict = f"Risk {case.risk:g} of 100, {case.tier} tier. Recommend {case.escalation}."

    if case.winning_kind == "indeterminate":
        text = (
            f"[{intent}] {case.seed}: the evidence does not separate the competing "
            f"explanations, so no conclusion is asserted. {verdict}"
        )
    elif case.winning_kind == "benign":
        label = _label(spec.typology, case.winning_hypothesis)
        text = (
            f"[{intent}] {case.seed}: a benign explanation fits best ({label}) at "
            f"{case.confidence} confidence, so this is not treated as {spec.typology}. "
            f"{verdict}"
        )
    else:
        label = _label(spec.typology, case.winning_hypothesis)
        scoring, _ = families.split(list(case.evidence), case.typology)
        driver = ""
        if scoring:
            top = scoring[0]
            driver = (
                f" Driven mainly by {top.label} "
                f"({top.contribution:g} of the {case.risk:g} points)."
            )
        text = (
            f"[{intent}] {case.seed}: best explained as {label} under the "
            f"{spec.typology} typology, at {case.confidence} confidence. {verdict}{driver}"
        )
    return text[:_MAX_EXPLANATION]
