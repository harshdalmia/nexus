/* ------------------------------------------------------------------
   Live run -> the frontend's existing domain types.

   The dossier, plan rail, execution stage and every block already know how
   to render a `Scenario` + `AgentDetail`. So integration happens here, once:
   a backend run is translated into those shapes and the UI renders it with
   no component redesign.

   Rule followed throughout: if the backend did not report a value, it is
   left undefined rather than filled with a plausible-looking number.
   Gaps stay visible as undefined instead of being papered over.
   ------------------------------------------------------------------ */

import type {
  ChartDatasetDto,
  ChartDatumDto,
  FindingDto,
  InvestigationDto,
  PlanningDecisionDto,
  ToolStepDto,
} from '@/lib/api/types';
import type {
  AgentDetail,
  ChartKind,
  ChartSpec,
  Datum,
  DossierSection,
  Explanation,
  ExecutionStage,
  FeatureSpec,
  FindingRow,
  PlanningDecision,
  RiskLevel,
  Scenario,
  SectionKind,
  Severity,
  SummaryStat,
  TraceStep,
} from '@/types/aml';

const SECTION_KINDS: readonly SectionKind[] = [
  'summary', 'execution-summary', 'planning', 'features', 'detection',
  'risk-classification', 'chart', 'graph', 'timeline', 'evidence',
  'explanation', 'recommendation', 'sar', 'downloads',
];

const CHART_KINDS: readonly ChartKind[] = [
  'bars', 'hbars', 'line', 'area', 'stacked', 'pie', 'donut', 'gauge',
  'heatmap', 'sankey', 'waterfall', 'scatter', 'treemap', 'corridor',
];

const levelOf = (tier: string | null): RiskLevel => {
  switch (tier) {
    case 'high':
      return 'HIGH';
    case 'medium':
      return 'MEDIUM';
    default:
      return 'LOW';
  }
};

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

const datum = (item: ChartDatumDto): Datum => ({
  label: item.label,
  value: item.value,
  ...(item.severity === null ? {} : { severity: item.severity }),
  ...(item.note === null ? {} : { note: item.note }),
});

/* ------------------------------- trace steps ------------------------------- */

const toTraceStep = (step: ToolStepDto): TraceStep => {
  const artifacts = [
    ...(step.rows_in === null ? [] : [{ label: 'rows in', value: step.rows_in.toLocaleString() }]),
    ...(step.rows_out === null ? [] : [{ label: 'rows out', value: step.rows_out.toLocaleString(), emphasis: true }]),
    ...(step.invocations > 1 ? [{ label: 'invocations', value: String(step.invocations) }] : []),
    ...Object.entries(step.filters_applied).map(([key, value]) => ({
      label: `filter · ${key}`,
      value,
    })),
  ];

  return {
    tool: step.tool,
    label: step.label,
    stage: step.stage as ExecutionStage,
    status: step.status,
    reason: step.reason,
    durationMs: step.duration_ms,
    ...(step.rows_in === null ? {} : { rowsIn: step.rows_in }),
    ...(step.rows_out === null ? {} : { rowsOut: step.rows_out }),
    ...(step.purpose === '' ? {} : { detail: step.purpose }),
    ...(artifacts.length === 0 ? {} : { outputs: artifacts }),
  };
};

/* --------------------------------- charts --------------------------------- */

const toChartSpec = (dataset: ChartDatasetDto): ChartSpec | undefined => {
  /* Table payloads are rendered by the evidence/finding blocks, not the chart
     renderer, and an unavailable dataset has nothing to draw. */
  if (!dataset.available || dataset.kind === 'table') {
    return undefined;
  }

  const kind = CHART_KINDS.includes(dataset.kind as ChartKind)
    ? (dataset.kind as ChartKind)
    : 'bars';

  return {
    kind,
    title: dataset.title,
    ...(dataset.subtitle === null ? {} : { subtitle: dataset.subtitle }),
    ...(dataset.footnote === null ? {} : { footnote: dataset.footnote }),
    ...(dataset.unit === null ? {} : { unit: dataset.unit }),
    data: dataset.data.map(datum),
  };
};

/* -------------------------------- sections -------------------------------- */

const toSections = (dto: InvestigationDto): readonly DossierSection[] => {
  const chartById = new Map(dto.charts.map((dataset) => [dataset.id, dataset]));

  return dto.sections
    .filter((section) => section.available && SECTION_KINDS.includes(section.kind as SectionKind))
    .flatMap((section) => {
      const chartId = section.id.startsWith('v-chart-') ? section.id.slice('v-chart-'.length) : null;
      const dataset = chartId === null ? undefined : chartById.get(chartId);
      const chart = dataset === undefined ? undefined : toChartSpec(dataset);

      /* A chart section with no drawable dataset is dropped rather than turned
         into a second table: tabular payloads (findings, evidence, amount
         summary) are already rendered by the flagged-accounts section, the
         explanation's claim list and the execution summary. They stay
         retrievable from the charts endpoint. */
      if (section.kind === 'chart' && chart === undefined) {
        return [];
      }

      return [
        {
          id: section.id,
          kind: section.kind as SectionKind,
          title: section.title,
          span: section.span,
          unlockAfter: section.unlock_after,
          ...(chart === undefined ? {} : { chart }),
          ...(section.reason === null ? {} : { note: section.reason }),
        },
      ];
    })
    .filter((section, index, all) => all.findIndex((item) => item.id === section.id) === index);
};

/* -------------------------------- findings -------------------------------- */

const toFindingRow = (finding: FindingDto): FindingRow => ({
  id: `f-${finding.node}`,
  entity: finding.node,
  name: finding.hypothesis_label || finding.winning_hypothesis || finding.winning_kind,
  primary: finding.confidence,
  secondary: `${String(finding.evidence_count)} claims`,
  pattern: finding.families.join(', ') || finding.winning_kind,
  score: Math.round(finding.risk),
  level: levelOf(finding.tier),
});

/* ------------------------------- agent detail ------------------------------- */

const toPlanningDecision = (decision: PlanningDecisionDto): PlanningDecision => ({
  stage: decision.stage,
  label: decision.label,
  value: decision.value,
  detail: decision.detail,
  ...(decision.confidence === null ? {} : { confidence: decision.confidence }),
});

const toFeatures = (dto: InvestigationDto): readonly FeatureSpec[] => {
  const catalog = dto.features;

  if (!catalog.available) {
    return [];
  }

  return catalog.features.map((feature) => ({
    name: feature.name,
    display: feature.name,
    pattern: feature.used_for_clustering ? 'peer clustering' : 'evidence tools',
    /* The manifest declares which features exist, not their per-account values. */
    value: feature.value === null ? 'computed' : String(feature.value),
    description: feature.definition,
    included: feature.computed,
  }));
};

const toDetail = (dto: InvestigationDto): AgentDetail => {
  const { execution, detection, risk } = dto;

  return {
    amlPattern: execution.aml_pattern_recognized
      ? execution.aml_pattern
      : `${execution.aml_pattern} (unrecognised — default route substituted)`,
    entities: execution.entities.length > 0
      ? execution.entities
      : [execution.entities_note || 'none — population query'],
    filters: Object.entries(execution.filters).map(([key, value]) => `${key} = ${value}`),
    investigationSummary: execution.investigation_summary,
    planning: dto.planning.map(toPlanningDecision),
    features: toFeatures(dto),
    detection: detection.available
      ? {
          models: detection.models.map((model) => ({
            name: model.name,
            kind: model.kind === 'hypothesis' ? 'rules' : model.kind,
            role: model.role,
          })),
          anomalyType: detection.anomaly_type,
          ...(detection.anomaly_score === null ? {} : { score: detection.anomaly_score }),
          ...(detection.threshold === null ? {} : { threshold: detection.threshold }),
          confidence: detection.confidence ?? 'not reported',
          durationMs: detection.duration_ms,
          evaluated: detection.evaluated,
          flagged: detection.flagged,
          topFeatures: detection.top_features.map((item) => ({
            feature: item.feature,
            contribution: item.contribution,
          })),
        }
      : null,
    risk: risk.available
      ? {
          score: Math.round(risk.score),
          level: levelOf(risk.tier),
          severity: severityOfTier(risk.tier),
          confidence: risk.confidence ?? 'not reported',
          band: risk.band ?? '',
          reason: risk.reason_text,
          evidence: risk.evidence,
          components: risk.components.map((component) => ({
            label: component.label,
            weight: component.weight,
            value: Math.round(component.value),
          })),
        }
      : null,
  };
};

/* -------------------------------- explanation -------------------------------- */

const toExplanation = (dto: InvestigationDto): Explanation | null => {
  const { explanation, risk, recommendation } = dto;

  if (!explanation.available || recommendation.action === null) {
    return null;
  }

  return {
    subject: explanation.subject ?? dto.query,
    level: levelOf(explanation.tier),
    score: Math.round(explanation.risk),
    confidence: explanation.confidence ?? 'not reported',
    modelVersion:
      explanation.model_version ??
      `${explanation.source === 'llm' ? 'LLM' : 'template'} narrator · validated=${String(
        explanation.validated,
      )}`,
    narrative: explanation.narrative,
    evidence: explanation.evidence,
    breakdown: (explanation.components.length > 0 ? explanation.components : risk.components).map(
      (component) => ({
        label: component.label,
        weight: component.weight,
        value: Math.round(component.value),
      }),
    ),
    recommendation: {
      action: recommendation.action,
      headline: recommendation.headline,
      detail: recommendation.detail,
      /* The engine publishes no SLA clock — say so rather than inventing one. */
      sla: recommendation.sla ?? 'no regulatory clock is published by the engine',
    },
  };
};

/* ---------------------------------- scenario ---------------------------------- */

const toSummary = (dto: InvestigationDto): readonly SummaryStat[] =>
  dto.summary_stats.map((stat) => ({
    label: stat.label,
    value: stat.value,
    ...(stat.severity === undefined ? {} : { severity: stat.severity }),
  }));

const toIntent = (dto: InvestigationDto): ReadonlyArray<readonly [string, string]> => {
  const { execution } = dto;
  const pairs: Array<readonly [string, string]> = [
    ['action', execution.intent.join(' + ') || 'detect'],
    ['target_pattern', execution.aml_pattern],
    ['intent_source', execution.intent_source],
  ];

  if (execution.entities.length > 0) {
    pairs.push(['entities', execution.entities.join(', ')]);
  }

  for (const [key, value] of Object.entries(execution.filters)) {
    pairs.push([key, value]);
  }

  if (execution.scoped_transactions !== null) {
    pairs.push(['scoped_txns', execution.scoped_transactions.toLocaleString()]);
  }

  return pairs;
};

/**
 * Translate a completed backend run into the Scenario the UI already renders.
 * The returned scenario carries `live: true` and its own `detail`, so nothing
 * falls back to the bundled demo data.
 */
export const scenarioFromRun = (dto: InvestigationDto): Scenario => {
  const planningNote =
    dto.planning.find((decision) => decision.stage === 'tool_selection')?.detail ??
    dto.execution.notes[0] ??
    'The planner selected the tools below for this query.';

  const findings = dto.findings.map(toFindingRow);
  const metricSeverity = severityOfTier(dto.risk.tier);

  return {
    id: dto.run_id,
    live: true,
    query: dto.query,
    action: dto.execution.intent.join('+') || 'detect',
    caseId: dto.case_id,
    intent: toIntent(dto),
    plannerNote: planningNote,
    steps: dto.steps.map(toTraceStep),
    resultHeadline: dto.headline,
    headlineMetric: {
      label: dto.findings.length === 1 ? 'risk score' : 'accounts flagged',
      value:
        dto.findings.length === 1
          ? String(Math.round(dto.risk.score))
          : String(dto.findings.length),
      severity: metricSeverity,
    },
    columns: ['Account', 'Confidence', 'Evidence', 'Families', 'Risk'],
    rows: findings,
    summary: toSummary(dto),
    sections: toSections(dto),
    explanation: toExplanation(dto),
    ...(dto.no_findings_reason === null
      ? {}
      : { noExplanationReason: dto.no_findings_reason }),
    detail: toDetail(dto),
  };
};
