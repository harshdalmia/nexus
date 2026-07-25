/* Backend DTOs — a direct mirror of nexus/api/schemas/views.py.

   Kept snake_case on purpose: this is the wire format, and a field named here
   should be greppable in the Python schema. Conversion to the frontend's own
   domain types happens once, in mapRun.ts. */

export type ToolStatus = 'ran' | 'skipped' | 'failed';
export type StageId = 'understanding' | 'planning' | 'selection' | 'execution' | 'reporting';

/** Provenance of the persisted anomaly model, read off the artefact's own bytes.
 *  `psi` is always null: nothing in the pipeline computes drift. */
export interface ModelArtifactDto {
  readonly present: boolean;
  readonly name: string;
  readonly kind: string;
  readonly version: string | null;
  readonly trained_at: string | null;
  readonly sha256: string | null;
  readonly bytes: number | null;
  readonly features: readonly string[];
  readonly psi: number | null;
  readonly reason: string | null;
}

export interface HealthDto {
  readonly status: 'warming' | 'ready' | 'error';
  readonly data_loaded: boolean;
  readonly error: string | null;
  readonly variant: string;
  readonly transactions: number;
  readonly accounts: number;
  readonly llm_enabled: boolean;
  readonly llm_model: string | null;
  readonly anomaly_model: boolean;
  readonly cached_runs: number;
  readonly capabilities: Record<string, boolean>;
  /** When this process finished ingesting. Service freshness. */
  readonly data_loaded_at: string | null;
  /** Newest and oldest timestamps inside the data itself. Data freshness. */
  readonly dataset_as_of: string | null;
  readonly dataset_from: string | null;
  readonly model: ModelArtifactDto | null;
}

export interface RosterToolDto {
  readonly tool: string;
  readonly label: string;
  readonly purpose: string;
  readonly stage: StageId;
  readonly scoring: boolean;
  readonly needs_features: boolean;
  readonly traverses_graph: boolean;
}

export interface ToolStepDto {
  readonly order: number;
  readonly tool: string;
  readonly label: string;
  readonly stage: StageId;
  readonly status: ToolStatus;
  readonly reason: string;
  readonly duration_ms: number;
  readonly rows_in: number | null;
  readonly rows_out: number | null;
  readonly invocations: number;
  readonly filters_applied: Record<string, string>;
  readonly filters_not_applied: readonly string[];
  readonly purpose: string;
}

export interface PlanningDecisionDto {
  readonly stage:
    | 'intent_extraction'
    | 'entity_extraction'
    | 'filter_detection'
    | 'pattern_detection'
    | 'tool_selection'
    | 'execution_planning';
  readonly label: string;
  readonly value: string;
  readonly detail: string;
  readonly confidence: number | null;
  readonly source: 'llm' | 'deterministic' | 'planner';
}

export interface EdaStatusDto {
  readonly status: ToolStatus;
  readonly reason: string;
  readonly transactions: number | null;
  readonly accounts: number | null;
  readonly scope_active: boolean;
  readonly scope: Record<string, string>;
}

export interface CostDto {
  readonly max_candidates: number;
  readonly max_investigations: number;
  readonly max_roundtrips_per_candidate: number;
  readonly candidate_pool_size: number;
  readonly candidates_eligible: number;
  readonly candidates_dropped: number;
  readonly investigated: number;
  readonly excluded: number;
  readonly returned: number;
  readonly roundtrips_total: number;
  readonly roundtrips_max_per_candidate: number;
  readonly wall_clock_ms: number;
  readonly budget_ms: number;
  readonly within_budget: boolean;
}

export interface SkippedToolDto {
  readonly tool: string;
  readonly label: string;
  readonly reason: string;
}

export interface ExecutionSummaryDto {
  readonly run_id: string;
  readonly case_id: string;
  readonly query: string;
  readonly intent: readonly string[];
  readonly intent_source: 'llm' | 'deterministic';
  readonly aml_pattern: string;
  readonly aml_pattern_recognized: boolean;
  readonly entities: readonly string[];
  readonly entities_note: string;
  readonly filters: Record<string, string>;
  readonly filters_note: string;
  readonly scoped_transactions: number | null;
  readonly total_transactions: number | null;
  readonly selected_tools: readonly string[];
  readonly skipped_tools: readonly SkippedToolDto[];
  readonly execution_time_ms: number;
  readonly investigation_summary: string;
  readonly eda: EdaStatusDto;
  readonly cost: CostDto;
  readonly notes: readonly string[];
  readonly findings_count: number;
  readonly no_findings_reason: string | null;
}

export interface FeatureDto {
  readonly name: string;
  /** Human phrase for `name`, e.g. `in_degree` -> "number of counterparties paying in". */
  readonly label: string;
  readonly definition: string;
  readonly computed: boolean;
  readonly used_for_clustering: boolean;
  /** What this feature evaluated to for `FeatureCatalogDto.subject`. Null before a
   *  subject exists. Formatting is ours: the backend ships the raw number plus `unit`. */
  readonly value: number | null;
  readonly unit: string;
  /** Always null: the pipeline groups features by clustering membership, not by typology. */
  readonly pattern: string | null;
}

export interface FeatureCatalogDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly source: 'warmup' | 'built' | null;
  readonly accounts: number;
  /** The account `features[].value` belongs to. */
  readonly subject: string | null;
  readonly features: readonly FeatureDto[];
  readonly cluster_features: readonly string[];
}

export interface DetectionModelDto {
  readonly name: string;
  readonly kind: 'rules' | 'supervised' | 'unsupervised' | 'graph' | 'hypothesis';
  readonly role: string;
  readonly duration_ms: number | null;
}

export interface HypothesisScoreDto {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly raw: number;
  readonly normalized: number;
  readonly band: string;
  readonly matched: readonly string[];
  readonly contradicted: readonly string[];
}

/** One rung of the escalation ladder with the score range that selects it.
 *  These are real cutoffs on the additive 0-100 risk scale, not model probabilities. */
export interface TierBandDto {
  readonly tier: string;
  readonly escalation: string;
  readonly min_score: number;
  readonly max_score: number;
  readonly selected: boolean;
}

export interface DetectionDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly models: readonly DetectionModelDto[];
  readonly anomaly_type: string;
  readonly verdict_kind: string | null;
  readonly confidence: string | null;
  /** Normalized-score gap to the runner-up hypothesis. The honest numeric confidence
   *  readout; a 0-1 "confidence score" would be manufactured. */
  readonly confidence_margin: number | null;
  readonly corroborating_families: number;
  readonly anomaly_score: number | null;
  readonly anomaly_direction: string | null;
  /** Lowest cutoff above plain monitoring, on the 0-100 risk scale. */
  readonly threshold: number | null;
  readonly tiers: readonly TierBandDto[];
  /** Always null. There is no supervised classifier, so no calibrated probability exists. */
  readonly probability: number | null;
  readonly artifact: ModelArtifactDto | null;
  readonly duration_ms: number;
  readonly evaluated: number;
  readonly flagged: number;
  readonly excluded: number;
  readonly top_features: ReadonlyArray<{ readonly feature: string; readonly contribution: number }>;
  readonly hypotheses: readonly HypothesisScoreDto[];
}

/** The evidence record behind one weighted component. What makes the score auditable. */
export interface ComponentInputDto {
  readonly claim_id: string;
  readonly claim: string;
  readonly calculation: string;
  readonly value: number;
  readonly direction: string;
  readonly strength: number;
  readonly tx_count: number;
}

export interface ScoreComponentDto {
  readonly label: string;
  /** Human phrase for `label`, which is an evidence-family slug. */
  readonly family_label: string;
  readonly meaning: string;
  readonly weight: number;
  readonly value: number;
  readonly contribution: number;
  /** False when the family was measured but carries no weight for this typology: it
   *  informed the verdict without moving the score. Do not rank evidence by strength
   *  alone — under some profiles the strongest record contributes nothing. */
  readonly scoring: boolean;
  readonly inputs: readonly ComponentInputDto[];
}

export interface RiskDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly node: string | null;
  readonly score: number;
  readonly tier: string | null;
  readonly escalation: string | null;
  readonly band: string | null;
  readonly confidence: string | null;
  readonly confidence_margin: number | null;
  readonly corroborating_families: number;
  readonly typology: string | null;
  readonly reason_text: string;
  readonly evidence: readonly string[];
  readonly components: readonly ScoreComponentDto[];
  readonly counterfactuals: ReadonlyArray<{ readonly label: string; readonly score: number }>;
  readonly tiers: readonly TierBandDto[];
  /** Families that moved the score, and families that were only context. Disjoint. */
  readonly scoring_families: readonly string[];
  readonly context_families: readonly string[];
}

export interface RecommendationDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly action: 'monitor' | 'review' | 'report' | null;
  readonly tier: string | null;
  readonly risk: number;
  readonly headline: string;
  readonly detail: string;
  readonly ladder: ReadonlyArray<{
    readonly action: 'monitor' | 'review' | 'report';
    readonly tier: string;
    readonly band: string;
    readonly selected: boolean;
  }>;
  readonly validated: boolean;
  readonly unsupported: readonly string[];
  readonly sla: string | null;
}

export interface EvidenceRecordDto {
  readonly claim_id: string;
  readonly family: string;
  readonly claim: string;
  readonly calculation: string;
  readonly value: number;
  readonly direction: string;
  readonly strength: number;
  readonly tx_ids: readonly number[];
  readonly tx_count: number;
  readonly feature_version: string;
  readonly weighted: boolean;
}

export interface FindingDto {
  readonly rank: number;
  readonly node: string;
  readonly risk: number;
  readonly tier: string;
  readonly escalation: string;
  readonly winning_kind: string;
  readonly winning_hypothesis: string;
  readonly hypothesis_label: string;
  readonly confidence: string;
  readonly explanation: string;
  readonly explanation_source: string;
  readonly validated: boolean;
  readonly unsupported: readonly string[];
  readonly evidence_count: number;
  readonly families: readonly string[];
  readonly members: readonly string[];
  readonly feeders: readonly string[];
  readonly beneficiaries: readonly string[];
  readonly excluded: ReadonlyArray<Record<string, string>>;
}

export interface ExplanationDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly subject: string | null;
  readonly query: string;
  readonly narrative: string;
  readonly source: 'llm' | 'template';
  readonly validated: boolean;
  readonly unsupported: readonly string[];
  readonly model_version: string | null;
  readonly evidence: readonly string[];
  readonly components: readonly ScoreComponentDto[];
  readonly risk: number;
  readonly tier: string | null;
  readonly confidence: string | null;
}

export interface ChartDatumDto {
  readonly label: string;
  readonly value: number;
  readonly severity: 'severe' | 'review' | 'clear' | null;
  readonly note: string | null;
}

export interface ChartDatasetDto {
  readonly id: string;
  readonly kind:
    | 'bars' | 'hbars' | 'line' | 'area' | 'stacked' | 'pie' | 'donut' | 'gauge'
    | 'heatmap' | 'sankey' | 'waterfall' | 'scatter' | 'treemap' | 'corridor' | 'table';
  readonly title: string;
  readonly subtitle: string | null;
  readonly footnote: string | null;
  readonly unit: string | null;
  readonly available: boolean;
  readonly reason: string | null;
  readonly source_tool: string | null;
  readonly data: readonly ChartDatumDto[];
  readonly columns: readonly string[];
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export interface SectionDto {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly span: 'full' | 'half' | 'third' | 'two-thirds';
  readonly unlock_after: string;
  readonly available: boolean;
  readonly reason: string | null;
}

export interface InvestigationDto {
  readonly run_id: string;
  readonly case_id: string;
  readonly created_at: string;
  readonly variant: string;
  readonly query: string;
  readonly duration_ms: number;
  readonly execution: ExecutionSummaryDto;
  readonly planning: readonly PlanningDecisionDto[];
  readonly steps: readonly ToolStepDto[];
  readonly features: FeatureCatalogDto;
  readonly detection: DetectionDto;
  readonly risk: RiskDto;
  readonly explanation: ExplanationDto;
  readonly recommendation: RecommendationDto;
  readonly findings: readonly FindingDto[];
  readonly evidence: readonly EvidenceRecordDto[];
  readonly charts: readonly ChartDatasetDto[];
  readonly sections: readonly SectionDto[];
  readonly summary_stats: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
    readonly severity?: 'severe' | 'review' | 'clear';
  }>;
  readonly headline: string;
  readonly no_findings_reason: string | null;
}

export interface RunSummaryDto {
  readonly run_id: string;
  readonly case_id: string;
  readonly query: string;
  readonly created_at: string;
  readonly variant: string;
  readonly duration_ms: number;
  readonly risk: number;
  readonly tier: string | null;
  readonly escalation: string | null;
  readonly findings_count: number;
  readonly tools_run: number;
  readonly tools_skipped: number;
}

export interface GraphNodeDto {
  readonly id: string;
  readonly label: string;
  readonly bank: string;
  readonly account: string;
  readonly kind: 'account' | 'hub' | 'feeder' | 'beneficiary';
  readonly role: string;
  readonly hop: number;
  readonly risk: number | null;
  readonly severity: 'severe' | 'review' | 'clear' | null;
  readonly in_degree: number;
  readonly out_degree: number;
  readonly in_value: number;
  readonly out_value: number;
  readonly centrality: number | null;
  readonly cluster: string | null;
  readonly entity_id: string | null;
  readonly facts: ReadonlyArray<{ readonly label: string; readonly value: string }>;
}

export interface GraphEdgeDto {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: 'transfer' | 'large-transfer';
  readonly label: string;
  readonly weight: number;
  readonly tx_count: number;
  readonly tx_ids: readonly number[];
  readonly first_seen: string | null;
  readonly last_seen: string | null;
}

export interface GraphDto {
  readonly center: string;
  readonly depth: number;
  readonly truncated: boolean;
  readonly nodes: readonly GraphNodeDto[];
  readonly edges: readonly GraphEdgeDto[];
  readonly clusters: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly role: string;
    readonly members: readonly string[];
  }>;
  readonly stats: Record<string, number>;
}

export interface EntityProfileDto {
  readonly node: string;
  readonly bank: string;
  readonly account: string;
  readonly entity_id: string | null;
  readonly entity_name: string | null;
  readonly in_count: number;
  readonly out_count: number;
  readonly in_sum: number;
  readonly out_sum: number;
  readonly in_degree: number;
  readonly out_degree: number;
  readonly txn_count: number;
  readonly velocity: number | null;
  readonly span_days: number | null;
  readonly first_seen: string | null;
  readonly last_seen: string | null;
  readonly peer_cluster: number | null;
}

export interface TransactionDto {
  readonly tx_id: number;
  readonly timestamp: string | null;
  readonly from_bank: string;
  readonly sender_account: string;
  readonly to_bank: string;
  readonly receiver_account: string;
  readonly amount_paid: number | null;
  readonly payment_currency: string;
  readonly amount_received: number | null;
  readonly receiving_currency: string;
  readonly amount_base: number | null;
  readonly payment_format: string;
  readonly cross_currency: boolean;
  readonly is_laundering: boolean;
}

export interface AuditDto {
  readonly run_id: string;
  readonly case_id: string;
  readonly created_at: string;
  readonly query: string;
  readonly typology: string;
  readonly intent: readonly string[];
  readonly tools_run: readonly string[];
  readonly tools_skipped: readonly SkippedToolDto[];
  readonly winning_hypothesis: string;
  readonly alternatives: ReadonlyArray<Record<string, string>>;
  readonly risk: number;
  readonly escalation: string;
  readonly evidence_ids: readonly string[];
  readonly narrative: string;
  readonly validated: boolean;
  readonly unsupported: readonly string[];
  readonly intent_source: string;
  readonly narrator_source: string;
}

export interface TransactionFacetsDto {
  readonly payment_formats: ReadonlyArray<{ readonly value: string; readonly count: number }>;
  readonly currencies: ReadonlyArray<{ readonly value: string; readonly count: number }>;
  readonly time_span: ReadonlyArray<{ readonly first: string | null; readonly last: string | null }>;
}

/* ------------------------- detection catalogue (models) ------------------------- */

export interface FamilyExpectationDto {
  readonly family: string;
  readonly expects: string;
  readonly importance: number;
}

export interface HypothesisRuleDto {
  readonly id: string;
  readonly typology: string;
  readonly label: string;
  readonly kind: string;
  readonly expression: string;
  readonly families: readonly FamilyExpectationDto[];
  readonly max_score: number;
  readonly enabled: boolean;
  readonly fired: number;
  readonly share_of_runs: number;
  readonly won: number;
  readonly precision: number | null;
  readonly precision_note: string;
}

export interface WeightedFamilyDto {
  readonly family: string;
  readonly weight: number;
  readonly neutral: boolean;
  readonly note: string;
}

export interface RiskProfileDto {
  readonly typology: string;
  readonly default: boolean;
  readonly families: readonly WeightedFamilyDto[];
}

export interface ScreeningSignalDto {
  readonly weights: Record<string, number>;
  readonly min_in_count: number;
  readonly min_in_degree: number;
  readonly max_candidates: number;
  readonly note: string;
}

export interface ModelArtifactDto {
  readonly name: string;
  readonly kind: string;
  readonly role: string;
  readonly available: boolean;
  readonly path: string | null;
  readonly reason: string | null;
}

export interface MetricDto {
  readonly label: string;
  readonly value: number | null;
  readonly note: string | null;
}

export interface ModelPerformanceDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly generated_at: string | null;
  readonly variant: string | null;
  readonly command: string;
  readonly metrics: readonly MetricDto[];
  readonly artifacts: readonly ModelArtifactDto[];
}

export interface FeatureWeightDto {
  readonly feature: string;
  readonly value: number;
  readonly source: 'risk-weight' | 'screener' | 'measured';
  readonly note: string;
}

export interface FeatureImportanceDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly runs_measured: number;
  readonly measured: readonly FeatureWeightDto[];
  readonly declared: readonly FeatureWeightDto[];
}

export interface FunnelStageDto {
  readonly label: string;
  readonly value: number;
  readonly note: string;
}

export interface FunnelDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly run_id: string | null;
  readonly query: string | null;
  readonly stages: readonly FunnelStageDto[];
}

export interface TypologyOutcomeDto {
  readonly typology: string;
  readonly label: string;
  readonly kind: string;
  readonly count: number;
}

export interface CatalogueSummaryDto {
  readonly typologies: readonly string[];
  readonly rules: readonly HypothesisRuleDto[];
  readonly profiles: readonly RiskProfileDto[];
  readonly screening: ScreeningSignalDto;
  readonly performance: ModelPerformanceDto;
  readonly feature_importance: FeatureImportanceDto;
  readonly funnel: FunnelDto;
  readonly outcomes: readonly TypologyOutcomeDto[];
  readonly runs_cached: number;
}

/* ----------------------------- dataset analytics ----------------------------- */

export interface SeriesPointDto {
  readonly bucket: string;
  readonly count: number;
  readonly value: number;
}

export interface VolumeSeriesDto {
  readonly bucket: string;
  readonly node: string | null;
  readonly points: readonly SeriesPointDto[];
  readonly total_count: number;
  readonly total_value: number;
}

export interface BandDto {
  readonly label: string;
  readonly count: number;
  readonly value: number;
  readonly lower: number | null;
  readonly upper: number | null;
}

export interface DistributionsDto {
  readonly transactions: number;
  readonly amount_bands: readonly BandDto[];
  readonly payment_formats: readonly BandDto[];
  readonly currencies: readonly BandDto[];
}

export interface CorridorHeatDto {
  readonly rows: ReadonlyArray<{ readonly row: string; readonly values: readonly number[] }>;
  readonly columns: readonly string[];
  readonly row_label: string;
  readonly note: string;
}

export interface SegmentsDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly clusters: ReadonlyArray<{
    readonly label: string;
    readonly accounts: number;
    readonly share: number;
  }>;
  readonly accounts: number;
  readonly features: readonly string[];
}

export interface CandidateScatterDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly x_label: string;
  readonly y_label: string;
  readonly size_label: string;
  readonly eligible: number;
  readonly dropped: number;
  readonly points: ReadonlyArray<{
    readonly node: string;
    readonly rank: number;
    readonly x: number;
    readonly y: number;
    readonly size: number;
  }>;
}

export interface MoneyFlowDto {
  readonly centre: string;
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly column: number;
    readonly role: string;
  }>;
  readonly links: ReadonlyArray<{
    readonly source: string;
    readonly target: string;
    readonly value: number;
    readonly tx_count: number;
  }>;
  readonly inbound_value: number;
  readonly outbound_value: number;
  readonly truncated: boolean;
}

export interface EntityEventDto {
  readonly tx_id: number;
  readonly at: string;
  readonly day: number;
  readonly kind: string;
  readonly channel: string;
  readonly direction: string;
  readonly counterparty: string;
  readonly amount: number;
  readonly currency: string;
  readonly payment_format: string;
  readonly labelled: boolean;
}

export interface EntityTimelineDto {
  readonly node: string;
  readonly first_seen: string | null;
  readonly last_seen: string | null;
  readonly span_days: number;
  readonly events: readonly EntityEventDto[];
  readonly truncated: boolean;
}

/* -------------------------- evidence attribution -------------------------- */

export interface ClaimCitationDto {
  readonly claim_id: string;
  readonly family: string;
  readonly claim: string;
  readonly calculation: string;
  readonly direction: string;
  readonly strength: number;
  readonly weighted: boolean;
  readonly node: string;
  readonly tx_count: number;
}

export interface AttributedTransactionDto {
  readonly transaction: TransactionDto;
  readonly citations: readonly ClaimCitationDto[];
  readonly families: readonly string[];
  readonly peak_strength: number | null;
  /** risk of the ACCOUNT the citing claim belongs to — never of the transaction */
  readonly account: string | null;
  readonly account_risk: number | null;
  readonly account_tier: string | null;
}

export interface AttributionDto {
  readonly run_id: string;
  readonly case_id: string;
  readonly query: string;
  readonly typology: string;
  readonly cited_transactions: number;
  readonly claims: number;
  readonly published_transactions: number;
  readonly rows: readonly AttributedTransactionDto[];
  readonly note: string;
}


/* ------------------------------ reports + artefacts ------------------------------ */

/** Where one paragraph's facts came from. A section with no sources should not ship. */
export interface ReportSourceDto {
  readonly kind: 'evidence' | 'tool' | 'declaration' | 'dataset' | 'exclusion';
  readonly ref: string;
  readonly detail: string;
  readonly tx_count: number;
  readonly tx_ids: readonly number[];
}

export interface ReportSectionDto {
  readonly heading: string;
  readonly body: string;
  readonly sources: readonly ReportSourceDto[];
}

/** One filing precondition. `manual` means a person has to do it, and is reported
 *  distinctly from `blocked` so the UI never shows a human step as auto-satisfied. */
export interface ReportReadinessDto {
  readonly id: string;
  readonly label: string;
  readonly status: 'ok' | 'blocked' | 'manual';
  readonly blocker: string | null;
}

export interface ArtifactDto {
  readonly name: string;
  readonly label: string;
  readonly media_type: string;
  readonly bytes: number;
  /** Digest of the exact bytes the download will return. */
  readonly sha256: string;
  /** Path relative to the API root, already including the version prefix. */
  readonly url: string;
  readonly redaction_profile: string;
}

export interface ReportDto {
  readonly available: boolean;
  readonly reason: string | null;
  readonly run_id: string;
  readonly case_id: string;
  readonly subject: string | null;
  readonly typology: string | null;
  readonly verdict: string | null;
  readonly risk: number;
  readonly tier: string | null;
  readonly escalation: string | null;
  readonly generated_at: string;
  /** Always false. The engine drafts; it does not file. */
  readonly filed: boolean;
  readonly sections: readonly ReportSectionDto[];
  readonly readiness: readonly ReportReadinessDto[];
  readonly artifacts: readonly ArtifactDto[];
  readonly notes: readonly string[];
}
