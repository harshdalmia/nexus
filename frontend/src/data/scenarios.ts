import * as viz from '@/data/visuals';
import type { Artifact, DossierSection, ExecutionStage, Scenario, TraceStep } from '@/types/aml';

/* ------------------------------------------------------------------
   Four canonical runs. Three are the queries in the problem statement,
   the fourth is the open-ended case where the full pipeline is
   justified. Latencies are the real backend numbers: the execution
   stage replays them honestly rather than pretending to be instant.
   Every scenario carries the same fourteen-node roster in the same
   order, so counters in the UI are computed, never asserted.
   ------------------------------------------------------------------ */

interface StepInit {
  readonly tool: string;
  readonly label: string;
  readonly stage: ExecutionStage;
  readonly ms: number;
  readonly reason: string;
  readonly detail?: string;
  readonly rowsIn?: number;
  readonly rowsOut?: number;
  readonly activity?: readonly string[];
  readonly inputs?: readonly Artifact[];
  readonly outputs?: readonly Artifact[];
}

const ran = (init: StepInit): TraceStep => ({
  tool: init.tool,
  label: init.label,
  stage: init.stage,
  status: 'ran',
  reason: init.reason,
  durationMs: init.ms,
  detail: init.detail,
  rowsIn: init.rowsIn,
  rowsOut: init.rowsOut,
  activity: init.activity,
  inputs: init.inputs,
  outputs: init.outputs,
});

const failed = (init: StepInit & { readonly failure: string }): TraceStep => ({
  ...ran(init),
  status: 'failed',
  detail: init.failure,
});

const skip = (tool: string, label: string, stage: ExecutionStage, reason: string): TraceStep => ({
  tool,
  label,
  stage,
  status: 'skipped',
  reason,
  durationMs: 0,
});

const NO_EDA = (reason: string) => skip('eda_profiler', 'EDA Profiler', 'execution', reason);
const NO_AGG = (reason: string) => skip('direct_aggregation', 'Direct Aggregation', 'execution', reason);

/* ------------------------------- sections ------------------------------- */

const section = (
  id: string,
  kind: DossierSection['kind'],
  title: string,
  span: DossierSection['span'],
  unlockAfter: string,
  chart?: DossierSection['chart'],
  note?: string,
): DossierSection => ({ id, kind, title, span, unlockAfter, chart, note });

/* =========================== STRUCTURING =========================== */

const structuring: Scenario = {
  id: 'structuring',
  query: 'Find structuring patterns in the last 30 days',
  action: 'detect_pattern',
  caseId: 'C-114',
  intent: [
    ['action', 'detect_pattern'],
    ['target_pattern', 'structuring'],
    ['entity_type', 'customer'],
    ['date_range', 'last_30_days'],
    ['txn_type', 'cash_deposit'],
    ['jurisdiction', 'any'],
  ],
  plannerNote:
    'The typology is named, so exploration is wasted work. Feature engineering narrows to the six structuring-tagged features and the profiler is dropped.',
  steps: [
    ran({
      tool: 'intent_classifier',
      label: 'Intent Classifier',
      stage: 'understanding',
      ms: 1180,
      reason: 'Turns free text into a typed intent with filters. Always first.',
      activity: ['tokenising query', 'resolving temporal expression "last 30 days"', 'matching typology vocabulary'],
      inputs: [{ label: 'query', value: '"Find structuring patterns in the last 30 days"' }],
      outputs: [
        { label: 'action', value: 'detect_pattern', emphasis: true },
        { label: 'typology', value: 'structuring', emphasis: true },
        { label: 'window', value: '25 Jun – 24 Jul 2026' },
        { label: 'confidence', value: '0.97' },
      ],
    }),
    ran({
      tool: 'planner',
      label: 'Planner',
      stage: 'planning',
      ms: 2140,
      reason: 'Explicit typology → load, structuring features, graph, hybrid detection, score, explain, recommend.',
      activity: ['scoring 14 candidate nodes', 'pruning nodes with no marginal value', 'ordering the DAG'],
      inputs: [{ label: 'intent', value: 'detect_pattern · structuring' }],
      outputs: [
        { label: 'nodes selected', value: '12 of 14', emphasis: true },
        { label: 'nodes declined', value: 'eda_profiler, direct_aggregation' },
        { label: 'estimated cost', value: '~30s · 1 model inference pass' },
      ],
    }),
    ran({
      tool: 'tool_selector',
      label: 'Tool Selector',
      stage: 'selection',
      ms: 640,
      reason: 'Binds each planned node to a concrete implementation and feature subset.',
      activity: ['binding feature tags', 'resolving model artifact', 'checking plan cache'],
      inputs: [{ label: 'plan', value: '12 nodes' }],
      outputs: [
        { label: 'features bound', value: '6 of 21 · structuring-tagged', emphasis: true },
        { label: 'model', value: 'xgboost_v4 (sha 9f2c11e)' },
        { label: 'rules armed', value: 'STRUCT_001, SMURF_001, CASHOUT_001, ROUND_001, GEO_001' },
      ],
    }),
    ran({
      tool: 'entity_resolver',
      label: 'Entity Resolver',
      stage: 'execution',
      ms: 3260,
      reason: 'Collapses account numbers, names and devices into stable entity identities.',
      activity: ['fuzzy-matching names', 'clustering shared devices and addresses', 'assigning entity ids'],
      inputs: [{ label: 'accounts in scope', value: '48,210' }],
      outputs: [
        { label: 'entities resolved', value: '31,884', emphasis: true },
        { label: 'merges applied', value: '1,412' },
        { label: 'shared-device clusters', value: '87' },
      ],
    }),
    ran({
      tool: 'transaction_loader',
      label: 'Transaction Loader',
      stage: 'execution',
      ms: 4180,
      reason: 'Pulls cash deposits for the window. Nothing downstream can run without it.',
      rowsIn: 1204882,
      rowsOut: 86420,
      activity: ['querying postgres partition 2026-06/07', 'streaming 86,420 rows', 'hydrating counterparties'],
      inputs: [{ label: 'screened population', value: '1,204,882 transactions' }],
      outputs: [
        { label: 'rows loaded', value: '86,420', emphasis: true },
        { label: 'accounts touched', value: '12,904' },
        { label: 'value in window', value: '$412.8M' },
      ],
    }),
    NO_EDA('Declined. The query already names its typology, so population profiling changes no decision.'),
    ran({
      tool: 'feature_builder',
      label: 'Feature Builder',
      stage: 'execution',
      ms: 3540,
      reason: 'Computes only the features tagged to structuring — 6 of 21.',
      rowsIn: 86420,
      rowsOut: 86420,
      detail:
        'txns_9000_9999_count_30d · rolling_sum_7d · txn_velocity · inter_txn_gap · repeated_amount_ratio · round_amount_ratio',
      activity: ['rolling 7d windows', 'threshold-band counts', 'inter-arrival gaps'],
      inputs: [{ label: 'rows', value: '86,420' }],
      outputs: [
        { label: 'feature matrix', value: '86,420 × 6', emphasis: true },
        { label: 'features skipped', value: '15 · irrelevant to structuring' },
        { label: 'cache hits', value: '38%' },
      ],
    }),
    ran({
      tool: 'graph_builder',
      label: 'Graph Builder',
      stage: 'execution',
      ms: 2980,
      reason: 'Builds the money-flow graph so fan-in and layering are measurable, not guessed.',
      rowsIn: 86420,
      rowsOut: 1189,
      activity: ['building adjacency', 'computing betweenness centrality', 'detecting fan-in motifs'],
      inputs: [{ label: 'transactions', value: '86,420' }],
      outputs: [
        { label: 'entities', value: '472', emphasis: true },
        { label: 'relationships', value: '1,189', emphasis: true },
        { label: 'suspicious clusters', value: '12', emphasis: true },
        { label: 'max centrality', value: '0.81 · entity 4521' },
      ],
    }),
    ran({
      tool: 'detection_engine',
      label: 'Detection Engine',
      stage: 'execution',
      ms: 5120,
      reason: 'Deterministic rules first, then XGBoost over the residual population, then novelty.',
      rowsIn: 86420,
      rowsOut: 41,
      detail: 'rule hits 34 · ml-only 7 · isolation-forest novelty 2',
      activity: ['evaluating 5 rules', 'xgboost inference · 86,420 rows', 'isolation forest novelty pass'],
      inputs: [{ label: 'feature matrix', value: '86,420 × 6' }],
      outputs: [
        { label: 'customers flagged', value: '41', emphasis: true },
        { label: 'rule hits', value: '34' },
        { label: 'model-only hits', value: '7' },
        { label: 'novelty hits', value: '2' },
        { label: 'flag rate', value: '0.047% of screened' },
      ],
    }),
    NO_AGG('Declined. The question is not a count — detection and scoring answer it directly.'),
    ran({
      tool: 'risk_engine',
      label: 'Risk Engine',
      stage: 'execution',
      ms: 2180,
      reason: 'Weighted blend: rules 0.35, model 0.35, behaviour 0.20, history 0.10.',
      rowsIn: 41,
      rowsOut: 41,
      activity: ['scoring rule hits', 'blending model probability', 'banding into low/medium/high'],
      inputs: [{ label: 'detections', value: '41' }],
      outputs: [
        { label: 'high risk', value: '9', emphasis: true },
        { label: 'medium risk', value: '18' },
        { label: 'low risk', value: '14' },
        { label: 'top score', value: '87 · entity 4521' },
      ],
    }),
    ran({
      tool: 'explainability',
      label: 'Explainability',
      stage: 'reporting',
      ms: 2640,
      reason: 'Rule reasons lead, SHAP supports. Written for a compliance reader, not a data scientist.',
      rowsIn: 41,
      rowsOut: 41,
      activity: ['TreeExplainer over 41 rows', 'ranking drivers', 'composing narratives'],
      inputs: [{ label: 'scored findings', value: '41' }],
      outputs: [
        { label: 'narratives written', value: '41', emphasis: true },
        { label: 'dominant driver', value: 'txns_9000_9999_count_30d · +0.31' },
        { label: 'mean confidence', value: '0.93' },
      ],
    }),
    ran({
      tool: 'recommendation_engine',
      label: 'Recommendation Engine',
      stage: 'reporting',
      ms: 720,
      reason: 'Maps score bands onto monitor / review / report with the regulatory clock attached.',
      activity: ['applying escalation policy', 'attaching SLA clocks'],
      inputs: [{ label: 'scored findings', value: '41' }],
      outputs: [
        { label: 'report', value: '9', emphasis: true },
        { label: 'review', value: '18' },
        { label: 'monitor', value: '14' },
      ],
    }),
    ran({
      tool: 'report_generator',
      label: 'Report Generator',
      stage: 'reporting',
      ms: 1120,
      reason: 'Assembles the dossier, the execution summary and a SAR draft for the top finding.',
      activity: ['assembling dossier sections', 'drafting SAR narrative', 'writing audit entry'],
      inputs: [{ label: 'dossier sections', value: '21' }],
      outputs: [
        { label: 'SAR draft', value: 'C-114 · 5 sourced paragraphs', emphasis: true },
        { label: 'artefacts', value: 'PDF · CSV · JSON' },
        { label: 'audit entry', value: 'written · immutable' },
      ],
    }),
  ],
  resultHeadline: '41 customers show structuring behaviour',
  headlineMetric: { label: 'customers flagged', value: '41', severity: 'severe' },
  columns: ['Customer', 'Deposits $9k–$9.99k', '30d volume', 'Pattern', 'Risk'],
  rows: [
    { id: 'f-4521', entity: '4521', name: 'Meridian Trading Co.', primary: '14', secondary: '$1,284,900', pattern: 'structuring + fan-in', score: 87, level: 'HIGH' },
    { id: 'f-9004', entity: '9004', name: 'Novak Exports Ltd', primary: '11', secondary: '$742,300', pattern: 'structuring + cash-out', score: 81, level: 'HIGH' },
    { id: 'f-3308', entity: '3308', name: 'R. Advani', primary: '9', secondary: '$318,650', pattern: 'structuring', score: 76, level: 'HIGH' },
    { id: 'f-7710', entity: '7710', name: 'Calder Holdings', primary: '7', secondary: '$556,100', pattern: 'structuring + layering', score: 63, level: 'MEDIUM' },
    { id: 'f-2255', entity: '2255', name: 'S. Bhatt', primary: '5', secondary: '$121,400', pattern: 'structuring', score: 51, level: 'MEDIUM' },
    { id: 'f-6120', entity: '6120', name: 'Larkspur Retail', primary: '4', secondary: '$88,900', pattern: 'round-amount clustering', score: 44, level: 'MEDIUM' },
    { id: 'f-5540', entity: '5540', name: 'Trentham Logistics', primary: '4', secondary: '$142,050', pattern: 'structuring', score: 38, level: 'LOW' },
  ],
  summary: [
    { label: 'flagged', value: '41' },
    { label: 'severe', value: '9', severity: 'severe' },
    { label: 'review', value: '18', severity: 'review' },
    { label: 'rule ∩ model', value: '82%', severity: 'clear' },
  ],
  sections: [
    section('s-exec', 'execution-summary', 'Execution summary', 'full', 'report_generator'),
    section('s-plan', 'planning', 'Agent planning & tool selection', 'full', 'tool_selector'),
    section('s-summary', 'summary', 'Executive summary', 'full', 'risk_engine'),
    section('s-features', 'features', 'Feature engineering', 'full', 'feature_builder'),
    section('s-detect', 'detection', 'Anomaly detection', 'half', 'detection_engine'),
    section('s-riskclass', 'risk-classification', 'Risk classification', 'half', 'risk_engine'),
    section('s-dist', 'chart', 'Risk distribution', 'half', 'risk_engine', viz.riskDistribution),
    section('s-cats', 'chart', 'Alert categories', 'half', 'detection_engine', viz.alertCategories),
    section('s-flow', 'chart', 'Money flow', 'two-thirds', 'graph_builder', viz.moneyFlowSankey),
    section('s-gauge', 'chart', 'Model confidence', 'third', 'risk_engine', viz.confidenceGauge),
    section('s-graph', 'graph', 'Entity connectivity', 'half', 'graph_builder'),
    section('s-timeline', 'timeline', 'Transaction timeline', 'half', 'transaction_loader'),
    section('s-daily', 'chart', 'Daily suspicious activity', 'half', 'transaction_loader', viz.dailySuspicious),
    section('s-volume', 'chart', 'Transaction volume', 'half', 'transaction_loader', viz.volumeLine),
    section('s-evolution', 'chart', 'Risk evolution', 'half', 'risk_engine', viz.riskEvolution),
    section('s-heat', 'chart', 'Risk by jurisdiction', 'half', 'transaction_loader', viz.jurisdictionHeat),
    section('s-corridor', 'chart', 'Geographical risk', 'third', 'transaction_loader', viz.corridorMap),
    section('s-segments', 'chart', 'Customer segments', 'third', 'feature_builder', viz.segmentTreemap),
    section('s-clusters', 'chart', 'Cluster detection', 'third', 'detection_engine', viz.clusterScatter),
    section('s-composition', 'chart', 'Risk composition', 'third', 'risk_engine', viz.riskComposition),
    section('s-rules', 'chart', 'Rule contribution', 'third', 'detection_engine', viz.ruleContribution),
    section('s-shap', 'chart', 'Feature contribution', 'third', 'explainability', viz.shapWaterfall),
    section('s-evidence', 'evidence', 'Evidence table', 'full', 'detection_engine'),
    section('s-explain', 'explanation', 'AI explanation', 'full', 'explainability'),
    section('s-reco', 'recommendation', 'Recommendation', 'full', 'recommendation_engine'),
    section('s-sar', 'sar', 'Generated SAR', 'two-thirds', 'report_generator'),
    section('s-downloads', 'downloads', 'Download centre', 'third', 'report_generator'),
  ],
  explanation: {
    subject: 'Customer 4521 · Meridian Trading Co.',
    level: 'HIGH',
    score: 87,
    confidence: 0.93,
    modelVersion: 'xgboost_v4 · trained 2026-07-18',
    narrative:
      'You asked for structuring over the last 30 days, and 4521 is the least ambiguous case in the population. The account took 14 cash deposits between $9,000 and $9,999 — each one deliberately short of the $10,000 reporting line — while aggregate inflow reached $1.28M from 23 unrelated senders. Funds left again within roughly 41 minutes on average, which reads as structuring feeding a fan-in layer rather than trading receipts.',
    evidence: [
      'STRUCT_001 · 14 transactions in the $9,000–$9,999 band, threshold is 3',
      'SMURF_001 · 23 distinct senders moved $187,400 into one account, threshold is 10',
      'CASHOUT_001 · median deposit-to-withdrawal gap 41 minutes, threshold is 2 hours',
      'SHAP · txns_9000_9999_count_30d contributed +0.31 of a 0.88 model probability',
      'Graph · betweenness centrality 0.81, the highest in a 472-entity network',
      'KYC · account 42 days old, refresh overdue by 18 days',
    ],
    breakdown: [
      { label: 'rule score', weight: 0.35, value: 92 },
      { label: 'ml probability', weight: 0.35, value: 88 },
      { label: 'behavioural deviation', weight: 0.2, value: 76 },
      { label: 'alert history', weight: 0.1, value: 60 },
    ],
    recommendation: {
      action: 'report',
      headline: 'Escalate and file a SAR',
      detail:
        'Three deterministic rules fired alongside a high model probability. Draft from the evidence spine and hold outbound wires to 7710 and 9004 pending L3 sign-off.',
      sla: 'regulatory clock · file within 30 days of detection',
    },
  },
};

/* ============================ AGGREGATE ============================ */

const aggregate: Scenario = {
  id: 'aggregate',
  query: 'Find customers with 10+ transactions under $10,000',
  action: 'aggregate_threshold',
  intent: [
    ['action', 'aggregate_threshold'],
    ['entity_type', 'customer'],
    ['min_count', '10'],
    ['max_amount', '10000'],
    ['date_range', 'last_30_days'],
    ['target_pattern', 'none'],
  ],
  plannerNote:
    'A counting question, not a detection question. Models would add 20 seconds and invent risk the analyst never asked about, so the entire inference branch is declined.',
  steps: [
    ran({
      tool: 'intent_classifier',
      label: 'Intent Classifier',
      stage: 'understanding',
      ms: 1090,
      reason: 'Recognises a countable threshold rather than a typology.',
      activity: ['parsing numeric constraints', 'detecting absence of typology'],
      inputs: [{ label: 'query', value: '"Which customers made 10+ transactions under $10,000?"' }],
      outputs: [
        { label: 'action', value: 'aggregate_threshold', emphasis: true },
        { label: 'min_count', value: '10' },
        { label: 'max_amount', value: '$10,000' },
        { label: 'typology', value: 'none — nothing to detect' },
      ],
    }),
    ran({
      tool: 'planner',
      label: 'Planner',
      stage: 'planning',
      ms: 1760,
      reason: 'Deterministic answer available from one aggregation. Everything else is declined.',
      activity: ['scoring 14 candidate nodes', 'declining the inference branch'],
      inputs: [{ label: 'intent', value: 'aggregate_threshold' }],
      outputs: [
        { label: 'nodes selected', value: '7 of 14', emphasis: true },
        { label: 'nodes declined', value: '7 · including all inference', emphasis: true },
        { label: 'estimated cost', value: '~9s · no model inference' },
      ],
    }),
    ran({
      tool: 'tool_selector',
      label: 'Tool Selector',
      stage: 'selection',
      ms: 520,
      reason: 'Binds the aggregation to SQL rather than the feature pipeline.',
      outputs: [
        { label: 'execution mode', value: 'pushdown SQL', emphasis: true },
        { label: 'models loaded', value: 'none' },
      ],
    }),
    ran({
      tool: 'entity_resolver',
      label: 'Entity Resolver',
      stage: 'execution',
      ms: 980,
      reason: 'Still required — counting per customer needs stable identities, not raw account numbers.',
      outputs: [
        { label: 'entities resolved', value: '12,904', emphasis: true },
        { label: 'merges applied', value: '206' },
      ],
    }),
    ran({
      tool: 'transaction_loader',
      label: 'Transaction Loader',
      stage: 'execution',
      ms: 2640,
      reason: 'Filters to transactions under $10,000 inside the window.',
      rowsIn: 1204882,
      rowsOut: 112904,
      activity: ['pushing predicate to postgres', 'streaming 112,904 rows'],
      outputs: [
        { label: 'rows loaded', value: '112,904', emphasis: true },
        { label: 'value in window', value: '$284.1M' },
      ],
    }),
    NO_EDA('Declined. Nothing to explore behind an explicit numeric filter.'),
    skip('feature_builder', 'Feature Builder', 'execution', 'Declined. The answer is a count, not a model input.'),
    skip('graph_builder', 'Graph Builder', 'execution', 'Declined. No relationship question was asked.'),
    skip(
      'detection_engine',
      'Detection Engine',
      'execution',
      'Declined. The analyst asked who matches a threshold, not who is suspicious. Scoring here would manufacture risk the query never requested.',
    ),
    ran({
      tool: 'direct_aggregation',
      label: 'Direct Aggregation',
      stage: 'execution',
      ms: 1180,
      reason: 'One group-by with a HAVING clause. Exact, cheap and fully auditable.',
      rowsIn: 112904,
      rowsOut: 128,
      detail: 'SELECT customer_id, COUNT(*), SUM(amount) … GROUP BY 1 HAVING COUNT(*) >= 10',
      activity: ['grouping by customer', 'applying HAVING COUNT(*) >= 10'],
      outputs: [
        { label: 'customers matched', value: '128', emphasis: true },
        { label: 'transactions covered', value: '4,604' },
        { label: 'largest count', value: '38 · entity 4521' },
      ],
    }),
    skip('risk_engine', 'Risk Engine', 'execution', 'Declined. No detections to score — cached scores are shown for orientation only.'),
    skip('explainability', 'Explainability', 'reporting', 'Declined. Nothing was flagged, so there is nothing to justify.'),
    skip(
      'recommendation_engine',
      'Recommendation Engine',
      'reporting',
      'Declined. No risk was assigned, so recommending an escalation would be inventing one.',
    ),
    ran({
      tool: 'report_generator',
      label: 'Report Generator',
      stage: 'reporting',
      ms: 860,
      reason: 'Assembles a counting dossier: distribution, bands and the matched list.',
      outputs: [
        { label: 'dossier sections', value: '6', emphasis: true },
        { label: 'SAR draft', value: 'not applicable' },
        { label: 'artefacts', value: 'CSV · JSON' },
      ],
    }),
  ],
  resultHeadline: '128 customers cross the threshold',
  headlineMetric: { label: 'customers matched', value: '128', severity: 'clear' },
  columns: ['Customer', 'Txns under $10k', 'Total value', 'Mean amount', 'Cached risk'],
  rows: [
    { id: 'a-4521', entity: '4521', name: 'Meridian Trading Co.', primary: '38', secondary: '$341,200', pattern: '$8,979 mean', score: 87, level: 'HIGH' },
    { id: 'a-9004', entity: '9004', name: 'Novak Exports Ltd', primary: '31', secondary: '$276,400', pattern: '$8,916 mean', score: 81, level: 'HIGH' },
    { id: 'a-1180', entity: '1180', name: 'Ashford Grocers', primary: '27', secondary: '$94,300', pattern: '$3,493 mean', score: 22, level: 'LOW' },
    { id: 'a-6120', entity: '6120', name: 'Larkspur Retail', primary: '24', secondary: '$188,900', pattern: '$7,871 mean', score: 44, level: 'MEDIUM' },
    { id: 'a-8871', entity: '8871', name: 'V. Kulkarni', primary: '19', secondary: '$61,700', pattern: '$3,247 mean', score: 15, level: 'LOW' },
    { id: 'a-5540', entity: '5540', name: 'Trentham Logistics', primary: '16', secondary: '$142,050', pattern: '$8,878 mean', score: 49, level: 'MEDIUM' },
  ],
  summary: [
    { label: 'matched', value: '128' },
    { label: 'tools used', value: '7 / 14', severity: 'clear' },
    { label: 'models run', value: 'none', severity: 'clear' },
    { label: 'latency', value: '9.0s', severity: 'clear' },
  ],
  sections: [
    section('a-exec', 'execution-summary', 'Execution summary', 'full', 'report_generator'),
    section('a-plan', 'planning', 'Agent planning & tool selection', 'full', 'tool_selector'),
    section('a-summary', 'summary', 'Executive summary', 'full', 'direct_aggregation'),
    section(
      'a-features',
      'features',
      'Feature engineering',
      'full',
      'direct_aggregation',
      undefined,
      'Feature Builder was declined for this query. The catalogue below shows what was available and why none of it was computed.',
    ),
    section('a-dist', 'chart', 'Transaction count distribution', 'half', 'direct_aggregation', viz.countDistribution),
    section('a-bands', 'chart', 'Amount bands', 'half', 'direct_aggregation', viz.amountBands),
    section('a-volume', 'chart', 'Transaction volume', 'two-thirds', 'transaction_loader', viz.volumeLine),
    section('a-segments', 'chart', 'Customer segments', 'third', 'entity_resolver', viz.aggregateSegments),
    section('a-evidence', 'evidence', 'Matched customers', 'full', 'direct_aggregation'),
    section('a-downloads', 'downloads', 'Download centre', 'full', 'report_generator'),
  ],
  explanation: null,
  noExplanationReason:
    'No explanation was generated because nothing was flagged. This was a deterministic aggregation: the explainability node never ran, no model inference took place, and the risk column shows cached scores from the overnight pass rather than anything computed for this query.',
};

/* ============================== ENTITY ============================== */

const entity: Scenario = {
  id: 'entity',
  query: 'Is customer 4521 suspicious?',
  action: 'entity_lookup',
  caseId: 'C-114',
  intent: [
    ['action', 'entity_lookup'],
    ['entity_type', 'customer'],
    ['entity_id', '4521'],
    ['scope', 'single_entity'],
    ['date_range', 'account_lifetime'],
    ['target_pattern', 'auto'],
  ],
  plannerNote:
    'Single entity. Every node is scoped to 4521 — 147 rows instead of 1.2M — which is why this run finishes in 18 seconds rather than 30.',
  steps: [
    ran({
      tool: 'intent_classifier',
      label: 'Intent Classifier',
      stage: 'understanding',
      ms: 1140,
      reason: 'Extracts the entity id and recognises a yes/no question about one subject.',
      activity: ['extracting entity id 4521', 'classifying as single-entity assessment'],
      inputs: [{ label: 'query', value: '"Is customer 4521 suspicious?"' }],
      outputs: [
        { label: 'action', value: 'entity_lookup', emphasis: true },
        { label: 'entity_id', value: '4521', emphasis: true },
        { label: 'scope', value: 'single_entity' },
        { label: 'confidence', value: '0.99' },
      ],
    }),
    ran({
      tool: 'planner',
      label: 'Planner',
      stage: 'planning',
      ms: 1980,
      reason: 'Scoped assessment: reuse existing flags, recompute only what today changed.',
      outputs: [
        { label: 'nodes selected', value: '12 of 14', emphasis: true },
        { label: 'scope', value: 'entity 4521 · 147 transactions', emphasis: true },
        { label: 'estimated cost', value: '~18s · scoped inference' },
      ],
    }),
    ran({
      tool: 'tool_selector',
      label: 'Tool Selector',
      stage: 'selection',
      ms: 610,
      reason: 'Binds every node to the entity scope and arms all five rules.',
      outputs: [
        { label: 'features bound', value: '21 of 21 · scoped', emphasis: true },
        { label: 'rules armed', value: '5' },
        { label: 'cached score', value: '61 · from overnight pass' },
      ],
    }),
    ran({
      tool: 'entity_resolver',
      label: 'Entity Resolver',
      stage: 'execution',
      ms: 1420,
      reason: 'Resolves 4521 and its counterparties into a single identity graph.',
      outputs: [
        { label: 'subject', value: 'Meridian Trading Co. · 4521', emphasis: true },
        { label: 'counterparties', value: '25' },
        { label: 'aliases merged', value: '3' },
      ],
    }),
    ran({
      tool: 'transaction_loader',
      label: 'Transaction Loader',
      stage: 'execution',
      ms: 1180,
      reason: 'Loads this account only — 147 rows, not the population.',
      rowsIn: 1204882,
      rowsOut: 147,
      outputs: [
        { label: 'rows loaded', value: '147', emphasis: true },
        { label: 'inflow', value: '$187,400' },
        { label: 'outflow', value: '$181,000' },
      ],
    }),
    NO_EDA('Declined. Population distributions say nothing about one account.'),
    ran({
      tool: 'feature_builder',
      label: 'Feature Builder',
      stage: 'execution',
      ms: 1360,
      reason: 'Full feature set, but over 147 rows — cheap enough to compute everything.',
      rowsIn: 147,
      rowsOut: 147,
      outputs: [
        { label: 'feature matrix', value: '147 × 21', emphasis: true },
        { label: 'baseline window', value: 'account lifetime · 42 days' },
      ],
    }),
    ran({
      tool: 'graph_builder',
      label: 'Graph Builder',
      stage: 'execution',
      ms: 2240,
      reason: 'Two hops around the subject, enough to see the ring it sits in.',
      rowsIn: 147,
      rowsOut: 15,
      outputs: [
        { label: 'entities', value: '10 · 2 hops', emphasis: true },
        { label: 'relationships', value: '15' },
        { label: 'centrality', value: '0.81 · hub', emphasis: true },
      ],
    }),
    ran({
      tool: 'detection_engine',
      label: 'Detection Engine',
      stage: 'execution',
      ms: 2380,
      reason: 'Rules re-evaluated for this account; no population sweep needed.',
      rowsIn: 147,
      rowsOut: 4,
      detail: 'STRUCT_001 ✓ · SMURF_001 ✓ · CASHOUT_001 ✓ · GEO_001 ✓ · ROUND_001 ✗',
      activity: ['evaluating 5 rules against 147 rows', 'scoring with xgboost_v4'],
      outputs: [
        { label: 'rules fired', value: '4 of 5', emphasis: true },
        { label: 'model probability', value: '0.88', emphasis: true },
        { label: 'novelty', value: 'no additional signal' },
      ],
    }),
    NO_AGG('Declined. A yes/no assessment is not a counting question.'),
    ran({
      tool: 'risk_engine',
      label: 'Risk Engine',
      stage: 'execution',
      ms: 1120,
      reason: 'Refreshes the cached score with today’s activity.',
      outputs: [
        { label: 'score', value: '87 · HIGH', emphasis: true },
        { label: 'previous', value: '61 · MEDIUM' },
        { label: 'delta', value: '+26 in 48 hours', emphasis: true },
      ],
    }),
    ran({
      tool: 'explainability',
      label: 'Explainability',
      stage: 'reporting',
      ms: 2510,
      reason: 'Answers the question asked — yes or no — then shows what backs it.',
      activity: ['TreeExplainer over 147 rows', 'assembling the answer'],
      outputs: [
        { label: 'verdict', value: 'yes · high risk', emphasis: true },
        { label: 'drivers surfaced', value: '6' },
        { label: 'confidence', value: '0.91' },
      ],
    }),
    ran({
      tool: 'recommendation_engine',
      label: 'Recommendation Engine',
      stage: 'reporting',
      ms: 640,
      reason: 'Score above 75 maps to report and escalate.',
      outputs: [
        { label: 'action', value: 'report · escalate to L3', emphasis: true },
        { label: 'clock', value: '30 days from detection' },
      ],
    }),
    ran({
      tool: 'report_generator',
      label: 'Report Generator',
      stage: 'reporting',
      ms: 980,
      reason: 'Builds the single-entity dossier and a SAR draft.',
      outputs: [
        { label: 'dossier sections', value: '14', emphasis: true },
        { label: 'SAR draft', value: 'C-114 · ready for review' },
      ],
    }),
  ],
  resultHeadline: 'Yes — 4521 is high risk on four independent signals',
  headlineMetric: { label: 'risk score', value: '87', severity: 'severe' },
  columns: ['Signal', 'Observed', 'Threshold', 'Window', 'Verdict'],
  rows: [
    { id: 'e-struct', entity: 'STRUCT_001', name: 'Deposits $9,000–$9,999', primary: '14', secondary: '≥ 3', pattern: '30 days', score: 92, level: 'HIGH' },
    { id: 'e-smurf', entity: 'SMURF_001', name: 'Distinct inbound senders', primary: '23', secondary: '≥ 10', pattern: '7 days', score: 88, level: 'HIGH' },
    { id: 'e-cash', entity: 'CASHOUT_001', name: 'Median hold time', primary: '41 min', secondary: '< 2 h', pattern: '30 days', score: 84, level: 'HIGH' },
    { id: 'e-geo', entity: 'GEO_001', name: 'Grey-list corridor exposure', primary: '$181,000', secondary: '≥ $15,000', pattern: '30 days', score: 58, level: 'MEDIUM' },
    { id: 'e-age', entity: 'KYC_002', name: 'Account age at first burst', primary: '42 days', secondary: '< 90 d', pattern: 'lifetime', score: 47, level: 'MEDIUM' },
    { id: 'e-round', entity: 'ROUND_001', name: 'Round-amount ratio', primary: '18%', secondary: '> 60%', pattern: '30 days', score: 12, level: 'LOW' },
  ],
  summary: [
    { label: 'risk score', value: '87 / 100', severity: 'severe' },
    { label: 'rules fired', value: '4 / 5', severity: 'severe' },
    { label: 'txns reviewed', value: '147' },
    { label: 'latency', value: '17.6s', severity: 'clear' },
  ],
  sections: [
    section('e-exec', 'execution-summary', 'Execution summary', 'full', 'report_generator'),
    section('e-plan', 'planning', 'Agent planning & tool selection', 'full', 'tool_selector'),
    section('e-summary', 'summary', 'Executive summary', 'full', 'risk_engine'),
    section('e-features', 'features', 'Feature engineering', 'full', 'feature_builder'),
    section('e-detect', 'detection', 'Anomaly detection', 'half', 'detection_engine'),
    section('e-riskclass', 'risk-classification', 'Risk classification', 'half', 'risk_engine'),
    section('e-gauge', 'chart', 'Model confidence', 'third', 'risk_engine', viz.entityConfidenceGauge),
    section('e-composition', 'chart', 'Risk composition', 'third', 'risk_engine', viz.riskComposition),
    section('e-rules', 'chart', 'Rule contribution', 'third', 'detection_engine', viz.ruleContribution),
    section('e-evolution', 'chart', 'Risk evolution', 'half', 'risk_engine', viz.riskEvolution),
    section('e-daily', 'chart', 'Daily suspicious activity', 'half', 'transaction_loader', viz.dailySuspicious),
    section('e-flow', 'chart', 'Money flow', 'two-thirds', 'graph_builder', viz.moneyFlowSankey),
    section('e-corridor', 'chart', 'Geographical risk', 'third', 'transaction_loader', viz.corridorMap),
    section('e-graph', 'graph', 'Entity connectivity', 'half', 'graph_builder'),
    section('e-timeline', 'timeline', 'Transaction timeline', 'half', 'transaction_loader'),
    section('e-shap', 'chart', 'Feature contribution', 'full', 'explainability', viz.shapWaterfall),
    section('e-evidence', 'evidence', 'Signal breakdown', 'full', 'detection_engine'),
    section('e-explain', 'explanation', 'AI explanation', 'full', 'explainability'),
    section('e-reco', 'recommendation', 'Recommendation', 'full', 'recommendation_engine'),
    section('e-sar', 'sar', 'Generated SAR', 'two-thirds', 'report_generator'),
    section('e-downloads', 'downloads', 'Download centre', 'third', 'report_generator'),
  ],
  explanation: {
    subject: 'Customer 4521 · Meridian Trading Co.',
    level: 'HIGH',
    score: 87,
    confidence: 0.91,
    modelVersion: 'xgboost_v4 · trained 2026-07-18',
    narrative:
      'Yes. Across the last 30 days this account behaved like a collection point rather than a trading business: 14 deposits sat just under the $10,000 reporting line, 23 unrelated senders paid in, and the balance left again within about 41 minutes on average, ending in two accounts inside a FATF grey-list corridor. At 42 days old with an overdue KYC refresh, there is no established baseline that would make this volume ordinary.',
    evidence: [
      'STRUCT_001 · 14 deposits in the $9,000–$9,999 band across 30 days',
      'SMURF_001 · 23 distinct senders, $187,400 aggregate inflow',
      'CASHOUT_001 · median deposit-to-withdrawal gap of 41 minutes',
      'GEO_001 · $181,000 outbound to 7710 and 9004, grey-list jurisdiction',
      'Graph · hub position with betweenness centrality 0.81 in a 10-entity ring',
      'Closing balance $2,140 — no retained working capital',
    ],
    breakdown: [
      { label: 'rule score', weight: 0.35, value: 92 },
      { label: 'ml probability', weight: 0.35, value: 88 },
      { label: 'behavioural deviation', weight: 0.2, value: 76 },
      { label: 'alert history', weight: 0.1, value: 60 },
    ],
    recommendation: {
      action: 'report',
      headline: 'Escalate to L3 and open a SAR draft',
      detail:
        'Open case C-114, attach the ring #A-114 money-flow graph, and place a temporary hold on both outbound corridors while the draft is reviewed.',
      sla: 'regulatory clock · file within 30 days of detection',
    },
  },
};

/* =============================== BROAD =============================== */

const broad: Scenario = {
  id: 'broad',
  query: 'Show me anything unusual this quarter',
  action: 'explore_anomalies',
  intent: [
    ['action', 'explore_anomalies'],
    ['entity_type', 'transaction'],
    ['date_range', 'last_quarter'],
    ['scope', 'population'],
    ['target_pattern', 'unspecified'],
  ],
  plannerNote:
    'No typology named and no entity scoped. This is the one case where the full pipeline earns its cost — the profiler runs, novelty is weighted up, and the run takes 40 seconds.',
  steps: [
    ran({
      tool: 'intent_classifier',
      label: 'Intent Classifier',
      stage: 'understanding',
      ms: 1210,
      reason: 'Detects an open-ended exploratory question with no typology and no subject.',
      outputs: [
        { label: 'action', value: 'explore_anomalies', emphasis: true },
        { label: 'typology', value: 'unspecified — nothing to narrow on', emphasis: true },
        { label: 'window', value: 'last quarter · 92 days' },
      ],
    }),
    ran({
      tool: 'planner',
      label: 'Planner',
      stage: 'planning',
      ms: 2480,
      reason: 'Nothing can be pruned safely, so the profiler runs and novelty weighting is raised.',
      outputs: [
        { label: 'nodes selected', value: '13 of 14', emphasis: true },
        { label: 'novelty weight', value: 'raised 0.15 → 0.30', emphasis: true },
        { label: 'estimated cost', value: '~40s · full population pass' },
      ],
    }),
    ran({
      tool: 'tool_selector',
      label: 'Tool Selector',
      stage: 'selection',
      ms: 700,
      reason: 'Arms every rule and both models — there is no basis to narrow the search.',
      outputs: [
        { label: 'features bound', value: '21 of 21', emphasis: true },
        { label: 'models', value: 'xgboost_v4 + isoforest_v2' },
      ],
    }),
    ran({
      tool: 'entity_resolver',
      label: 'Entity Resolver',
      stage: 'execution',
      ms: 4120,
      reason: 'Population-wide identity resolution across the quarter.',
      outputs: [
        { label: 'entities resolved', value: '84,660', emphasis: true },
        { label: 'merges applied', value: '5,904' },
      ],
    }),
    ran({
      tool: 'transaction_loader',
      label: 'Transaction Loader',
      stage: 'execution',
      ms: 5240,
      reason: 'Loads the full quarter across every payment channel.',
      rowsIn: 1204882,
      rowsOut: 402117,
      outputs: [
        { label: 'rows loaded', value: '402,117', emphasis: true },
        { label: 'channels', value: 'cash · wire · ach · card · crypto' },
      ],
    }),
    ran({
      tool: 'eda_profiler',
      label: 'EDA Profiler',
      stage: 'execution',
      ms: 4180,
      reason: 'Invoked because the query is exploratory — profiling decides where to look.',
      rowsIn: 402117,
      detail: 'amount distribution bimodal at $4.9k and $9.6k · 3.1% of accounts hold 41% of volume',
      activity: ['profiling 21 distributions', 'testing for bimodality', 'ranking concentration'],
      outputs: [
        { label: 'distributions profiled', value: '21', emphasis: true },
        { label: 'anomalous modes', value: '2 · $4.9k and $9.6k', emphasis: true },
        { label: 'concentration', value: '3.1% of accounts hold 41% of volume' },
      ],
    }),
    ran({
      tool: 'feature_builder',
      label: 'Feature Builder',
      stage: 'execution',
      ms: 4120,
      reason: 'All 21 features computed. With no typology named, nothing can be pruned.',
      rowsIn: 402117,
      rowsOut: 402117,
      outputs: [
        { label: 'feature matrix', value: '402,117 × 21', emphasis: true },
        { label: 'compute', value: '18 vCPU-seconds' },
      ],
    }),
    failed({
      tool: 'graph_builder',
      label: 'Graph Builder',
      stage: 'execution',
      ms: 4360,
      reason: 'Cycle detection exceeded its budget on a 402k-edge graph. Degraded rather than blocked.',
      failure:
        'timeout · cycle_detection exceeded the 4s budget at 402,117 edges. Fell back to betweenness centrality only, so layering cycles are unmeasured in this run.',
      activity: ['building adjacency · 402k edges', 'cycle detection…', 'budget exceeded — degrading'],
      outputs: [
        { label: 'entities', value: '84,660' },
        { label: 'centrality', value: 'computed', emphasis: true },
        { label: 'cycles', value: 'not computed — rerun scoped to a cluster' },
      ],
    }),
    ran({
      tool: 'detection_engine',
      label: 'Detection Engine',
      stage: 'execution',
      ms: 6180,
      reason: 'Rules, supervised model and novelty, with novelty weighted up for unknown shapes.',
      rowsIn: 402117,
      rowsOut: 186,
      detail: 'rule hits 121 · ml-only 44 · novelty-only 21',
      activity: ['evaluating 5 rules', 'xgboost inference · 402,117 rows', 'isolation forest · novelty pass'],
      outputs: [
        { label: 'anomalies', value: '186', emphasis: true },
        { label: 'clusters formed', value: '5' },
        { label: 'no rule coverage', value: '21', emphasis: true },
      ],
    }),
    NO_AGG('Declined. Exploration is not a counting question.'),
    ran({
      tool: 'risk_engine',
      label: 'Risk Engine',
      stage: 'execution',
      ms: 2860,
      reason: 'Ranks the clusters so the worklist arrives ordered by severity, not by time.',
      rowsIn: 186,
      rowsOut: 186,
      outputs: [
        { label: 'high risk', value: '2 clusters', emphasis: true },
        { label: 'medium risk', value: '2 clusters' },
        { label: 'top score', value: '87 · ring #A-114' },
      ],
    }),
    ran({
      tool: 'explainability',
      label: 'Explainability',
      stage: 'reporting',
      ms: 3120,
      reason: 'Explains the top clusters; the tail is queued into the triage worklist.',
      outputs: [
        { label: 'clusters explained', value: '5', emphasis: true },
        { label: 'unexplained tail', value: '21 · queued for review' },
        { label: 'confidence', value: '0.86' },
      ],
    }),
    ran({
      tool: 'recommendation_engine',
      label: 'Recommendation Engine',
      stage: 'reporting',
      ms: 780,
      reason: 'Severity is mixed, so recommendations differ per cluster.',
      outputs: [
        { label: 'report', value: '1 cluster', emphasis: true },
        { label: 'review', value: '2 clusters' },
        { label: 'monitor', value: '2 clusters' },
      ],
    }),
    ran({
      tool: 'report_generator',
      label: 'Report Generator',
      stage: 'reporting',
      ms: 1240,
      reason: 'Builds an exploratory dossier and flags the degraded graph node in the audit entry.',
      outputs: [
        { label: 'dossier sections', value: '15', emphasis: true },
        { label: 'caveat recorded', value: 'graph_builder degraded', emphasis: true },
        { label: 'artefacts', value: 'PDF · CSV · JSON' },
      ],
    }),
  ],
  resultHeadline: '186 anomalies across 5 emerging clusters',
  headlineMetric: { label: 'anomalies', value: '186', severity: 'review' },
  columns: ['Cluster', 'Accounts', 'Volume', 'Signature', 'Risk'],
  rows: [
    { id: 'c-1', entity: '#A-114', name: 'Fan-in hub ring', primary: '7', secondary: '$187,400', pattern: 'structuring + rapid layering', score: 87, level: 'HIGH' },
    { id: 'c-2', entity: '#A-121', name: 'IN→AE corridor burst', primary: '12', secondary: '$914,000', pattern: 'grey-list velocity spike', score: 78, level: 'HIGH' },
    { id: 'c-3', entity: '#A-133', name: 'Night-window cash cycle', primary: '9', secondary: '$402,500', pattern: 'temporal anomaly · novelty only', score: 64, level: 'MEDIUM' },
    { id: 'c-4', entity: '#A-140', name: 'Repeated $4,950 transfers', primary: '23', secondary: '$1,138,500', pattern: 'scripted amount repetition', score: 57, level: 'MEDIUM' },
    { id: 'c-5', entity: '#A-152', name: 'Dormant-then-active accounts', primary: '31', secondary: '$233,900', pattern: 'behavioural deviation', score: 31, level: 'LOW' },
  ],
  summary: [
    { label: 'anomalies', value: '186' },
    { label: 'novelty only', value: '21', severity: 'review' },
    { label: 'tools used', value: '13 / 14', severity: 'severe' },
    { label: 'latency', value: '40.6s', severity: 'review' },
  ],
  sections: [
    section('b-exec', 'execution-summary', 'Execution summary', 'full', 'report_generator'),
    section('b-plan', 'planning', 'Agent planning & tool selection', 'full', 'tool_selector'),
    section('b-summary', 'summary', 'Executive summary', 'full', 'risk_engine'),
    section('b-features', 'features', 'Feature engineering', 'full', 'feature_builder'),
    section('b-detect', 'detection', 'Anomaly detection', 'half', 'detection_engine'),
    section('b-riskclass', 'risk-classification', 'Risk classification', 'half', 'risk_engine'),
    section('b-source', 'chart', 'Detection source', 'half', 'detection_engine', viz.novelClusters),
    section('b-clusters', 'chart', 'Cluster detection', 'half', 'detection_engine', viz.clusterScatter),
    section('b-trend', 'chart', 'Risk trend', 'half', 'risk_engine', viz.quarterTrend),
    section('b-conc', 'chart', 'Volume concentration', 'half', 'eda_profiler', viz.concentration),
    section('b-heat', 'chart', 'Risk by jurisdiction', 'half', 'transaction_loader', viz.jurisdictionHeat),
    section('b-corridor', 'chart', 'Geographical risk', 'half', 'transaction_loader', viz.corridorMap),
    section('b-segments', 'chart', 'Customer segments', 'third', 'feature_builder', viz.segmentTreemap),
    section('b-dist', 'chart', 'Risk distribution', 'third', 'risk_engine', viz.riskDistribution),
    section('b-cats', 'chart', 'Alert categories', 'third', 'detection_engine', viz.alertCategories),
    section(
      'b-graph',
      'graph',
      'Entity connectivity',
      'half',
      'graph_builder',
      undefined,
      'Cycle detection timed out on this run — the canvas shows centrality only.',
    ),
    section('b-timeline', 'timeline', 'Transaction timeline', 'half', 'transaction_loader'),
    section('b-evidence', 'evidence', 'Cluster breakdown', 'full', 'detection_engine'),
    section('b-explain', 'explanation', 'AI explanation', 'full', 'explainability'),
    section('b-reco', 'recommendation', 'Recommendation', 'full', 'recommendation_engine'),
    section('b-downloads', 'downloads', 'Download centre', 'full', 'report_generator'),
  ],
  explanation: {
    subject: 'Cluster #A-114 · highest ranked anomaly',
    level: 'HIGH',
    score: 87,
    confidence: 0.86,
    modelVersion: 'xgboost_v4 + isoforest_v2',
    narrative:
      'Nothing in the query pointed at a typology, so the agent profiled the quarter before ranking anything. The strongest cluster is a seven-account ring where six recently opened accounts pay into a single hub that forwards almost everything offshore within the hour. Two further clusters deserve a look purely because unsupervised novelty flagged them and no current rule describes their shape. Note that cycle detection timed out on this population, so layering loops are not measured in this run.',
    evidence: [
      'EDA · amount distribution peaks at $9.6k, consistent with threshold avoidance',
      'Ring #A-114 triggered STRUCT_001, SMURF_001 and CASHOUT_001 together',
      'Cluster #A-133 flagged by Isolation Forest only — no rule coverage exists',
      'Concentration · 3.1% of accounts moved 41% of quarterly volume',
      'Caveat · graph_builder degraded to centrality only at 402k edges',
    ],
    breakdown: [
      { label: 'rule score', weight: 0.35, value: 84 },
      { label: 'ml probability', weight: 0.35, value: 86 },
      { label: 'behavioural deviation', weight: 0.2, value: 91 },
      { label: 'alert history', weight: 0.1, value: 72 },
    ],
    recommendation: {
      action: 'review',
      headline: 'Review the top two clusters, monitor the tail',
      detail:
        '#A-114 is SAR-ready today. #A-133 has no rule coverage — worth proposing a new rule once an analyst confirms the shape. Rerun the graph node scoped to #A-121 to recover cycle detection.',
      sla: 'target · triage within 5 business days',
    },
  },
};

/* ============================== CASH-OUT ============================== */

const cashout: Scenario = {
  id: 'cashout',
  query: 'Show rapid cash-out transactions',
  action: 'detect_pattern',
  caseId: 'C-118',
  intent: [
    ['action', 'detect_pattern'],
    ['target_pattern', 'rapid_cash_out'],
    ['entity_type', 'transaction'],
    ['date_range', 'last_30_days'],
    ['channel', 'cash | wire'],
    ['hold_time', '< 2 hours'],
  ],
  plannerNote:
    'The typology is named and it is a timing pattern, so feature engineering narrows to the four disposal features and the profiler is dropped. Graph is kept because a cash-out chain is a path, not a row.',
  steps: [
    ran({
      tool: 'intent_classifier',
      label: 'Intent Classifier',
      stage: 'understanding',
      ms: 1060,
      reason: 'Turns free text into a typed intent with filters. Always first.',
      activity: ['tokenising query', 'matching typology vocabulary', 'inferring implied hold-time bound'],
      inputs: [{ label: 'query', value: '"Show rapid cash-out transactions"' }],
      outputs: [
        { label: 'action', value: 'detect_pattern', emphasis: true },
        { label: 'typology', value: 'rapid_cash_out', emphasis: true },
        { label: 'implied bound', value: 'hold time < 2 hours' },
        { label: 'confidence', value: '0.96' },
      ],
    }),
    ran({
      tool: 'planner',
      label: 'Planner',
      stage: 'planning',
      ms: 1980,
      reason: 'Named timing typology → load, disposal features, chain graph, rules, score, explain.',
      activity: ['scoring 14 candidate nodes', 'pruning nodes with no marginal value', 'ordering the DAG'],
      inputs: [{ label: 'intent', value: 'detect_pattern · rapid_cash_out' }],
      outputs: [
        { label: 'nodes selected', value: '12 of 14', emphasis: true },
        { label: 'nodes declined', value: 'eda_profiler, direct_aggregation' },
        { label: 'estimated cost', value: '~26s · 1 model inference pass' },
      ],
    }),
    ran({
      tool: 'tool_selector',
      label: 'Tool Selector',
      stage: 'selection',
      ms: 580,
      reason: 'Binds each planned node to a concrete implementation and feature subset.',
      activity: ['binding disposal feature tags', 'resolving model artifact', 'arming CASHOUT_001'],
      inputs: [{ label: 'plan', value: '12 nodes' }],
      outputs: [
        { label: 'features bound', value: '6 of 21 · cash-out tagged', emphasis: true },
        { label: 'model', value: 'xgboost_v4 (sha 9f2c11e)' },
        { label: 'rules armed', value: 'CASHOUT_001, STRUCT_001, GEO_001' },
      ],
    }),
    ran({
      tool: 'entity_resolver',
      label: 'Entity Resolver',
      stage: 'execution',
      ms: 2740,
      reason: 'A disposal chain crosses accounts, so identities have to be stable before chains are built.',
      activity: ['fuzzy-matching names', 'clustering shared devices', 'assigning entity ids'],
      inputs: [{ label: 'accounts in scope', value: '39,480' }],
      outputs: [
        { label: 'entities resolved', value: '26,610', emphasis: true },
        { label: 'merges applied', value: '1,043' },
        { label: 'shared-ATM clusters', value: '31' },
      ],
    }),
    ran({
      tool: 'transaction_loader',
      label: 'Transaction Loader',
      stage: 'execution',
      ms: 3820,
      reason: 'Pulls paired deposit and disposal legs for the window.',
      rowsIn: 1204882,
      rowsOut: 68240,
      activity: ['querying postgres partition 2026-06/07', 'streaming 68,240 rows', 'pairing deposit and disposal legs'],
      inputs: [{ label: 'screened population', value: '1,204,882 transactions' }],
      outputs: [
        { label: 'rows loaded', value: '68,240', emphasis: true },
        { label: 'accounts touched', value: '9,842' },
        { label: 'value in window', value: '$286.4M' },
      ],
    }),
    NO_EDA('Declined. The typology is named and the discriminating feature is hold time, so profiling the population changes no decision.'),
    ran({
      tool: 'feature_builder',
      label: 'Feature Builder',
      stage: 'execution',
      ms: 3120,
      reason: 'Computes only the disposal and timing features — 6 of 21.',
      rowsIn: 68240,
      rowsOut: 68240,
      detail:
        'deposit_to_withdrawal_median · withdrawal_ratio_24h · txn_velocity_24h · atm_cluster_concentration · rolling_sum_7d · network_centrality',
      activity: ['pairing deposit and disposal events', 'computing hold-time medians', 'weighting ATM clusters'],
      inputs: [{ label: 'rows', value: '68,240' }],
      outputs: [
        { label: 'feature matrix', value: '68,240 × 6', emphasis: true },
        { label: 'features skipped', value: '15 · not tagged to rapid cash-out' },
        { label: 'cache hits', value: '31%' },
      ],
    }),
    ran({
      tool: 'graph_builder',
      label: 'Graph Builder',
      stage: 'execution',
      ms: 2610,
      reason: 'A cash-out chain is a path across accounts, so it can only be reconstructed on the graph.',
      rowsIn: 68240,
      rowsOut: 604,
      activity: ['building adjacency', 'walking deposit-to-disposal chains', 'ranking chains by throughput'],
      inputs: [{ label: 'transactions', value: '68,240' }],
      outputs: [
        { label: 'entities', value: '318', emphasis: true },
        { label: 'chains reconstructed', value: '17', emphasis: true },
        { label: 'terminal cash nodes', value: '6', emphasis: true },
        { label: 'max centrality', value: '0.44 · entity 9004' },
      ],
    }),
    ran({
      tool: 'detection_engine',
      label: 'Detection Engine',
      stage: 'execution',
      ms: 4180,
      reason: 'CASHOUT_001 per chain, then XGBoost over the chain-level feature matrix.',
      rowsIn: 68240,
      rowsOut: 17,
      detail: 'rule hits 15 · ml-only 2 · novelty 0',
      activity: ['evaluating CASHOUT_001 per chain', 'xgboost inference · 68,240 rows', 'suppressing payroll counterparties'],
      inputs: [{ label: 'feature matrix', value: '68,240 × 6' }],
      outputs: [
        { label: 'chains flagged', value: '17', emphasis: true },
        { label: 'accounts involved', value: '9' },
        { label: 'rule hits', value: '15' },
        { label: 'model-only hits', value: '2' },
        { label: 'suppressed as payroll', value: '48' },
      ],
    }),
    NO_AGG('Declined. The question asks which chains qualify, not how many rows exist.'),
    ran({
      tool: 'risk_engine',
      label: 'Risk Engine',
      stage: 'execution',
      ms: 1840,
      reason: 'Weighted blend: rules 0.35, model 0.35, behaviour 0.20, history 0.10.',
      rowsIn: 17,
      rowsOut: 17,
      activity: ['scoring rule hits', 'blending model probability', 'banding into low/medium/high'],
      inputs: [{ label: 'detections', value: '17' }],
      outputs: [
        { label: 'high risk', value: '6', emphasis: true },
        { label: 'medium risk', value: '8' },
        { label: 'low risk', value: '3' },
        { label: 'top score', value: '84 · chain CH-07' },
      ],
    }),
    ran({
      tool: 'explainability',
      label: 'Explainability',
      stage: 'reporting',
      ms: 2210,
      reason: 'Rule reasons lead, SHAP supports, written for a compliance reader.',
      rowsIn: 17,
      rowsOut: 17,
      activity: ['TreeExplainer over 17 chains', 'ranking drivers', 'composing narratives'],
      inputs: [{ label: 'scored chains', value: '17' }],
      outputs: [
        { label: 'narratives written', value: '17', emphasis: true },
        { label: 'dominant driver', value: 'deposit_to_withdrawal_median · +0.34' },
        { label: 'mean confidence', value: '0.87' },
      ],
    }),
    ran({
      tool: 'recommendation_engine',
      label: 'Recommendation Engine',
      stage: 'reporting',
      ms: 640,
      reason: 'Maps score bands onto monitor / review / report with the regulatory clock attached.',
      activity: ['applying escalation policy', 'attaching SLA clocks'],
      inputs: [{ label: 'scored chains', value: '17' }],
      outputs: [
        { label: 'report', value: '6', emphasis: true },
        { label: 'review', value: '8' },
        { label: 'monitor', value: '3' },
      ],
    }),
    ran({
      tool: 'report_generator',
      label: 'Report Generator',
      stage: 'reporting',
      ms: 980,
      reason: 'Assembles the dossier, the execution summary and a SAR draft for the top chain.',
      activity: ['assembling dossier sections', 'drafting SAR narrative', 'writing audit entry'],
      inputs: [{ label: 'dossier sections', value: '18' }],
      outputs: [
        { label: 'SAR draft', value: 'C-118 · 4 sourced paragraphs', emphasis: true },
        { label: 'artefacts', value: 'PDF · CSV · JSON' },
        { label: 'audit entry', value: 'written · immutable' },
      ],
    }),
  ],
  resultHeadline: '17 rapid cash-out chains across 9 accounts',
  headlineMetric: { label: 'disposal chains', value: '17', severity: 'severe' },
  columns: ['Chain', 'Account', 'Hold time', 'Disposed', 'Route', 'Risk'],
  rows: [
    { id: 'ch-07', entity: 'CH-07', name: 'Novak Exports Ltd · 9004', primary: '11 min', secondary: '$142,800', pattern: 'deposit → ATM cash', score: 84, level: 'HIGH' },
    { id: 'ch-02', entity: 'CH-02', name: 'Meridian Trading Co. · 4521', primary: '41 min', secondary: '$118,400', pattern: 'deposit → offshore wire', score: 81, level: 'HIGH' },
    { id: 'ch-11', entity: 'CH-11', name: 'Calder Holdings · 7710', primary: '58 min', secondary: '$96,200', pattern: 'deposit → onward transfer', score: 78, level: 'HIGH' },
    { id: 'ch-04', entity: 'CH-04', name: 'R. Advani · 3308', primary: '1h 12m', secondary: '$74,900', pattern: 'deposit → ATM cash', score: 69, level: 'MEDIUM' },
    { id: 'ch-09', entity: 'CH-09', name: 'Larkspur Retail · 6120', primary: '1h 34m', secondary: '$58,300', pattern: 'deposit → card spend', score: 61, level: 'MEDIUM' },
    { id: 'ch-15', entity: 'CH-15', name: 'Trentham Logistics · 5540', primary: '1h 51m', secondary: '$47,600', pattern: 'deposit → onward transfer', score: 52, level: 'MEDIUM' },
    { id: 'ch-17', entity: 'CH-17', name: 'S. Bhatt · 2255', primary: '1h 58m', secondary: '$34,200', pattern: 'deposit → ATM cash', score: 37, level: 'LOW' },
  ],
  summary: [
    { label: 'chains flagged', value: '17', severity: 'severe' },
    { label: 'median hold', value: '38 min', severity: 'severe' },
    { label: 'disposed value', value: '$612,400' },
    { label: 'latency', value: '25.8s', severity: 'clear' },
  ],
  sections: [
    section('co-exec', 'execution-summary', 'Execution summary', 'full', 'report_generator'),
    section('co-plan', 'planning', 'Agent planning & tool selection', 'full', 'tool_selector'),
    section('co-summary', 'summary', 'Executive summary', 'full', 'risk_engine'),
    section('co-features', 'features', 'Feature engineering', 'full', 'feature_builder'),
    section('co-detect', 'detection', 'Anomaly detection', 'half', 'detection_engine'),
    section('co-risk', 'risk-classification', 'Risk classification', 'half', 'risk_engine'),
    section('co-flow', 'chart', 'Money flow', 'two-thirds', 'graph_builder', viz.moneyFlowSankey),
    section('co-gauge', 'chart', 'Model confidence', 'third', 'risk_engine', viz.confidenceGauge),
    section('co-daily', 'chart', 'Daily suspicious activity', 'half', 'transaction_loader', viz.dailySuspicious),
    section('co-volume', 'chart', 'Transaction volume', 'half', 'transaction_loader', viz.volumeLine),
    section('co-graph', 'graph', 'Disposal chains', 'half', 'graph_builder'),
    section('co-timeline', 'timeline', 'Transaction timeline', 'half', 'transaction_loader'),
    section('co-corridor', 'chart', 'Geographical risk', 'third', 'transaction_loader', viz.corridorMap),
    section('co-rules', 'chart', 'Rule contribution', 'third', 'detection_engine', viz.ruleContribution),
    section('co-shap', 'chart', 'Feature contribution', 'third', 'explainability', viz.shapWaterfall),
    section('co-evidence', 'evidence', 'Chain breakdown', 'full', 'detection_engine'),
    section('co-explain', 'explanation', 'AI explanation', 'full', 'explainability'),
    section('co-reco', 'recommendation', 'Recommendation', 'full', 'recommendation_engine'),
    section('co-sar', 'sar', 'Generated SAR', 'two-thirds', 'report_generator'),
    section('co-downloads', 'downloads', 'Download centre', 'third', 'report_generator'),
  ],
  explanation: {
    subject: 'Chain CH-07 · Novak Exports Ltd · 9004',
    level: 'HIGH',
    score: 84,
    confidence: 0.87,
    modelVersion: 'xgboost_v4 · trained 2026-07-18',
    narrative:
      'You asked for rapid cash-out transactions, and CH-07 is the fastest chain in the window. $142,800 arrived across nine cash deposits and left as ATM withdrawals a median of 11 minutes after each deposit cleared, drawn from four machines inside one district. Nothing was retained overnight, which is disposal rather than cash management: a trading account holds working capital, this one holds $1,900.',
    evidence: [
      'CASHOUT_001 · median deposit-to-disposal gap of 11 minutes, threshold is 2 hours',
      'Disposal ratio 0.96 — almost all same-day inflow removed the same day',
      '11 withdrawals totalling $48,000 across 4 ATMs inside one district',
      'SHAP · deposit_to_withdrawal_median contributed +0.34 of a 0.79 model probability',
      'Chain terminates in cash, so there is no onward audit trail',
      'Closing balance $1,900 against $142,800 of throughput',
    ],
    breakdown: [
      { label: 'rule score', weight: 0.35, value: 88 },
      { label: 'ml probability', weight: 0.35, value: 79 },
      { label: 'behavioural deviation', weight: 0.2, value: 71 },
      { label: 'alert history', weight: 0.1, value: 54 },
    ],
    recommendation: {
      action: 'report',
      headline: 'File on CH-07 and CH-02, review the rest',
      detail:
        'Both top chains terminate outside the institution. Draft the SAR from the chain evidence, request ATM footage for the four machines, and hold further cash disposal on 9004 pending L3 sign-off.',
      sla: 'regulatory clock · file within 30 days of detection',
    },
  },
};

export const scenarios = [structuring, aggregate, entity, cashout, broad] as const;

export const stageOrder: readonly ExecutionStage[] = [
  'understanding',
  'planning',
  'selection',
  'execution',
  'reporting',
];

export const stageTitle: Record<ExecutionStage, string> = {
  understanding: 'Understanding intent',
  planning: 'Planning investigation',
  selection: 'Selecting required tools',
  execution: 'Running investigation',
  reporting: 'Generating report',
};

export const findScenario = (rawQuery: string): Scenario => {
  const query = rawQuery.toLowerCase();

  if (/\b(is|about)\b.*\b(suspicious|risky)\b/.test(query) || /(customer|account|entity)\s*#?\s*\d{3,}/.test(query)) {
    return entity;
  }

  if (/\d+\s*\+?\s*(transactions|txns|payments)|under \$?\d|below \$?\d|more than \d|at least \d/.test(query)) {
    return aggregate;
  }

  if (/cash.?out|rapid (disposal|withdraw)|withdraw|atm/.test(query)) {
    return cashout;
  }

  if (/structur|smurf|threshold|9,?000|layer|fan.?in/.test(query)) {
    return structuring;
  }

  return broad;
};

export const scenarioById = (id: string): Scenario =>
  scenarios.find((scenario) => scenario.id === id) ?? structuring;
