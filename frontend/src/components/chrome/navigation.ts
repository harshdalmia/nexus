import {
  Activity,
  FileText,
  GitBranch,
  Layers,
  ScrollText,
  Search,
  SlidersHorizontal,
  Table2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkspaceId } from '@/types/aml';

export interface NavEntry {
  readonly id: WorkspaceId;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly group: 'operate' | 'analyse' | 'govern';
  readonly hotkey: string;
  readonly title: string;
  readonly question: string;
  readonly badge?: { readonly value: string; readonly severity: 'severe' | 'review' | 'model' };
}

export const navEntries: readonly NavEntry[] = [
  {
    id: 'watchtower',
    label: 'Watchtower',
    icon: Activity,
    group: 'operate',
    hotkey: 'w',
    title: 'Watchtower',
    question: 'What needs my attention right now?',
    badge: { value: '2', severity: 'severe' },
  },
  {
    id: 'ask',
    label: 'Ask',
    icon: Search,
    group: 'operate',
    hotkey: 'a',
    title: 'Ask',
    question: 'Natural language in, execution plan and evidence out.',
  },
  {
    id: 'cases',
    label: 'Cases',
    icon: Layers,
    group: 'operate',
    hotkey: 'c',
    title: 'Case workspace',
    question: 'Graph, evidence spine and timeline for one investigation.',
    badge: { value: '12', severity: 'review' },
  },
  {
    id: 'graph',
    label: 'Entity graph',
    icon: GitBranch,
    group: 'analyse',
    hotkey: 'g',
    title: 'Entity graph',
    question: 'Who is connected to whom, and by what.',
  },
  {
    id: 'ledger',
    label: 'Ledger',
    icon: Table2,
    group: 'analyse',
    hotkey: 'l',
    title: 'Transaction ledger',
    question: 'The exhaustive list behind every finding.',
  },
  {
    id: 'models',
    label: 'Models & rules',
    icon: SlidersHorizontal,
    group: 'analyse',
    hotkey: 'm',
    title: 'Models & rules',
    question: 'What the system looks for, and what it costs to look.',
    badge: { value: '21', severity: 'model' },
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: FileText,
    group: 'govern',
    hotkey: 'r',
    title: 'Report composer',
    question: 'Turn the evidence spine into a filed SAR.',
  },
  {
    id: 'audit',
    label: 'Audit trail',
    icon: ScrollText,
    group: 'govern',
    hotkey: 'u',
    title: 'Audit trail',
    question: 'Every query, tool run, disposition and export.',
  },
];

export const groupLabels: Record<NavEntry['group'], string> = {
  operate: 'operate',
  analyse: 'analyse',
  govern: 'govern',
};

export const navEntry = (id: WorkspaceId): NavEntry => {
  const found = navEntries.find((entry) => entry.id === id);

  if (found === undefined) {
    throw new Error(`Unknown workspace: ${id}`);
  }

  return found;
};
