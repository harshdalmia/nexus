import type { GraphEdge, GraphNode } from '@/types/aml';

/* Ring #A-114. Layout is hand-placed rather than force-simulated so the
   money flow reads left → right: originators, hub, offshore beneficiaries.
   Hop-2 nodes stay hidden until the analyst expands, which keeps the
   canvas legible instead of exploding to 40 nodes on load. */

export const graphNodes: readonly GraphNode[] = [
  {
    id: '6120', label: '6120', kind: 'company', x: 120, y: 92, hop: 1, role: 'originator · Larkspur Retail',
    centrality: 0.18, severity: 'review',
    facts: [['opened', '61 days ago'], ['deposits in', '4 · $18,400'], ['branch', 'MUM-014'], ['kyc', 'complete']],
  },
  {
    id: '1180', label: '1180', kind: 'person', x: 92, y: 186, hop: 1, role: 'originator · Ashford Grocers',
    centrality: 0.14, severity: 'clear',
    facts: [['opened', '58 days ago'], ['deposits in', '3 · $12,900'], ['branch', 'MUM-014'], ['kyc', 'complete']],
  },
  {
    id: '3308', label: '3308', kind: 'person', x: 86, y: 292, hop: 1, role: 'originator · R. Advani',
    centrality: 0.31, severity: 'severe',
    facts: [['opened', '55 days ago'], ['deposits in', '6 · $54,300'], ['branch', 'MUM-021'], ['kyc', 'refresh overdue']],
  },
  {
    id: '2255', label: '2255', kind: 'person', x: 96, y: 398, hop: 1, role: 'originator · S. Bhatt',
    centrality: 0.22, severity: 'review',
    facts: [['opened', '54 days ago'], ['deposits in', '5 · $41,600'], ['branch', 'MUM-021'], ['kyc', 'complete']],
  },
  {
    id: '8871', label: '8871', kind: 'person', x: 128, y: 492, hop: 1, role: 'originator · V. Kulkarni',
    centrality: 0.11, severity: 'clear',
    facts: [['opened', '52 days ago'], ['deposits in', '2 · $9,800'], ['branch', 'PUN-004'], ['kyc', 'complete']],
  },
  {
    id: '5540', label: '5540', kind: 'company', x: 238, y: 44, hop: 1, role: 'originator · Trentham Logistics',
    centrality: 0.27, severity: 'severe',
    facts: [['opened', '50 days ago'], ['deposits in', '3 · $50,400'], ['branch', 'PUN-004'], ['kyc', 'refresh overdue']],
  },
  {
    id: '4521', label: '4521', kind: 'account', x: 470, y: 292, hop: 1, role: 'hub · Meridian Trading Co.',
    centrality: 0.81, severity: 'severe',
    facts: [
      ['inbound', '23 senders · $187,400'],
      ['outbound', '2 wires · $181,000'],
      ['net retained', '$2,140'],
      ['median hold', '41 minutes'],
      ['account age', '42 days'],
      ['rules fired', 'STRUCT · SMURF · CASHOUT · GEO'],
    ],
  },
  {
    id: 'MUM-014', label: 'MUM-014', kind: 'branch', x: 300, y: 470, hop: 1, role: 'branch · 3 originators opened here',
    centrality: 0.24, severity: 'review',
    facts: [['accounts opened', '3 in 11 days'], ['same address', 'yes'], ['staff', '2 tellers']],
  },
  {
    id: 'DEV-7742', label: 'DEV-7742', kind: 'device', x: 300, y: 128, hop: 1, role: 'device · shared by 4 originators',
    centrality: 0.46, severity: 'severe',
    facts: [['shared by', '6120 · 3308 · 2255 · 5540'], ['first seen', '52 days ago'], ['geo', 'Mumbai · single cell']],
  },
  {
    id: '7710', label: '7710', kind: 'offshore', x: 760, y: 168, hop: 1, role: 'beneficiary · Calder Holdings (AE)',
    centrality: 0.38, severity: 'severe',
    facts: [['jurisdiction', 'AE · FATF grey'], ['inbound wire', '$104,000'], ['received', '26 Jul 09:12'], ['onward', '2 hops to CY']],
  },
  {
    id: '9004', label: '9004', kind: 'offshore', x: 760, y: 416, hop: 1, role: 'beneficiary · Novak Exports (AE)',
    centrality: 0.35, severity: 'severe',
    facts: [['jurisdiction', 'AE · FATF grey'], ['inbound wire', '$77,000'], ['received', '26 Jul 09:26'], ['onward', 'cash-out $48,000']],
  },
  /* hop 2 — revealed on expand */
  {
    id: '2201', label: '2201', kind: 'wallet', x: 930, y: 92, hop: 2, role: 'wallet · VASP settlement',
    centrality: 0.12, severity: 'review',
    facts: [['chain', 'TRON · USDT'], ['inbound', '$61,000 equivalent'], ['vasp', 'unlicensed']],
  },
  {
    id: '3390', label: '3390', kind: 'company', x: 946, y: 262, hop: 2, role: 'company · Kestrel Metals (CY)',
    centrality: 0.19, severity: 'review',
    facts: [['jurisdiction', 'CY'], ['inbound', '$43,000'], ['directors', '1 shared with Calder']],
  },
  {
    id: 'CASH', label: 'CASH', kind: 'account', x: 926, y: 470, hop: 2, role: 'cash withdrawal · ATM cluster',
    centrality: 0.08, severity: 'severe',
    facts: [['withdrawals', '11 · $48,000'], ['window', '3 days'], ['locations', '4 ATMs, one district']],
  },
];

export const graphEdges: readonly GraphEdge[] = [
  { id: 'e1', from: '6120', to: '4521', kind: 'transfer', label: '4 deposits · $18,400', hop: 1 },
  { id: 'e2', from: '1180', to: '4521', kind: 'transfer', label: '3 deposits · $12,900', hop: 1 },
  { id: 'e3', from: '3308', to: '4521', kind: 'transfer', label: '6 deposits · $54,300', hop: 1 },
  { id: 'e4', from: '2255', to: '4521', kind: 'transfer', label: '5 deposits · $41,600', hop: 1 },
  { id: 'e5', from: '8871', to: '4521', kind: 'transfer', label: '2 deposits · $9,800', hop: 1 },
  { id: 'e6', from: '5540', to: '4521', kind: 'transfer', label: '3 deposits · $50,400', hop: 1 },
  { id: 'e7', from: 'DEV-7742', to: '6120', kind: 'shared-device', label: 'same device', hop: 1 },
  { id: 'e8', from: 'DEV-7742', to: '5540', kind: 'shared-device', label: 'same device', hop: 1 },
  { id: 'e9', from: 'MUM-014', to: '3308', kind: 'ownership', label: 'opened at branch', hop: 1 },
  { id: 'e10', from: 'MUM-014', to: '2255', kind: 'ownership', label: 'opened at branch', hop: 1 },
  { id: 'e11', from: '4521', to: '7710', kind: 'large-transfer', label: 'wire · $104,000', hop: 1 },
  { id: 'e12', from: '4521', to: '9004', kind: 'large-transfer', label: 'wire · $77,000', hop: 1 },
  { id: 'e13', from: '7710', to: '2201', kind: 'transfer', label: 'crypto out · $61,000', hop: 2 },
  { id: 'e14', from: '7710', to: '3390', kind: 'transfer', label: 'invoice · $43,000', hop: 2 },
  { id: 'e15', from: '9004', to: 'CASH', kind: 'large-transfer', label: 'ATM cluster · $48,000', hop: 2 },
];

export const entityKindLabel: Record<GraphNode['kind'], string> = {
  person: 'individual',
  company: 'company',
  account: 'bank account',
  offshore: 'offshore account',
  device: 'device',
  branch: 'branch',
  wallet: 'crypto wallet',
};

export const edgeKindLabel: Record<GraphEdge['kind'], string> = {
  transfer: 'transfer',
  'large-transfer': 'transfer over $50k',
  'shared-device': 'shared device',
  ownership: 'account opened at',
};
