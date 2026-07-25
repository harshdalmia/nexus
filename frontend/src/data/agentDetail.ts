import type { AgentDetail, FeatureSpec, PlanningDecision, Scenario } from '@/types/aml';

/* ------------------------------------------------------------------
   Per-query agent reasoning: the six planning derivations, the AML
   features it engineered (or declined to), the detection configuration
   and the risk classification.

   Kept next to the scenarios but in its own module so the plan data and
   the reasoning data can be read independently.
   ------------------------------------------------------------------ */

const decision = (
  stage: PlanningDecision['stage'],
  label: string,
  value: string,
  detail: string,
  confidence?: number,
): PlanningDecision => ({ stage, label, value, detail, confidence });

/* the full AML feature catalogue, tagged by the pattern each one serves */
const feature = (
  name: string,
  display: string,
  pattern: string,
  value: string,
  description: string,
): FeatureSpec => ({ name, display, pattern, value, description, included: true });

const declined = (
  name: string,
  display: string,
  pattern: string,
  reason: string,
): FeatureSpec => ({
  name,
  display,
  pattern,
  value: 'not computed',
  description: 'Tagged to a pattern this query does not target.',
  included: false,
  reason,
});

/* ============================== structuring ============================== */

const structuring: AgentDetail = {
  amlPattern: 'Structuring (threshold avoidance) with fan-in smurfing',
  entities: ['population scope · 12,904 customers in window'],
  filters: ['date_range = last 30 days', 'txn_type = cash_deposit', 'amount < $10,000', 'jurisdiction = any'],
  investigationSummary:
    '41 customers deposited cash in amounts clustered immediately below the $10,000 reporting threshold. Nine combine that with fan-in from unrelated senders and same-day onward transfer, which is structuring feeding a layering step rather than trading receipts. Customer 4521 is the clearest case at a composite score of 87.',
  planning: [
    decision('intent_extraction', 'Intent', 'detect_pattern', 'Verb "find" plus a named typology means population detection, not a lookup or a count.', 0.97),
    decision('entity_extraction', 'Entities', 'none — population query', 'No customer, account or case identifier appears in the text, so the scope stays the whole book.', 0.99),
    decision('filter_detection', 'Filters', '4 detected', '"last 30 days" resolved to a date range; typology implies cash deposits under the reporting line.', 0.96),
    decision('pattern_detection', 'AML pattern', 'structuring', 'Matched the structuring vocabulary directly; smurfing added because fan-in is a co-indicator.', 0.94),
    decision('tool_selection', 'Tools selected', '12 of 14', 'Detection, scoring and explanation are all required. Profiling and aggregation are not.', undefined),
    decision('execution_planning', 'Plan', 'load → features → graph → detect → score → explain → report', 'Graph before detection so fan-in ratios exist when the rules are evaluated.', undefined),
  ],
  features: [
    feature('txns_9000_9999_count_30d', 'Structuring score', 'structuring', '14 deposits', 'Count of deposits inside the $9,000–$9,999 band across the window.'),
    feature('rolling_sum_amount_7d', 'Rolling sum (7d)', 'structuring', '$93,600 peak', 'Rolling seven-day inflow, which reveals volume hidden by splitting.'),
    feature('txn_velocity_24h', 'Transaction velocity', 'structuring', '4.9 / day', 'Transactions per day against the account’s own baseline of 0.7.'),
    feature('distinct_senders_7d', 'Smurfing score', 'smurfing', '23 senders', 'Distinct originators paying into one beneficiary inside a rolling week.'),
    feature('inter_txn_gap_seconds', 'Inter-transaction gap', 'automation', '41 min median', 'Median interval between deposits, which exposes scripted timing.'),
    feature('repeated_amount_ratio', 'Repeated amount ratio', 'structuring', '0.34', 'Share of transactions repeating the modal amount.'),
    feature('round_amount_ratio', 'Round amount ratio', 'placement', '0.18', 'Share of suspiciously round amounts.'),
    feature('network_centrality', 'Network centrality', 'layering', '0.81', 'Betweenness centrality inside the 472-entity money-flow graph.'),
    declined('deposit_to_withdrawal_median', 'Rapid cash-out score', 'rapid cash-out', 'Computed as a supporting signal only; not a primary feature for this typology.'),
    declined('temporal_zscore', 'Time-of-day deviation', 'behavioural anomaly', 'Behavioural features are reserved for open-ended exploration.'),
  ],
  detection: {
    models: [
      { name: 'rule_engine v12', kind: 'rules', role: 'STRUCT_001, SMURF_001, CASHOUT_001, ROUND_001, GEO_001' },
      { name: 'xgboost_v4', kind: 'supervised', role: 'laundering probability over the engineered feature matrix' },
      { name: 'isoforest_v2', kind: 'unsupervised', role: 'novelty cover for shapes no rule describes' },
    ],
    anomalyType: 'Collective pattern — threshold avoidance with fan-in',
    score: 0.88,
    threshold: 0.62,
    confidence: 0.93,
    durationMs: 5120,
    evaluated: 86420,
    flagged: 41,
    topFeatures: [
      { feature: 'txns_9000_9999_count_30d', contribution: 0.31 },
      { feature: 'distinct_senders_7d', contribution: 0.22 },
      { feature: 'deposit_to_withdrawal_median', contribution: 0.17 },
      { feature: 'counterparty_country_risk', contribution: 0.09 },
    ],
  },
  risk: {
    score: 87,
    level: 'HIGH',
    severity: 'severe',
    confidence: 0.93,
    band: '75–100 · HIGH · report',
    reason:
      'Four deterministic rules fired on the top-ranked customer and the supervised model agrees at 0.88, so rule and model evidence are independent and concurrent.',
    evidence: [
      'STRUCT_001 · 14 deposits in the $9,000–$9,999 band against a threshold of 3',
      'SMURF_001 · 23 distinct senders moved $187,400 into one account',
      'CASHOUT_001 · median hold time of 41 minutes against a 2 hour threshold',
      'Graph · betweenness centrality 0.81, highest of 472 entities',
    ],
    components: [
      { label: 'rule score', weight: 0.35, value: 92 },
      { label: 'ml probability', weight: 0.35, value: 88 },
      { label: 'behavioural deviation', weight: 0.2, value: 76 },
      { label: 'alert history', weight: 0.1, value: 60 },
    ],
  },
};

/* =============================== aggregate =============================== */

const aggregate: AgentDetail = {
  amlPattern: 'None — no typology named or implied',
  entities: ['population scope · customers with 10 or more qualifying transactions'],
  filters: ['min_count = 10', 'max_amount = $10,000', 'date_range = last 30 days'],
  investigationSummary:
    '128 customers made ten or more transactions under $10,000 in the window, covering 4,604 transactions. This is a deterministic count: no features were engineered, no model ran, and no risk was assigned. The risk column shows cached scores from the overnight pass for orientation only.',
  planning: [
    decision('intent_extraction', 'Intent', 'aggregate_threshold', 'A "which customers … 10+ / under $10,000" construction is a countable filter, not a detection request.', 0.98),
    decision('entity_extraction', 'Entities', 'none — population query', 'No identifier present; the subject is any customer meeting the count.', 0.99),
    decision('filter_detection', 'Filters', '3 detected', 'Both numeric bounds were extracted literally: a minimum count and a maximum amount.', 0.99),
    decision('pattern_detection', 'AML pattern', 'none detected', 'No typology vocabulary present. Inferring one would answer a question the analyst did not ask.', 0.97),
    decision('tool_selection', 'Tools selected', '7 of 14', 'Loader and aggregation answer this exactly. The whole inference branch was declined.', undefined),
    decision('execution_planning', 'Plan', 'resolve → load → group-by', 'Pushed down as SQL. Estimated 9s against 30s for the full pipeline.', undefined),
  ],
  features: [
    declined('txns_9000_9999_count_30d', 'Structuring score', 'structuring', 'The answer is a count, not a model input. No typology was named.'),
    declined('distinct_senders_7d', 'Smurfing score', 'smurfing', 'No relationship question was asked.'),
    declined('deposit_to_withdrawal_median', 'Rapid cash-out score', 'rapid cash-out', 'Disposal timing is irrelevant to a threshold count.'),
    declined('txn_velocity_24h', 'Transaction velocity', 'structuring', 'Velocity would change no part of a HAVING COUNT(*) answer.'),
    declined('network_centrality', 'Network centrality', 'layering', 'Graph builder was declined, so no centrality exists.'),
  ],
  detection: null,
  risk: null,
};

/* ================================ entity ================================ */

const entity: AgentDetail = {
  amlPattern: 'Structuring, fan-in smurfing and rapid layering (detected, not requested)',
  entities: ['customer 4521 · Meridian Trading Co.'],
  filters: ['entity_id = 4521', 'scope = single_entity', 'date_range = account lifetime'],
  investigationSummary:
    'Yes. Across 147 transactions, 4521 behaved as a collection point: 14 deposits below the reporting line, 23 unrelated senders, a 41 minute median hold, and $181,000 forwarded into a FATF grey-list corridor. Four of five rules fired and the model agrees at 0.88, giving a composite of 87.',
  planning: [
    decision('intent_extraction', 'Intent', 'customer_lookup', 'A yes/no question about one named subject is an entity assessment, not a population sweep.', 0.99),
    decision('entity_extraction', 'Entities', 'customer 4521', 'Numeric identifier extracted and resolved to Meridian Trading Co. with three merged aliases.', 0.99),
    decision('filter_detection', 'Filters', 'none beyond the subject', 'No time or amount bound in the text, so the window defaults to account lifetime.', 0.95),
    decision('pattern_detection', 'AML pattern', 'auto — all typologies armed', 'No typology named, so every rule is evaluated against this one account rather than pruned.', 0.9),
    decision('tool_selection', 'Tools selected', '12 of 14', 'Everything is scoped to 147 rows. Profiling and aggregation add nothing to a single subject.', undefined),
    decision('execution_planning', 'Plan', 'scoped load → features → graph → rules → score → explain', 'Reuses last night’s cached score of 61 and recomputes only today’s delta.', undefined),
  ],
  features: [
    feature('txns_9000_9999_count_30d', 'Structuring score', 'structuring', '14 deposits', 'Deposits in the $9,000–$9,999 band over the review window.'),
    feature('distinct_senders_7d', 'Smurfing score', 'smurfing', '23 senders', 'Distinct originators funnelling into this account in a rolling week.'),
    feature('deposit_to_withdrawal_median', 'Rapid cash-out score', 'rapid cash-out', '41 minutes', 'Median interval between a deposit clearing and funds leaving.'),
    feature('rolling_sum_amount_7d', 'Rolling sum (7d)', 'structuring', '$93,600 peak', 'Rolling weekly inflow across the account lifetime.'),
    feature('txn_velocity_24h', 'Transaction velocity', 'structuring', '4.9 / day', 'Against a personal baseline of 0.7 per day.'),
    feature('amount_deviation_z', 'Amount deviation', 'behavioural anomaly', 'z = 3.4', 'Deviation of amounts from this account’s own rolling mean.'),
    feature('counterparty_country_risk', 'Jurisdiction risk', 'cross-border', 'grey list', 'Counterparty jurisdiction scored against the FATF list.'),
    feature('account_age_days', 'Account age', 'mule account', '42 days', 'Age at first burst — no established baseline to compare against.'),
    feature('network_centrality', 'Network centrality', 'layering', '0.81', 'Hub position across the ten-entity, two-hop neighbourhood.'),
    feature('round_amount_ratio', 'Round amount ratio', 'placement', '0.18', 'Below the 0.6 rule threshold, so ROUND_001 did not fire.'),
  ],
  detection: {
    models: [
      { name: 'rule_engine v12', kind: 'rules', role: 'all five rules evaluated against 147 scoped transactions' },
      { name: 'xgboost_v4', kind: 'supervised', role: 'laundering probability for this subject' },
      { name: 'networkx betweenness', kind: 'graph', role: 'hub detection across two hops' },
    ],
    anomalyType: 'Entity-level composite — structuring + fan-in + rapid disposal',
    score: 0.88,
    threshold: 0.62,
    confidence: 0.91,
    durationMs: 2380,
    evaluated: 147,
    flagged: 4,
    topFeatures: [
      { feature: 'txns_9000_9999_count_30d', contribution: 0.31 },
      { feature: 'distinct_senders_7d', contribution: 0.22 },
      { feature: 'deposit_to_withdrawal_median', contribution: 0.17 },
      { feature: 'account_age_days', contribution: 0.07 },
    ],
  },
  risk: {
    score: 87,
    level: 'HIGH',
    severity: 'severe',
    confidence: 0.91,
    band: '75–100 · HIGH · report',
    reason:
      'Four of five rules fired on independent signals and the supervised model agrees at 0.88. The score rose from a cached 61 in 48 hours, driven by SMURF_001 firing for the first time.',
    evidence: [
      'STRUCT_001 · 14 deposits in the $9,000–$9,999 band',
      'SMURF_001 · 23 distinct senders, $187,400 aggregate inflow',
      'CASHOUT_001 · 41 minute median hold time',
      'GEO_001 · $181,000 outbound to an FATF grey-list corridor',
      'KYC · account 42 days old with a refresh 18 days overdue',
    ],
    components: [
      { label: 'rule score', weight: 0.35, value: 92 },
      { label: 'ml probability', weight: 0.35, value: 88 },
      { label: 'behavioural deviation', weight: 0.2, value: 76 },
      { label: 'alert history', weight: 0.1, value: 60 },
    ],
  },
};

/* =============================== cash-out =============================== */

const cashout: AgentDetail = {
  amlPattern: 'Rapid cash-out (placement then immediate withdrawal)',
  entities: ['population scope · 9 accounts with qualifying disposal chains'],
  filters: ['pattern = rapid_cash_out', 'channel = cash | wire', 'hold_time < 2 hours', 'date_range = last 30 days'],
  investigationSummary:
    '17 disposal chains matched rapid cash-out across nine accounts and $612,400. In every chain funds were withdrawn or forwarded within two hours of a deposit clearing, and six chains terminated at ATM clusters inside a single district.',
  planning: [
    decision('intent_extraction', 'Intent', 'detect_pattern', '"Show … transactions" with a named typology is pattern detection scoped to transactions rather than customers.', 0.96),
    decision('entity_extraction', 'Entities', 'none — population query', 'No subject identifier; the unit of analysis is the deposit-to-disposal chain.', 0.98),
    decision('filter_detection', 'Filters', '4 detected', 'The typology itself implies the hold-time bound and the cash and wire channels.', 0.93),
    decision('pattern_detection', 'AML pattern', 'rapid_cash_out', 'Matched the cash-out vocabulary; layering added as the downstream stage.', 0.95),
    decision('tool_selection', 'Tools selected', '12 of 14', 'Chain reconstruction needs the graph. Profiling and aggregation were declined.', undefined),
    decision('execution_planning', 'Plan', 'load → timing features → graph chains → detect → score → explain', 'Feature engineering narrowed to the four timing and disposal features.', undefined),
  ],
  features: [
    feature('deposit_to_withdrawal_median', 'Rapid cash-out score', 'rapid cash-out', '38 min median', 'Median interval from deposit clearance to disposal across each chain.'),
    feature('withdrawal_ratio_24h', 'Disposal ratio', 'rapid cash-out', '0.96', 'Share of each day’s inflow removed within the same day.'),
    feature('txn_velocity_24h', 'Transaction velocity', 'rapid cash-out', '6.1 / day', 'Chain events per day against the account baseline.'),
    feature('atm_cluster_concentration', 'ATM concentration', 'placement', '4 ATMs', 'Distinct withdrawal locations per chain, weighted by district.'),
    feature('rolling_sum_amount_7d', 'Rolling sum (7d)', 'structuring', '$212,000 peak', 'Rolling weekly throughput for the accounts in each chain.'),
    feature('network_centrality', 'Network centrality', 'layering', '0.44', 'Chain hub position, used to rank which chains matter.'),
    declined('txns_9000_9999_count_30d', 'Structuring score', 'structuring', 'Threshold-band counting is not part of the cash-out definition.'),
    declined('round_amount_ratio', 'Round amount ratio', 'placement', 'Amount shape is irrelevant when disposal timing is the signal.'),
  ],
  detection: {
    models: [
      { name: 'rule_engine v12', kind: 'rules', role: 'CASHOUT_001 evaluated per disposal chain' },
      { name: 'xgboost_v4', kind: 'supervised', role: 'chain-level laundering probability' },
      { name: 'networkx chains', kind: 'graph', role: 'deposit-to-withdrawal chain reconstruction' },
    ],
    anomalyType: 'Sequential pattern — deposit followed by immediate disposal',
    score: 0.79,
    threshold: 0.62,
    confidence: 0.87,
    durationMs: 4180,
    evaluated: 68240,
    flagged: 17,
    topFeatures: [
      { feature: 'deposit_to_withdrawal_median', contribution: 0.34 },
      { feature: 'withdrawal_ratio_24h', contribution: 0.21 },
      { feature: 'atm_cluster_concentration', contribution: 0.14 },
      { feature: 'txn_velocity_24h', contribution: 0.11 },
    ],
  },
  risk: {
    score: 79,
    level: 'HIGH',
    severity: 'severe',
    confidence: 0.87,
    band: '75–100 · HIGH · report',
    reason:
      'CASHOUT_001 fired on every chain and the model agrees at 0.79. Concentration of withdrawals across four ATMs in one district makes the disposal deliberate rather than incidental.',
    evidence: [
      'CASHOUT_001 · 38 minute median hold across 17 chains',
      'Disposal ratio 0.96 — almost nothing retained overnight',
      '11 withdrawals totalling $48,000 across 4 ATMs in one district',
      'Six chains terminate in cash, leaving no onward audit trail',
    ],
    components: [
      { label: 'rule score', weight: 0.35, value: 88 },
      { label: 'ml probability', weight: 0.35, value: 79 },
      { label: 'behavioural deviation', weight: 0.2, value: 71 },
      { label: 'alert history', weight: 0.1, value: 54 },
    ],
  },
};

/* ================================ broad ================================ */

const broad: AgentDetail = {
  amlPattern: 'Unspecified — profiling decides where to look',
  entities: ['population scope · 84,660 resolved entities'],
  filters: ['date_range = last quarter', 'scope = population', 'channel = all'],
  investigationSummary:
    '186 anomalies formed five clusters across the quarter. The strongest is a seven-account fan-in ring; two further clusters were surfaced by novelty detection alone and have no rule describing them. Cycle detection timed out at 402,117 edges, so layering loops are unmeasured in this run.',
  planning: [
    decision('intent_extraction', 'Intent', 'explore_anomalies', '"Anything unusual" carries no typology and no subject, so the intent is open exploration.', 0.92),
    decision('entity_extraction', 'Entities', 'none — population query', 'Nothing to scope to; the unit of analysis is the whole book for the quarter.', 0.98),
    decision('filter_detection', 'Filters', '3 detected', 'Only the period was stated. Channel and scope default to everything.', 0.94),
    decision('pattern_detection', 'AML pattern', 'none named — all armed', 'With no typology to prune on, every rule and both models stay armed and novelty weighting is raised.', 0.88),
    decision('tool_selection', 'Tools selected', '13 of 14', 'The only case where profiling earns its cost, because nothing else can decide where to look.', undefined),
    decision('execution_planning', 'Plan', 'load → profile → all features → graph → detect → rank → explain', 'Novelty weight raised 0.15 → 0.30 so unknown shapes can outrank known ones.', undefined),
  ],
  features: [
    feature('txns_9000_9999_count_30d', 'Structuring score', 'structuring', 'computed', 'All 21 features computed: with no typology named nothing can be pruned safely.'),
    feature('distinct_senders_7d', 'Smurfing score', 'smurfing', 'computed', 'Fan-in ratio per beneficiary across the quarter.'),
    feature('deposit_to_withdrawal_median', 'Rapid cash-out score', 'rapid cash-out', 'computed', 'Disposal timing per account.'),
    feature('txn_velocity_24h', 'Transaction velocity', 'structuring', 'computed', 'Velocity against each account’s own baseline.'),
    feature('amount_deviation_z', 'Amount deviation', 'behavioural anomaly', 'computed', 'Z-score of amount against the account’s rolling mean.'),
    feature('temporal_zscore', 'Time-of-day deviation', 'behavioural anomaly', 'computed', 'Night-window activity against personal history — this surfaced cluster #A-133.'),
    feature('repeated_amount_ratio', 'Repeated amount ratio', 'structuring', 'computed', 'Scripted repetition, which surfaced the $4,950 cluster.'),
    feature('network_centrality', 'Network centrality', 'layering', 'partial', 'Centrality computed; cycle detection timed out at 402k edges.'),
  ],
  detection: {
    models: [
      { name: 'rule_engine v12', kind: 'rules', role: 'all five rules across the quarter' },
      { name: 'xgboost_v4', kind: 'supervised', role: 'probability over the full 21-feature matrix' },
      { name: 'isoforest_v2', kind: 'unsupervised', role: 'novelty, weighted up to 0.30 for this intent' },
    ],
    anomalyType: 'Mixed — 121 rule hits, 44 model-only, 21 novelty-only',
    score: 0.86,
    threshold: 0.58,
    confidence: 0.86,
    durationMs: 6180,
    evaluated: 402117,
    flagged: 186,
    topFeatures: [
      { feature: 'temporal_zscore', contribution: 0.26 },
      { feature: 'repeated_amount_ratio', contribution: 0.19 },
      { feature: 'txns_9000_9999_count_30d', contribution: 0.18 },
      { feature: 'network_centrality', contribution: 0.12 },
    ],
  },
  risk: {
    score: 87,
    level: 'HIGH',
    severity: 'severe',
    confidence: 0.86,
    band: '75–100 · HIGH · report (top cluster)',
    reason:
      'Ranking is per cluster. Ring #A-114 scores 87 on concurrent rule and model evidence; the novelty-only clusters score in the review band because no rule corroborates them yet.',
    evidence: [
      'Ring #A-114 triggered STRUCT_001, SMURF_001 and CASHOUT_001 together',
      'Profiling found a bimodal amount distribution peaking at $9.6k',
      '3.1% of accounts moved 41% of quarterly volume',
      'Caveat · graph analysis degraded to centrality only',
    ],
    components: [
      { label: 'rule score', weight: 0.35, value: 84 },
      { label: 'ml probability', weight: 0.35, value: 86 },
      { label: 'behavioural deviation', weight: 0.2, value: 91 },
      { label: 'alert history', weight: 0.1, value: 72 },
    ],
  },
};

export const agentDetail: Record<string, AgentDetail> = {
  structuring,
  aggregate,
  entity,
  cashout,
  broad,
};

/**
 * The agent reasoning for a scenario.
 *
 * A live run carries its own `detail`, reported by the engine, and that always
 * wins. The bundled demo scenarios have no `detail`, so they resolve against
 * the declarations above by id.
 */
export const detailFor = (scenario: Pick<Scenario, 'id'> & { readonly detail?: AgentDetail }): AgentDetail =>
  scenario.detail ?? agentDetail[scenario.id] ?? structuring;

/* the logical agent components described in the architecture, for the
   architecture panel in Models & rules */
export const agentArchitecture = [
  {
    id: 'intent',
    name: 'Intent & Entity Parser',
    tools: ['intent_classifier'],
    role: 'Turns free text into a typed intent, entity list, filter set and target pattern.',
    always: true,
  },
  {
    id: 'planner',
    name: 'Planner / Orchestrator',
    tools: ['planner', 'tool_selector'],
    role: 'Chooses which of the remaining tools earn their cost, in what order, and records why.',
    always: true,
  },
  {
    id: 'data',
    name: 'Data Access',
    tools: ['entity_resolver', 'transaction_loader'],
    role: 'Resolves identities and loads only the transactions the plan needs.',
    always: false,
  },
  {
    id: 'eda',
    name: 'EDA Tool',
    tools: ['eda_profiler'],
    role: 'Profiles distributions. Invoked only for open-ended queries where nothing tells the agent where to look.',
    always: false,
  },
  {
    id: 'features',
    name: 'Feature Engineering Tool',
    tools: ['feature_builder'],
    role: 'Builds AML features on demand, narrowed to the features tagged to the target pattern.',
    always: false,
  },
  {
    id: 'graph',
    name: 'Graph Builder',
    tools: ['graph_builder'],
    role: 'Reconstructs money flow and centrality when a relationship question is implied.',
    always: false,
  },
  {
    id: 'detection',
    name: 'Anomaly Detection Tool',
    tools: ['detection_engine', 'direct_aggregation'],
    role: 'Deterministic rules, supervised probability and unsupervised novelty — or a plain aggregation when that is the honest answer.',
    always: false,
  },
  {
    id: 'risk',
    name: 'Risk Classification Tool',
    tools: ['risk_engine'],
    role: 'Blends rule, model, behavioural and historical scores into a banded 0–100 composite.',
    always: false,
  },
  {
    id: 'explain',
    name: 'Explanation Engine',
    tools: ['explainability', 'recommendation_engine'],
    role: 'Writes the analyst-facing narrative from rule reasons and SHAP drivers, then maps the band onto monitor / review / report.',
    always: false,
  },
  {
    id: 'report',
    name: 'Reporting',
    tools: ['report_generator'],
    role: 'Assembles the dossier, the execution summary and the SAR draft.',
    always: true,
  },
] as const;
