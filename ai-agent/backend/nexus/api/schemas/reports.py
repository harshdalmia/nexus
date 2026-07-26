"""View models for the draft report and its downloadable artefacts."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ReportSourceView(BaseModel):
    """Where one paragraph's facts came from."""

    kind: Literal["evidence", "tool", "declaration", "dataset", "exclusion"]
    ref: str
    detail: str = ""
    tx_count: int = Field(0, ge=0)
    tx_ids: list[int] = Field(default_factory=list)


class ReportSectionView(BaseModel):
    heading: str
    body: str
    sources: list[ReportSourceView] = Field(default_factory=list)


class ReportReadinessView(BaseModel):
    """One filing precondition.

    `manual` means a person has to do it. It is reported distinctly from `blocked` because
    these are steps that SHOULD need a human, and an automated pipeline reporting them as
    satisfied would be the single most misleading thing this API could do.
    """

    id: str
    label: str
    status: Literal["ok", "blocked", "manual"]
    blocker: str | None = None


class ArtifactView(BaseModel):
    """One downloadable file. `url` is relative to the API root."""

    name: str
    label: str = ""
    media_type: str
    bytes: int = Field(0, ge=0)
    sha256: str
    url: str
    # Exports are not redacted. Saying so is the honest answer; claiming a redaction profile
    # that no code implements would be worse than reporting none.
    redaction_profile: str = "none"


class ReportView(BaseModel):
    available: bool = True
    reason: str | None = None
    run_id: str = ""
    case_id: str = ""
    subject: str | None = None
    typology: str | None = None
    verdict: str | None = None
    risk: float = 0.0
    tier: str | None = None
    escalation: str | None = None
    generated_at: str = ""
    # Always false. The engine drafts; it does not file.
    filed: bool = False
    sections: list[ReportSectionView] = Field(default_factory=list)
    readiness: list[ReportReadinessView] = Field(default_factory=list)
    artifacts: list[ArtifactView] = Field(default_factory=list)
    notes: list[str] = Field(default_factory=list)
