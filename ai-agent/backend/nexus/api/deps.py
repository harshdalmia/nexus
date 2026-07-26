"""FastAPI dependencies: engine readiness, the run store, and run lookup.

Routers never touch `app.state` directly; they declare what they need and get a checked
object or a structured 503/404.
"""

from __future__ import annotations

from fastapi import Depends, Path, Request

from .errors import ApiError
from .services.runs import RunStore, StoredRun
from .state import EngineState


def get_engine(request: Request) -> EngineState:
    """The engine regardless of readiness — only /health should use this."""
    engine = getattr(request.app.state, "engine", None)
    if engine is None:  # pragma: no cover - app is always constructed with one
        raise ApiError(500, "ENGINE_MISSING", "The engine was not attached to the app.")
    return engine


def require_engine(engine: EngineState = Depends(get_engine)) -> EngineState:
    """The engine, guaranteed loaded. 503 while warming or after a load failure."""
    if engine.status == "error":
        raise ApiError(
            503, "ENGINE_ERROR",
            "The engine failed to load its dataset.", engine.error,
        )
    if not engine.ready:
        raise ApiError(
            503, "WARMING_UP",
            "Dataset is still loading. Poll /api/v1/health until status is 'ready'.",
        )
    return engine


def get_runs(request: Request) -> RunStore:
    store = getattr(request.app.state, "runs", None)
    if store is None:  # pragma: no cover
        raise ApiError(500, "RUN_STORE_MISSING", "The run store was not attached.")
    return store


def get_stored_run(
    run_id: str = Path(
        ...,
        min_length=1,
        max_length=64,
        description="run id returned by POST /investigations, or the literal 'latest'",
    ),
    runs: RunStore = Depends(get_runs),
) -> StoredRun:
    return runs.require(run_id)
