"""Audit receipts: what was asked, what ran, what was decided, and on what evidence."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..core.envelope import Envelope, ok, page_meta
from ..core.pagination import PageRequest, page_params, slice_page, sort_in_memory
from ..deps import get_runs, get_stored_run
from ..schemas.views import AuditView, RunSummaryView
from ..services import serializers
from ..services.runs import RunStore, StoredRun

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get(
    "",
    response_model=Envelope[list[RunSummaryView]],
    summary="Audit trail of cached runs, newest first",
    description=(
        "One entry per investigation this process has run. The trail is in-memory and "
        "process-scoped: nothing is persisted between restarts."
    ),
)
def list_audit(
    page: PageRequest = Depends(page_params),
    runs: RunStore = Depends(get_runs),
) -> dict:
    summaries = [serializers.run_summary(run) for run in runs.list()]
    ordered = sort_in_memory(summaries, page, ("created_at", "risk", "duration_ms"))
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
    response_model=Envelope[AuditView],
    summary="Full audit receipt for one run",
)
def get_audit(run: StoredRun = Depends(get_stored_run)) -> dict:
    return ok(serializers.audit(run), source="cache", run_id=run.run_id)
