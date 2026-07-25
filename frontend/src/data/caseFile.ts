import type { NextStep, RiskDelta, SpineItem, TimelineEvent } from '@/types/aml';

export const riskDeltas: readonly RiskDelta[] = [
  { label: 'SMURF_001 fired for the first time', points: 18, source: 'rule engine Â· 24 Jul 09:41' },
  { label: 'Median hold time fell to 41 minutes', points: 8, source: 'behavioural Â· 30d window' },
  { label: 'Grey-list corridor exposure added', points: 4, source: 'GEO_001 Â· 26 Jul' },
  { label: 'KYC refresh went overdue', points: 2, source: 'onboarding Â· 18d late' },
  { label: 'Two low-value counterparties cleared', points: -5, source: 'analyst review Â· M. Osei' },
];

export const nextSteps: readonly NextStep[] = [
  {
    id: 'ns-1',
    label: 'Verify KYC documents for the six originators',
    rationale: 'All six opened within 11 days at three branches listing one correspondence address. Confirming the address makes the ring argument documentary rather than statistical.',
    effort: '~20 min Â· records team',
  },
  {
    id: 'ns-2',
    label: 'Pull teller footage for MUM-014, 7â€“24 Jul',
    rationale: 'If one individual made deposits across multiple account names, the smurfing conclusion becomes direct evidence for the SAR narrative.',
    effort: '~1 day Â· branch ops',
  },
  {
    id: 'ns-3',
    label: 'Screen 5540 and 3390 against sanctions and PEP lists',
    rationale: 'Both sit on the onward corridor and neither has been screened since onboarding. A hit would change the filing category.',
    effort: '~5 min Â· automated',
  },
  {
    id: 'ns-4',
    label: 'Request source-of-funds statement from 4521',
    rationale: 'Standard step before filing; absence of a plausible response is itself reportable and strengthens the narrative.',
    effort: '~10 min Â· draft ready',
  },
];

export const caseTimeline: readonly TimelineEvent[] = [
  { id: 't-1', day: 1, kind: 'account', label: 'Account 4521 opened', detail: 'Branch MUM-014, SME cash-intensive segment, no prior banking relationship.', severity: 'clear' },
  { id: 't-2', day: 3, kind: 'account', label: '3 originator accounts opened', detail: '6120, 1180, 3308 â€” same correspondence address, two branches.', severity: 'review' },
  { id: 't-3', day: 6, kind: 'account', label: '3 further originators opened', detail: '2255, 8871, 5540. All six accounts now live within an 11-day span.', severity: 'review' },
  { id: 't-4', day: 8, kind: 'deposit', label: 'First deposit cluster', detail: '4 cash deposits, $9,200â€“$9,850, three different branches, same afternoon.', severity: 'severe', amount: '$37,700' },
  { id: 't-5', day: 9, kind: 'model', label: 'Model probability crosses 0.40', detail: 'txns_9000_9999_count_30d becomes the dominant SHAP driver.', severity: 'review' },
  { id: 't-6', day: 12, kind: 'deposit', label: 'Second deposit cluster', detail: '6 deposits across two days, all under the reporting line.', severity: 'severe', amount: '$56,100' },
  { id: 't-7', day: 14, kind: 'alert', label: 'STRUCT_001 fires', detail: 'Threshold of 3 transactions in the $9,000â€“$9,999 band exceeded at 9.', severity: 'severe' },
  { id: 't-8', day: 17, kind: 'note', label: 'Analyst note Â· M. Osei', detail: 'Two counterparties cleared as legitimate merchant settlements, documented and excluded.', severity: 'clear' },
  { id: 't-9', day: 19, kind: 'deposit', label: 'Third deposit cluster', detail: '13 deposits over five days, 23 distinct senders cumulative.', severity: 'severe', amount: '$93,600' },
  { id: 't-10', day: 21, kind: 'alert', label: 'SMURF_001 fires', detail: '23 distinct senders against a threshold of 10, aggregate above $50,000.', severity: 'severe' },
  { id: 't-11', day: 25, kind: 'wire', label: 'Outbound wire to 7710', detail: 'AE, FATF grey list. Sent 41 minutes after the final deposit cleared.', severity: 'severe', amount: '$104,000' },
  { id: 't-12', day: 25, kind: 'wire', label: 'Outbound wire to 9004', detail: 'AE, FATF grey list. Balance falls to $2,140 immediately after.', severity: 'severe', amount: '$77,000' },
  { id: 't-13', day: 26, kind: 'model', label: 'Risk score 61 â†’ 87', detail: 'CASHOUT_001 and GEO_001 both fire; case escalated to severe.', severity: 'severe' },
  { id: 't-14', day: 27, kind: 'sar', label: 'SAR draft generated', detail: 'Narrative assembled from 5 pinned evidence items, pending L3 review.', severity: 'review' },
];

export const spineSeed: readonly SpineItem[] = [
  { id: 'sp-1', kind: 'transaction', label: '14 deposits Â· $9,000â€“$9,999', meta: 'STRUCT_001 Â· 30d window', caseId: 'C-114' },
  { id: 'sp-2', kind: 'transaction', label: '2 outbound wires Â· $181,000', meta: 'GEO_001 Â· AE grey-list corridor', caseId: 'C-114' },
  { id: 'sp-3', kind: 'entity', label: '6 originators, 11-day opening window', meta: 'shared correspondence address', caseId: 'C-114' },
  { id: 'sp-4', kind: 'graph', label: 'Ring #A-114 money-flow graph', meta: '7 entities Â· hub centrality 0.81', caseId: 'C-114' },
  { id: 'sp-5', kind: 'note', label: 'Two counterparties excluded after review', meta: 'M. Osei Â· 17 Jul', caseId: 'C-114' },
];

/* `sarSections` and `sarChecklist` were removed: the report composer and the dossier
   SAR block now read the engine draft from /investigations/{run_id}/report, which owns
   both the paragraphs and the readiness checks. A fixture alongside them would compete
   with the real document and always win, because it never fails to load. */

export const auditLog = [
  { id: 'au-1', time: '24 Jul 14:02:11', actor: 'you', kind: 'query', detail: 'Find structuring patterns in the last 30 days', meta: '9 of 11 tools Â· 2.8s Â· 41 results' },
  { id: 'au-2', time: '24 Jul 13:58:44', actor: 'you', kind: 'evidence', detail: 'Pinned 3 transactions to C-114 spine', meta: 'TX-88214 Â· TX-88190 Â· TX-86880' },
  { id: 'au-3', time: '24 Jul 13:41:02', actor: 'A. Iyer', kind: 'filing', detail: 'SAR submitted for C-085', meta: 'FIU ack 2026-0724-8812' },
  { id: 'au-4', time: '24 Jul 13:22:19', actor: 'M. Osei', kind: 'disposition', detail: 'Dismissed alert 12 on C-091 with reason', meta: 'merchant settlement Â· documented' },
  { id: 'au-5', time: '24 Jul 12:47:55', actor: 'agent', kind: 'scoring', detail: 'Refreshed risk scores for medium band', meta: '1,431 customers Â· xgboost_v4' },
  { id: 'au-6', time: '24 Jul 12:05:31', actor: 'you', kind: 'query', detail: 'Is customer 4521 suspicious?', meta: '9 of 11 tools Â· 1.4s Â· scoped' },
  { id: 'au-7', time: '24 Jul 11:38:07', actor: 'compliance', kind: 'config', detail: 'STRUCT_001 threshold proposal 3 â†’ 4', meta: 'rejected Â· alert rate too low' },
  { id: 'au-8', time: '24 Jul 10:12:44', actor: 'you', kind: 'query', detail: 'Which customers made 10+ transactions under $10,000?', meta: '5 of 11 tools Â· 0.6s Â· no ML' },
  { id: 'au-9', time: '24 Jul 09:41:09', actor: 'agent', kind: 'case', detail: 'Opened C-114 from detection output', meta: 'score 87 Â· severe' },
  { id: 'au-10', time: '24 Jul 09:12:09', actor: 'system', kind: 'model', detail: 'Loaded xgboost_v4 from artifact store', meta: 'sha 9f2c11e Â· trained 2026-07-18' },
  { id: 'au-11', time: '23 Jul 18:55:02', actor: 'you', kind: 'export', detail: 'Exported 41 rows to CSV', meta: 'structuring-30d Â· redacted PII' },
  { id: 'au-12', time: '23 Jul 16:02:40', actor: 'agent', kind: 'case', detail: 'Opened C-109 from detection output', meta: 'score 81 Â· severe' },
] as const;
