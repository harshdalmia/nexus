import type { RuleContribution } from '@/types/aml';

/* Rules are shown read-only: what each one looks for, how often it fired
   and how precise it has been. Thresholds are disclosed inside the
   expression for transparency, but they are not editable in the product. */

export const ruleContributions: readonly RuleContribution[] = [
  {
    id: 'STRUCT_001',
    name: 'Structuring below the reporting line',
    expression: 'count(amount ∈ [9000, 9999.99]) ≥ 3 within 30d',
    pattern: 'structuring',
    firedCount: 6412,
    shareOfAlerts: 0.451,
    precision: 0.93,
    regulatoryBasis: '31 CFR 1010.311 — $10,000 CTR line',
    enabled: true,
  },
  {
    id: 'SMURF_001',
    name: 'Fan-in smurfing',
    expression: 'distinct_senders ≥ 10 and sum(amount) ≥ $50,000 within 7d',
    pattern: 'smurfing',
    firedCount: 3180,
    shareOfAlerts: 0.224,
    precision: 0.88,
    regulatoryBasis: 'FATF typology · placement through third parties',
    enabled: true,
  },
  {
    id: 'CASHOUT_001',
    name: 'Rapid cash-out',
    expression: 'median(withdrawal_ts − deposit_ts) < 2 hours',
    pattern: 'layering',
    firedCount: 2041,
    shareOfAlerts: 0.144,
    precision: 0.81,
    enabled: true,
  },
  {
    id: 'ROUND_001',
    name: 'Round-amount clustering',
    expression: 'share(amount mod 500 = 0) > 60%',
    pattern: 'placement',
    firedCount: 1188,
    shareOfAlerts: 0.084,
    precision: 0.64,
    enabled: true,
  },
  {
    id: 'GEO_001',
    name: 'High-risk jurisdiction exposure',
    expression: 'counterparty_country ∈ FATF list and amount ≥ $15,000',
    pattern: 'cross-border',
    firedCount: 903,
    shareOfAlerts: 0.064,
    precision: 0.76,
    regulatoryBasis: 'FATF grey and black list, July 2026 revision',
    enabled: true,
  },
];

export const featureImportance = [
  { label: 'txns_9000_9999_count_30d', value: 0.31, pattern: 'structuring' },
  { label: 'distinct_senders_7d', value: 0.25, pattern: 'smurfing' },
  { label: 'deposit_to_withdrawal_median', value: 0.21, pattern: 'layering' },
  { label: 'rolling_sum_amount_7d', value: 0.17, pattern: 'structuring' },
  { label: 'account_age_days', value: 0.12, pattern: 'mule' },
  { label: 'counterparty_country_risk', value: 0.09, pattern: 'cross-border' },
  { label: 'repeated_amount_ratio', value: 0.08, pattern: 'structuring' },
  { label: 'inter_txn_gap_seconds', value: 0.06, pattern: 'automation' },
] as const;

export const performance = {
  precision: 0.91,
  recall: 0.84,
  f1: 0.87,
  auc: 0.96,
  modelVersion: 'xgboost_v4',
  trained: '2026-07-18',
  holdout: '241,978 txns · 1,904 labelled positives',
  drift: 'population stability index 0.07 — stable',
} as const;

export const pyramid = [
  { label: 'transactions screened', value: 1204882, width: 100, severity: 'clear' as const },
  { label: 'flagged by rules or ML', value: 14209, width: 72, severity: 'clear' as const },
  { label: 'medium risk · review', value: 1431, width: 46, severity: 'review' as const },
  { label: 'high risk · report', value: 287, width: 24, severity: 'severe' as const },
];

export const scoreWeights = [
  { label: 'rule score', weight: 0.35, note: 'deterministic hits, regulator-recognisable' },
  { label: 'ml probability', weight: 0.35, note: 'xgboost_v4 on 21 engineered features' },
  { label: 'behavioural deviation', weight: 0.2, note: 'z-score against the account’s own baseline' },
  { label: 'alert history', weight: 0.1, note: 'prior alerts, time-decayed' },
] as const;

export const patternMix = [
  { label: 'structuring', value: 6412 },
  { label: 'smurfing / fan-in', value: 3180 },
  { label: 'rapid cash-out', value: 2041 },
  { label: 'layering cycles', value: 1388 },
  { label: 'round-amount', value: 1188 },
] as const;

export const alertTrend = [210, 194, 228, 178, 199, 166, 182, 151, 160, 143, 154, 142] as const;
