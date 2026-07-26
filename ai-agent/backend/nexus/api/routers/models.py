"""The detection catalogue: hypotheses, risk weights, screening, model artifacts.

Everything here is a declaration the engine already carries, or an outcome measured over
the runs this process executed. No metric is computed inside a request.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ...config import Settings
from ..core.envelope import Envelope, ok
from ..deps import get_runs
from ..schemas.catalogue import (
    CatalogueSummaryView,
    FeatureImportanceView,
    FunnelView,
    HypothesisRuleView,
    ModelPerformanceView,
    RiskProfileView,
    ScreeningSignalView,
    TypologyOutcomeView,
)
from ..services import catalogue as service
from ..services.runs import RunStore

router = APIRouter(prefix="/models", tags=["models"])


@router.get(
    "",
    response_model=Envelope[CatalogueSummaryView],
    summary="Everything the models and rules view needs, in one call",
)
def catalogue_summary(runs: RunStore = Depends(get_runs)) -> dict:
    view = service.summary(runs, max_candidates=Settings().max_candidates)

    return ok(
        view,
        source="static",
        notes=(
            []
            if runs.count() > 0
            else ["no run cached in this process yet, so outcome counts and the funnel are empty"]
        ),
    )


@router.get(
    "/rules",
    response_model=Envelope[list[HypothesisRuleView]],
    summary="The hypothesis library as the detection rule set",
    description=(
        "Each entry is a curated fingerprint from `hypotheses/library.yaml`: the evidence "
        "families it expects, in which direction, with what importance. `fired`/`won` are "
        "measured over runs cached in this process; `precision` needs labelled outcomes and "
        "is deliberately null."
    ),
)
def rules(runs: RunStore = Depends(get_runs)) -> dict:
    return ok(service.rules(runs.list()), source="static")


@router.get(
    "/risk-weights",
    response_model=Envelope[list[RiskProfileView]],
    summary="Per-typology risk weight profiles, plus the deliberately neutral families",
)
def risk_weights() -> dict:
    return ok(service.profiles(), source="static")


@router.get(
    "/screening",
    response_model=Envelope[ScreeningSignalView],
    summary="How the candidate screener ranks accounts before the expensive stage",
)
def screening() -> dict:
    return ok(service.screening(Settings().max_candidates), source="static")


@router.get(
    "/performance",
    response_model=Envelope[ModelPerformanceView],
    summary="Evaluation metrics from a persisted offline report",
    description=(
        "The eval harness runs over held-out ground truth and is never executed inside a "
        "request. Without a report on disk this returns `available: false` and the command "
        "that produces one."
    ),
)
def performance() -> dict:
    return ok(service.performance(), source="static")


@router.get(
    "/feature-importance",
    response_model=Envelope[FeatureImportanceView],
    summary="Measured evidence-family contributions beside the declared weights",
    description=(
        "The pipeline ships no supervised model and no SHAP, so this is the mean weighted "
        "contribution per evidence family across scored runs — labelled as measured, not "
        "presented as SHAP."
    ),
)
def feature_importance(runs: RunStore = Depends(get_runs)) -> dict:
    return ok(service.feature_importance(runs.list()), source="cache")


@router.get(
    "/funnel",
    response_model=Envelope[FunnelView],
    summary="Screened to reportable, from the newest run's cost telemetry",
)
def funnel(runs: RunStore = Depends(get_runs)) -> dict:
    return ok(service.funnel(runs.list()), source="cache")


@router.get(
    "/outcomes",
    response_model=Envelope[list[TypologyOutcomeView]],
    summary="Which explanation won, and how often, across cached runs",
)
def outcomes(runs: RunStore = Depends(get_runs)) -> dict:
    return ok(service.outcomes(runs.list()), source="cache")
