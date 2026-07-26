"""The detection catalogue, read out of the engine's own declarations.

The pipeline's "rules" are its hypothesis library: each hypothesis is a fingerprint of
evidence families with an expected direction and an importance. Severity comes from the
risk engine's weight profiles, and candidate selection from the screener's rank weights.
All three are declared in code or config, so this module reads them — it never restates
them with its own numbers.

Outcome counts (how often a hypothesis won) are measured over the runs cached in this
process and labelled as such. Precision needs labelled outcomes and is left null.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ... import anomaly, risk as risk_mod, screener
from ...config import REPO_ROOT
from ...hypotheses import available_typologies, load_hypotheses
from ...schemas import NEUTRAL_FAMILIES
from ..schemas.catalogue import (
    CatalogueSummaryView,
    FamilyExpectationView,
    FeatureImportanceView,
    FeatureWeightView,
    FunnelStageView,
    FunnelView,
    HypothesisRuleView,
    MetricView,
    ModelArtifactView,
    ModelPerformanceView,
    RiskProfileView,
    ScreeningSignalView,
    TypologyOutcomeView,
    WeightedFamilyView,
)
from .runs import RunStore, StoredRun

# Where an offline eval run is expected to leave its report.
EVAL_REPORT_PATHS = (
    REPO_ROOT / "backend" / "reports" / "eval.json",
    REPO_ROOT / "reports" / "eval.json",
)

_FAMILY_NOTES = {
    "peer_deviation": "behaviour against behavioural peers (robust z)",
    "flow_through": "how fast money arrived and left",
    "network_convergence": "fan-in shape on the transaction graph",
    "temporal_coordination": "timing coordination across payers",
    "typology_rule": "deterministic typology rule (near-threshold count)",
}


def _expression(hypothesis: Any) -> str:
    """A hypothesis fingerprint as a readable predicate."""
    parts = [
        f"{family} {spec.expects}×{spec.importance:g}"
        for family, spec in sorted(hypothesis.fingerprint.items())
    ]

    return " AND ".join(parts)


def _outcome_counts(runs: list[StoredRun]) -> tuple[dict[str, int], dict[str, int]]:
    """(scored, won) per hypothesis label across cached runs."""
    scored: dict[str, int] = {}
    won: dict[str, int] = {}

    for run in runs:
        for _, label, _ in run.result.audit.alternatives:
            scored[label] = scored.get(label, 0) + 1

        winner = run.result.audit.winning_hypothesis
        if winner:
            won[winner] = won.get(winner, 0) + 1

    return scored, won


def rules(runs: list[StoredRun]) -> list[HypothesisRuleView]:
    """Every hypothesis in the library, with this session's outcomes attached."""
    scored, won = _outcome_counts(runs)
    total = max(len(runs), 1)
    out: list[HypothesisRuleView] = []

    for typology in available_typologies():
        for hypothesis in load_hypotheses(typology):
            fired = scored.get(hypothesis.label, 0)
            out.append(HypothesisRuleView(
                id=hypothesis.id,
                typology=typology,
                label=hypothesis.label,
                kind=hypothesis.kind,
                expression=_expression(hypothesis),
                families=[
                    FamilyExpectationView(
                        family=family, expects=spec.expects, importance=spec.importance,
                    )
                    for family, spec in sorted(hypothesis.fingerprint.items())
                ],
                max_score=round(hypothesis.max_score, 4),
                fired=fired,
                share_of_runs=round(fired / total, 4) if runs else 0.0,
                won=won.get(hypothesis.label, 0),
            ))

    out.sort(key=lambda rule: (rule.typology, rule.kind != "suspicious", rule.id))
    return out


def profiles() -> list[RiskProfileView]:
    """Risk weight profiles exactly as the risk engine declares them."""
    default = risk_mod.RISK_WEIGHTS
    out: list[RiskProfileView] = []

    for typology, weights in risk_mod.RISK_PROFILES.items():
        out.append(RiskProfileView(
            typology=typology,
            default=weights is default,
            families=[
                WeightedFamilyView(
                    family=family,
                    weight=round(weight, 4),
                    note=_FAMILY_NOTES.get(family, ""),
                )
                for family, weight in sorted(weights.items(), key=lambda kv: -kv[1])
            ],
        ))

    # Neutral families are declared but deliberately carry no weight; saying so is the
    # point, because it is what keeps the anomaly score from moving a score.
    out.append(RiskProfileView(
        typology="neutral (no weight by design)",
        families=[
            WeightedFamilyView(
                family=family, weight=0.0, neutral=True,
                note="reported as evidence, excluded from every weight profile",
            )
            for family in sorted(NEUTRAL_FAMILIES)
        ],
    ))
    return out


def screening(max_candidates: int) -> ScreeningSignalView:
    return ScreeningSignalView(
        weights={key: round(value, 4) for key, value in screener.RANK_WEIGHTS.items()},
        min_in_count=screener.MIN_IN_COUNT,
        min_in_degree=screener.MIN_IN_DEGREE,
        max_candidates=max_candidates,
        note=(
            "percentile-rank composite over engineered features; a recall funnel, "
            "not a precision claim"
        ),
    )


def _artifacts() -> list[ModelArtifactView]:
    present = anomaly.MODEL_PATH.is_file()

    return [
        ModelArtifactView(
            name="rule / hypothesis engine",
            kind="rules",
            role="curated fingerprints from hypotheses/library.yaml",
            available=True,
        ),
        ModelArtifactView(
            name="isolation forest",
            kind="unsupervised",
            role="neutral anomaly family, outside the risk weights",
            available=present,
            path=str(anomaly.MODEL_PATH) if present else None,
            reason=None if present else "no artifact; run scripts/train_model.py",
        ),
        ModelArtifactView(
            name="supervised classifier",
            kind="supervised",
            role="not part of this pipeline",
            available=False,
            reason="the engine scores with rules, hypotheses and novelty only",
        ),
    ]


def performance() -> ModelPerformanceView:
    """Read a persisted evaluation report; never compute metrics inside a request."""
    report_path: Path | None = next((p for p in EVAL_REPORT_PATHS if p.is_file()), None)

    if report_path is None:
        return ModelPerformanceView(
            available=False,
            reason=(
                "no evaluation report on disk. The harness is an offline job over held-out "
                "ground truth: run `python scripts/eval_report.py` and write its output to "
                "backend/reports/eval.json."
            ),
            artifacts=_artifacts(),
        )

    try:
        payload = json.loads(report_path.read_text(encoding="utf-8"))
    except Exception as exc:
        return ModelPerformanceView(
            available=False,
            reason=f"evaluation report at {report_path.name} could not be read: {exc}",
            artifacts=_artifacts(),
        )

    metrics = [
        MetricView(
            label=str(entry.get("label", "metric")),
            value=(
                float(entry["value"])
                if isinstance(entry.get("value"), (int, float)) else None
            ),
            note=entry.get("note"),
        )
        for entry in payload.get("metrics", [])
        if isinstance(entry, dict)
    ]

    return ModelPerformanceView(
        available=bool(metrics),
        reason=None if metrics else "the report contained no metrics",
        generated_at=payload.get("generated_at"),
        variant=payload.get("variant"),
        metrics=metrics,
        artifacts=_artifacts(),
    )


def feature_importance(runs: list[StoredRun]) -> FeatureImportanceView:
    """Measured family contributions across cached runs, beside the declared weights."""
    declared = [
        FeatureWeightView(
            feature=family, value=round(weight, 4), source="risk-weight",
            note=_FAMILY_NOTES.get(family, ""),
        )
        for family, weight in sorted(risk_mod.RISK_WEIGHTS.items(), key=lambda kv: -kv[1])
    ] + [
        FeatureWeightView(
            feature=feature, value=round(weight, 4), source="screener",
            note="candidate screening weight",
        )
        for feature, weight in sorted(screener.RANK_WEIGHTS.items(), key=lambda kv: -kv[1])
    ]

    totals: dict[str, float] = {}
    counted = 0

    for run in runs:
        charts = run.result.charts

        if charts is None or not charts.risk_contribution.available:
            continue

        counted += 1
        for entry in charts.risk_contribution.entries:
            totals[entry.family] = totals.get(entry.family, 0.0) + entry.contribution

    if counted == 0:
        return FeatureImportanceView(
            available=False,
            reason=(
                "no scored run in this process yet — contributions are measured from "
                "investigations, not precomputed"
            ),
            declared=declared,
        )

    measured = [
        FeatureWeightView(
            feature=family,
            value=round(total / counted, 2),
            source="measured",
            note=f"mean weighted contribution across {counted} scored run(s)",
        )
        for family, total in sorted(totals.items(), key=lambda kv: -kv[1])
    ]

    return FeatureImportanceView(runs_measured=counted, measured=measured, declared=declared)


def funnel(runs: list[StoredRun]) -> FunnelView:
    """The newest run's own cost telemetry as a screening funnel."""
    if not runs:
        return FunnelView(
            available=False,
            reason="no run in this process yet; the funnel is measured per investigation",
        )

    run = runs[0]
    cost = run.result.execution.cost
    screened = cost.candidate_pool_size or cost.candidates_eligible or cost.investigated
    reportable = sum(
        1 for finding in run.result.findings if finding.escalation == "report"
    )
    reviewable = sum(
        1 for finding in run.result.findings if finding.escalation in {"report", "review"}
    )

    stages = [
        FunnelStageView(label="screened", value=int(screened), note="candidate pool"),
        FunnelStageView(label="investigated", value=int(cost.investigated), note="full pipeline"),
        FunnelStageView(label="flagged", value=int(cost.returned), note="carried evidence"),
        FunnelStageView(label="reviewable", value=reviewable, note="review or report"),
        FunnelStageView(label="reportable", value=reportable, note="report band"),
    ]

    return FunnelView(run_id=run.run_id, query=run.query, stages=stages)


def outcomes(runs: list[StoredRun]) -> list[TypologyOutcomeView]:
    """Which explanation won, how often — this session's typology mix."""
    counts: dict[tuple[str, str, str], int] = {}

    for run in runs:
        case = run.result.case

        if case is None:
            continue

        key = (case.typology, case.winning_hypothesis, case.winning_kind)
        counts[key] = counts.get(key, 0) + 1

    return [
        TypologyOutcomeView(typology=typology, label=label, kind=kind, count=count)
        for (typology, label, kind), count in sorted(counts.items(), key=lambda kv: -kv[1])
    ]


def summary(store: RunStore, max_candidates: int) -> CatalogueSummaryView:
    runs = store.list()

    return CatalogueSummaryView(
        typologies=available_typologies(),
        rules=rules(runs),
        profiles=profiles(),
        screening=screening(max_candidates),
        performance=performance(),
        feature_importance=feature_importance(runs),
        funnel=funnel(runs),
        outcomes=outcomes(runs),
        runs_cached=len(runs),
    )
