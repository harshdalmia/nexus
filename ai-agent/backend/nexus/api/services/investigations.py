"""Investigation orchestration: validate, call the pipeline, cache, hand back.

The pipeline call is one line — `orchestrator.run(...)`. Everything around it is transport
concern: entity existence checks so no case is invented for an unknown account, the
connection lock, timing, cost-cap overrides, and structured failure codes.
"""

from __future__ import annotations

import dataclasses
import time

from ...config import Settings
from ...intent import parse as parse_intent
from ...orchestrator import run as run_pipeline
from ..core.logging import logger
from ..errors import ApiError
from ..schemas.requests import InvestigationRequest
from ..state import EngineState
from .runs import RunStore, StoredRun


def _settings_for(engine: EngineState, request: InvestigationRequest) -> Settings:
    """Apply per-request cost caps. These are engine *inputs*, not pipeline behaviour."""
    overrides: dict[str, int] = {}
    if request.max_investigations is not None:
        overrides["max_investigations"] = request.max_investigations
    if request.max_candidates is not None:
        overrides["max_candidates"] = request.max_candidates
    if not overrides:
        return engine.settings
    return dataclasses.replace(engine.settings, **overrides)


def _reject_unknown_entities(engine: EngineState, query: str) -> None:
    """404 rather than a fabricated case when a named account is not in the dataset."""
    for node in parse_intent(query).entities:
        if not engine.has_node(node):
            raise ApiError(
                404, "ACCOUNT_NOT_FOUND",
                f"Account {node} does not exist in {engine.settings.variant}.",
                {"node": node, "variant": engine.settings.variant},
            )


def execute(
    engine: EngineState, runs: RunStore, request: InvestigationRequest
) -> StoredRun:
    """Run one investigation and cache it under a run id."""
    query = request.query.strip()
    _reject_unknown_entities(engine, query)

    settings = _settings_for(engine, request)
    started = time.perf_counter()

    try:
        # The shared DuckDB connection is not thread-safe and FastAPI runs sync endpoints
        # in a threadpool, so every pipeline call is serialised.
        with engine.lock:
            result = run_pipeline(query, engine.ds.con, engine.peers, engine.profiles, settings)
    except ApiError:
        raise
    except ValueError as exc:
        # The pipeline raises ValueError for a query it cannot resolve to a target.
        raise ApiError(400, "UNRESOLVABLE_QUERY", str(exc)) from exc
    except Exception as exc:
        logger.exception("investigation failed for query %r", query)
        raise ApiError(
            500, "INVESTIGATION_FAILED",
            "The investigation could not be completed.",
            {"type": type(exc).__name__},
        ) from exc

    duration_ms = (time.perf_counter() - started) * 1000.0
    stored = runs.add(query, engine.settings.variant, result, duration_ms)

    logger.info(
        "run %s query=%r findings=%d risk=%s in %.0fms",
        stored.run_id[:8], query, len(result.findings),
        result.case.risk if result.case else "n/a", duration_ms,
    )
    return stored
