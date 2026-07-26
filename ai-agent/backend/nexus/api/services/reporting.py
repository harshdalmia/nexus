"""Report service: build a draft report for a cached run, and render its artefacts.

Artefacts are rendered on demand and cached per run, so the `sha256` and `bytes` a client
sees in the listing are the digest and length of the exact bytes it will later download. If
they were rendered twice the PDF's embedded creation timestamp would differ and the advertised
digest would be a lie, which defeats the point of publishing one.
"""

from __future__ import annotations

import threading

from ... import artifacts as artifacts_mod
from ... import reports as reports_mod
from ...risk import counterfactuals as risk_counterfactuals
from ..errors import ApiError
from ..schemas.reports import (
    ArtifactView, ReportReadinessView, ReportSectionView, ReportSourceView, ReportView,
)
from .runs import StoredRun

# run_id -> (report, [artifact, ...]). Bounded by the run store's own eviction policy in
# practice; cleared wholesale if it ever grows past the ceiling.
_CACHE: dict[str, tuple[object, list[artifacts_mod.Artifact]]] = {}
_LOCK = threading.Lock()
_MAX_CACHED = 32


def _prefix(run: StoredRun) -> str:
    return f"/api/v1/investigations/{run.run_id}/artifacts"


def _build(run: StoredRun):
    result = run.result
    case = result.case
    if case is None:
        return None, []

    tools_run = [entry.tool for entry in result.plan_trace if entry.status == "ran"]
    tools_skipped = [
        (entry.tool, entry.reason) for entry in result.plan_trace if entry.status != "ran"
    ]
    cfs = risk_counterfactuals(list(case.evidence), case.typology)

    report = reports_mod.build(
        case=case,
        spec=result.spec,
        tools_run=tools_run,
        tools_skipped=tools_skipped,
        counterfactuals=cfs,
        run_reference=run.case_id,
    )
    return report, artifacts_mod.render_all(report, case)


def _cached(run: StoredRun):
    with _LOCK:
        hit = _CACHE.get(run.run_id)
    if hit is not None:
        return hit

    built = _build(run)
    with _LOCK:
        if len(_CACHE) >= _MAX_CACHED:
            _CACHE.clear()
        _CACHE[run.run_id] = built
    return built


def _source_view(source) -> ReportSourceView:
    return ReportSourceView(
        kind=source.kind, ref=source.ref, detail=source.detail,
        tx_count=source.tx_count, tx_ids=list(source.tx_ids),
    )


def _artifact_views(run: StoredRun, items: list[artifacts_mod.Artifact]) -> list[ArtifactView]:
    return [
        ArtifactView(
            name=item.name, label=item.label, media_type=item.media_type,
            bytes=item.bytes_len, sha256=item.sha256,
            url=f"{_prefix(run)}/{item.name}",
            redaction_profile=item.redaction_profile,
        )
        for item in items
    ]


def report(run: StoredRun) -> ReportView:
    """The draft report for a run, or a stated reason there is none."""
    built, items = _cached(run)
    if built is None:
        return ReportView(
            available=False,
            reason=(
                run.result.no_findings_reason
                or "nothing was flagged for this query, so there is nothing to report"
            ),
            run_id=run.run_id,
            case_id=run.case_id,
        )

    notes: list[str] = [
        "This is a draft assembled from the run's own evidence. It has not been reviewed "
        "and it has not been filed.",
    ]
    pdf_reason = artifacts_mod.unavailable_reason()
    if pdf_reason:
        notes.append(f"PDF export is unavailable: {pdf_reason}")

    return ReportView(
        run_id=run.run_id,
        case_id=run.case_id,
        subject=built.subject,
        typology=built.typology,
        verdict=built.verdict,
        risk=built.risk,
        tier=built.tier,
        escalation=built.escalation,
        generated_at=built.generated_at,
        filed=built.filed,
        sections=[
            ReportSectionView(
                heading=section.heading,
                body=section.body,
                sources=[_source_view(source) for source in section.sources],
            )
            for section in built.sections
        ],
        readiness=[
            ReportReadinessView(
                id=item.id, label=item.label, status=item.status, blocker=item.blocker
            )
            for item in built.readiness
        ],
        artifacts=_artifact_views(run, items),
        notes=notes,
    )


def artifact_list(run: StoredRun) -> list[ArtifactView]:
    built, items = _cached(run)
    if built is None:
        return []
    return _artifact_views(run, items)


def artifact_bytes(run: StoredRun, name: str) -> artifacts_mod.Artifact:
    """One rendered artefact by filename, or a 404 naming what is available."""
    built, items = _cached(run)
    if built is None:
        raise ApiError(
            404, "NO_REPORT",
            "This run flagged nothing, so no report artefact exists for it.",
            {"run_id": run.run_id},
        )
    for item in items:
        if item.name == name:
            return item
    raise ApiError(
        404, "ARTIFACT_NOT_FOUND",
        "No artefact with that name was rendered for this run.",
        {"requested": name, "available": [item.name for item in items]},
    )


def clear() -> None:
    """Drop cached artefacts (used by tests)."""
    with _LOCK:
        _CACHE.clear()
