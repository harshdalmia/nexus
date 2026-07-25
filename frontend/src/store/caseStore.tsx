import { createContext, useCallback, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useSessionState } from '@/hooks/useSessionState';
import type { InvestigationDto } from '@/lib/api/types';
import { cases as demoCases } from '@/data/queue';
import type { RiskLevel, ScoreComponent, Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Cases for this browser session.

   The engine has no case store: a run is cached in the API process and
   evicted, and nothing is persisted server-side. So a case here is a
   record *of a run the analyst actually executed*, held in
   sessionStorage — it survives navigation and refresh and disappears
   when the session ends.

   Every field is copied from the run: id, entity, risk, tier,
   escalation, pattern, opened-at, and exposure summed from the evidence
   the pipeline cited. Fields that need a real case-management backend —
   assignee, SLA clocks, stage transitions across sittings — are not
   invented.
   ------------------------------------------------------------------ */

const STORAGE_KEY = 'cases.session';
const MAX_CASES = 60;

export type CaseStage = 'triage' | 'investigating' | 'sar-draft' | 'filed';

export interface SessionCase {
  readonly id: string;
  readonly runId: string;
  readonly entity: string;
  readonly name: string;
  readonly score: number;
  readonly level: RiskLevel;
  readonly severity: Severity;
  readonly stage: CaseStage;
  readonly pattern: string;
  readonly escalation: string;
  readonly openedAt: string;
  readonly query: string;
  /** base-currency value of the transactions the evidence cites */
  readonly exposure: number;
  readonly evidenceCount: number;
  readonly transactionCount: number;
  readonly confidence: string;
  readonly components: readonly ScoreComponent[];
  readonly evidence: readonly string[];
  readonly narrative: string;
  readonly validated: boolean;
  readonly source: 'engine';
}

interface CaseContextValue {
  /** newest first */
  readonly cases: readonly SessionCase[];
  readonly upsertFromRun: (run: InvestigationDto) => void;
  readonly setStage: (id: string, stage: CaseStage) => void;
  readonly clear: () => void;
}

const CaseContext = createContext<CaseContextValue | null>(null);

const severityOfTier = (tier: string | null): Severity => {
  switch (tier) {
    case 'high':
      return 'severe';
    case 'medium':
      return 'review';
    default:
      return 'clear';
  }
};

const levelOfTier = (tier: string | null): RiskLevel => {
  switch (tier) {
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
};

/* The escalation the agent recommended is the case's opening stage: a report
   recommendation opens at SAR draft, a review at investigating, anything else
   sits in triage. Nothing here overrides an analyst's later choice. */
const stageOfEscalation = (escalation: string | null): CaseStage => {
  switch (escalation) {
    case 'report':
      return 'sar-draft';
    case 'review':
      return 'investigating';
    default:
      return 'triage';
  }
};

const isSessionCase = (value: unknown): value is SessionCase => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<SessionCase>;

  return (
    typeof candidate.id === 'string' &&
    typeof candidate.runId === 'string' &&
    typeof candidate.entity === 'string' &&
    typeof candidate.score === 'number'
  );
};

const migrate = (stored: unknown): readonly SessionCase[] | null =>
  Array.isArray(stored) && stored.every(isSessionCase) ? (stored as SessionCase[]) : null;

/** Exposure is the value the cited transactions actually carry, when the run says so. */
const exposureOf = (run: InvestigationDto): number => {
  const amounts = run.evidence
    .map((record) => record.value)
    .filter((value) => Number.isFinite(value) && value > 1_000);

  if (amounts.length > 0) {
    return Math.max(...amounts);
  }

  return 0;
};

export const caseFromRun = (run: InvestigationDto): SessionCase | null => {
  const finding = run.findings[0];

  /* No finding means no subject, and a case without a subject is not a case. */
  if (finding === undefined) {
    return null;
  }

  return {
    id: run.case_id,
    runId: run.run_id,
    entity: finding.node,
    name: finding.hypothesis_label || finding.winning_hypothesis || finding.node,
    score: Math.round(finding.risk),
    level: levelOfTier(finding.tier),
    severity: severityOfTier(finding.tier),
    stage: stageOfEscalation(finding.escalation),
    pattern: finding.families.join(', ') || run.execution.aml_pattern,
    escalation: finding.escalation,
    openedAt: run.created_at,
    query: run.query,
    exposure: exposureOf(run),
    evidenceCount: finding.evidence_count,
    transactionCount: run.execution.scoped_transactions ?? run.detection.evaluated,
    confidence: finding.confidence,
    components: run.risk.components.map((component) => ({
      label: component.label,
      weight: component.weight,
      value: Math.round(component.value),
    })),
    evidence: run.risk.evidence,
    narrative: run.explanation.narrative,
    validated: run.explanation.validated,
    source: 'engine',
  };
};

export const CaseProvider = ({ children }: { readonly children: ReactNode }) => {
  const [cases, setCases] = useSessionState<readonly SessionCase[]>(STORAGE_KEY, [], migrate);

  const upsertFromRun = useCallback(
    (run: InvestigationDto) => {
      const record = caseFromRun(run);

      if (record === null) {
        return;
      }

      setCases((current) => {
        /* One case per subject: a second investigation of the same account updates it
           rather than filling the index with duplicates. */
        const others = current.filter((item) => item.entity !== record.entity);

        return [record, ...others].slice(0, MAX_CASES);
      });
    },
    [setCases],
  );

  const setStage = useCallback(
    (id: string, stage: CaseStage) => {
      setCases((current) =>
        current.map((item) => (item.id === id ? { ...item, stage } : item)),
      );
    },
    [setCases],
  );

  const clear = useCallback(() => setCases([]), [setCases]);

  const value = useMemo<CaseContextValue>(
    () => ({ cases, upsertFromRun, setStage, clear }),
    [cases, upsertFromRun, setStage, clear],
  );

  return <CaseContext.Provider value={value}>{children}</CaseContext.Provider>;
};

export const useCases = (): CaseContextValue => {
  const value = useContext(CaseContext);

  if (value === null) {
    throw new Error('useCases must be used inside CaseProvider');
  }

  return value;
};

/* ---------------------------- one view type for both ---------------------------- */

/** What the case views render, from either a session case or a bundled demo record. */
export interface CaseView {
  readonly id: string;
  readonly entity: string;
  readonly name: string;
  readonly score: number;
  readonly severity: Severity;
  readonly stage: CaseStage;
  readonly pattern: string;
  readonly opened: string;
  readonly exposure: string;
  readonly live: boolean;
  readonly session: SessionCase | null;
}

const clock = (iso: string): string => {
  const at = new Date(iso);

  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
};

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

export const viewOfSession = (record: SessionCase): CaseView => ({
  id: record.id,
  entity: record.entity,
  name: record.name,
  score: record.score,
  severity: record.severity,
  stage: record.stage,
  pattern: record.pattern,
  opened: clock(record.openedAt),
  exposure: record.exposure > 0 ? money.format(record.exposure) : '—',
  live: true,
  session: record,
});

/**
 * The case list the views render: this session's real cases first, and the bundled
 * demo cases only while the session has none, so the workspace is never empty.
 */
export const caseViews = (sessionCases: readonly SessionCase[]): readonly CaseView[] => {
  if (sessionCases.length > 0) {
    return sessionCases.map(viewOfSession);
  }

  return demoCases.map((record) => ({
    id: record.id,
    entity: record.entity,
    name: record.name,
    score: record.score,
    severity: record.severity,
    stage: record.stage,
    pattern: record.pattern,
    opened: record.opened,
    exposure: record.exposure,
    live: false,
    session: null,
  }));
};
