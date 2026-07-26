"""Accounts and their networks.

`node` is the pipeline's account identifier, `bank|account` (for example `0500|C1`). It
contains a pipe, so clients must URL-encode it.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Path, Query

from ..core.config import api_settings
from ..core.envelope import Envelope, ok
from ..deps import require_engine
from ..schemas.views import EntityProfileView, GraphView
from ..services import entities as service
from ..state import EngineState

router = APIRouter(prefix="/entities", tags=["entities"])

_NODE = Path(
    ...,
    description="account node as `bank|account`, URL-encoded (e.g. `0500%7CC1`)",
    min_length=3,
    max_length=80,
)


@router.get(
    "/{node}",
    response_model=Envelope[EntityProfileView],
    summary="Behavioural profile of one account",
    description=(
        "The profile table the engine builds at warmup: in/out counts, values, degrees, "
        "transaction count, velocity and activity span. Derived from transactions only."
    ),
    responses={404: {"description": "Account not present in the loaded dataset"}},
)
def get_entity(
    node: str = _NODE,
    engine: EngineState = Depends(require_engine),
) -> dict:
    return ok(
        service.profile(engine, node),
        source="dataset", variant=engine.settings.variant,
    )


@router.get(
    "/{node}/graph",
    response_model=Envelope[GraphView],
    summary="Bounded ego network around an account",
    description=(
        "Nodes, edges, weights, relationship kinds and role clusters. Parallel transfers "
        "between the same pair are aggregated into one edge carrying its transaction ids. "
        "No layout is computed — the client positions the graph itself."
    ),
    responses={404: {"description": "Account not present in the loaded dataset"}},
)
def get_entity_graph(
    node: str = _NODE,
    depth: int | None = Query(
        None, ge=1, description="feeder expansion depth; capped by server configuration"
    ),
    engine: EngineState = Depends(require_engine),
) -> dict:
    settings = api_settings()
    view = service.ego_graph(engine, node, depth or settings.graph_depth_default)
    return ok(
        view,
        source="pipeline", variant=engine.settings.variant,
        notes=(
            ["node count exceeded the server cap; the graph was truncated"]
            if view.truncated else []
        ),
    )
