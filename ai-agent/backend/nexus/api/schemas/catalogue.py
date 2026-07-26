"""View models for the detection catalogue: hypotheses, weights, screening, models.

Everything here is a *declaration* the engine already carries — the hypothesis library,
the risk weight profiles, the screener's rank weights — or an outcome measured across the
runs this process has executed. Nothing is computed for display.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class FamilyExpectationView(BaseModel):
    """One evidence family inside a hypothesis fingerprint."""

    family: str
    expects: str
    importance: float


class HypothesisRuleView(BaseModel):
    """A hypothesis as the analyst-facing detection rule it is.

    `fired`/`share` are measured over the runs cached in this process, so they describe
    this session's activity, not an institutional alert history. `precision` requires
    labelled outcomes and is therefore never filled in here.
    """

    id: str
    typology: str
    label: str
    kind: str
    expression: str
    families: list[FamilyExpectationView] = Field(default_factory=list)
    max_score: float
    enabled: bool = True
    fired: int = Field(0, ge=0)
    share_of_runs: float = Field(0.0, ge=0.0, le=1.0)
    won: int = Field(0, ge=0)
    precision: float | None = None
    precision_note: str = "requires labelled outcomes; not published by the engine"


class WeightedFamilyView(BaseModel):
    family: str
    weight: float
    neutral: bool = False
    note: str = ""


class RiskProfileView(BaseModel):
    """A per-typology risk weight profile, read from the risk engine's own declaration."""

    typology: str
    default: bool = False
    families: list[WeightedFamilyView] = Field(default_factory=list)


class ScreeningSignalView(BaseModel):
    """How the candidate screener ranks accounts before the expensive stage."""

    weights: dict[str, float] = Field(default_factory=dict)
    min_in_count: int
    min_in_degree: int
    max_candidates: int
    note: str


class ModelArtifactView(BaseModel):
    name: str
    kind: str
    role: str
    available: bool
    path: str | None = None
    reason: str | None = None


class MetricView(BaseModel):
    label: str
    value: float | None = None
    note: str | None = None


class ModelPerformanceView(BaseModel):
    """Evaluation results, read from a persisted report produced by the eval harness.

    The harness is an offline job over held-out ground truth; it is never run inside a
    request. When no report exists the payload says so instead of inventing metrics.
    """

    model_config = ConfigDict(protected_namespaces=())

    available: bool = False
    reason: str | None = None
    generated_at: str | None = None
    variant: str | None = None
    command: str = "python scripts/eval_report.py"
    metrics: list[MetricView] = Field(default_factory=list)
    artifacts: list[ModelArtifactView] = Field(default_factory=list)


class FeatureWeightView(BaseModel):
    feature: str
    value: float
    source: Literal["risk-weight", "screener", "measured"]
    note: str = ""


class FeatureImportanceView(BaseModel):
    """What actually drove scores, measured across cached runs, plus declared weights.

    The pipeline ships no supervised model artifact and no SHAP, so this is an evidence
    family contribution profile — labelled as measured, never as SHAP.
    """

    available: bool = True
    reason: str | None = None
    runs_measured: int = Field(0, ge=0)
    measured: list[FeatureWeightView] = Field(default_factory=list)
    declared: list[FeatureWeightView] = Field(default_factory=list)


class FunnelStageView(BaseModel):
    label: str
    value: int = Field(..., ge=0)
    note: str = ""


class FunnelView(BaseModel):
    """Screened -> flagged -> reviewable -> reportable, from a run's own cost telemetry."""

    available: bool = True
    reason: str | None = None
    run_id: str | None = None
    query: str | None = None
    stages: list[FunnelStageView] = Field(default_factory=list)


class TypologyOutcomeView(BaseModel):
    typology: str
    label: str
    kind: str
    count: int = Field(0, ge=0)


class CatalogueSummaryView(BaseModel):
    """One document for the Models workspace, so the page needs a single call."""

    typologies: list[str] = Field(default_factory=list)
    rules: list[HypothesisRuleView] = Field(default_factory=list)
    profiles: list[RiskProfileView] = Field(default_factory=list)
    screening: ScreeningSignalView
    performance: ModelPerformanceView
    feature_importance: FeatureImportanceView
    funnel: FunnelView
    outcomes: list[TypologyOutcomeView] = Field(default_factory=list)
    runs_cached: int = Field(0, ge=0)
