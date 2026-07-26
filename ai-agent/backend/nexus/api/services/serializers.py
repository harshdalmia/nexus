"""RunResult -> view models.

This module is deliberately dumb: it copies, labels, orders and counts. It does not
score, threshold, weight, rank or decide anything. Where the UI wants a value the
pipeline never produced, the field stays None rather than being invented.
"""

from __future__ import annotations

from typing import Any, Iterable

from ... import anomaly as anomaly_mod
from ... import families as families_mod
from ... import risk as risk_mod
from ...planner import BY_ID, ROSTER
from ...schemas import NEUTRAL_FAMILIES, EvidenceRecord, Finding
from ..schemas.views import (
    AuditView,
    ChartDatasetView,
    ChartDatumView,
    ComponentInputView,
    CostView,
    DetectionModelView,
    DetectionView,
    ModelArtifactView,
    EdaStatusView,
    EscalationRungView,
    EvidenceRecordView,
    ExecutionSummaryView,
    ExplanationView,
    FeatureCatalogView,
    FeatureView,
    FeatureContributionView,
    FindingView,
    HypothesisScoreView,
    InvestigationView,
    PlanningDecisionView,
    RecommendationView,
    RiskView,
    RosterToolView,
    RunSummaryView,
    ScoreComponentView,
    SectionView,
    SkippedToolView,
    TierBandView,
    ToolStepView,
)
from .runs import StoredRun

# Presentation-only grouping of roster tools onto the UI's execution acts. The pipeline
# has no notion of a "stage"; this is purely how the frontend lays the trace out.
TOOL_STAGE: dict[str, str] = {
    "eda_profile": "understanding",
    "candidate_screener": "selection",
    "feature_builder": "execution",
    "peer_comparison": "execution",
    "rapid_pass_through": "execution",
    "graph_motif": "execution",
    "benign_signals": "execution",
    "near_threshold": "execution",
    "isolation_forest": "execution",
}

# UI copy for each escalation band. The band itself is the pipeline's decision.
_ACTION_COPY: dict[str, str] = {
    "report": "Escalate and file a report",
    "review": "Route for human review",
    "monitor": "Keep under automated monitoring",
}


def _stage(tool: str) -> str:
    return TOOL_STAGE.get(tool, "execution")


def _label(tool: str) -> str:
    spec = BY_ID.get(tool)
    return spec.label if spec else tool


def _purpose(tool: str) -> str:
    spec = BY_ID.get(tool)
    return spec.purpose if spec else ""


def _ran_tools(result: Any) -> list[str]:
    return [entry.tool for entry in result.plan_trace if entry.status == "ran"]


def _entry(result: Any, tool: str):
    for entry in result.plan_trace:
        if entry.tool == tool:
            return entry
    return None


def _last_ran(result: Any) -> str:
    ran = _ran_tools(result)
    return ran[-1] if ran else (result.plan_trace[0].tool if result.plan_trace else "")


def _unlock(result: Any, preferred: str) -> str:
    """`preferred` if it actually ran, else the last tool that did.

    Keeps the frontend's progressive reveal honest: a section can never be gated on a
    tool the planner declined, which would leave it permanently pending.
    """
    return preferred if preferred in set(_ran_tools(result)) else _last_ran(result)


# ------------------------------------------------------------------------- roster

def roster() -> list[RosterToolView]:
    return [
        RosterToolView(
            tool=tool.id, label=tool.label, purpose=tool.purpose,
            stage=_stage(tool.id), scoring=tool.scoring,
            needs_features=tool.needs_features, traverses_graph=tool.traverses_graph,
        )
        for tool in ROSTER
    ]


# ---------------------------------------------------------------------------- steps

def steps(result: Any) -> list[ToolStepView]:
    return [
        ToolStepView(
            order=index,
            tool=entry.tool,
            label=entry.label,
            stage=_stage(entry.tool),
            status=entry.status,
            reason=entry.reason,
            duration_ms=entry.duration_ms,
            rows_in=entry.rows_in,
            rows_out=entry.rows_out,
            invocations=entry.invocations,
            filters_applied=dict(entry.filters_applied),
            filters_not_applied=list(entry.filters_not_applied),
            purpose=_purpose(entry.tool),
        )
        for index, entry in enumerate(result.plan_trace)
    ]


# -------------------------------------------------------------------------- planning

def planning(result: Any) -> list[PlanningDecisionView]:
    """The six derivations, each read back out of pipeline output — never inferred."""
    spec = result.spec
    execution = result.execution
    ran = _ran_tools(result)
    skipped = [entry for entry in result.plan_trace if entry.status != "ran"]

    intents = ", ".join(spec.intent) or "detect"
    entities = ", ".join(spec.entities) if spec.entities else "none — population query"
    filters = (
        ", ".join(f"{key} = {value}" for key, value in spec.filters.items())
        if spec.filters else "none detected"
    )

    pattern_detail = (
        f"typology '{spec.typology}' recognised; its scoring route was selected"
        if (execution is None or execution.typology_recognized)
        else f"typology '{spec.typology}' unrecognised; the default route was substituted"
    )

    order = " -> ".join(ran) if ran else "no tool reached execution"

    return [
        PlanningDecisionView(
            stage="intent_extraction", label="Intent", value=intents,
            detail=f"parsed by the {result.intent_source} intent parser",
            source=result.intent_source if result.intent_source in {"llm", "deterministic"}
            else "deterministic",
        ),
        PlanningDecisionView(
            stage="entity_extraction", label="Entities", value=entities,
            detail=(execution.entities_note if execution and execution.entities_note
                    else f"{len(spec.entities)} account entity(ies) resolved from the query"),
        ),
        PlanningDecisionView(
            stage="filter_detection", label="Filters", value=filters,
            detail=(execution.filters_note if execution and execution.filters_note
                    else f"{len(spec.filters)} filter(s) pushed into the scan predicate"),
        ),
        PlanningDecisionView(
            stage="pattern_detection", label="AML pattern", value=spec.typology,
            detail=pattern_detail,
        ),
        PlanningDecisionView(
            stage="tool_selection", label="Tools selected",
            value=f"{len(ran)} of {len(ROSTER)}",
            detail=(
                f"{len(skipped)} declined: "
                + "; ".join(f"{entry.tool} ({entry.reason})" for entry in skipped[:3])
            ) if skipped else "every roster tool was selected for this query",
        ),
        PlanningDecisionView(
            stage="execution_planning", label="Plan", value=order,
            detail=f"graph traversal depth {spec.trace_depth}",
        ),
    ]


# ------------------------------------------------------------------ execution summary

def _eda_status(result: Any) -> EdaStatusView:
    entry = _entry(result, "eda_profile")
    eda = result.eda

    if entry is None:
        return EdaStatusView(status="skipped", reason="the profiler is not in this roster")

    return EdaStatusView(
        status=entry.status,
        reason=entry.reason,
        transactions=eda.transactions if eda else None,
        accounts=eda.accounts if eda else None,
        scope_active=eda.scope_active if eda else False,
        scope=dict(eda.scope) if eda else {},
    )


def _cost(result: Any) -> CostView:
    cost = result.execution.cost
    return CostView(**cost.model_dump())


def execution_summary(run: StoredRun) -> ExecutionSummaryView:
    result = run.result
    execution = result.execution
    ran = _ran_tools(result)
    skipped = [
        SkippedToolView(tool=entry.tool, label=entry.label, reason=entry.reason)
        for entry in result.plan_trace
        if entry.status != "ran"
    ]

    return ExecutionSummaryView(
        run_id=run.run_id,
        case_id=run.case_id,
        query=execution.query,
        intent=list(execution.intent),
        intent_source=result.intent_source if result.intent_source in {"llm", "deterministic"}
        else "deterministic",
        aml_pattern=execution.typology,
        aml_pattern_recognized=execution.typology_recognized,
        entities=list(execution.entities),
        entities_note=execution.entities_note,
        filters=dict(execution.filters),
        filters_note=execution.filters_note,
        scoped_transactions=execution.scoped_transactions,
        total_transactions=execution.total_transactions,
        selected_tools=ran,
        skipped_tools=skipped,
        execution_time_ms=execution.cost.wall_clock_ms,
        investigation_summary=result.narrative,
        eda=_eda_status(result),
        cost=_cost(result),
        notes=list(execution.notes),
        findings_count=len(result.findings),
        no_findings_reason=result.no_findings_reason,
    )


# -------------------------------------------------------------------------- features

def features(result: Any) -> FeatureCatalogView:
    manifest = result.feature_manifest
    entry = _entry(result, "feature_builder")

    if manifest is None:
        return FeatureCatalogView(
            available=False,
            reason=(
                entry.reason if entry is not None
                else "the feature builder did not run for this query"
            ),
        )

    cluster = set(manifest.cluster_features)
    values = dict(manifest.values)
    return FeatureCatalogView(
        source=manifest.source,
        accounts=manifest.accounts,
        subject=manifest.subject,
        features=[
            FeatureView(
                name=definition.name,
                label=families_mod.feature_label(definition.name),
                definition=definition.definition,
                computed=True,
                used_for_clustering=definition.name in cluster,
                # What it evaluated to for the subject account, when there is one.
                value=values.get(definition.name),
                unit=definition.unit,
            )
            for definition in manifest.features
        ],
        cluster_features=list(manifest.cluster_features),
    )


# ------------------------------------------------------------------------- detection

def _anomaly_record(result: Any) -> EvidenceRecord | None:
    case = result.case
    if case is None:
        return None
    for record in case.evidence:
        if record.family == "anomaly":
            return record
    return None


def detection(result: Any) -> DetectionView:
    charts = result.charts
    case = result.case
    ran = set(_ran_tools(result))

    models: list[DetectionModelView] = []
    for tool in ROSTER:
        if tool.id not in ran:
            continue
        entry = _entry(result, tool.id)
        duration = entry.duration_ms if entry else None
        if tool.id == "isolation_forest":
            models.append(DetectionModelView(
                name=tool.label, kind="unsupervised",
                role="neutral anomaly score, outside the risk weights",
                duration_ms=duration,
            ))
        elif tool.traverses_graph:
            models.append(DetectionModelView(
                name=tool.label, kind="graph", role=tool.purpose, duration_ms=duration,
            ))
        elif tool.scoring:
            models.append(DetectionModelView(
                name=tool.label, kind="rules", role=tool.purpose, duration_ms=duration,
            ))

    scoreboard = charts.hypothesis_scoreboard if charts else None
    hypotheses = [
        HypothesisScoreView(**entry.model_dump())
        for entry in (scoreboard.entries if scoreboard and scoreboard.available else [])
    ]
    if hypotheses:
        models.append(DetectionModelView(
            name="Hypothesis duel", kind="hypothesis",
            role=f"scored {len(hypotheses)} competing explanations against the evidence",
        ))

    contributions = charts.risk_contribution if charts else None
    top = [
        FeatureContributionView(feature=entry.family, contribution=entry.contribution)
        for entry in (contributions.entries if contributions and contributions.available else [])
    ]

    anomaly = _anomaly_record(result)
    cost = result.execution.cost

    if case is None:
        return DetectionView(
            available=False,
            reason=result.no_findings_reason or "nothing was flagged for this query",
            models=models,
            threshold=_review_threshold(),
            tiers=tier_ladder(),
            artifact=model_artifact(),
            duration_ms=sum(model.duration_ms or 0.0 for model in models),
            evaluated=cost.candidate_pool_size or cost.investigated,
            flagged=0,
            excluded=cost.excluded,
            hypotheses=hypotheses,
        )

    return DetectionView(
        models=models,
        anomaly_type=case.winning_hypothesis,
        verdict_kind=case.winning_kind,
        confidence=case.confidence,
        confidence_margin=case.confidence_margin,
        corroborating_families=case.corroborating_families,
        anomaly_score=anomaly.value if anomaly else None,
        anomaly_direction=anomaly.direction if anomaly else None,
        threshold=_review_threshold(),
        tiers=tier_ladder(case.escalation),
        artifact=model_artifact(),
        duration_ms=round(sum(model.duration_ms or 0.0 for model in models), 2),
        evaluated=cost.candidate_pool_size or cost.investigated,
        flagged=cost.returned,
        excluded=cost.excluded,
        top_features=top,
        hypotheses=hypotheses,
    )


def model_artifact() -> ModelArtifactView:
    """Provenance for the persisted anomaly model, read from the artefact on disk."""
    identity = anomaly_mod.identity()
    return ModelArtifactView(
        present=identity.present,
        name=identity.name,
        kind=identity.kind,
        version=identity.version,
        trained_at=identity.trained_at,
        sha256=identity.sha256,
        bytes=identity.bytes,
        features=list(identity.features),
        psi=None,  # no drift computation exists in the pipeline
        reason=identity.reason,
    )


# ------------------------------------------------------------------------------ risk

def _inputs_for(case: Any, family: str) -> list[ComponentInputView]:
    """The evidence records that produced one component's strength."""
    return [
        ComponentInputView(
            claim_id=record.claim_id,
            claim=record.claim,
            calculation=record.calculation,
            value=record.value,
            direction=record.direction,
            strength=record.strength,
            tx_count=len(record.transactions),
        )
        for record in case.evidence
        if record.family == family
    ]


def _components(result: Any) -> list[ScoreComponentView]:
    """Weighted components, each carrying the evidence that produced it.

    Two additions over a bare weight/value/contribution triple. First `inputs`, so the
    additive score is auditable in one payload rather than by cross-referencing the evidence
    list. Second the families that were MEASURED but carry no weight for this typology: they
    shaped the verdict and contributed nothing, and omitting them is how a reader ends up
    unable to reconcile the evidence on screen with the score beside it.
    """
    case = result.case
    if case is None:
        return []

    weights = risk_mod.weights_for(case.typology)
    strengths = risk_mod.family_strengths(list(case.evidence), weights)
    contributions = (
        {entry.family: entry.contribution for entry in result.charts.risk_contribution.entries}
        if result.charts and result.charts.risk_contribution.available else {}
    )

    out: list[ScoreComponentView] = []
    for family, weight in weights.items():
        strength = strengths.get(family, 0.0)
        out.append(ScoreComponentView(
            label=family,
            family_label=families_mod.label(family),
            meaning=families_mod.meaning(family),
            weight=round(weight, 4),
            value=round(strength * 100.0, 2),
            contribution=round(contributions.get(family, 0.0), 2),
            scoring=True,
            inputs=_inputs_for(case, family),
        ))
    out.sort(key=lambda component: -component.contribution)

    # Measured-but-unweighted families, appended after the weighted ones so ordering still
    # leads with what moved the score.
    for family in sorted({record.family for record in case.evidence} - set(weights)):
        out.append(ScoreComponentView(
            label=family,
            family_label=families_mod.label(family),
            meaning=families_mod.meaning(family),
            weight=0.0,
            value=0.0,
            contribution=0.0,
            scoring=False,
            inputs=_inputs_for(case, family),
        ))
    return out


def _tier_bands() -> list[tuple[float, str, str]]:
    """Tier thresholds as declared by the risk engine, read not redefined."""
    return list(risk_mod.TIERS)


def tier_ladder(selected: str | None = None) -> list[TierBandView]:
    """The escalation ladder with each rung's score range, ascending."""
    return [
        TierBandView(
            tier=band.tier, escalation=band.escalation,
            min_score=band.min_score, max_score=band.max_score,
            selected=band.escalation == selected,
        )
        for band in risk_mod.bands()
    ]


def _review_threshold() -> float | None:
    """The lowest cutoff above plain monitoring — the point a score becomes actionable."""
    above_monitor = [
        band.min_score for band in risk_mod.bands() if band.escalation != "monitor"
    ]
    return min(above_monitor) if above_monitor else None


def _band_label(tier: str) -> str:
    bands = sorted(_tier_bands(), key=lambda item: item[0])
    for index, (threshold, name, _) in enumerate(bands):
        if name != tier:
            continue
        upper = bands[index + 1][0] - 1 if index + 1 < len(bands) else 100.0
        return f"{threshold:g}-{upper:g}"
    return ""


def _band_text(tier: str, escalation: str, score: float) -> str:
    """Band description for one case.

    The numeric range is only quoted when the case's score actually falls inside
    the tier's range. The pipeline can assign a tier the raw score alone would not
    imply — a benign winning verdict caps the tier regardless of magnitude — and
    printing "0-39" beside a score of 53 would misrepresent that decision.
    """
    label = f"{tier.upper()} - {escalation}"
    span = _band_label(tier)

    if not span:
        return label

    low, _, high = span.partition("-")
    if float(low) <= score <= float(high):
        return f"{span} - {label}"

    return f"{label} (tier set by the winning verdict, not by score alone)"


def risk(result: Any) -> RiskView:
    case = result.case
    if case is None:
        return RiskView(
            available=False,
            reason=result.no_findings_reason or "no account was flagged, so nothing was scored",
        )

    counterfactuals = (
        result.charts.counterfactual.entries
        if result.charts and result.charts.counterfactual.available else []
    )
    top = result.findings[0] if result.findings else None
    scoring, context = families_mod.split(list(case.evidence), case.typology)

    return RiskView(
        node=case.seed,
        score=case.risk,
        tier=case.tier,
        escalation=case.escalation,
        band=_band_text(case.tier, case.escalation, case.risk),
        confidence=case.confidence,
        confidence_margin=case.confidence_margin,
        corroborating_families=case.corroborating_families,
        typology=case.typology,
        reason_text=top.explanation if top else result.narrative,
        evidence=[record.claim for record in case.evidence],
        components=_components(result),
        counterfactuals=[
            {"label": entry.label, "score": entry.score} for entry in counterfactuals
        ],
        tiers=tier_ladder(case.escalation),
        # Which families actually moved the score, and which were context. The distinction is
        # load-bearing: under the structuring profile a full-strength peer deviation
        # contributes zero, so a UI that ranks evidence by strength would lead with the one
        # record that changed nothing.
        scoring_families=[line.family for line in scoring],
        context_families=[line.family for line in context],
    )


# ------------------------------------------------------------------- recommendation

def recommendation(result: Any) -> RecommendationView:
    case = result.case
    if case is None:
        return RecommendationView(
            available=False,
            reason=(
                result.no_findings_reason
                or "no risk was assigned, so no escalation was recommended"
            ),
            ladder=[
                EscalationRungView(action=action, tier=tier, band=_band_label(tier))
                for _, tier, action in sorted(_tier_bands(), key=lambda item: item[0])
            ],
        )

    top = result.findings[0] if result.findings else None
    return RecommendationView(
        action=case.escalation,
        tier=case.tier,
        risk=case.risk,
        headline=_ACTION_COPY.get(case.escalation, case.escalation),
        detail=top.explanation if top else result.narrative,
        ladder=[
            EscalationRungView(
                action=action, tier=tier, band=_band_label(tier),
                selected=action == case.escalation,
            )
            for _, tier, action in sorted(_tier_bands(), key=lambda item: item[0])
        ],
        validated=result.validated,
        unsupported=list(result.unsupported),
    )


# ------------------------------------------------------------------ findings/evidence

def _weighted(family: str, typology: str) -> bool:
    return family in risk_mod.weights_for(typology) and family not in NEUTRAL_FAMILIES


def evidence_record(record: EvidenceRecord, typology: str, tx_limit: int = 25) -> EvidenceRecordView:
    return EvidenceRecordView(
        claim_id=record.claim_id,
        family=record.family,
        claim=record.claim,
        calculation=record.calculation,
        value=record.value,
        direction=record.direction,
        strength=record.strength,
        tx_ids=[int(tx) for tx in record.transactions[:tx_limit]],
        tx_count=len(record.transactions),
        feature_version=record.feature_version,
        weighted=_weighted(record.family, typology),
    )


def finding(item: Finding) -> FindingView:
    case = item.case
    return FindingView(
        rank=item.rank,
        node=item.node,
        risk=item.risk,
        tier=item.tier,
        escalation=item.escalation,
        winning_kind=item.winning_kind,
        winning_hypothesis=item.winning_hypothesis,
        hypothesis_label=item.hypothesis_label,
        confidence=item.confidence,
        explanation=item.explanation,
        explanation_source=item.explanation_source,
        validated=item.validated,
        unsupported=list(item.unsupported),
        evidence_count=len(item.evidence),
        families=sorted({record.family for record in item.evidence}),
        members=list(case.members),
        feeders=list(case.feeders_included),
        beneficiaries=list(case.beneficiaries),
        excluded=[{"node": node, "reason": reason} for node, reason in case.excluded],
    )


def findings(result: Any) -> list[FindingView]:
    return [finding(item) for item in result.findings]


def evidence(result: Any, node: str | None = None) -> list[EvidenceRecordView]:
    typology = result.spec.typology
    if node is None:
        case = result.case
        records: Iterable[EvidenceRecord] = case.evidence if case else []
    else:
        match = next((item for item in result.findings if item.node == node), None)
        records = match.evidence if match else []
    return [evidence_record(record, typology) for record in records]


# ----------------------------------------------------------------------- explanation

def explanation(result: Any) -> ExplanationView:
    case = result.case
    if case is None:
        return ExplanationView(
            available=False,
            reason=result.no_findings_reason or "nothing was flagged, so nothing was explained",
            query=result.spec.query,
            narrative=result.narrative,
            source=result.narrator_source if result.narrator_source in {"llm", "template"}
            else "template",
        )

    return ExplanationView(
        subject=case.seed,
        query=result.spec.query,
        narrative=result.narrative,
        source=result.narrator_source if result.narrator_source in {"llm", "template"}
        else "template",
        validated=result.validated,
        unsupported=list(result.unsupported),
        evidence=[record.claim for record in case.evidence],
        components=_components(result),
        risk=case.risk,
        tier=case.tier,
        confidence=case.confidence,
    )


# --------------------------------------------------------------------------- charts

def _severity(value: float, high: float, medium: float) -> str | None:
    if value >= high:
        return "severe"
    if value >= medium:
        return "review"
    return "clear"


def _derived_charts(result: Any) -> list[ChartDatasetView]:
    """Datasets from `nexus/derived.py`: flow, timeline, volume, screening distributions.

    Each one degrades on its own: when a series is absent the dataset is returned with
    `available: false` and the reason, rather than being omitted, so the frontend can render a
    stated gap instead of silently dropping a panel.
    """
    out: list[ChartDatasetView] = []
    no_case = result.no_findings_reason or "no account was flagged, so nothing was traced"

    flow = getattr(result, "flow", None)
    out.append(ChartDatasetView(
        id="money_flow", kind="sankey", title="Money flow",
        subtitle="staged inbound and outbound value around the subject",
        unit="base_currency",
        available=flow is not None and bool(flow.links),
        reason=None if (flow is not None and flow.links) else no_case,
        source_tool="graph_motif",
        footnote=(
            "counterparty list truncated to the highest-value connections"
            if flow is not None and flow.truncated else None
        ),
        columns=["source", "target", "value", "tx_count"],
        rows=[
            {
                "source": link.source, "target": link.target,
                "value": link.value, "tx_count": link.tx_count,
            }
            for link in (flow.links if flow else [])
        ],
        data=[
            ChartDatumView(
                label=f"{link.source} -> {link.target}", value=link.value,
                severity=link.severity, note=f"{link.tx_count} transaction(s)",
            )
            for link in (flow.links if flow else [])
        ],
    ))

    events = list(getattr(result, "timeline", []) or [])
    out.append(ChartDatasetView(
        id="timeline", kind="line", title="Transaction timeline",
        subtitle="dated inbound and outbound events for the subject",
        unit="base_currency",
        available=bool(events),
        reason=None if events else no_case,
        source_tool="transaction_store",
        footnote=(
            "severity marks direction, not risk: the engine scores accounts, not transactions"
        ),
        columns=["at", "kind", "counterparty", "amount", "payment_format", "tx_id"],
        rows=[
            {
                "at": event.at.isoformat() if event.at else None,
                "kind": event.kind, "counterparty": event.counterparty,
                "amount": event.amount, "payment_format": event.payment_format,
                "tx_id": event.tx_id,
            }
            for event in events
        ],
        data=[
            ChartDatumView(
                label=event.at.isoformat() if event.at else str(event.tx_id),
                value=event.amount, severity=event.severity, note=event.label,
            )
            for event in events
        ],
    ))

    buckets = list(getattr(result, "volume", []) or [])
    out.append(ChartDatasetView(
        id="volume_series", kind="area", title="Daily activity",
        subtitle="transaction count and value per day for the subject",
        available=bool(buckets),
        reason=None if buckets else no_case,
        source_tool="transaction_store",
        columns=["bucket", "count", "value"],
        rows=[
            {
                "bucket": bucket.bucket.isoformat() if bucket.bucket else None,
                "count": bucket.count, "value": bucket.value,
            }
            for bucket in buckets
        ],
        data=[
            ChartDatumView(
                label=bucket.bucket.isoformat() if bucket.bucket else "unknown",
                value=float(bucket.count), note=f"{bucket.value:,.2f}",
            )
            for bucket in buckets
        ],
    ))

    ranks = list(getattr(result, "rank_distribution", []) or [])
    out.append(ChartDatasetView(
        id="screening_rank_distribution", kind="bars",
        title="Screening rank distribution",
        # Named honestly. Only the accounts that reached the expensive stage have a risk
        # score, so this cannot be a risk distribution.
        subtitle="candidates by composite screening rank, not by risk score",
        available=bool(ranks),
        reason=None if ranks else (
            "this query named an account directly, so no candidate pool was screened"
        ),
        source_tool="candidate_screener",
        columns=["band", "count"],
        rows=[{"band": bucket.band, "count": bucket.count} for bucket in ranks],
        data=[
            ChartDatumView(label=bucket.band, value=float(bucket.count)) for bucket in ranks
        ],
    ))

    points = list(getattr(result, "candidate_scatter", []) or [])
    out.append(ChartDatasetView(
        id="candidate_scatter", kind="scatter", title="Candidate pool",
        subtitle=(
            f"{points[0].x_feature} against {points[0].y_feature}, sized by screening rank"
            if points else "two engineered features, sized by screening rank"
        ),
        available=bool(points),
        reason=None if points else (
            "this query named an account directly, so no candidate pool was screened"
        ),
        source_tool="candidate_screener",
        columns=["id", "x", "y", "size"],
        rows=[
            {"id": point.id, "x": point.x, "y": point.y, "size": point.size}
            for point in points
        ],
        data=[
            ChartDatumView(label=point.id, value=point.size, note=f"{point.x}, {point.y}")
            for point in points
        ],
    ))

    return out


def charts(result: Any) -> list[ChartDatasetView]:
    """Every dataset the pipeline produced, as structured JSON. No rendering, no layout."""
    chart_set = result.charts
    out: list[ChartDatasetView] = []

    if chart_set is None:
        return out

    contribution = chart_set.risk_contribution
    out.append(ChartDatasetView(
        id=contribution.id, kind="hbars", title=contribution.title,
        subtitle="weighted contribution to the composite risk score",
        unit="points", available=contribution.available, reason=contribution.reason,
        source_tool="risk_engine",
        data=[
            ChartDatumView(
                label=entry.family, value=entry.contribution,
                severity=_severity(entry.contribution, 20.0, 8.0),
            )
            for entry in contribution.entries
        ],
    ))

    counterfactual = chart_set.counterfactual
    out.append(ChartDatasetView(
        id=counterfactual.id, kind="bars", title=counterfactual.title,
        subtitle="score with each evidence family removed",
        unit="risk", available=counterfactual.available, reason=counterfactual.reason,
        source_tool="risk_engine",
        data=[
            ChartDatumView(label=entry.label, value=entry.score)
            for entry in counterfactual.entries
        ],
    ))

    board = chart_set.hypothesis_scoreboard
    out.append(ChartDatasetView(
        id=board.id, kind="hbars", title=board.title,
        subtitle="normalised score per competing explanation",
        available=board.available, reason=board.reason, source_tool="detection_engine",
        data=[
            ChartDatumView(
                label=entry.label, value=entry.normalized, note=entry.band,
                severity=_severity(entry.normalized, 0.5, 0.2),
            )
            for entry in board.entries
        ],
        columns=["hypothesis", "kind", "normalized", "band", "matched", "contradicted"],
        rows=[
            {
                "hypothesis": entry.label, "kind": entry.kind,
                "normalized": entry.normalized, "band": entry.band,
                "matched": ", ".join(entry.matched),
                "contradicted": ", ".join(entry.contradicted),
            }
            for entry in board.entries
        ],
    ))

    table = chart_set.findings_table
    out.append(ChartDatasetView(
        id=table.id, kind="table", title=table.title,
        available=table.available, reason=table.reason, source_tool="risk_engine",
        columns=["node", "risk", "tier", "escalation"],
        rows=[row.model_dump() for row in table.rows],
        data=[
            ChartDatumView(
                label=row.node, value=row.risk,
                severity=_severity(row.risk, 70.0, 40.0), note=row.escalation,
            )
            for row in table.rows
        ],
    ))

    evidence_table = chart_set.evidence_table
    out.append(ChartDatasetView(
        id=evidence_table.id, kind="table", title=evidence_table.title,
        subtitle=(
            f"{evidence_table.total_records} record(s), "
            f"{evidence_table.rows_omitted} omitted"
        ) if evidence_table.available else None,
        available=evidence_table.available, reason=evidence_table.reason,
        source_tool="detection_engine",
        columns=["family", "claim", "calculation", "value", "direction", "strength"],
        rows=[row.model_dump() for row in evidence_table.rows],
        data=[
            ChartDatumView(
                label=row.family, value=row.strength, note=row.direction,
                severity="severe" if row.direction == "high" else "clear",
            )
            for row in evidence_table.rows
        ],
    ))

    profile = chart_set.data_profile
    payment = profile.payment_format
    out.append(ChartDatasetView(
        id="data_profile_payment_format", kind="donut",
        title="Payment format mix",
        subtitle="transactions in the profiled slice",
        available=profile.available and payment is not None,
        reason=profile.reason if not profile.available else (
            None if payment is not None else "the profiler reported no payment-format column"
        ),
        source_tool="eda_profile",
        data=[
            ChartDatumView(label=entry.category, value=entry.count)
            for entry in (payment.entries if payment else [])
        ],
    ))

    amounts = profile.amounts
    out.append(ChartDatasetView(
        id="data_profile_amounts", kind="table", title="Amount distribution",
        subtitle="base-currency amounts in the profiled slice",
        available=amounts is not None,
        reason=None if amounts is not None else (
            profile.reason or "the profiler produced no amount summary"
        ),
        source_tool="eda_profile",
        columns=["statistic", "value"],
        rows=[
            {"statistic": name, "value": value}
            for name, value in (
                [
                    ("count", amounts.count), ("min", amounts.min), ("median", amounts.median),
                    ("mean", amounts.mean), ("p95", amounts.p95), ("max", amounts.max),
                    ("sum", amounts.sum),
                ] if amounts else []
            )
        ],
        data=[
            ChartDatumView(label=name, value=float(value))
            for name, value in (
                [
                    ("min", amounts.min), ("median", amounts.median),
                    ("mean", amounts.mean), ("p95", amounts.p95), ("max", amounts.max),
                ] if amounts else []
            )
        ],
    ))

    out.extend(_derived_charts(result))

    # Any further distribution the profiler produced (currency, bank, ...) is emitted as
    # its own dataset rather than being dropped.
    eda = result.eda
    if eda is not None:
        for column, distribution in eda.distributions.items():
            if column == "payment_format":
                continue
            out.append(ChartDatasetView(
                id=f"data_profile_{column}", kind="donut",
                title=f"{column.replace('_', ' ').title()} mix",
                subtitle="transactions in the profiled slice",
                source_tool="eda_profile",
                footnote=(
                    f"{distribution.remainder_categories} further categories "
                    f"({distribution.remainder_count} transactions) not shown"
                ) if distribution.remainder_categories else None,
                data=[
                    ChartDatumView(label=entry.category, value=entry.count)
                    for entry in distribution.entries
                ],
            ))

    return out


# ------------------------------------------------------------------- dossier sections

def sections(result: Any) -> list[SectionView]:
    """Which sections this run can fill. Unavailable ones carry the pipeline's reason."""
    has_case = result.case is not None
    chart_set = result.charts
    out: list[SectionView] = [
        SectionView(
            id="v-exec", kind="execution-summary", title="Execution summary",
            span="full", unlock_after=_last_ran(result),
        ),
        SectionView(
            id="v-plan", kind="planning", title="Agent planning & tool selection",
            span="full", unlock_after=_ran_tools(result)[0] if _ran_tools(result) else "",
        ),
        SectionView(
            id="v-summary", kind="summary", title="Executive summary",
            span="full", unlock_after=_last_ran(result),
        ),
    ]

    feature_catalog = features(result)
    out.append(SectionView(
        id="v-features", kind="features", title="Feature engineering", span="full",
        unlock_after=_unlock(result, "feature_builder"),
        available=feature_catalog.available, reason=feature_catalog.reason,
    ))

    detection_view = detection(result)
    out.append(SectionView(
        id="v-detect", kind="detection", title="Anomaly detection", span="half",
        unlock_after=_unlock(result, "isolation_forest"),
        available=detection_view.available, reason=detection_view.reason,
    ))

    risk_view = risk(result)
    out.append(SectionView(
        id="v-risk", kind="risk-classification", title="Risk classification", span="half",
        unlock_after=_last_ran(result),
        available=risk_view.available, reason=risk_view.reason,
    ))

    for dataset in charts(result):
        if not dataset.available:
            continue

        # Tabular datasets are not dossier sections of their own. `findings_table`
        # is the flagged-accounts section below, `evidence_table` is already the
        # evidence section and the explanation's claim list, and
        # `data_profile_amounts` restates the profiled-slice figures the execution
        # summary reports. Publishing them as sections duplicated the same numbers
        # three times in one report; they remain available on /charts for clients
        # that want the raw dataset.
        if dataset.kind == "table":
            continue

        out.append(SectionView(
            id=f"v-chart-{dataset.id}", kind="chart", title=dataset.title,
            span="half",
            unlock_after=_unlock(result, dataset.source_tool or _last_ran(result)),
        ))

    if "graph_motif" in set(_ran_tools(result)):
        out.append(SectionView(
            id="v-graph", kind="graph", title="Entity connectivity", span="half",
            unlock_after="graph_motif",
        ))

    # The single tabular block in the report: one row per flagged account, with the
    # per-account evidence reachable from the row itself.
    out.append(SectionView(
        id="v-evidence", kind="evidence", title="Flagged accounts", span="full",
        unlock_after=_last_ran(result),
        available=bool(result.findings),
        reason=None if result.findings
        else (result.no_findings_reason or "no account was flagged"),
    ))
    out.append(SectionView(
        id="v-explain", kind="explanation", title="AI explanation", span="full",
        unlock_after=_last_ran(result),
    ))
    out.append(SectionView(
        id="v-reco", kind="recommendation", title="Recommendation", span="full",
        unlock_after=_last_ran(result), available=has_case,
        reason=None if has_case else (
            result.no_findings_reason or "no escalation was recommended"
        ),
    ))
    return out


# ------------------------------------------------------------------------- aggregates

def summary_stats(run: StoredRun) -> list[dict]:
    """The four headline numbers, all copied from pipeline output."""
    result = run.result
    case = result.case
    cost = result.execution.cost
    ran = len(_ran_tools(result))

    stats: list[dict] = []
    if case is not None:
        stats.append({
            "label": "risk score", "value": f"{case.risk:g} / 100",
            "severity": "severe" if case.tier == "high"
            else "review" if case.tier == "medium" else "clear",
        })
    stats.append({"label": "accounts flagged", "value": str(len(result.findings))})
    stats.append({
        "label": "tools used", "value": f"{ran} / {len(ROSTER)}", "severity": "clear",
    })
    stats.append({
        "label": "latency", "value": f"{cost.wall_clock_ms / 1000:.1f}s",
        "severity": "clear" if cost.within_budget else "review",
    })
    return stats


def headline(result: Any) -> str:
    count = len(result.findings)
    if count == 0:
        return "No account was flagged"
    if count == 1:
        finding_item = result.findings[0]
        return f"{finding_item.node} flagged at risk {finding_item.risk:g}"
    return f"{count} accounts flagged"


def investigation(run: StoredRun) -> InvestigationView:
    result = run.result
    return InvestigationView(
        run_id=run.run_id,
        case_id=run.case_id,
        created_at=run.created_at,
        variant=run.variant,
        query=run.query,
        duration_ms=run.duration_ms,
        execution=execution_summary(run),
        planning=planning(result),
        steps=steps(result),
        features=features(result),
        detection=detection(result),
        risk=risk(result),
        explanation=explanation(result),
        recommendation=recommendation(result),
        findings=findings(result),
        evidence=evidence(result),
        charts=charts(result),
        sections=sections(result),
        summary_stats=summary_stats(run),
        headline=headline(result),
        no_findings_reason=result.no_findings_reason,
    )


def run_summary(run: StoredRun) -> RunSummaryView:
    result = run.result
    case = result.case
    return RunSummaryView(
        run_id=run.run_id,
        case_id=run.case_id,
        query=run.query,
        created_at=run.created_at,
        variant=run.variant,
        duration_ms=run.duration_ms,
        risk=case.risk if case else 0.0,
        tier=case.tier if case else None,
        escalation=case.escalation if case else None,
        findings_count=len(result.findings),
        tools_run=len(_ran_tools(result)),
        tools_skipped=len([e for e in result.plan_trace if e.status != "ran"]),
    )


# ---------------------------------------------------------------------------- audit

def audit(run: StoredRun) -> AuditView:
    result = run.result
    receipt = result.audit
    return AuditView(
        run_id=run.run_id,
        case_id=run.case_id,
        created_at=run.created_at,
        query=receipt.query,
        typology=receipt.typology,
        intent=list(receipt.intent),
        tools_run=list(receipt.tools_run),
        tools_skipped=[
            SkippedToolView(tool=tool, label=_label(tool), reason=reason)
            for tool, reason in receipt.tools_skipped
        ],
        winning_hypothesis=receipt.winning_hypothesis,
        alternatives=[
            {"id": item[0], "label": item[1], "band": item[2]}
            for item in receipt.alternatives
        ],
        risk=receipt.risk,
        escalation=receipt.escalation,
        evidence_ids=list(receipt.evidence_ids),
        narrative=receipt.narrative,
        validated=result.validated,
        unsupported=list(result.unsupported),
        intent_source=result.intent_source,
        narrator_source=result.narrator_source,
    )
