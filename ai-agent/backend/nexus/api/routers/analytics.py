"""Dataset-derived analytics for the population views.

These are read-only aggregations over the loaded dataset — the same store the pipeline
reads. They let the watchtower, models and case views draw real distributions instead of
fixtures, without asking the engine to score anything.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query

from ..core.envelope import Envelope, ok
from ..deps import require_engine
from ..schemas.analytics import (
    CandidateScatterView,
    CorridorHeatView,
    DistributionsView,
    EntityTimelineView,
    MoneyFlowView,
    SegmentsView,
    VolumeSeriesView,
)
from ..services import analytics as service
from ..state import EngineState

router = APIRouter(prefix="/analytics", tags=["analytics"])

_NODE = Path(
    ...,
    description="account node as `bank|account`, URL-encoded (e.g. `0500%7CC1`)",
    min_length=3,
    max_length=80,
)


@router.get(
    "/volume",
    response_model=Envelope[VolumeSeriesView],
    summary="Transaction count and value per period",
)
def volume(
    bucket: str = Query("week", description="day | week | month"),
    node: str | None = Query(None, description="scope to one account, `bank|account`"),
    limit: int = Query(60, ge=1, le=400, description="maximum periods returned"),
    engine: EngineState = Depends(require_engine),
) -> dict:
    return ok(
        service.volume_series(engine, bucket=bucket, node=node, limit=limit),
        source="dataset",
        variant=engine.settings.variant,
    )


@router.get(
    "/distributions",
    response_model=Envelope[DistributionsView],
    summary="Amount bands, payment formats and currencies across the loaded slice",
    description=(
        "The $9k–$9.99k band is reported separately because it is the band the engine's "
        "near-threshold rule examines."
    ),
)
def distributions(engine: EngineState = Depends(require_engine)) -> dict:
    return ok(
        service.distributions(engine), source="dataset", variant=engine.settings.variant,
    )


@router.get(
    "/corridor-heat",
    response_model=Envelope[CorridorHeatView],
    summary="Currency corridor intensity per period",
    description=(
        "Rows are payment currencies, not jurisdictions: the dataset carries no country "
        "data. Values are normalised against the busiest cell."
    ),
)
def corridor_heat(
    bucket: str = Query("month", description="day | week | month"),
    rows: int = Query(6, ge=1, le=15, description="how many currencies to include"),
    engine: EngineState = Depends(require_engine),
) -> dict:
    return ok(
        service.corridor_heat(engine, bucket=bucket, rows=rows),
        source="dataset",
        variant=engine.settings.variant,
    )


@router.get(
    "/segments",
    response_model=Envelope[SegmentsView],
    summary="Behavioural peer clusters as sized segments",
)
def segments(engine: EngineState = Depends(require_engine)) -> dict:
    return ok(service.segments(engine), source="pipeline", variant=engine.settings.variant)


@router.get(
    "/candidates",
    response_model=Envelope[CandidateScatterView],
    summary="The screener's candidate pool projected onto two of its own features",
)
def candidates(
    limit: int = Query(120, ge=1, le=500, description="pool size to project"),
    engine: EngineState = Depends(require_engine),
) -> dict:
    return ok(
        service.candidate_scatter(engine, limit=limit),
        source="pipeline",
        variant=engine.settings.variant,
    )


@router.get(
    "/entities/{node}/money-flow",
    response_model=Envelope[MoneyFlowView],
    summary="Staged money flow around one account: feeders, hub, beneficiaries",
    responses={404: {"description": "Account not present in the loaded dataset"}},
)
def money_flow(
    node: str = _NODE,
    depth: int = Query(1, ge=1, description="feeder expansion depth, capped by config"),
    engine: EngineState = Depends(require_engine),
) -> dict:
    return ok(
        service.money_flow(engine, node, depth=depth),
        source="pipeline",
        variant=engine.settings.variant,
    )


@router.get(
    "/entities/{node}/timeline",
    response_model=Envelope[EntityTimelineView],
    summary="One account's dated transaction history",
    responses={404: {"description": "Account not present in the loaded dataset"}},
)
def entity_timeline(
    node: str = _NODE,
    limit: int = Query(200, ge=1, le=1000, description="maximum events returned"),
    engine: EngineState = Depends(require_engine),
) -> dict:
    return ok(
        service.entity_timeline(engine, node, limit=limit),
        source="dataset",
        variant=engine.settings.variant,
    )
