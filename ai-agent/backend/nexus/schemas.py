"""Pydantic v2 schemas for the normalized data model (Phase 1).

Only the data-layer models live here. Evidence/Hypothesis/Case models arrive in Phase 2.
Node identity is the (bank, account) pair — bank + account codes are STRINGS to preserve
leading zeros (e.g. '00952', '000').
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Transaction(BaseModel):
    """One normalized transaction row."""

    model_config = ConfigDict(frozen=True)

    tx_id: int = Field(..., description="Synthetic stable row index assigned on ingest.")
    timestamp: datetime
    from_bank: str
    sender_account: str
    to_bank: str
    receiver_account: str
    amount_received: float
    receiving_currency: str
    amount_paid: float
    payment_currency: str
    payment_format: str
    # Derived:
    amount_base: float = Field(..., description="amount_paid normalized to base currency (USD).")
    cross_currency: bool = Field(
        ..., description="True when receiving_currency != payment_currency."
    )
    is_laundering: bool = Field(
        False, description="Binary label if known. Populated from data/ground truth."
    )

    @property
    def from_node(self) -> tuple[str, str]:
        return (self.from_bank, self.sender_account)

    @property
    def to_node(self) -> tuple[str, str]:
        return (self.to_bank, self.receiver_account)


class Account(BaseModel):
    """One row from accounts.csv (account -> entity phonebook)."""

    model_config = ConfigDict(frozen=True)

    bank_name: str
    bank_id: str
    account_number: str
    entity_id: str
    entity_name: str

    @property
    def node(self) -> tuple[str, str]:
        return (self.bank_id, self.account_number)


Direction = Literal["high", "low"]
HypothesisKind = Literal["suspicious", "benign"]
# A case verdict may also be undecided when no evidence separates the theories.
VerdictKind = Literal["suspicious", "benign", "indeterminate"]


class EvidenceRecord(BaseModel):
    """One verifiable finding produced by a tool — the unit of proof.

    `direction` is high/low vs a neutral midpoint; `strength` is squashed to [0,1].
    `transactions` are the exact tx_ids behind the claim (the proof-of-work).
    """

    model_config = ConfigDict(frozen=True)

    claim_id: str
    family: str
    claim: str
    calculation: str
    value: float
    direction: Direction
    strength: float = Field(..., ge=0.0, le=1.0)
    transactions: list[int] = Field(default_factory=list)
    feature_version: str = "v1"
    data_snapshot: str = ""


class FamilyExpectation(BaseModel):
    """A hypothesis's expectation for one evidence family."""

    model_config = ConfigDict(frozen=True)

    expects: Direction
    importance: float = Field(..., gt=0.0)


class Hypothesis(BaseModel):
    """A theory expressed as a fingerprint: expected direction + importance per family.

    Families not listed are neutral (ignored). `max_score` is the sum of importances,
    used to normalize the raw duel score into roughly [-1, +1].
    """

    model_config = ConfigDict(frozen=True)

    id: str
    label: str
    kind: HypothesisKind
    fingerprint: dict[str, FamilyExpectation]

    @property
    def max_score(self) -> float:
        return sum(fe.importance for fe in self.fingerprint.values())


class InvestigationSpec(BaseModel):
    """Structured intent parsed from a natural-language query — the contract the
    deterministic pipeline acts on. The only place NL ambiguity is allowed.
    """

    query: str
    intent: list[str] = Field(default_factory=list)   # detect / trace / explain / monitor
    typology: str = "smurfing"                          # smurfing / structuring
    filters: dict[str, str] = Field(default_factory=dict)
    entities: list[str] = Field(default_factory=list)   # named account nodes 'bank|acct'
    trace_depth: int = 1


class AuditReceipt(BaseModel):
    """Immutable-ish record of a run: what was asked, what ran, what was decided, why."""

    query: str
    typology: str
    intent: list[str]
    tools_run: list[str] = Field(default_factory=list)
    tools_skipped: list[tuple[str, str]] = Field(default_factory=list)  # (tool, reason)
    winning_hypothesis: str = ""
    alternatives: list[tuple[str, str, str]] = Field(default_factory=list)  # (id,label,band)
    risk: float = 0.0
    escalation: str = "monitor"
    evidence_ids: list[str] = Field(default_factory=list)
    narrative: str = ""
    # Additive (Phase 6): per-tool telemetry alongside the existing run/skipped lists.
    plan_trace: list["PlanTraceEntry"] = Field(default_factory=list)


class Case(BaseModel):
    """A compressed network case: the verdict object handed to a human."""

    seed: str
    typology: str
    winning_hypothesis: str
    winning_kind: VerdictKind
    confidence: str
    # The two measurements the confidence band was derived from, published so a UI can show a
    # number instead of only a word. `confidence_margin` is the normalized-score gap to the
    # runner-up hypothesis; `corroborating_families` is how many evidence families actually
    # supported the winner. A margin says the alternatives were beaten; the family count says
    # the winner was corroborated. They are not the same claim.
    confidence_margin: float | None = None
    corroborating_families: int = Field(0, ge=0)
    risk: float
    tier: str
    escalation: str                       # monitor / review / report
    members: list[str] = Field(default_factory=list)
    feeders_included: list[str] = Field(default_factory=list)
    beneficiaries: list[str] = Field(default_factory=list)
    excluded: list[tuple[str, str]] = Field(default_factory=list)  # (node, reason)
    evidence: list[EvidenceRecord] = Field(default_factory=list)
    # Structured money-flow shapes the graph tool measured, when it ran.
    motifs: list["Motif"] = Field(default_factory=list)
    # Descriptive amounts/dates/channel for the subject, attached by the orchestrator for
    # the narrated case only. Left None on the per-candidate cases so the expensive stage
    # does not pay three extra queries per candidate. Declared here (rather than beside the
    # Phase 6 models) so `Case` stays one object; `SubjectContext` is defined below.
    context: "SubjectContext | None" = None


class PatternInstance(BaseModel):
    """One BEGIN/END block from Patterns.txt — the held-out answer key.

    `transactions` holds the raw parsed rows of the block (as tuples matching the Trans
    column order, pre-tx_id join). `tx_ids` is filled after joining to the transaction
    store. Kept separate so the raw block is preserved even if a join misses.
    """

    typology: str
    description: str = ""
    transactions: list[tuple] = Field(default_factory=list)
    tx_ids: list[int] = Field(default_factory=list)
    accounts: set[tuple[str, str]] = Field(default_factory=set)
    entities: set[str] = Field(default_factory=set)

    @property
    def size(self) -> int:
        return len(self.transactions)


# ---------------------------------------------------------------------------
# Phase 6 (agent-capability-completion) — additive models.
# Nothing above this line changed. Every model below is new.
# ---------------------------------------------------------------------------

Status = Literal["ran", "skipped", "failed"]
Tier = Literal["low", "medium", "high"]
Escalation = Literal["monitor", "review", "report"]

# Families that are deliberately OUT of every hypothesis fingerprint and every risk
# weight profile, so emitting them can never move a score. `anomaly` is the precedent.
NEUTRAL_FAMILIES: frozenset[str] = frozenset({"anomaly", "data_profile", "feature_coverage"})


class FilterScope(BaseModel):
    """Query filters as a typed predicate source. Inactive scope contributes no SQL."""

    model_config = ConfigDict(frozen=True)

    payment_format: str | None = None
    month: str | None = None
    month_number: int | None = Field(None, ge=1, le=12)


# ---------- derived presentation series (nexus/derived.py) ----------

class FlowNode(BaseModel):
    id: str
    label: str
    # Layer in the flow diagram: negative upstream of the subject, 0 the subject itself,
    # positive downstream. Derived from hop distance in the ego graph, not from layout.
    column: int = 0
    value: float = 0.0
    role: Literal["subject", "payer", "beneficiary"] = "payer"
    risk: float | None = None


class FlowLink(BaseModel):
    source: str
    target: str
    value: float = 0.0
    tx_count: int = Field(0, ge=0)
    tx_ids: list[int] = Field(default_factory=list, max_length=25)
    severity: Literal["severe", "review", "clear"] = "clear"


class FlowGraph(BaseModel):
    center: str
    depth: int = Field(1, ge=1)
    nodes: list[FlowNode] = Field(default_factory=list)
    links: list[FlowLink] = Field(default_factory=list)
    truncated: bool = False
    scope_active: bool = False


class TimelineEvent(BaseModel):
    at: datetime | None = None
    tx_id: int
    kind: Literal["inbound", "outbound"]
    label: str
    detail: str = ""
    amount: float = 0.0
    counterparty: str = ""
    payment_format: str = ""
    # Marks DIRECTION, not risk. The engine scores accounts, never transactions.
    severity: Literal["severe", "review", "clear"] = "clear"


class VolumeBucket(BaseModel):
    bucket: datetime | None = None
    grain: str = "day"
    count: int = Field(0, ge=0)
    value: float = 0.0


class RankBucket(BaseModel):
    """One bin of the screening-rank histogram. Screening rank, not risk."""

    band: str
    min_rank: float
    max_rank: float
    count: int = Field(0, ge=0)


class ScatterPoint(BaseModel):
    id: str
    x: float
    y: float
    size: float = 0.0
    x_feature: str = ""
    y_feature: str = ""


class ReportSource(BaseModel):
    """One traceable origin for a sentence in a report section.

    A filing has to survive being questioned, so every paragraph names where it came from:
    an evidence claim (with the transactions that prove it), a tool that ran, or a declared
    engine parameter. A section with no sources is a section that should not be in the report.
    """

    kind: Literal["evidence", "tool", "declaration", "dataset"]
    ref: str
    detail: str = ""
    tx_count: int = Field(0, ge=0)
    tx_ids: list[int] = Field(default_factory=list)


class ReportSection(BaseModel):
    heading: str
    body: str
    sources: list[ReportSource] = Field(default_factory=list)


class ReportReadiness(BaseModel):
    """One precondition for filing. `blocker` is set only when the item is not satisfied."""

    id: str
    label: str
    status: Literal["ok", "blocked", "manual"]
    blocker: str | None = None


class Report(BaseModel):
    """A draft narrative report assembled from a run. Never a filing.

    Deliberately not called a SAR: nothing here has been reviewed by a human, and the
    readiness list exists precisely to record that some steps cannot be automated.
    """

    subject: str
    typology: str
    verdict: VerdictKind
    risk: float
    tier: str
    escalation: str
    generated_at: str
    run_reference: str = ""
    sections: list[ReportSection] = Field(default_factory=list)
    readiness: list[ReportReadiness] = Field(default_factory=list)
    filed: bool = False


class Motif(BaseModel):
    """A detected money-flow shape around one account.

    `kind` is `fan_in` or `fan_out`. Deliberately NOT `cycle`: the graph tool measures
    convergence, not cycles, and labelling it otherwise would overstate what ran.
    """

    kind: Literal["fan_in", "fan_out"]
    node: str
    fan_in: int = Field(0, ge=0)
    fan_out: int = Field(0, ge=0)
    convergence: float = Field(0.0, ge=0.0, le=1.0)
    depth: int = Field(1, ge=1)
    feeders: list[str] = Field(default_factory=list)
    beneficiaries: list[str] = Field(default_factory=list)
    transactions: list[int] = Field(default_factory=list)


class SubjectContext(BaseModel):
    """Descriptive facts about one account: how much, when, through what channel.

    Purely descriptive — no score, no verdict. Exists because the evidence records answer
    "why suspicious?" and never answered "how much money, over what period?".
    """

    node: str
    scope_active: bool = False
    scope: dict[str, str] = Field(default_factory=dict)
    # Currency `inbound_value` / `outbound_value` are normalized to. Overridden from
    # Settings by `subject.summarize`; the default keeps this module import-free.
    base_currency: str = "US Dollar"
    inbound_count: int = Field(0, ge=0)
    inbound_value: float = 0.0
    inbound_counterparties: int = Field(0, ge=0)
    outbound_count: int = Field(0, ge=0)
    outbound_value: float = 0.0
    outbound_counterparties: int = Field(0, ge=0)
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    span_days: int | None = Field(None, ge=1)
    active_days: int | None = Field(None, ge=0)
    top_payment_format: str | None = None
    top_payment_format_count: int = Field(0, ge=0)
    top_currency: str | None = None
    top_currency_count: int = Field(0, ge=0)
    currencies: list[str] = Field(default_factory=list)


class PlanTraceEntry(BaseModel):
    """One roster tool's execution record — the proof the plan was per-query."""

    tool: str
    label: str = Field(..., min_length=1, max_length=60)
    status: Status
    reason: str = Field(..., min_length=1, max_length=200)
    duration_ms: float = Field(..., ge=0.0)
    rows_in: int | None = Field(None, ge=0)      # None == not row-countable
    rows_out: int | None = Field(None, ge=0)     # None == not row-countable
    invocations: int = Field(0, ge=0)
    filters_applied: dict[str, str] = Field(default_factory=dict)
    filters_not_applied: list[str] = Field(default_factory=list)


class CostTelemetry(BaseModel):
    max_candidates: int = Field(..., ge=0)
    max_investigations: int = Field(..., ge=0)
    max_roundtrips_per_candidate: int = Field(..., ge=0)
    candidate_pool_size: int = Field(0, ge=0)
    candidates_eligible: int = Field(0, ge=0)
    candidates_dropped: int = Field(0, ge=0)
    investigated: int = Field(0, ge=0)
    excluded: int = Field(0, ge=0)
    returned: int = Field(0, ge=0)
    roundtrips_max_per_candidate: int = Field(0, ge=0)
    roundtrips_total: int = Field(0, ge=0)
    wall_clock_ms: float = Field(0.0, ge=0.0)
    budget_ms: float = Field(..., ge=0.0)
    within_budget: bool = True


class ExecutionSummary(BaseModel):
    """Query-aware execution summary: what was asked, what was detected, what ran."""

    query: str
    intent: list[str] = Field(default_factory=list)
    typology: str
    typology_recognized: bool = True
    entities: list[str] = Field(default_factory=list)
    entities_note: str = ""
    filters: dict[str, str] = Field(default_factory=dict)
    filters_note: str = ""
    scoped_transactions: int | None = None
    total_transactions: int | None = None
    cost: CostTelemetry
    notes: list[str] = Field(default_factory=list)


# ---------- EDA profile ----------

class CategoryCount(BaseModel):
    category: str
    count: int = Field(..., ge=0)


class Distribution(BaseModel):
    column: str
    entries: list[CategoryCount] = Field(default_factory=list, max_length=20)
    remainder_categories: int = Field(0, ge=0)
    remainder_count: int = Field(0, ge=0)


class AmountSummary(BaseModel):
    count: int = Field(..., ge=0)
    min: float
    max: float
    mean: float
    median: float
    p95: float
    sum: float


class TimeSpan(BaseModel):
    first: datetime
    last: datetime
    span_days: int = Field(..., ge=1)
    active_days: int = Field(..., ge=0)


class DataQuality(BaseModel):
    null_timestamps: int = Field(0, ge=0)
    non_positive_amounts: int = Field(0, ge=0)
    unpriced_currency_transactions: int = Field(0, ge=0)
    unpriced_currencies: list[str] = Field(default_factory=list, max_length=20)


class EdaProfile(BaseModel):
    """Structured EDA result. Absent metrics are None, never a zero-filled object."""

    scope_active: bool = False
    scope: dict[str, str] = Field(default_factory=dict)
    transactions: int = Field(..., ge=0)
    accounts: int = Field(..., ge=0)
    distributions: dict[str, Distribution] = Field(default_factory=dict)
    cross_currency_count: int = Field(0, ge=0)
    cross_currency_rate: float | None = Field(None, ge=0.0, le=1.0)
    amounts: AmountSummary | None = None
    time_span: TimeSpan | None = None
    quality: DataQuality = Field(default_factory=DataQuality)


# ---------- engineered features ----------

class FeatureDefinition(BaseModel):
    name: str
    definition: str = Field(..., min_length=1, max_length=200)
    # What the number means dimensionally. Travels instead of a formatted display string,
    # because the transport contract puts all formatting on the client.
    unit: str = ""


class FeatureManifest(BaseModel):
    features: list[FeatureDefinition] = Field(..., min_length=10, max_length=10)
    cluster_features: list[str] = Field(..., min_length=9, max_length=9)
    accounts: int = Field(..., ge=0)
    source: Literal["warmup", "built"]
    # feature name -> value for the subject account, when a subject is known. Empty on a
    # broad sweep before a subject is chosen.
    subject: str | None = None
    values: dict[str, float] = Field(default_factory=dict)


# ---------- candidate screening ----------

class Candidate(BaseModel):
    node: str
    rank: float
    features: dict[str, float] = Field(default_factory=dict)


class CandidatePool(BaseModel):
    candidates: list[Candidate] = Field(default_factory=list)
    eligible: int = Field(0, ge=0)
    dropped: int = Field(0, ge=0)
    max_candidates: int = Field(..., ge=0)
    signal: dict[str, float] = Field(default_factory=dict)
    reason: str = ""


# ---------- findings ----------

class Finding(BaseModel):
    """One flagged account: risk, escalation, evidence and a per-item explanation."""

    rank: int = Field(..., ge=1)
    node: str
    risk: float = Field(..., ge=0.0, le=100.0)
    tier: Tier
    escalation: Escalation
    winning_kind: VerdictKind
    winning_hypothesis: str = ""
    hypothesis_label: str = ""
    confidence: str
    explanation: str = Field(..., min_length=1, max_length=400)
    explanation_source: Literal["llm", "template"] = "template"
    validated: bool = True
    unsupported: list[str] = Field(default_factory=list)
    evidence: list[EvidenceRecord] = Field(default_factory=list)
    case: Case


# ---------- chart payloads ----------

class ChartEnvelope(BaseModel):
    id: str
    title: str
    available: bool = True
    reason: str | None = None


class RiskContributionEntry(BaseModel):
    family: str
    contribution: float


class RiskContributionChart(ChartEnvelope):
    entries: list[RiskContributionEntry] = Field(default_factory=list)


class CounterfactualEntry(BaseModel):
    label: str
    score: float


class CounterfactualChart(ChartEnvelope):
    entries: list[CounterfactualEntry] = Field(default_factory=list)


class ScoreboardEntry(BaseModel):
    id: str
    label: str
    kind: str
    raw: float
    normalized: float
    band: str
    matched: list[str] = Field(default_factory=list)
    contradicted: list[str] = Field(default_factory=list)


class ScoreboardChart(ChartEnvelope):
    entries: list[ScoreboardEntry] = Field(default_factory=list)


class FindingsTableRow(BaseModel):
    node: str
    risk: float
    tier: Tier
    escalation: Escalation


class FindingsTableChart(ChartEnvelope):
    rows: list[FindingsTableRow] = Field(default_factory=list)


class EvidenceTableRow(BaseModel):
    family: str
    claim: str
    calculation: str
    value: float
    direction: Direction
    strength: float
    tx_ids: list[int] = Field(default_factory=list, max_length=25)
    tx_count: int = Field(0, ge=0)


class EvidenceTableChart(ChartEnvelope):
    rows: list[EvidenceTableRow] = Field(default_factory=list, max_length=50)
    total_records: int = Field(0, ge=0)
    rows_omitted: int = Field(0, ge=0)


class DataProfileChart(ChartEnvelope):
    payment_format: Distribution | None = None
    amounts: AmountSummary | None = None


class ChartSet(BaseModel):
    risk_contribution: RiskContributionChart
    counterfactual: CounterfactualChart
    hypothesis_scoreboard: ScoreboardChart
    findings_table: FindingsTableChart
    evidence_table: EvidenceTableChart
    data_profile: DataProfileChart


# `AuditReceipt.plan_trace` and `Case.context` are declared with forward references because
# PlanTraceEntry and SubjectContext are defined below them; resolve now that every name
# exists.
AuditReceipt.model_rebuild()
Case.model_rebuild()
