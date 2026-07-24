/* ------------------------------------------------------------------
   Domain vocabulary. Shared by every workspace so a "severity" or a
   "score" means exactly one thing across the whole product.
   ------------------------------------------------------------------ */

export type Severity = 'severe' | 'review' | 'clear';

export type RiskLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type WorkspaceId =
  | 'watchtower'
  | 'ask'
  | 'cases'
  | 'graph'
  | 'ledger'
  | 'models'
  | 'reports'
  | 'audit';

export type RunPhase = 'idle' | 'running' | 'complete';

export type ToolStatus = 'ran' | 'skipped' | 'failed';

export type StepState = 'queued' | 'running' | 'done' | 'skipped' | 'failed';

/** the five visible acts of an investigation */
export type ExecutionStage = 'understanding' | 'planning' | 'selection' | 'execution' | 'reporting';

export type EscalationAction = 'report' | 'review' | 'monitor';

export const severityOfLevel = (level: RiskLevel): Severity => {
  switch (level) {
    case 'HIGH':
      return 'severe';
    case 'MEDIUM':
      return 'review';
    default:
      return 'clear';
  }
};

export const severityOfScore = (score: number): Severity => {
  if (score >= 75) {
    return 'severe';
  }

  if (score >= 40) {
    return 'review';
  }

  return 'clear';
};

/* ---------------------------- agent ---------------------------- */

export interface Artifact {
  readonly label: string;
  readonly value: string;
  readonly emphasis?: boolean;
}

export interface TraceStep {
  readonly tool: string;
  readonly label: string;
  readonly stage: ExecutionStage;
  readonly status: ToolStatus;
  readonly reason: string;
  /** real backend latency in ms — the stage replays it honestly */
  readonly durationMs: number;
  readonly rowsIn?: number;
  readonly rowsOut?: number;
  readonly detail?: string;
  /** shown live while the node runs */
  readonly activity?: readonly string[];
  readonly inputs?: readonly Artifact[];
  readonly outputs?: readonly Artifact[];
}

export interface FindingRow {
  readonly id: string;
  readonly entity: string;
  readonly name: string;
  readonly primary: string;
  readonly secondary: string;
  readonly pattern: string;
  readonly score: number;
  readonly level: RiskLevel;
}

export interface ScoreComponent {
  readonly label: string;
  readonly weight: number;
  readonly value: number;
}

export interface Recommendation {
  readonly action: EscalationAction;
  readonly headline: string;
  readonly detail: string;
  readonly sla: string;
}

export interface Explanation {
  readonly subject: string;
  readonly level: RiskLevel;
  readonly score: number;
  /** a probability when the model reports one, a named band when it reports that instead */
  readonly confidence: number | string;
  readonly narrative: string;
  readonly evidence: readonly string[];
  readonly breakdown: readonly ScoreComponent[];
  readonly recommendation: Recommendation;
  readonly modelVersion: string;
}

export interface SummaryStat {
  readonly label: string;
  readonly value: string;
  readonly severity?: Severity;
}

/* ------------------------- visualization engine -------------------------
   The backend returns visualization metadata; the frontend maps each spec
   onto a component. Different intents therefore produce different dossiers
   without any screen being hard-coded. */

export type ChartKind =
  | 'bars'
  | 'hbars'
  | 'line'
  | 'area'
  | 'stacked'
  | 'pie'
  | 'donut'
  | 'gauge'
  | 'heatmap'
  | 'sankey'
  | 'waterfall'
  | 'scatter'
  | 'treemap'
  | 'corridor';

export interface Datum {
  readonly label: string;
  readonly value: number;
  readonly severity?: Severity;
  readonly note?: string;
}

export interface SeriesPoint {
  readonly label: string;
  readonly values: readonly number[];
}

export interface SankeyLink {
  readonly from: string;
  readonly to: string;
  readonly value: number;
  readonly severity?: Severity;
}

export interface SankeyNodeSpec {
  readonly id: string;
  readonly label: string;
  readonly column: 0 | 1 | 2 | 3;
  readonly severity?: Severity;
}

export interface ScatterPoint {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly severity: Severity;
  readonly label: string;
}

export interface CorridorFlow {
  readonly from: string;
  readonly to: string;
  readonly value: number;
  readonly severity: Severity;
}

export interface ChartSpec {
  readonly kind: ChartKind;
  readonly title: string;
  readonly subtitle?: string;
  readonly footnote?: string;
  readonly unit?: string;
  readonly data?: readonly Datum[];
  readonly series?: readonly SeriesPoint[];
  readonly seriesNames?: readonly string[];
  readonly sankey?: {
    readonly nodes: readonly SankeyNodeSpec[];
    readonly links: readonly SankeyLink[];
  };
  readonly scatter?: readonly ScatterPoint[];
  readonly corridor?: readonly CorridorFlow[];
  readonly heatRows?: ReadonlyArray<{ readonly row: string; readonly values: readonly number[] }>;
  readonly heatColumns?: readonly string[];
  readonly gauge?: { readonly value: number; readonly label: string; readonly caption: string };
}

export type SectionKind =
  | 'summary'
  | 'execution-summary'
  | 'planning'
  | 'features'
  | 'detection'
  | 'risk-classification'
  | 'chart'
  | 'graph'
  | 'timeline'
  | 'evidence'
  | 'explanation'
  | 'recommendation'
  | 'sar'
  | 'downloads';

/* ------------------------- agent planning + tooling -------------------------
   The six planning derivations the agent performs before it dispatches
   anything. Rendered as a labelled block so the tool path is visibly a
   decision rather than a fixed pipeline. */

export type PlanningStage =
  | 'intent_extraction'
  | 'entity_extraction'
  | 'filter_detection'
  | 'pattern_detection'
  | 'tool_selection'
  | 'execution_planning';

export interface PlanningDecision {
  readonly stage: PlanningStage;
  readonly label: string;
  /** the derived value, e.g. "customer_lookup" or "none detected" */
  readonly value: string;
  /** why the agent concluded that */
  readonly detail: string;
  readonly confidence?: number;
}

/** one engineered AML feature, included or deliberately not computed */
export interface FeatureSpec {
  readonly name: string;
  readonly display: string;
  readonly pattern: string;
  readonly value: string;
  readonly description: string;
  readonly included: boolean;
  readonly reason?: string;
}

export interface DetectionModel {
  readonly name: string;
  readonly kind: 'rules' | 'supervised' | 'unsupervised' | 'graph';
  readonly role: string;
}

export interface DetectionSummary {
  readonly models: readonly DetectionModel[];
  readonly anomalyType: string;
  /** model probability 0–1, when the engine publishes one */
  readonly score?: number;
  /** decision threshold, when the engine publishes one */
  readonly threshold?: number;
  readonly confidence: number | string;
  readonly durationMs: number;
  readonly evaluated: number;
  readonly flagged: number;
  readonly topFeatures: ReadonlyArray<{ readonly feature: string; readonly contribution: number }>;
}

export interface RiskClassification {
  readonly score: number;
  readonly level: RiskLevel;
  readonly severity: Severity;
  readonly confidence: number | string;
  readonly band: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly components: readonly ScoreComponent[];
}

/** everything the PS asks the execution summary to state */
export interface AgentDetail {
  readonly amlPattern: string;
  readonly entities: readonly string[];
  readonly filters: readonly string[];
  readonly investigationSummary: string;
  readonly planning: readonly PlanningDecision[];
  readonly features: readonly FeatureSpec[];
  readonly detection: DetectionSummary | null;
  readonly risk: RiskClassification | null;
}

export interface DossierSection {
  readonly id: string;
  readonly kind: SectionKind;
  readonly title: string;
  readonly span: 'full' | 'half' | 'third' | 'two-thirds';
  /** section materialises the moment this tool resolves */
  readonly unlockAfter: string;
  readonly chart?: ChartSpec;
  readonly note?: string;
}

export interface Scenario {
  readonly id: string;
  readonly query: string;
  readonly action: string;
  readonly intent: ReadonlyArray<readonly [string, string]>;
  readonly plannerNote: string;
  readonly steps: readonly TraceStep[];
  readonly resultHeadline: string;
  readonly headlineMetric: { readonly label: string; readonly value: string; readonly severity: Severity };
  readonly columns: readonly string[];
  readonly rows: readonly FindingRow[];
  readonly summary: readonly SummaryStat[];
  readonly sections: readonly DossierSection[];
  readonly explanation: Explanation | null;
  readonly noExplanationReason?: string;
  readonly caseId?: string;
  /** Present on live runs: the agent reasoning the backend reported for this run.
      Absent on the bundled demo scenarios, which read from `data/agentDetail`. */
  readonly detail?: AgentDetail;
  /** true when this scenario came from the engine rather than the bundled demo set */
  readonly live?: boolean;
}

/* ---------------------------- entities ---------------------------- */

export type EntityKind =
  | 'person'
  | 'company'
  | 'account'
  | 'offshore'
  | 'device'
  | 'branch'
  | 'wallet';

export interface GraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind: EntityKind;
  readonly x: number;
  readonly y: number;
  readonly hop: 1 | 2;
  readonly role: string;
  readonly centrality: number;
  readonly severity: Severity;
  readonly facts: ReadonlyArray<readonly [string, string]>;
}

export type EdgeKind = 'transfer' | 'large-transfer' | 'shared-device' | 'ownership';

export interface GraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  readonly label: string;
  readonly hop: 1 | 2;
}

/* ---------------------------- case work ---------------------------- */

export type SpineKind = 'transaction' | 'entity' | 'rule' | 'graph' | 'note' | 'trace' | 'chart';

export interface SpineItem {
  readonly id: string;
  readonly kind: SpineKind;
  readonly label: string;
  readonly meta: string;
  readonly caseId: string;
}

export type TimelineKind = 'account' | 'deposit' | 'wire' | 'model' | 'note' | 'sar' | 'alert';

export interface TimelineEvent {
  readonly id: string;
  readonly day: number;
  readonly kind: TimelineKind;
  readonly label: string;
  readonly detail: string;
  readonly severity: Severity;
  readonly amount?: string;
}

export interface CaseRecord {
  readonly id: string;
  readonly entity: string;
  readonly name: string;
  readonly score: number;
  readonly severity: Severity;
  readonly stage: 'triage' | 'investigating' | 'sar-draft' | 'filed';
  readonly slaHours: number;
  readonly assignee: string;
  readonly pattern: string;
  readonly opened: string;
  readonly exposure: string;
}

export interface RiskDelta {
  readonly label: string;
  readonly points: number;
  readonly source: string;
}

export interface NextStep {
  readonly id: string;
  readonly label: string;
  readonly rationale: string;
  readonly effort: string;
}

/* ---------------------------- models ---------------------------- */

/** Read-only view of a rule's contribution. Thresholds are displayed as
    part of the expression but are not editable in the product. */
export interface RuleContribution {
  readonly id: string;
  readonly name: string;
  readonly expression: string;
  readonly pattern: string;
  readonly firedCount: number;
  readonly shareOfAlerts: number;
  readonly precision: number;
  readonly regulatoryBasis?: string;
  readonly enabled: boolean;
}

/* ---------------------------- misc ---------------------------- */

export interface Toast {
  readonly id: number;
  readonly title: string;
  readonly detail: string;
  readonly severity: Severity | 'info';
}

export interface ScopeChip {
  readonly id: string;
  readonly kind: 'time' | 'entity' | 'pattern' | 'jurisdiction' | 'case';
  readonly label: string;
  readonly locked?: boolean;
}
