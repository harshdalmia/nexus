"""Report_Builder — a draft narrative report assembled from a finished run.

Every paragraph is composed from what the run already produced, and every paragraph names its
sources: an evidence claim with the transaction ids behind it, a tool that ran, or a declared
engine parameter. Nothing is invented here, and no number is computed here — contributions come
from `risk.risk_score`, the split between scoring and context evidence comes from `families`,
and amounts come from `subject.summarize`.

Two deliberate refusals:

* **It is a draft, never a filing.** `filed` is always False and `readiness` records the steps
  that genuinely need a human. A generator that reported itself ready to file would be lying
  about the one thing a compliance workflow exists to guarantee.
* **It states limitations in the report itself.** The methodology section names what the engine
  does not do — no cycle detection, no per-transaction scoring, no supervised model, no
  jurisdiction data — because a filing that overstates its own method is worse than one that
  admits its scope.
"""

from __future__ import annotations

from datetime import datetime, timezone

from . import families
from . import risk as risk_mod
from .hypotheses import load_hypotheses
from .schemas import (
    Case, InvestigationSpec, Report, ReportReadiness, ReportSection, ReportSource,
    SubjectContext,
)

AVAILABLE = True

# Cap the counterparties named inline; the full lists travel in the case record.
_MAX_NAMED = 8
_MAX_SOURCE_TX = 25


def _money(value: float, currency: str) -> str:
    return f"{value:,.2f} {currency}"


def _count(value: int) -> str:
    return f"{value:,}"


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{_count(count)} {singular if count == 1 else (plural or singular + 's')}"


def _date(value) -> str:
    return value.strftime("%d %B %Y") if value is not None else "an unrecorded date"


def _named(nodes: list[str]) -> str:
    shown = nodes[:_MAX_NAMED]
    text = ", ".join(shown)
    rest = len(nodes) - len(shown)
    return f"{text} and {_count(rest)} further account(s)" if rest > 0 else text


def _removed_families(label: str) -> str:
    """Human names for a counterfactual label.

    `risk.counterfactuals` labels a single removal `-family` and the combined pair
    `-family_a-family_b`. Stripping only the leading dash left the pair as one unknown slug,
    which then printed as mangled prose, so the label is split on its own separator.
    """
    names = [part for part in label.split("-") if part]
    return " and ".join(families.label(name) for name in names)


def _evidence_source(record) -> ReportSource:
    return ReportSource(
        kind="evidence",
        ref=record.claim_id,
        detail=f"{families.label(record.family)}: {record.claim}",
        tx_count=len(record.transactions),
        tx_ids=[int(t) for t in record.transactions[:_MAX_SOURCE_TX]],
    )


# --------------------------------------------------------------------------- sections


def _subject_section(case: Case, spec: InvestigationSpec) -> ReportSection:
    body = [
        f"The subject of this report is account {case.seed}, examined under the "
        f"{case.typology} typology in response to the query \"{spec.query}\"."
    ]
    if len(case.members) > 1:
        parts = [_plural(len(case.feeders_included), "counterparty paying in",
                         "counterparties paying in")]
        if case.beneficiaries:
            parts.append(_plural(len(case.beneficiaries), "onward beneficiary",
                                 "onward beneficiaries"))
        body.append(
            f"The case covers {_plural(len(case.members), 'account')} in total: the subject "
            f"together with {' and '.join(parts)}."
        )
        if case.feeders_included:
            body.append(f"Accounts paying into the subject: {_named(case.feeders_included)}.")
        if case.beneficiaries:
            body.append(f"Accounts the subject paid: {_named(case.beneficiaries)}.")
    else:
        body.append("No connected network was attached to this subject.")

    return ReportSection(
        heading="Subject and accounts",
        body=" ".join(body),
        sources=[ReportSource(
            kind="dataset", ref=case.seed,
            detail="account identity is the (bank, account) pair as loaded from the dataset",
        )],
    )


def _activity_section(context: SubjectContext | None) -> ReportSection | None:
    if context is None:
        return None
    ccy = context.base_currency
    body: list[str] = []

    if context.inbound_count:
        body.append(
            f"The account received {_money(context.inbound_value, ccy)} across "
            f"{_plural(context.inbound_count, 'payment')} from "
            f"{_plural(context.inbound_counterparties, 'counterparty', 'counterparties')}."
        )
    else:
        body.append("No inbound payments were observed in the period examined.")

    if context.outbound_count:
        body.append(
            f"It sent {_money(context.outbound_value, ccy)} across "
            f"{_plural(context.outbound_count, 'payment')} to "
            f"{_plural(context.outbound_counterparties, 'counterparty', 'counterparties')}."
        )
    else:
        body.append("No outbound payments were observed in the period examined.")

    if context.first_seen is not None and context.last_seen is not None:
        body.append(
            f"Observed activity runs from {_date(context.first_seen)} to "
            f"{_date(context.last_seen)}"
            + (f", on {_plural(context.active_days, 'separate day')}."
               if context.active_days else ".")
        )
    if context.top_payment_format:
        body.append(
            f"The predominant payment channel was {context.top_payment_format}, accounting "
            f"for {_plural(context.top_payment_format_count, 'payment')}."
        )
    if context.scope_active and context.scope:
        applied = ", ".join(f"{k} = {v}" for k, v in context.scope.items())
        body.append(
            f"These figures describe only the filtered slice the query requested ({applied}); "
            "they are not the account's full history."
        )
    body.append(
        f"All values are normalised to {ccy} using the static rate table declared in "
        "configuration, which is an approximation and not a dealt rate."
    )

    return ReportSection(
        heading="Account activity",
        body=" ".join(body),
        sources=[ReportSource(
            kind="declaration", ref="config.FX_PER_USD",
            detail="static currency conversion table used to derive amount_base",
        )],
    )


def _basis_section(case: Case) -> ReportSection:
    scoring, _ = families.split(list(case.evidence), case.typology)
    if not scoring:
        return ReportSection(
            heading="Basis for suspicion",
            body=(
                "No evidence carrying weight under the "
                f"{case.typology} risk profile was found, so the composite risk score is "
                f"{case.risk:g} of 100. This report records the examination, not a finding "
                "of suspicion."
            ),
            sources=[],
        )

    body = [
        f"The composite risk score is {case.risk:g} of 100, placing the subject in the "
        f"{case.tier} tier. The score is an additive weighted sum, so each contribution below "
        "is exactly the number of points that family put into it."
    ]
    for item in scoring:
        body.append(
            f"{item.label.capitalize()} ({families.meaning(item.family)}): {item.claim}. "
            f"Weighted at {item.weight:g}, this contributed {item.contribution:g} of the "
            f"{case.risk:g} points, evidenced by "
            f"{_plural(len(item.record.transactions), 'transaction')}."
        )
    return ReportSection(
        heading="Basis for suspicion",
        body=" ".join(body),
        sources=[_evidence_source(item.record) for item in scoring],
    )


def _considered_section(case: Case, spec: InvestigationSpec) -> ReportSection:
    """What was examined and did not support the conclusion. The defensibility section."""
    _, context = families.split(list(case.evidence), case.typology)
    body: list[str] = []

    try:
        hypotheses = load_hypotheses(spec.typology)
    except KeyError:
        hypotheses = []
    if hypotheses:
        alternatives = [h.label for h in hypotheses if h.id != case.winning_hypothesis]
        if alternatives:
            body.append(
                f"The evidence was scored against {_plural(len(hypotheses), 'competing '
                'explanation')}, not against a single hypothesis. The alternatives "
                f"considered and not selected were: {', '.join(alternatives)}."
            )

    if context:
        body.append(
            "The following measurements were taken and did not contribute to the score:"
        )
        for item in context:
            body.append(
                f"{item.label.capitalize()}: {item.claim}"
                + (f" ({item.note})." if item.note else ".")
            )
    else:
        body.append("Every measurement taken carried weight under this typology's profile.")

    if case.confidence_margin is not None:
        body.append(
            f"Confidence is recorded as {case.confidence}, derived from a "
            f"{case.confidence_margin:g} normalised-score margin over the next-best "
            f"explanation and "
            f"{_plural(case.corroborating_families, 'corroborating evidence family',
                       'corroborating evidence families')}. The margin measures separation "
            "between explanations; it is not a probability that the conclusion is correct."
        )

    return ReportSection(
        heading="Alternatives considered",
        body=" ".join(body),
        sources=[_evidence_source(item.record) for item in context],
    )


def _exclusions_section(case: Case) -> ReportSection | None:
    if not case.excluded:
        return None
    total = len(case.feeders_included) + len(case.excluded)
    reasons = sorted({reason for _, reason in case.excluded})
    excluded_count = len(case.excluded)
    body = [
        f"{_count(excluded_count)} of {_count(total)} counterparties connected to the "
        f"subject {'was' if excluded_count == 1 else 'were'} examined and deliberately "
        "excluded from the case rather than being swept in by association."
    ]
    body.append(
        "Exclusions were applied by rule, not by judgement: a connected counterparty joins "
        "the case only if it shows the narrow payment behaviour of a conduit account. "
        f"The recorded reasons were: {'; '.join(reasons[:_MAX_NAMED])}."
    )
    body.append(f"Excluded accounts: {_named([node for node, _ in case.excluded])}.")
    return ReportSection(
        heading="Counterparties examined and excluded",
        body=" ".join(body),
        sources=[ReportSource(
            kind="declaration", ref="casebuilder.THIN_MAX",
            detail="maximum distinct payees for a counterparty to count as conduit-like",
        )],
    )


def _methodology_section(case: Case, spec: InvestigationSpec, tools_run: list[str],
                         tools_skipped: list[tuple[str, str]]) -> ReportSection:
    weights = risk_mod.weights_for(case.typology)
    weight_text = ", ".join(
        f"{families.label(family)} {weight:g}" for family, weight in weights.items()
    )
    body = [
        "The subject was examined by a deterministic rules-and-graph engine. Tools that ran: "
        f"{', '.join(tools_run) if tools_run else 'none'}."
    ]
    if tools_skipped:
        body.append(
            "Tools deliberately not run for this query: "
            + "; ".join(f"{tool} ({reason})" for tool, reason in tools_skipped[:6])
            + "."
        )
    body.append(
        f"Risk is a weighted sum over independent evidence families ({weight_text}), scaled "
        "to 0-100, with escalation thresholds at "
        + ", ".join(
            f"{band.min_score:g} for {band.escalation}" for band in risk_mod.bands()
        )
        + "."
    )
    body.append(
        "Stated limitations. The engine scores accounts, not individual transactions, so no "
        "per-transaction risk value is reported. It measures fan-in convergence and does not "
        "perform cycle detection. It uses no supervised classifier, so no calibrated "
        "probability or feature attribution is reported; the additive contributions above are "
        "the explanation. The dataset carries no jurisdiction, entity-type or KYC "
        "information, so none is asserted. Any narrative prose produced by a language model "
        "is checked against the evidence ledger and discarded if it contains a figure that "
        "cannot be traced."
    )
    return ReportSection(
        heading="Methodology and limitations",
        body=" ".join(body),
        sources=[ReportSource(kind="tool", ref=tool, detail="executed for this subject")
                 for tool in tools_run],
    )


def _recommendation_section(case: Case, counterfactuals: list[tuple[str, float]]
                            ) -> ReportSection:
    body = [
        f"The engine recommends {case.escalation} for account {case.seed}, on a risk score "
        f"of {case.risk:g} of 100 ({case.tier} tier)."
    ]
    if case.winning_kind == "benign":
        body.append(
            "A benign explanation prevailed over the suspicious alternatives, which caps the "
            "recommendation at monitoring regardless of the raw score."
        )
    elif case.winning_kind == "indeterminate":
        body.append(
            "The evidence did not separate the competing explanations, so no conclusion is "
            "asserted and the recommendation reflects that uncertainty."
        )

    removals = [(label, score) for label, score in counterfactuals if label != "full"]
    if removals:
        body.append(
            "Sensitivity of the score to each contributing family, recomputed with that "
            "family removed: "
            + ", ".join(
                f"without {_removed_families(label)} the score would be {score:g}"
                for label, score in removals[:6]
            )
            + "."
        )
    body.append(
        "This document is a draft prepared for analyst review. It has not been reviewed, "
        "approved or filed."
    )
    return ReportSection(
        heading="Recommendation",
        body=" ".join(body),
        sources=[ReportSource(
            kind="declaration", ref="risk.TIERS",
            detail="escalation thresholds on the 0-100 composite risk scale",
        )],
    )


# -------------------------------------------------------------------------- readiness


def _readiness(case: Case, sections: list[ReportSection]) -> list[ReportReadiness]:
    """What is satisfied, what is blocked, and what only a human can do.

    `manual` is not a softer `blocked`: these are steps that SHOULD require a person, and
    reporting them as automatically satisfied is the failure mode this list exists to prevent.
    """
    evidence_sources = sum(
        1 for section in sections for source in section.sources if source.kind == "evidence"
    )
    cited_tx = sum(
        source.tx_count for section in sections for source in section.sources
    )

    items = [
        ReportReadiness(
            id="evidence-cited",
            label="Every substantive paragraph cites evidence",
            status="ok" if evidence_sources else "blocked",
            blocker=None if evidence_sources else (
                "no evidence record backs this draft, so there is nothing to file"
            ),
        ),
        ReportReadiness(
            id="transactions-attached",
            label="Cited evidence points at specific transactions",
            status="ok" if cited_tx else "blocked",
            blocker=None if cited_tx else "no transaction ids are attached to the claims",
        ),
        ReportReadiness(
            id="verdict-asserted",
            label="A verdict was actually reached",
            status="ok" if case.winning_kind != "indeterminate" else "blocked",
            blocker=None if case.winning_kind != "indeterminate" else (
                "the evidence did not separate the competing explanations"
            ),
        ),
        ReportReadiness(
            id="analyst-review",
            label="Reviewed by a named analyst",
            status="manual",
            blocker="requires a person; the engine cannot satisfy this",
        ),
        ReportReadiness(
            id="subject-contact",
            label="Subject enquiry considered and documented",
            status="manual",
            blocker="requires a person; the engine cannot satisfy this",
        ),
    ]
    return items


# ------------------------------------------------------------------------------ build


def build(
    case: Case,
    spec: InvestigationSpec,
    tools_run: list[str] | None = None,
    tools_skipped: list[tuple[str, str]] | None = None,
    counterfactuals: list[tuple[str, float]] | None = None,
    run_reference: str = "",
) -> Report:
    """Assemble the draft report for one case. Deterministic: same case, same document."""
    sections = [
        _subject_section(case, spec),
        _activity_section(case.context),
        _basis_section(case),
        _considered_section(case, spec),
        _exclusions_section(case),
        _methodology_section(case, spec, tools_run or [], tools_skipped or []),
        _recommendation_section(case, counterfactuals or []),
    ]
    present = [section for section in sections if section is not None]

    return Report(
        subject=case.seed,
        typology=case.typology,
        verdict=case.winning_kind,
        risk=case.risk,
        tier=case.tier,
        escalation=case.escalation,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        run_reference=run_reference,
        sections=present,
        readiness=_readiness(case, present),
        filed=False,
    )
