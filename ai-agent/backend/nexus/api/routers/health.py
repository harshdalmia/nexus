"""Service health and the static tool roster."""

from __future__ import annotations

import os

from fastapi import APIRouter, Depends

from ... import llm, reports
from ...artifacts import PDF_AVAILABLE
from ..core.envelope import Envelope, ok
from ..deps import get_engine, get_runs
from ..schemas.views import HealthView, RosterToolView
from ..services import serializers
from ..services.runs import RunStore
from ..state import EngineState

router = APIRouter(tags=["health"])


def _anomaly_model_present() -> bool:
    from ... import anomaly
    return anomaly.MODEL_PATH.is_file()


@router.get(
    "/health",
    response_model=Envelope[HealthView],
    summary="Engine readiness and dataset facts",
    description=(
        "Always 200, even while the dataset loads — read `data_loaded` and `status`. "
        "Clients should poll this until `status` is `ready` before investigating."
    ),
)
def health(
    engine: EngineState = Depends(get_engine),
    runs: RunStore = Depends(get_runs),
) -> dict:
    stats = engine.stats()
    view = HealthView(
        status=engine.status,
        data_loaded=engine.ready,
        error=engine.error,
        variant=engine.settings.variant,
        transactions=stats["transactions"],
        accounts=stats["accounts"],
        llm_enabled=llm.use_llm(),
        llm_model=os.getenv("GEMINI_MODEL") if llm.use_llm() else None,
        anomaly_model=_anomaly_model_present(),
        cached_runs=runs.count(),
        data_loaded_at=engine.data_loaded_at,
        dataset_as_of=engine.dataset_as_of,
        dataset_from=engine.dataset_from,
        model=serializers.model_artifact(),
        capabilities={
            "eda_tool": True,
            "feature_builder": True,
            "anomaly_detection": _anomaly_model_present(),
            "graph_traversal": True,
            "llm_narration": llm.use_llm(),
            # The report *content* builder is deterministic and always present. PDF rendering
            # depends on reportlab, so it is reported separately rather than folded in —
            # a client should not be told exports are unavailable because a font library is.
            "report_generator": reports.AVAILABLE,
            "pdf_export": PDF_AVAILABLE,
        },
    )
    return ok(view, source="static", variant=engine.settings.variant)


@router.get(
    "/roster",
    response_model=Envelope[list[RosterToolView]],
    tags=["execution"],
    summary="Every tool the planner may select",
    description=(
        "The agent's declared capability set — what the plan rail renders before a query "
        "is dispatched. Selection happens per query; this is only what is selectable."
    ),
)
def roster() -> dict:
    return ok(serializers.roster(), source="static")
