import type { Severity } from '@/types/aml';

export interface LedgerRow {
  readonly id: string;
  readonly time: string;
  readonly from: string;
  readonly to: string;
  readonly amount: number;
  readonly channel: 'cash' | 'wire' | 'ach' | 'card' | 'crypto';
  readonly jurisdiction: string;
  readonly pattern: string;
  readonly rule: string;
  readonly score: number;
  readonly severity: Severity;
  readonly shap: readonly string[];
  readonly siblings: number;
}

const build = (
  id: number,
  time: string,
  from: string,
  to: string,
  amount: number,
  channel: LedgerRow['channel'],
  jurisdiction: string,
  pattern: string,
  rule: string,
  score: number,
  shap: readonly string[],
  siblings: number,
): LedgerRow => ({
  id: `TX-${String(id)}`,
  time,
  from,
  to,
  amount,
  channel,
  jurisdiction,
  pattern,
  rule,
  score,
  severity: score >= 75 ? 'severe' : score >= 40 ? 'review' : 'clear',
  shap,
  siblings,
});

export const ledgerRows: readonly LedgerRow[] = [
  build(88214, '24 Jul 09:12', '4521', '7710', 9850, 'cash', 'IN→AE', 'structuring', 'STRUCT_001', 91, ['txns_9000_9999 +0.31', 'hold_time −0.18', 'ctry_risk +0.11'], 13),
  build(88213, '24 Jul 08:58', '6120', '4521', 4200, 'cash', 'IN', 'smurfing', 'SMURF_001', 61, ['distinct_senders +0.24', 'acct_age +0.09'], 22),
  build(88190, '24 Jul 08:47', '4521', '7710', 9700, 'cash', 'IN→AE', 'structuring', 'STRUCT_001', 89, ['txns_9000_9999 +0.29', 'rolling_sum_7d +0.14'], 13),
  build(88176, '24 Jul 07:31', '9004', 'CASH', 48000, 'cash', 'AE', 'rapid cash-out', 'CASHOUT_001', 84, ['hold_time −0.27', 'round_amount +0.08'], 10),
  build(87996, '23 Jul 19:33', '6120', '4521', 4200, 'cash', 'IN', 'smurfing', 'SMURF_001', 61, ['distinct_senders +0.22'], 22),
  build(87972, '23 Jul 18:04', '5540', '9004', 9700, 'wire', 'IN→AE', 'structuring', 'STRUCT_001', 77, ['txns_9000_9999 +0.26', 'ctry_risk +0.12'], 8),
  build(87840, '23 Jul 14:05', '3308', '9004', 9950, 'cash', 'IN→AE', 'structuring', 'STRUCT_001', 84, ['txns_9000_9999 +0.30'], 8),
  build(87799, '23 Jul 12:44', '7710', '2201', 61000, 'crypto', 'AE→—', 'layering', 'GEO_001', 72, ['ctry_risk +0.21', 'channel_crypto +0.16'], 3),
  build(87611, '22 Jul 22:58', '9004', 'CASH', 21000, 'cash', 'AE', 'rapid cash-out', 'CASHOUT_001', 79, ['hold_time −0.25'], 10),
  build(87540, '22 Jul 19:12', '2255', '4521', 9200, 'cash', 'IN', 'structuring', 'STRUCT_001', 68, ['txns_9000_9999 +0.19'], 13),
  build(87402, '22 Jul 11:20', '7710', '2255', 15000, 'wire', 'AE→IN', 'layering', 'GEO_001', 55, ['ctry_risk +0.15', 'reciprocal_flow +0.10'], 5),
  build(87355, '22 Jul 10:02', '1180', '6120', 2300, 'ach', 'IN', '—', '—', 18, ['baseline'], 0),
  build(87188, '21 Jul 16:41', '2255', '4521', 5000, 'cash', 'IN', 'round amount', 'ROUND_001', 47, ['round_amount +0.13'], 6),
  build(87140, '21 Jul 15:08', '8871', '4521', 4900, 'cash', 'IN', 'round amount', 'ROUND_001', 43, ['round_amount +0.12'], 6),
  build(86903, '21 Jul 10:02', '1180', '3308', 780, 'card', 'IN', '—', '—', 12, ['baseline'], 0),
  build(86880, '20 Jul 21:47', '3308', '4521', 9900, 'cash', 'IN', 'structuring', 'STRUCT_001', 81, ['txns_9000_9999 +0.28'], 13),
  build(86812, '20 Jul 17:19', '5540', '4521', 9600, 'cash', 'IN', 'structuring', 'STRUCT_001', 74, ['txns_9000_9999 +0.24'], 13),
  build(86755, '20 Jul 13:55', '6120', '4521', 3800, 'cash', 'IN', 'smurfing', 'SMURF_001', 58, ['distinct_senders +0.20'], 22),
  build(86690, '19 Jul 20:31', '4521', '9004', 34000, 'wire', 'IN→AE', 'layering', 'GEO_001', 76, ['ctry_risk +0.18', 'hold_time −0.14'], 4),
  build(86601, '19 Jul 12:12', '1180', '8871', 1450, 'ach', 'IN', '—', '—', 9, ['baseline'], 0),
  build(86540, '18 Jul 18:40', '2255', '6120', 2600, 'ach', 'IN', '—', '—', 21, ['baseline'], 0),
  build(86488, '18 Jul 11:05', '3308', '4521', 9450, 'cash', 'IN', 'structuring', 'STRUCT_001', 78, ['txns_9000_9999 +0.25'], 13),
];

export interface SavedView {
  readonly id: string;
  readonly label: string;
  readonly filters: readonly string[];
  readonly count: number;
}

export const savedViews: readonly SavedView[] = [
  { id: 'v-struct', label: 'structuring · 30d', filters: ['amount 9,000–9,999', 'channel cash'], count: 6412 },
  { id: 'v-corridor', label: 'AE corridor', filters: ['jurisdiction IN→AE'], count: 914 },
  { id: 'v-newacct', label: 'new accounts, high value', filters: ['acct_age < 90d', 'amount > $25k'], count: 288 },
  { id: 'v-novel', label: 'novelty only', filters: ['rule none', 'isoforest hit'], count: 21 },
];

export const channelLabel: Record<LedgerRow['channel'], string> = {
  cash: 'cash',
  wire: 'wire',
  ach: 'ach',
  card: 'card',
  crypto: 'crypto',
};
