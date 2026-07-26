"""Chart datasets for a run.

Structured data only: labels, values, rows and columns. No rendering, no colours beyond a
severity hint the pipeline's own thresholds imply, no layout.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..core.envelope import Envelope, ok
from ..deps import get_stored_run
from ..errors import ApiError
from ..schemas.views import ChartDatasetView
from ..services import serializers
from ..services.runs import StoredRun

router = APIRouter(prefix="/investigations/{run_id}/charts", tags=["charts"])


@router.get(
    "",
    response_model=Envelope[list[ChartDatasetView]],
    summary="Every chart dataset this run produced",
    description=(
        "Unavailable datasets are included with `available=false` and the pipeline's own "
        "reason, so a client can explain an absent chart instead of hiding it silently. "
        "Pass `available_only=true` to receive just the renderable ones."
    ),
)
def list_charts(
    available_only: bool = Query(False, description="drop datasets with no data"),
    run: StoredRun = Depends(get_stored_run),
) -> dict:
    datasets = serializers.charts(run.result)
    if available_only:
        datasets = [dataset for dataset in datasets if dataset.available]
    return ok(datasets, source="cache", run_id=run.run_id)


@router.get(
    "/{chart_id}",
    response_model=Envelope[ChartDatasetView],
    summary="One chart dataset by id",
    responses={404: {"description": "No dataset with that id in this run"}},
)
def get_chart(chart_id: str, run: StoredRun = Depends(get_stored_run)) -> dict:
    datasets = serializers.charts(run.result)
    match = next((dataset for dataset in datasets if dataset.id == chart_id), None)

    if match is None:
        raise ApiError(
            404, "CHART_NOT_FOUND",
            f"This run produced no dataset with id {chart_id!r}.",
            {"available": [dataset.id for dataset in datasets]},
        )

    return ok(match, source="cache", run_id=run.run_id)
