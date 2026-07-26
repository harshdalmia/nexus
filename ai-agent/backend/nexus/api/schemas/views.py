"""Frontend-facing view models.

Naming is snake_case (Python transport convention); the frontend maps these onto its own
camelCase domain types. Every field below is traceable to a pipeline field — where the
pipeline has no equivalent the field is Optional and left null rather than filled in.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Stage = Literal["understanding", "planning", "selection", "execution", "reporting"]
Status = Literal["ran", "skipped", "failed"]


# --------------------------------------------------------------------------- health

class ModelArtifactView(BaseModel):
    """Provenance of the persisted anomaly model, read off the artefact's own bytes.

    No drift/PSI figure: nothing in the pipeline computes one, and a provenance strip showing
    an invented number is worse than one showing a gap.
    """

    present: bool
    name: str = "isolation_forest"
    kind: str = "unsupervised"
    version: str | None = None
    trained_at: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    features: list[str] = Field(default_factory=list)
    psi: float | None = None
    reason: str | None = None


class HealthView(BaseModel):
    status: Literal["warming", "ready", "error"]
    data_loaded: bool
    error: str | None = None
    variant: str
    transactions: int = Field(..., ge=0)
    accounts: int = Field(..., ge=0)
    llm_enabled: bool
    llm_model: str | None = None
    anomaly_model: bool
    cached_runs: int = Field(0, ge=0)
    capabilities: dict[str, bool] = Field(default_factory=dict)
    # Data vintage: when this process ingested, and how recent the data itself is.
    data_loaded_at: str | None = None
    dataset_as_of: str | None = None
    dataset_from: str | None = None
    model: ModelArtifactView | None = None


class RosterToolView(BaseModel):
    """A capability the planner may select. Static declaration, not a run record."""

    tool: str
    label: str
    purpose: str
    stage: Stage
    scoring: bool = False
    needs_features: bool = False
    traverses_graph: bool = False


# ----------------------------------------------------------------------- execution

class ToolStepView(BaseModel):
    """One roster tool's execution record, ordered as the pipeline reported it."""

    order: int = Field(..., ge=0)
    tool: str
    label: str
    stage: Stage
    status: Status
    reason: str
    duration_ms: float = Field(..., ge=0.0)
    rows_in: int | None = None
    rows_out: int | None = None
    invocations: int = Field(0, ge=0)
    filters_applied: dict[str, str] = Field(default_factory=dict)
    filters_not_applied: list[str] = Field(default_factory=list)
    purpose: str = ""


class PlanningDecisionView(BaseModel):
    """One of the six planning derivations, read back out of the pipeline's own output."""

    stage: Literal[
        "intent_extraction",
        "entity_extraction",
        "filter_detection",
        "pattern_detection",
        "tool_selection",
        "execution_planning",
    ]
    label: str
    value: str
    detail: str
    # The pipeline does not emit a numeric confidence for its derivations.
    confidence: float | None = None
    source: Literal["llm", "deterministic", "planner"] = "planner"


class EdaStatusView(BaseModel):
    """Selective-EDA verdict: did the profiler run for this query, and why."""

    status: Status
    reason: str
    transactions: int | None = None
    accounts: int | None = None
    scope_active: bool = False
    scope: dict[str, str] = Field(default_factory=dict)


class CostView(BaseModel):
    max_candidates: int
    max_investigations: int
    max_roundtrips_per_candidate: int
    candidate_pool_size: int
    candidates_eligible: int
    candidates_dropped: int
    investigated: int
    excluded: int
    returned: int
    roundtrips_total: int
    roundtrips_max_per_candidate: int
    wall_clock_ms: float
    budget_ms: float
    within_budget: bool


class SkippedToolView(BaseModel):
    tool: str
    label: str
    reason: str


class ExecutionSummaryView(BaseModel):
    """Exactly the execution summary the UI renders, sourced field by field."""

    run_id: str
    case_id: str
    query: str
    intent: list[str] = Field(default_factory=list)
    intent_source: Literal["llm", "deterministic"] = "deterministic"
    aml_pattern: str
    aml_pattern_recognized: bool = True
    entities: list[str] = Field(default_factory=list)
    entities_note: str = ""
    filters: dict[str, str] = Field(default_factory=dict)
    filters_note: str = ""
    scoped_transactions: int | None = None
    total_transactions: int | None = None
    selected_tools: list[str] = Field(default_factory=list)
    skipped_tools: list[SkippedToolView] = Field(default_factory=list)
    execution_time_ms: float = Field(..., ge=0.0)
    investigation_summary: str
    eda: EdaStatusView
    cost: CostView
    notes: list[str] = Field(default_factory=list)
    findings_count: int = Field(0, ge=0)
    no_findings_reason: str | None = None


# ------------------------------------------------------------------------ features

class FeatureView(BaseModel):
    """One engineered feature as declared by the pipeline's feature manifest."""

    name: str
    label: str = ""
    definition: str
    computed: bool = True
    used_for_clustering: bool = False
    # What this feature evaluated to for the subject account. Null on a broad sweep before a
    # subject exists. `unit` travels instead of a formatted string, per the transport contract.
    value: float | None = None
    unit: str = ""
    # The pipeline groups features by clustering membership, not by typology, so there is no
    # per-feature typology tag to report.
    pattern: str | None = None


class FeatureCatalogView(BaseModel):
    available: bool = True
    reason: str | None = None
    source: Literal["warmup", "built"] | None = None
    accounts: int = Field(0, ge=0)
    subject: str | None = None
    features: list[FeatureView] = Field(default_factory=list)
    cluster_features: list[str] = Field(default_factory=list)


# ----------------------------------------------------------------------- detection

class DetectionModelView(BaseModel):
    name: str
    kind: Literal["rules", "supervised", "unsupervised", "graph", "hypothesis"]
    role: str
    duration_ms: float | None = None


class HypothesisScoreView(BaseModel):
    id: str
    label: str
    kind: str
    raw: float
    normalized: float
    band: str
    matched: list[str] = Field(default_factory=list)
    contradicted: list[str] = Field(default_factory=list)


class FeatureContributionView(BaseModel):
    feature: str
    contribution: float


class DetectionView(BaseModel):
    available: bool = True
    reason: str | None = None
    models: list[DetectionModelView] = Field(default_factory=list)
    anomaly_type: str = ""
    verdict_kind: str | None = None
    confidence: str | None = None
    # Unsupervised anomaly score, when the isolation forest ran. Neutral by design:
    # it carries no risk weight in the pipeline.
    anomaly_score: float | None = None
    anomaly_direction: str | None = None
    # `threshold` is the score at or above which the engine stops recommending plain
    # monitoring — a real cutoff on the additive 0-100 risk scale, not a model probability.
    # `tiers` carries the full ladder. `probability` stays null on purpose: there is no
    # supervised classifier in this pipeline, so no calibrated probability exists to report.
    threshold: float | None = None
    tiers: list[TierBandView] = Field(default_factory=list)
    probability: float | None = None
    confidence_margin: float | None = None
    corroborating_families: int = Field(0, ge=0)
    artifact: ModelArtifactView | None = None
    duration_ms: float = 0.0
    evaluated: int = Field(0, ge=0)
    flagged: int = Field(0, ge=0)
    excluded: int = Field(0, ge=0)
    top_features: list[FeatureContributionView] = Field(default_factory=list)
    hypotheses: list[HypothesisScoreView] = Field(default_factory=list)


# ---------------------------------------------------------------------------- risk

class ComponentInputView(BaseModel):
    """The evidence record behind one weighted risk component.

    This is what makes the additive score auditable: the claim that produced the strength, the
    formula that produced the claim, and the transactions that prove it.
    """

    claim_id: str
    claim: str
    calculation: str
    value: float
    direction: str
    strength: float
    tx_count: int = Field(0, ge=0)


class ScoreComponentView(BaseModel):
    label: str
    # Human phrase for `label`, which is an evidence-family slug.
    family_label: str = ""
    meaning: str = ""
    weight: float
    value: float
    contribution: float
    # False when the family was measured but carries no weight for this typology, i.e. it
    # informed the verdict without moving the score. Distinguishing these is the difference
    # between a readable score breakdown and a misleading one.
    scoring: bool = True
    inputs: list[ComponentInputView] = Field(default_factory=list)


class TierBandView(BaseModel):
    """One rung of the escalation ladder with the score range that selects it.

    These are the engine's real cutoffs on the additive 0-100 scale. They are NOT a 0-1 model
    decision threshold; the pipeline has no classifier that would own one.
    """

    tier: str
    escalation: str
    min_score: float
    max_score: float
    selected: bool = False


class CounterfactualView(BaseModel):
    label: str
    score: float


class RiskView(BaseModel):
    available: bool = True
    reason: str | None = None
    node: str | None = None
    score: float = Field(0.0, ge=0.0, le=100.0)
    tier: str | None = None
    escalation: str | None = None
    band: str | None = None
    confidence: str | None = None
    # The two measurements the confidence band came from. `confidence_margin` is the
    # normalized-score gap to the runner-up hypothesis and is the honest number for a gauge;
    # a 0-1 "confidence score" would be manufactured.
    confidence_margin: float | None = None
    corroborating_families: int = Field(0, ge=0)
    typology: str | None = None
    reason_text: str = ""
    evidence: list[str] = Field(default_factory=list)
    components: list[ScoreComponentView] = Field(default_factory=list)
    counterfactuals: list[CounterfactualView] = Field(default_factory=list)
    # Decision thresholds, so a score bar can draw its markers and "exceeded"/"below" can be
    # stated rather than implied.
    tiers: list[TierBandView] = Field(default_factory=list)
    scoring_families: list[str] = Field(default_factory=list)
    context_families: list[str] = Field(default_factory=list)


class EscalationRungView(BaseModel):
    action: Literal["monitor", "review", "report"]
    tier: str
    band: str
    selected: bool = False


class RecommendationView(BaseModel):
    available: bool = True
    reason: str | None = None
    action: Literal["monitor", "review", "report"] | None = None
    tier: str | None = None
    risk: float = 0.0
    headline: str = ""
    detail: str = ""
    ladder: list[EscalationRungView] = Field(default_factory=list)
    validated: bool = True
    unsupported: list[str] = Field(default_factory=list)
    # No SLA clock exists in the pipeline.
    sla: str | None = None


# ------------------------------------------------------------------- findings/evidence

class EvidenceRecordView(BaseModel):
    claim_id: str
    family: str
    claim: str
    calculation: str
    value: float
    direction: str
    strength: float
    tx_ids: list[int] = Field(default_factory=list)
    tx_count: int = Field(0, ge=0)
    feature_version: str = "v1"
    weighted: bool = True


class FindingView(BaseModel):
    rank: int
    node: str
    risk: float
    tier: str
    escalation: str
    winning_kind: str
    winning_hypothesis: str = ""
    hypothesis_label: str = ""
    confidence: str
    explanation: str
    explanation_source: str = "template"
    validated: bool = True
    unsupported: list[str] = Field(default_factory=list)
    evidence_count: int = Field(0, ge=0)
    families: list[str] = Field(default_factory=list)
    members: list[str] = Field(default_factory=list)
    feeders: list[str] = Field(default_factory=list)
    beneficiaries: list[str] = Field(default_factory=list)
    excluded: list[dict[str, str]] = Field(default_factory=list)


class ExplanationView(BaseModel):
    # `model_version` is a domain term here, not a pydantic accessor.
    model_config = ConfigDict(protected_namespaces=())

    available: bool = True
    reason: str | None = None
    subject: str | None = None
    query: str = ""
    narrative: str = ""
    source: Literal["llm", "template"] = "template"
    validated: bool = True
    unsupported: list[str] = Field(default_factory=list)
    model_version: str | None = None
    evidence: list[str] = Field(default_factory=list)
    components: list[ScoreComponentView] = Field(default_factory=list)
    risk: float = 0.0
    tier: str | None = None
    confidence: str | None = None


# -------------------------------------------------------------------------- charts

ChartKind = Literal[
    "bars", "hbars", "line", "area", "stacked", "pie", "donut", "gauge",
    "heatmap", "sankey", "waterfall", "scatter", "treemap", "corridor", "table",
]


class ChartDatumView(BaseModel):
    label: str
    value: float
    severity: Literal["severe", "review", "clear"] | None = None
    note: str | None = None


class ChartDatasetView(BaseModel):
    """A structured dataset, never a rendered chart."""

    id: str
    kind: ChartKind
    title: str
    subtitle: str | None = None
    footnote: str | None = None
    unit: str | None = None
    available: bool = True
    reason: str | None = None
    source_tool: str | None = None
    data: list[ChartDatumView] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    rows: list[dict] = Field(default_factory=list)


# --------------------------------------------------------------------------- graph

class GraphNodeView(BaseModel):
    id: str
    label: str
    bank: str = ""
    account: str = ""
    kind: Literal["account", "hub", "feeder", "beneficiary"] = "account"
    role: str = ""
    hop: int = Field(1, ge=0)
    risk: float | None = None
    severity: Literal["severe", "review", "clear"] | None = None
    in_degree: int = Field(0, ge=0)
    out_degree: int = Field(0, ge=0)
    in_value: float = 0.0
    out_value: float = 0.0
    centrality: float | None = None
    cluster: str | None = None
    entity_id: str | None = None
    facts: list[dict[str, str]] = Field(default_factory=list)


class GraphEdgeView(BaseModel):
    id: str
    source: str
    target: str
    kind: Literal["transfer", "large-transfer"] = "transfer"
    label: str = ""
    weight: float = 0.0
    tx_count: int = Field(1, ge=0)
    tx_ids: list[int] = Field(default_factory=list)
    first_seen: str | None = None
    last_seen: str | None = None


class GraphClusterView(BaseModel):
    id: str
    label: str
    role: str
    members: list[str] = Field(default_factory=list)


class GraphView(BaseModel):
    center: str
    depth: int
    truncated: bool = False
    nodes: list[GraphNodeView] = Field(default_factory=list)
    edges: list[GraphEdgeView] = Field(default_factory=list)
    clusters: list[GraphClusterView] = Field(default_factory=list)
    stats: dict[str, float] = Field(default_factory=dict)


class EntityProfileView(BaseModel):
    node: str
    bank: str
    account: str
    entity_id: str | None = None
    entity_name: str | None = None
    in_count: int = 0
    out_count: int = 0
    in_sum: float = 0.0
    out_sum: float = 0.0
    in_degree: int = 0
    out_degree: int = 0
    txn_count: int = 0
    velocity: float | None = None
    span_days: float | None = None
    first_seen: str | None = None
    last_seen: str | None = None
    peer_cluster: int | None = None


# -------------------------------------------------------------------- transactions

class TransactionView(BaseModel):
    tx_id: int
    timestamp: str | None = None
    from_bank: str
    sender_account: str
    to_bank: str
    receiver_account: str
    amount_paid: float | None = None
    payment_currency: str = ""
    amount_received: float | None = None
    receiving_currency: str = ""
    amount_base: float | None = None
    payment_format: str = ""
    cross_currency: bool = False
    is_laundering: bool = False


# --------------------------------------------------------------------------- audit

class AuditView(BaseModel):
    run_id: str
    case_id: str
    created_at: str
    query: str
    typology: str
    intent: list[str] = Field(default_factory=list)
    tools_run: list[str] = Field(default_factory=list)
    tools_skipped: list[SkippedToolView] = Field(default_factory=list)
    winning_hypothesis: str = ""
    alternatives: list[dict[str, str]] = Field(default_factory=list)
    risk: float = 0.0
    escalation: str = "monitor"
    evidence_ids: list[str] = Field(default_factory=list)
    narrative: str = ""
    validated: bool = True
    unsupported: list[str] = Field(default_factory=list)
    intent_source: str = "deterministic"
    narrator_source: str = "template"


# ------------------------------------------------------------------- dossier layout

class SectionView(BaseModel):
    """Which dossier sections this run can actually fill, and when they unlock.

    `unlock_after` names a tool that genuinely ran, so the frontend's progressive reveal
    stays honest: a section never waits on a tool the planner declined.
    """

    id: str
    kind: str
    title: str
    span: Literal["full", "half", "third", "two-thirds"]
    unlock_after: str
    available: bool = True
    reason: str | None = None


class RunSummaryView(BaseModel):
    run_id: str
    case_id: str
    query: str
    created_at: str
    variant: str
    duration_ms: float
    risk: float = 0.0
    tier: str | None = None
    escalation: str | None = None
    findings_count: int = 0
    tools_run: int = 0
    tools_skipped: int = 0


class InvestigationView(BaseModel):
    """The whole run in one document — what the Ask workspace loads on submit."""

    run_id: str
    case_id: str
    created_at: str
    variant: str
    query: str
    duration_ms: float
    execution: ExecutionSummaryView
    planning: list[PlanningDecisionView] = Field(default_factory=list)
    steps: list[ToolStepView] = Field(default_factory=list)
    features: FeatureCatalogView
    detection: DetectionView
    risk: RiskView
    explanation: ExplanationView
    recommendation: RecommendationView
    findings: list[FindingView] = Field(default_factory=list)
    evidence: list[EvidenceRecordView] = Field(default_factory=list)
    charts: list[ChartDatasetView] = Field(default_factory=list)
    sections: list[SectionView] = Field(default_factory=list)
    summary_stats: list[dict] = Field(default_factory=list)
    headline: str = ""
    no_findings_reason: str | None = None


# ---------------------------------------------------------------- attribution

class ClaimCitationView(BaseModel):
    """One evidence claim that cites a specific transaction.

    This is attribution, not a per-transaction score: it says which account-level claim
    used this row as proof, and how strong that claim was. The engine scores accounts, so
    there is no transaction risk value to report.
    """

    claim_id: str
    family: str
    claim: str
    calculation: str
    direction: str
    strength: float
    # whether the family carries weight in the risk profile for this typology
    weighted: bool = True
    node: str
    tx_count: int = Field(0, ge=0)


class AttributedTransactionView(BaseModel):
    """A ledger row plus the claims that cite it, if any."""

    transaction: TransactionView
    citations: list[ClaimCitationView] = Field(default_factory=list)
    families: list[str] = Field(default_factory=list)
    # the strongest claim citing this row, for ordering and emphasis
    peak_strength: float | None = None
    # risk of the ACCOUNT the citing claim belongs to — never of the transaction
    account: str | None = None
    account_risk: float | None = None
    account_tier: str | None = None


class AttributionView(BaseModel):
    """Every transaction a run's evidence cites, annotated with the citing claims."""

    run_id: str
    case_id: str
    query: str
    typology: str
    # distinct transactions the run's evidence cites
    cited_transactions: int = Field(0, ge=0)
    claims: int = Field(0, ge=0)
    # an evidence record can cite more transactions than it publishes ids for
    published_transactions: int = Field(0, ge=0)
    rows: list[AttributedTransactionView] = Field(default_factory=list)
    note: str = ""
