"""Investigations: run the pipeline, then read any facet of that run.

A run is executed once by POST and cached. Every GET below reads the same immutable
snapshot, so the execution summary, the plan, the risk score and the charts a client
renders all describe the identical investigation.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query, Response, status

from ..core.envelope import Envelope, ok, page_meta
from ..core.pagination import PageRequest, page_params, slice_page, sort_in_memory
from ..deps import get_runs, get_stored_run, require_engine
from ..schemas.reports import ArtifactView, ReportView
from ..schemas.requests import InvestigationRequest
from ..schemas.views import (
    DetectionView,
    ExecutionSummaryView,
    ExplanationView,
    FeatureCatalogView,
    FindingView,
    GraphView,
    InvestigationView,
    PlanningDecisionView,
    RecommendationView,
    RiskView,
    RunSummaryView,
    SectionView,
    ToolStepView,
)
from ..services import entities as entity_service
from ..services import investigations as service
from ..services import reporting
from ..services import serializers
from ..services.runs import RunStore, StoredRun
from ..state import EngineState

router = APIRouter(prefix="/investigations", tags=["investigations"])

FINDING_SORT_FIELDS = ("rank", "risk", "node", "tier", "escalation")


@router.post(
    "",
    response_model=Envelope[InvestigationView],
    status_code=status.HTTP_201_CREATED,
    summary="Run an investigation from a natural-language query",
    description=(
        "Executes the agent pipeline once and returns the complete run document: execution "
        "summary, planning derivations, per-tool trace, engineered features, detection, "
        "risk, explanation, recommendation, findings, evidence and chart datasets.\n\n"
        "201 because a new, addressable run resource is created. Its `run_id` (or the alias "
        "`latest`) reads any facet without re-running the pipeline."
    ),
    responses={
        400: {"description": "Blank or unresolvable query"},
        404: {"description": "A named account does not exist in the loaded dataset"},
        503: {"description": "Dataset still loading, or the engine failed to load"},
    },
)
def create_investigation(
    payload: InvestigationRequest,
    engine: EngineState = Depends(require_engine),
    runs: RunStore = Depends(get_runs),
) -> dict:
    run = service.execute(engine, runs, payload)
    return ok(
        serializers.investigation(run),
        variant=run.variant,
        run_id=run.run_id,
        duration_ms=run.duration_ms,
        notes=list(run.result.execution.notes),
    )


@router.get(
    "",
    response_model=Envelope[list[RunSummaryView]],
    summary="List cached runs, newest first",
)
def list_investigations(
    page: PageRequest = Depends(page_params),
    runs: RunStore = Depends(get_runs),
) -> dict:
    summaries = [serializers.run_summary(run) for run in runs.list()]
    ordered = sort_in_memory(
        summaries, page, ("created_at", "risk", "findings_count", "duration_ms")
    )
    window = slice_page(ordered, page)
    return ok(
        window,
        source="cache",
        page=page_meta(
            page=page.page, page_size=page.page_size,
            total=len(summaries), sort=page.sort,
        ),
    )


@router.get(
    "/{run_id}",
    response_model=Envelope[InvestigationView],
    summary="The complete run document",
)
def get_investigation(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(
        serializers.investigation(run),
        source="cache", variant=run.variant, run_id=run.run_id,
        duration_ms=run.duration_ms,
    )


@router.get(
    "/{run_id}/execution",
    response_model=Envelope[ExecutionSummaryView],
    tags=["execution"],
    summary="Execution summary: query, intent, filters, entities, pattern, tools, timing",
)
def get_execution(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.execution_summary(run), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/plan",
    response_model=Envelope[list[ToolStepView]],
    tags=["execution"],
    summary="Per-tool execution plan exactly as the pipeline recorded it",
    description=(
        "One entry per roster tool: order, status, duration, row counts, filters and the "
        "reason it ran or was declined. The frontend animates this locally; the server "
        "reports facts, not progress."
    ),
)
def get_plan(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.steps(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/planning",
    response_model=Envelope[list[PlanningDecisionView]],
    tags=["execution"],
    summary="The six planning derivations behind the tool selection",
)
def get_planning(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.planning(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/sections",
    response_model=Envelope[list[SectionView]],
    tags=["execution"],
    summary="Which dossier sections this run can fill, and the tool each waits on",
)
def get_sections(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.sections(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/features",
    response_model=Envelope[FeatureCatalogView],
    tags=["features"],
    summary="Engineered AML features, or why the builder was declined",
)
def get_features(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.features(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/detection",
    response_model=Envelope[DetectionView],
    tags=["detection"],
    summary="Models used, anomaly type, scores and competing hypotheses",
)
def get_detection(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.detection(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/risk",
    response_model=Envelope[RiskView],
    tags=["risk"],
    summary="Risk score, tier, weighted components and counterfactuals",
)
def get_risk(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.risk(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/explanation",
    response_model=Envelope[ExplanationView],
    tags=["explanation"],
    summary="Analyst narrative, its source, and the claims that back it",
)
def get_explanation(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.explanation(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/recommendation",
    response_model=Envelope[RecommendationView],
    tags=["recommendation"],
    summary="Escalation decision with the full monitor/review/report ladder",
)
def get_recommendation(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.recommendation(run.result), source="cache", run_id=run.run_id)


@router.get(
    "/{run_id}/findings",
    response_model=Envelope[list[FindingView]],
    tags=["findings"],
    summary="Flagged accounts, paginated and sortable",
)
def get_findings(
    page: PageRequest = Depends(page_params),
    tier: str | None = Query(None, description="filter by risk tier: low | medium | high"),
    escalation: str | None = Query(
        None, description="filter by escalation: monitor | review | report"
    ),
    run: StoredRun = Depends(get_stored_run),
) -> dict:
    rows = serializers.findings(run.result)

    if tier:
        rows = [row for row in rows if row.tier == tier.lower()]
    if escalation:
        rows = [row for row in rows if row.escalation == escalation.lower()]

    ordered = sort_in_memory(rows, page, FINDING_SORT_FIELDS)
    window = slice_page(ordered, page)
    return ok(
        window,
        source="cache", run_id=run.run_id,
        page=page_meta(
            page=page.page, page_size=page.page_size, total=len(rows),
            sort=page.sort, filters={"tier": tier, "escalation": escalation},
        ),
    )


@router.get(
    "/{run_id}/graph",
    response_model=Envelope[GraphView],
    tags=["entities"],
    summary="Entity graph around this run's finding: nodes, edges, clusters, metadata",
    description=(
        "Graph *data* only — no coordinates. Node risk is overlaid from this run's own "
        "findings rather than rescored."
    ),
)
def get_run_graph(
    node: str | None = Query(
        None, description="which finding to centre on; defaults to the top-ranked one"
    ),
    run: StoredRun = Depends(get_stored_run),
    engine: EngineState = Depends(require_engine),
) -> dict:
    view = entity_service.graph_for_run(engine, run.result, node)
    return ok(view, source="pipeline", run_id=run.run_id, variant=run.variant)


@router.get(
    "/{run_id}/report",
    response_model=Envelope[ReportView],
    tags=["reports"],
    summary="Draft narrative report assembled from this run's evidence",
    description=(
        "Sourced paragraphs, filing-readiness checks and the downloadable artefacts. Every "
        "substantive paragraph names its origin — an evidence claim with the transaction ids "
        "behind it, a tool that ran, or a declared engine parameter.\n\n"
        "This is a **draft**. `filed` is always false, and readiness items marked `manual` "
        "are steps that require a person; the engine does not pretend to satisfy them."
    ),
)
def get_report(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(reporting.report(run), source="pipeline", run_id=run.run_id)


@router.post(
    "/{run_id}/report",
    response_model=Envelope[ReportView],
    tags=["reports"],
    summary="Build (or rebuild) the draft report and its artefacts",
    description=(
        "Idempotent: the report is deterministic for a given run, so POST returns the same "
        "document as GET. It exists because building the artefacts is the action the "
        "composer's build button performs."
    ),
)
def build_report(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(reporting.report(run), source="pipeline", run_id=run.run_id)


@router.get(
    "/{run_id}/artifacts",
    response_model=Envelope[list[ArtifactView]],
    tags=["reports"],
    summary="Exportable artefacts with real sizes and content digests",
    description=(
        "Sizes and `sha256` values describe the exact bytes the download endpoint will "
        "return, which is what lets an export be attested to after the fact."
    ),
)
def list_artifacts(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(reporting.artifact_list(run), source="pipeline", run_id=run.run_id)


@router.get(
    "/{run_id}/artifacts/{name}",
    tags=["reports"],
    summary="Download one artefact",
    response_class=Response,
    responses={
        200: {"content": {"application/pdf": {}, "text/csv": {}, "application/json": {}}},
        404: {"description": "This run produced no report, or no artefact by that name"},
    },
)
def download_artifact(
    name: str = Path(..., min_length=1, max_length=128, description="artefact file name"),
    run: StoredRun = Depends(get_stored_run),
) -> Response:
    item = reporting.artifact_bytes(run, name)
    return Response(
        content=item.content,
        media_type=item.media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{item.name}"',
            # Published so a client can verify the bytes match what the listing advertised.
            "X-Content-Sha256": item.sha256,
        },
    )
