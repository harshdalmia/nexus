import type { ChartSpec } from '@/types/aml';

/* ------------------------------------------------------------------
   Visualization metadata. In production these specs arrive with the
   agent response; here they are authored per typology so each intent
   produces a materially different dossier.
   ------------------------------------------------------------------ */

export const riskDistribution: ChartSpec = {
  kind: 'bars',
  title: 'Risk distribution',
  subtitle: 'flagged customers by score band',
  unit: 'customers',
  data: [
    { label: '0–19', value: 4, severity: 'clear' },
    { label: '20–39', value: 6, severity: 'clear' },
    { label: '40–54', value: 9, severity: 'review' },
    { label: '55–69', value: 8, severity: 'review' },
    { label: '70–84', value: 9, severity: 'severe' },
    { label: '85–100', value: 5, severity: 'severe' },
  ],
  footnote: '14 of 41 sit above the reporting band — a believable 2% of the screened population',
};

export const riskComposition: ChartSpec = {
  kind: 'donut',
  title: 'Risk composition',
  subtitle: 'what drives the 87 for customer 4521',
  data: [
    { label: 'rule score', value: 32.2, severity: 'severe', note: '92 × 0.35' },
    { label: 'ml probability', value: 30.8, severity: 'severe', note: '88 × 0.35' },
    { label: 'behavioural', value: 15.2, severity: 'review', note: '76 × 0.20' },
    { label: 'alert history', value: 6, severity: 'clear', note: '60 × 0.10' },
  ],
  footnote: 'weights from configs/risk_weights.yaml · sums to the composite score',
};

export const alertCategories: ChartSpec = {
  kind: 'pie',
  title: 'Alert categories',
  subtitle: 'typology mix inside this result set',
  data: [
    { label: 'structuring', value: 26, severity: 'severe' },
    { label: 'fan-in smurfing', value: 8, severity: 'severe' },
    { label: 'rapid cash-out', value: 4, severity: 'review' },
    { label: 'round-amount', value: 3, severity: 'review' },
  ],
};

export const dailySuspicious: ChartSpec = {
  kind: 'stacked',
  title: 'Daily suspicious activity',
  subtitle: 'deposits, wires and cash-outs by day',
  seriesNames: ['deposits under $10k', 'outbound wires', 'cash withdrawals'],
  series: [
    { label: '1', values: [2, 0, 0] },
    { label: '3', values: [3, 0, 0] },
    { label: '5', values: [4, 1, 0] },
    { label: '7', values: [6, 0, 1] },
    { label: '9', values: [8, 1, 0] },
    { label: '11', values: [7, 0, 2] },
    { label: '13', values: [9, 2, 1] },
    { label: '15', values: [11, 1, 0] },
    { label: '17', values: [8, 0, 3] },
    { label: '19', values: [13, 2, 1] },
    { label: '21', values: [10, 1, 2] },
    { label: '23', values: [12, 3, 1] },
    { label: '25', values: [9, 4, 3] },
    { label: '27', values: [6, 2, 5] },
    { label: '29', values: [4, 1, 2] },
  ],
  footnote: 'wire activity clusters immediately after each deposit burst',
};

export const volumeLine: ChartSpec = {
  kind: 'line',
  title: 'Transaction volume',
  subtitle: 'screened cash deposits per day, 30 days',
  unit: 'txns',
  data: [
    { label: 'd1', value: 2140 },
    { label: 'd3', value: 2380 },
    { label: 'd5', value: 2290 },
    { label: 'd7', value: 2610 },
    { label: 'd9', value: 2870 },
    { label: 'd11', value: 2740 },
    { label: 'd13', value: 3120 },
    { label: 'd15', value: 3410 },
    { label: 'd17', value: 3190 },
    { label: 'd19', value: 3680 },
    { label: 'd21', value: 3520 },
    { label: 'd23', value: 3910 },
    { label: 'd25', value: 4240 },
    { label: 'd27', value: 3860 },
    { label: 'd29', value: 3540 },
  ],
};

export const riskEvolution: ChartSpec = {
  kind: 'area',
  title: 'Risk evolution',
  subtitle: 'composite score for 4521 across the review period',
  data: [
    { label: 'd1', value: 12 },
    { label: 'd4', value: 14 },
    { label: 'd7', value: 22 },
    { label: 'd9', value: 34 },
    { label: 'd12', value: 41 },
    { label: 'd14', value: 58 },
    { label: 'd17', value: 55 },
    { label: 'd19', value: 61 },
    { label: 'd21', value: 74 },
    { label: 'd23', value: 76 },
    { label: 'd25', value: 83 },
    { label: 'd26', value: 87 },
    { label: 'd28', value: 87 },
    { label: 'd30', value: 87 },
  ],
  footnote: 'step changes align with STRUCT_001 on day 14 and SMURF_001 on day 21',
};

export const shapWaterfall: ChartSpec = {
  kind: 'waterfall',
  title: 'Feature contribution',
  subtitle: 'SHAP decomposition of the 0.88 model probability',
  data: [
    { label: 'base rate', value: 0.06, severity: 'clear' },
    { label: 'txns_9000_9999_count_30d', value: 0.31, severity: 'severe' },
    { label: 'distinct_senders_7d', value: 0.22, severity: 'severe' },
    { label: 'deposit_to_withdrawal_median', value: 0.17, severity: 'severe' },
    { label: 'counterparty_country_risk', value: 0.09, severity: 'review' },
    { label: 'account_age_days', value: 0.07, severity: 'review' },
    { label: 'declared_turnover_match', value: -0.04, severity: 'clear' },
  ],
  footnote: 'positive bars push toward laundering; the single negative bar is the only mitigating feature',
};

export const ruleContribution: ChartSpec = {
  kind: 'hbars',
  title: 'Rule contribution',
  subtitle: 'observed value against configured threshold',
  data: [
    { label: 'STRUCT_001', value: 100, note: '14 txns vs threshold 3' },
    { label: 'SMURF_001', value: 92, note: '23 senders vs threshold 10' },
    { label: 'CASHOUT_001', value: 88, note: '41 min vs threshold 120 min' },
    { label: 'GEO_001', value: 61, note: '$181,000 vs threshold $15,000' },
    { label: 'ROUND_001', value: 12, note: '18% vs threshold 60% — not fired' },
  ],
};

export const moneyFlowSankey: ChartSpec = {
  kind: 'sankey',
  title: 'Money flow',
  subtitle: 'placement → consolidation → layering, $187,400 traced',
  sankey: {
    nodes: [
      { id: 'cash', label: 'cash deposits · 23', column: 0, severity: 'review' },
      { id: 'mules', label: '6 originator accounts', column: 1, severity: 'review' },
      { id: 'hub', label: 'hub 4521', column: 2, severity: 'severe' },
      { id: '7710', label: '7710 · AE', column: 3, severity: 'severe' },
      { id: '9004', label: '9004 · AE', column: 3, severity: 'severe' },
      { id: 'retained', label: 'retained balance', column: 3, severity: 'clear' },
    ],
    links: [
      { from: 'cash', to: 'mules', value: 187400, severity: 'review' },
      { from: 'mules', to: 'hub', value: 187400, severity: 'severe' },
      { from: 'hub', to: '7710', value: 104000, severity: 'severe' },
      { from: 'hub', to: '9004', value: 77000, severity: 'severe' },
      { from: 'hub', to: 'retained', value: 6400, severity: 'clear' },
    ],
  },
  footnote: '96.6% of inflow left the hub within a median of 41 minutes',
};

export const clusterScatter: ChartSpec = {
  kind: 'scatter',
  title: 'Cluster detection',
  subtitle: 'mean amount against transaction velocity · bubble size is exposure',
  scatter: [
    { id: 'a114', x: 8140, y: 4.9, size: 34, severity: 'severe', label: 'ring #A-114' },
    { id: 'a121', x: 21400, y: 3.1, size: 28, severity: 'severe', label: '#A-121 corridor' },
    { id: 'a133', x: 4950, y: 6.2, size: 22, severity: 'review', label: '#A-133 night cycle' },
    { id: 'a140', x: 4950, y: 5.1, size: 26, severity: 'review', label: '#A-140 scripted' },
    { id: 'a152', x: 3100, y: 1.4, size: 16, severity: 'clear', label: '#A-152 dormant' },
    { id: 'base1', x: 1800, y: 0.7, size: 10, severity: 'clear', label: 'retail baseline' },
    { id: 'base2', x: 2600, y: 1.1, size: 12, severity: 'clear', label: 'SME baseline' },
    { id: 'base3', x: 6200, y: 0.9, size: 11, severity: 'clear', label: 'wholesale baseline' },
    { id: 'base4', x: 9400, y: 1.8, size: 9, severity: 'clear', label: 'property escrow' },
  ],
  footnote: 'the two severe clusters sit just under $10k with velocity 3–5× the retail baseline',
};

export const segmentTreemap: ChartSpec = {
  kind: 'treemap',
  title: 'Customer segments',
  subtitle: 'flagged exposure by segment',
  data: [
    { label: 'SME cash-intensive', value: 1284900, severity: 'severe' },
    { label: 'import / export', value: 914000, severity: 'severe' },
    { label: 'retail individual', value: 402500, severity: 'review' },
    { label: 'money service business', value: 233900, severity: 'review' },
    { label: 'professional services', value: 121400, severity: 'clear' },
    { label: 'property', value: 88900, severity: 'clear' },
  ],
};

export const jurisdictionHeat: ChartSpec = {
  kind: 'heatmap',
  title: 'Risk by jurisdiction',
  subtitle: 'normalised exposure, jurisdiction × week',
  heatColumns: ['W7', 'W8', 'W9', 'W10', 'W11', 'W12'],
  heatRows: [
    { row: 'AE', values: [0.22, 0.34, 0.41, 0.58, 0.72, 0.91] },
    { row: 'IN', values: [0.4, 0.38, 0.44, 0.42, 0.47, 0.52] },
    { row: 'CY', values: [0.12, 0.18, 0.26, 0.31, 0.44, 0.49] },
    { row: 'PA', values: [0.05, 0.09, 0.16, 0.28, 0.38, 0.61] },
    { row: 'SG', values: [0.08, 0.11, 0.14, 0.12, 0.19, 0.22] },
    { row: 'GB', values: [0.3, 0.28, 0.24, 0.26, 0.22, 0.2] },
  ],
  footnote: 'AE exposure quadrupled over six weeks against flat domestic volume',
};

export const corridorMap: ChartSpec = {
  kind: 'corridor',
  title: 'Geographical risk',
  subtitle: 'cross-border corridors in this result set',
  corridor: [
    { from: 'IN', to: 'AE', value: 914000, severity: 'severe' },
    { from: 'AE', to: 'CY', value: 43000, severity: 'review' },
    { from: 'AE', to: 'PA', value: 61000, severity: 'severe' },
    { from: 'IN', to: 'SG', value: 128000, severity: 'clear' },
    { from: 'GB', to: 'IN', value: 96000, severity: 'clear' },
  ],
  footnote: 'two corridors terminate in FATF grey-list jurisdictions',
};

export const confidenceGauge: ChartSpec = {
  kind: 'gauge',
  title: 'Model confidence',
  subtitle: 'agreement between rules, supervised model and novelty signal',
  gauge: { value: 0.93, label: '0.93', caption: 'rules and model concur on 34 of 41 findings' },
};

export const entityConfidenceGauge: ChartSpec = {
  kind: 'gauge',
  title: 'Model confidence',
  subtitle: 'scoped to entity 4521',
  gauge: { value: 0.91, label: '0.91', caption: '4 rules fired, 147 transactions reviewed' },
};

/* ---------------- aggregate intent: counting, no inference ---------------- */

export const countDistribution: ChartSpec = {
  kind: 'bars',
  title: 'Transaction count distribution',
  subtitle: 'customers by number of sub-$10,000 transactions',
  unit: 'customers',
  data: [
    { label: '10–14', value: 61, severity: 'clear' },
    { label: '15–19', value: 34, severity: 'clear' },
    { label: '20–24', value: 18, severity: 'clear' },
    { label: '25–29', value: 9, severity: 'clear' },
    { label: '30–34', value: 4, severity: 'clear' },
    { label: '35+', value: 2, severity: 'clear' },
  ],
  footnote: 'a count, not a risk ranking — no model was invoked for this answer',
};

export const amountBands: ChartSpec = {
  kind: 'hbars',
  title: 'Amount bands',
  subtitle: 'where the matched transactions sit',
  data: [
    { label: '$9,000–$9,999', value: 100, note: '1,842 transactions' },
    { label: '$7,500–$8,999', value: 54, note: '994 transactions' },
    { label: '$5,000–$7,499', value: 41, note: '755 transactions' },
    { label: '$2,500–$4,999', value: 33, note: '608 transactions' },
    { label: 'under $2,500', value: 22, note: '405 transactions' },
  ],
  footnote: 'the top band is 40% of matched volume, which is what makes this question worth asking',
};

export const aggregateSegments: ChartSpec = {
  kind: 'treemap',
  title: 'Customer segments',
  subtitle: 'matched customers by segment',
  data: [
    { label: 'retail individual', value: 54, severity: 'clear' },
    { label: 'SME cash-intensive', value: 31, severity: 'clear' },
    { label: 'money service business', value: 18, severity: 'clear' },
    { label: 'professional services', value: 14, severity: 'clear' },
    { label: 'import / export', value: 11, severity: 'clear' },
  ],
};

/* ---------------- broad intent: exploratory ---------------- */

export const novelClusters: ChartSpec = {
  kind: 'pie',
  title: 'Detection source',
  subtitle: 'which layer surfaced each anomaly',
  data: [
    { label: 'rule engine', value: 121, severity: 'severe' },
    { label: 'supervised model only', value: 44, severity: 'review' },
    { label: 'novelty only · no rule coverage', value: 21, severity: 'review' },
  ],
  footnote: '21 anomalies have no rule describing them — candidates for a new rule',
};

export const quarterTrend: ChartSpec = {
  kind: 'area',
  title: 'Risk trend',
  subtitle: 'mean composite score across the screened book',
  data: [
    { label: 'W1', value: 18 },
    { label: 'W2', value: 19 },
    { label: 'W3', value: 22 },
    { label: 'W4', value: 21 },
    { label: 'W5', value: 24 },
    { label: 'W6', value: 27 },
    { label: 'W7', value: 26 },
    { label: 'W8', value: 31 },
    { label: 'W9', value: 34 },
    { label: 'W10', value: 33 },
    { label: 'W11', value: 38 },
    { label: 'W12', value: 41 },
  ],
};

export const concentration: ChartSpec = {
  kind: 'stacked',
  title: 'Volume concentration',
  subtitle: 'share of quarterly volume by account decile',
  seriesNames: ['flagged', 'unflagged'],
  series: [
    { label: 'd1', values: [31, 10] },
    { label: 'd2', values: [12, 9] },
    { label: 'd3', values: [6, 8] },
    { label: 'd4', values: [3, 7] },
    { label: 'd5', values: [2, 6] },
    { label: 'd6', values: [1, 5] },
    { label: 'd7', values: [1, 4] },
    { label: 'd8', values: [0, 3] },
    { label: 'd9', values: [0, 2] },
    { label: 'd10', values: [0, 1] },
  ],
  footnote: '3.1% of accounts moved 41% of volume, and they are disproportionately flagged',
};
