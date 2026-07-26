"""HTTP surface, one module per resource.

Layering: a handler in here is the controller. It validates (via pydantic models and
dependencies), calls exactly one service, and wraps the result in the standard envelope.
No handler contains analysis, SQL, or pipeline knowledge — that lives in `services/`,
and the pipeline itself lives in `nexus/` and is never modified.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import (
    analytics,
    audit,
    charts,
    entities,
    evidence,
    health,
    investigations,
    models,
    transactions,
)


def v1_router(prefix: str = "/api/v1") -> APIRouter:
    """Assemble the versioned router. Order matters only for path/param collisions."""
    router = APIRouter(prefix=prefix)
    router.include_router(health.router)
    router.include_router(investigations.router)
    router.include_router(charts.router)
    router.include_router(evidence.router)
    router.include_router(entities.router)
    router.include_router(transactions.router)
    router.include_router(models.router)
    router.include_router(analytics.router)
    router.include_router(audit.router)
    return router
