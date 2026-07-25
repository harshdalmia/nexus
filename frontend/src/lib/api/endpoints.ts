/* Typed endpoint functions. One per route, no logic beyond the path. */

import { apiBaseUrl, apiGet, apiPost } from '@/lib/api/client';
import type { ApiResponse } from '@/lib/api/client';
import type {
  ArtifactDto,
  AttributionDto,
  AuditDto,
  CandidateScatterDto,
  CatalogueSummaryDto,
  ChartDatasetDto,
  CorridorHeatDto,
  DetectionDto,
  DistributionsDto,
  EntityProfileDto,
  EntityTimelineDto,
  FeatureImportanceDto,
  FunnelDto,
  HypothesisRuleDto,
  ModelPerformanceDto,
  MoneyFlowDto,
  RiskProfileDto,
  SegmentsDto,
  TypologyOutcomeDto,
  VolumeSeriesDto,
  EvidenceRecordDto,
  ExecutionSummaryDto,
  ExplanationDto,
  FeatureCatalogDto,
  FindingDto,
  GraphDto,
  HealthDto,
  InvestigationDto,
  PlanningDecisionDto,
  RecommendationDto,
  ReportDto,
  RiskDto,
  RosterToolDto,
  RunSummaryDto,
  SectionDto,
  ToolStepDto,
  TransactionDto,
  TransactionFacetsDto,
} from '@/lib/api/types';

/* ------------------------------- system ------------------------------- */

export const getHealth = (signal?: AbortSignal): Promise<ApiResponse<HealthDto>> =>
  /* Health must answer fast even while 5M rows load, so it gets a short leash. */
  apiGet<HealthDto>('/health', { signal, timeoutMs: 8_000 });

export const getRoster = (signal?: AbortSignal): Promise<ApiResponse<readonly RosterToolDto[]>> =>
  apiGet<readonly RosterToolDto[]>('/roster', { signal });

/* ---------------------------- investigations ---------------------------- */

export interface InvestigateOptions {
  readonly maxInvestigations?: number;
  readonly maxCandidates?: number;
  readonly signal?: AbortSignal;
}

export const investigate = (
  query: string,
  options: InvestigateOptions = {},
): Promise<ApiResponse<InvestigationDto>> =>
  apiPost<InvestigationDto>(
    '/investigations',
    {
      query,
      ...(options.maxInvestigations === undefined
        ? {}
        : { max_investigations: options.maxInvestigations }),
      ...(options.maxCandidates === undefined ? {} : { max_candidates: options.maxCandidates }),
    },
    { signal: options.signal },
  );

export const getInvestigation = (
  runId: string,
  signal?: AbortSignal,
): Promise<ApiResponse<InvestigationDto>> =>
  apiGet<InvestigationDto>(`/investigations/${encodeURIComponent(runId)}`, { signal });

export const listInvestigations = (
  params: { page?: number; pageSize?: number; sort?: string } = {},
): Promise<ApiResponse<readonly RunSummaryDto[]>> =>
  apiGet<readonly RunSummaryDto[]>('/investigations', {
    params: { page: params.page, page_size: params.pageSize, sort: params.sort },
  });

const facet = <T>(runId: string, path: string, signal?: AbortSignal) =>
  apiGet<T>(`/investigations/${encodeURIComponent(runId)}/${path}`, { signal });

export const getExecution = (runId: string) => facet<ExecutionSummaryDto>(runId, 'execution');
export const getPlan = (runId: string) => facet<readonly ToolStepDto[]>(runId, 'plan');
export const getPlanning = (runId: string) => facet<readonly PlanningDecisionDto[]>(runId, 'planning');
export const getSections = (runId: string) => facet<readonly SectionDto[]>(runId, 'sections');
export const getFeatures = (runId: string) => facet<FeatureCatalogDto>(runId, 'features');
export const getDetection = (runId: string) => facet<DetectionDto>(runId, 'detection');
export const getRisk = (runId: string) => facet<RiskDto>(runId, 'risk');
export const getExplanation = (runId: string) => facet<ExplanationDto>(runId, 'explanation');
export const getRecommendation = (runId: string) => facet<RecommendationDto>(runId, 'recommendation');
export const getRunGraph = (runId: string) => facet<GraphDto>(runId, 'graph');

export const getFindings = (
  runId: string,
  params: { page?: number; pageSize?: number; sort?: string; tier?: string; escalation?: string } = {},
): Promise<ApiResponse<readonly FindingDto[]>> =>
  apiGet<readonly FindingDto[]>(`/investigations/${encodeURIComponent(runId)}/findings`, {
    params: {
      page: params.page,
      page_size: params.pageSize,
      sort: params.sort,
      tier: params.tier,
      escalation: params.escalation,
    },
  });

export const getEvidence = (
  runId: string,
  params: { node?: string; family?: string; weightedOnly?: boolean; pageSize?: number } = {},
): Promise<ApiResponse<readonly EvidenceRecordDto[]>> =>
  apiGet<readonly EvidenceRecordDto[]>(`/investigations/${encodeURIComponent(runId)}/evidence`, {
    params: {
      node: params.node,
      family: params.family,
      weighted_only: params.weightedOnly,
      page_size: params.pageSize,
    },
  });

export const getEvidenceTransactions = (
  runId: string,
  claimId: string,
  node?: string,
): Promise<ApiResponse<readonly TransactionDto[]>> =>
  apiGet<readonly TransactionDto[]>(
    `/investigations/${encodeURIComponent(runId)}/evidence/${encodeURIComponent(claimId)}/transactions`,
    { params: { node } },
  );

export const getCharts = (
  runId: string,
  availableOnly = false,
): Promise<ApiResponse<readonly ChartDatasetDto[]>> =>
  apiGet<readonly ChartDatasetDto[]>(`/investigations/${encodeURIComponent(runId)}/charts`, {
    params: { available_only: availableOnly },
  });

/* -------------------------------- entities -------------------------------- */

export const getEntity = (node: string): Promise<ApiResponse<EntityProfileDto>> =>
  apiGet<EntityProfileDto>(`/entities/${encodeURIComponent(node)}`);

export const getEntityGraph = (node: string, depth?: number): Promise<ApiResponse<GraphDto>> =>
  apiGet<GraphDto>(`/entities/${encodeURIComponent(node)}/graph`, { params: { depth } });

/* ------------------------------ transactions ------------------------------ */

export interface TransactionQuery {
  readonly page?: number;
  readonly pageSize?: number;
  readonly sort?: string;
  readonly node?: string;
  readonly sender?: string;
  readonly receiver?: string;
  readonly bank?: string;
  readonly paymentFormat?: string;
  readonly currency?: string;
  readonly minAmount?: number;
  readonly maxAmount?: number;
  readonly start?: string;
  readonly end?: string;
  readonly launderingOnly?: boolean;
  readonly crossCurrencyOnly?: boolean;
  readonly signal?: AbortSignal;
}

export const getTransactions = (
  query: TransactionQuery = {},
): Promise<ApiResponse<readonly TransactionDto[]>> =>
  apiGet<readonly TransactionDto[]>('/transactions', {
    signal: query.signal,
    params: {
      page: query.page,
      page_size: query.pageSize,
      sort: query.sort,
      node: query.node,
      sender: query.sender,
      receiver: query.receiver,
      bank: query.bank,
      payment_format: query.paymentFormat,
      currency: query.currency,
      min_amount: query.minAmount,
      max_amount: query.maxAmount,
      start: query.start,
      end: query.end,
      laundering_only: query.launderingOnly,
      cross_currency_only: query.crossCurrencyOnly,
    },
  });

export const getTransactionFacets = (): Promise<ApiResponse<TransactionFacetsDto>> =>
  apiGet<TransactionFacetsDto>('/transactions/facets');

/* --------------------------------- audit --------------------------------- */

export const getAuditTrail = (
  params: { page?: number; pageSize?: number } = {},
): Promise<ApiResponse<readonly RunSummaryDto[]>> =>
  apiGet<readonly RunSummaryDto[]>('/audit', {
    params: { page: params.page, page_size: params.pageSize },
  });

export const getAuditReceipt = (runId: string): Promise<ApiResponse<AuditDto>> =>
  apiGet<AuditDto>(`/audit/${encodeURIComponent(runId)}`);

/* --------------------------- models & rules catalogue --------------------------- */

export const getCatalogue = (signal?: AbortSignal): Promise<ApiResponse<CatalogueSummaryDto>> =>
  apiGet<CatalogueSummaryDto>('/models', { signal });

export const getRules = (): Promise<ApiResponse<readonly HypothesisRuleDto[]>> =>
  apiGet<readonly HypothesisRuleDto[]>('/models/rules');

export const getRiskWeights = (): Promise<ApiResponse<readonly RiskProfileDto[]>> =>
  apiGet<readonly RiskProfileDto[]>('/models/risk-weights');

export const getModelPerformance = (): Promise<ApiResponse<ModelPerformanceDto>> =>
  apiGet<ModelPerformanceDto>('/models/performance');

export const getFeatureImportance = (): Promise<ApiResponse<FeatureImportanceDto>> =>
  apiGet<FeatureImportanceDto>('/models/feature-importance');

export const getFunnel = (): Promise<ApiResponse<FunnelDto>> => apiGet<FunnelDto>('/models/funnel');

export const getOutcomes = (): Promise<ApiResponse<readonly TypologyOutcomeDto[]>> =>
  apiGet<readonly TypologyOutcomeDto[]>('/models/outcomes');

/* ------------------------------ dataset analytics ------------------------------ */

export const getVolumeSeries = (
  params: { bucket?: 'day' | 'week' | 'month'; node?: string; limit?: number; signal?: AbortSignal } = {},
): Promise<ApiResponse<VolumeSeriesDto>> =>
  apiGet<VolumeSeriesDto>('/analytics/volume', {
    signal: params.signal,
    params: { bucket: params.bucket, node: params.node, limit: params.limit },
  });

export const getDistributions = (signal?: AbortSignal): Promise<ApiResponse<DistributionsDto>> =>
  apiGet<DistributionsDto>('/analytics/distributions', { signal });

export const getCorridorHeat = (
  params: { bucket?: 'day' | 'week' | 'month'; rows?: number; signal?: AbortSignal } = {},
): Promise<ApiResponse<CorridorHeatDto>> =>
  apiGet<CorridorHeatDto>('/analytics/corridor-heat', {
    signal: params.signal,
    params: { bucket: params.bucket, rows: params.rows },
  });

export const getSegments = (signal?: AbortSignal): Promise<ApiResponse<SegmentsDto>> =>
  apiGet<SegmentsDto>('/analytics/segments', { signal });

export const getCandidates = (
  params: { limit?: number; signal?: AbortSignal } = {},
): Promise<ApiResponse<CandidateScatterDto>> =>
  apiGet<CandidateScatterDto>('/analytics/candidates', {
    signal: params.signal,
    params: { limit: params.limit },
  });

export const getMoneyFlow = (
  node: string,
  params: { depth?: number; signal?: AbortSignal } = {},
): Promise<ApiResponse<MoneyFlowDto>> =>
  apiGet<MoneyFlowDto>(`/analytics/entities/${encodeURIComponent(node)}/money-flow`, {
    signal: params.signal,
    params: { depth: params.depth },
  });

export const getEntityTimeline = (
  node: string,
  params: { limit?: number; signal?: AbortSignal } = {},
): Promise<ApiResponse<EntityTimelineDto>> =>
  apiGet<EntityTimelineDto>(`/analytics/entities/${encodeURIComponent(node)}/timeline`, {
    signal: params.signal,
    params: { limit: params.limit },
  });

/* --------------------------- reports and artefacts --------------------------- */

export const getReport = (runId: string, signal?: AbortSignal): Promise<ApiResponse<ReportDto>> =>
  apiGet<ReportDto>(`/investigations/${encodeURIComponent(runId)}/report`, { signal });

/** Build the draft and its artefacts. Idempotent: the report is deterministic for a run,
 *  so this returns the same document as `getReport`. It exists because building the
 *  downloadable files is the action the composer's button performs. */
export const buildReport = (
  runId: string,
  signal?: AbortSignal,
): Promise<ApiResponse<ReportDto>> =>
  apiPost<ReportDto>(`/investigations/${encodeURIComponent(runId)}/report`, {}, { signal });

export const getArtifacts = (
  runId: string,
  signal?: AbortSignal,
): Promise<ApiResponse<readonly ArtifactDto[]>> =>
  apiGet<readonly ArtifactDto[]>(`/investigations/${encodeURIComponent(runId)}/artifacts`, {
    signal,
  });

/** Absolute href for an artefact. `ArtifactDto.url` is API-root relative and already
 *  carries the version prefix, so the base URL is prepended without `apiPrefix`. */
export const artifactHref = (artifact: ArtifactDto): string => `${apiBaseUrl}${artifact.url}`;

/* --------------------------- evidence attribution --------------------------- */

export const getAttribution = (
  runId: string,
  params: { limit?: number; signal?: AbortSignal } = {},
): Promise<ApiResponse<AttributionDto>> =>
  apiGet<AttributionDto>(`/transactions/attribution/${encodeURIComponent(runId)}`, {
    signal: params.signal,
    params: { limit: params.limit },
  });
