"""Evidence records for a run, and the transactions that prove them."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..core.envelope import Envelope, ok, page_meta
from ..core.pagination import PageRequest, page_params, slice_page, sort_in_memory
from ..deps import get_stored_run, require_engine
from ..errors import ApiError
from ..schemas.views import EvidenceRecordView, TransactionView
from ..services import serializers
from ..services import transactions as tx_service
from ..services.runs import StoredRun
from ..state import EngineState

router = APIRouter(prefix="/investigations/{run_id}/evidence", tags=["evidence"])

SORT_FIELDS = ("family", "strength", "value", "direction", "tx_count")


@router.get(
    "",
    response_model=Envelope[list[EvidenceRecordView]],
    summary="Evidence records behind a finding",
    description=(
        "Defaults to the top-ranked finding. `weighted` marks whether a family carries risk "
        "weight — neutral families (anomaly, profiling, coverage) are reported but never "
        "move the score."
    ),
)
def list_evidence(
    page: PageRequest = Depends(page_params),
    node: str | None = Query(None, description="finding to read; defaults to top-ranked"),
    family: str | None = Query(None, description="filter by evidence family"),
    weighted_only: bool = Query(False, description="only families that carry risk weight"),
    run: StoredRun = Depends(get_stored_run),
) -> dict:
    records = serializers.evidence(run.result, node)

    if family:
        records = [record for record in records if record.family == family]
    if weighted_only:
        records = [record for record in records if record.weighted]

    ordered = sort_in_memory(records, page, SORT_FIELDS)
    window = slice_page(ordered, page)
    return ok(
        window,
        source="cache", run_id=run.run_id,
        page=page_meta(
            page=page.page, page_size=page.page_size, total=len(records),
            sort=page.sort, filters={"node": node, "family": family},
        ),
    )


@router.get(
    "/{claim_id}/transactions",
    response_model=Envelope[list[TransactionView]],
    tags=["transactions"],
    summary="The exact transactions cited by one evidence record",
    responses={404: {"description": "No such claim in this run"}},
)
def evidence_transactions(
    claim_id: str,
    node: str | None = Query(None, description="finding to read; defaults to top-ranked"),
    run: StoredRun = Depends(get_stored_run),
    engine: EngineState = Depends(require_engine),
) -> dict:
    records = serializers.evidence(run.result, node)
    match = next((record for record in records if record.claim_id == claim_id), None)

    if match is None:
        raise ApiError(
            404, "CLAIM_NOT_FOUND",
            f"No evidence record {claim_id!r} in this run.",
            {"available": [record.claim_id for record in records][:25]},
        )

    rows = tx_service.by_ids(engine, match.tx_ids)
    return ok(
        rows,
        source="dataset", run_id=run.run_id, variant=run.variant,
        notes=[
            f"{match.tx_count} transaction(s) support this claim; "
            f"{len(match.tx_ids)} id(s) were published with the record"
        ],
    )
