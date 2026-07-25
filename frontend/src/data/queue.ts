import type { CaseRecord, Severity } from '@/types/aml';

export const cases: readonly CaseRecord[] = [
  { id: 'C-114', entity: '4521', name: 'Meridian Trading Co.', score: 87, severity: 'severe', stage: 'sar-draft', slaHours: 2, assignee: 'you', pattern: 'structuring + fan-in', opened: '24 Jul 09:41', exposure: '$1,284,900' },
  { id: 'C-109', entity: '9004', name: 'Novak Exports Ltd', score: 81, severity: 'severe', stage: 'investigating', slaHours: 6, assignee: 'you', pattern: 'structuring + cash-out', opened: '23 Jul 16:02', exposure: '$742,300' },
  { id: 'C-107', entity: '5540', name: 'Trentham Logistics', score: 79, severity: 'severe', stage: 'triage', slaHours: 9, assignee: 'unassigned', pattern: 'rapid cash-out', opened: '23 Jul 11:20', exposure: '$488,110' },
  { id: 'C-102', entity: '3308', name: 'R. Advani', score: 63, severity: 'review', stage: 'investigating', slaHours: 27, assignee: 'you', pattern: 'structuring', opened: '22 Jul 08:15', exposure: '$318,650' },
  { id: 'C-098', entity: '7710', name: 'Calder Holdings', score: 58, severity: 'review', stage: 'investigating', slaHours: 41, assignee: 'A. Iyer', pattern: 'layering', opened: '21 Jul 14:48', exposure: '$556,100' },
  { id: 'C-094', entity: '2255', name: 'S. Bhatt', score: 51, severity: 'review', stage: 'triage', slaHours: 62, assignee: 'unassigned', pattern: 'structuring', opened: '20 Jul 10:11', exposure: '$121,400' },
  { id: 'C-091', entity: '6120', name: 'Larkspur Retail', score: 44, severity: 'review', stage: 'triage', slaHours: 70, assignee: 'M. Osei', pattern: 'round-amount clustering', opened: '19 Jul 17:35', exposure: '$88,900' },
  { id: 'C-088', entity: '1180', name: 'Ashford Grocers', score: 22, severity: 'clear', stage: 'investigating', slaHours: 96, assignee: 'M. Osei', pattern: 'velocity spike', opened: '19 Jul 09:02', exposure: '$94,300' },
  { id: 'C-085', entity: '8871', name: 'V. Kulkarni', score: 18, severity: 'clear', stage: 'filed', slaHours: 0, assignee: 'A. Iyer', pattern: 'none material', opened: '18 Jul 12:26', exposure: '$61,700' },
];

export interface SignalCard {
  readonly id: string;
  readonly kind: 'model' | 'sla' | 'coverage' | 'drift';
  readonly headline: string;
  readonly body: string;
  readonly action: string;
  readonly severity: Severity | 'model';
}

export const signals: readonly SignalCard[] = [
  {
    id: 'sig-1',
    kind: 'coverage',
    headline: '21 novelty hits, no rule coverage',
    body: 'Isolation Forest flagged a night-window cash cycle across 9 accounts that no current rule describes. Confirm the shape and the agent will draft a rule proposal.',
    action: 'Inspect cluster #A-133',
    severity: 'model',
  },
  {
    id: 'sig-2',
    kind: 'sla',
    headline: '2 cases breach SLA within 6 hours',
    body: 'C-114 has 2h remaining with a SAR draft pending review. C-109 has 6h and no assignee action since yesterday.',
    action: 'Open C-114',
    severity: 'severe',
  },
  {
    id: 'sig-3',
    kind: 'drift',
    headline: 'STRUCT_001 alert rate up 14% week on week',
    body: 'Volume in the $9,000–$9,999 band rose against a flat total, so the rule is contributing more of the alert mix than last week.',
    action: 'Review STRUCT_001 contribution',
    severity: 'review',
  },
];

export const workload = [
  { label: 'assigned to you', value: 12, total: 47, severity: 'review' as Severity },
  { label: 'team open', value: 47, total: 47, severity: 'clear' as Severity },
  { label: 'sla at risk', value: 2, total: 47, severity: 'severe' as Severity },
  { label: 'awaiting review', value: 5, total: 47, severity: 'review' as Severity },
];

/* jurisdiction × week exposure, 0–1 normalised intensity */
export interface HeatCell {
  readonly row: string;
  readonly values: readonly number[];
}

export const exposureHeat: readonly HeatCell[] = [
  { row: 'AE', values: [0.22, 0.34, 0.41, 0.58, 0.72, 0.91] },
  { row: 'IN', values: [0.4, 0.38, 0.44, 0.42, 0.47, 0.52] },
  { row: 'CY', values: [0.12, 0.18, 0.26, 0.31, 0.44, 0.49] },
  { row: 'SG', values: [0.08, 0.11, 0.14, 0.12, 0.19, 0.22] },
  { row: 'GB', values: [0.3, 0.28, 0.24, 0.26, 0.22, 0.2] },
  { row: 'PA', values: [0.05, 0.09, 0.16, 0.28, 0.38, 0.61] },
];

export const heatWeeks = ['W7', 'W8', 'W9', 'W10', 'W11', 'W12'] as const;

export const analystActivity = [
  { time: '13:58', who: 'you', text: 'pinned 3 deposits to C-114 evidence spine' },
  { time: '13:41', who: 'A. Iyer', text: 'filed SAR for C-085, closed case' },
  { time: '13:22', who: 'M. Osei', text: 'dismissed C-091 alert 12 — merchant settlement, documented' },
  { time: '12:47', who: 'agent', text: 'refreshed risk scores for 1,431 medium-band customers' },
  { time: '12:05', who: 'you', text: 'ran query · "Is customer 4521 suspicious?"' },
] as const;
