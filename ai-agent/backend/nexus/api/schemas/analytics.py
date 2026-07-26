"""View models for dataset-derived analytics.

Every payload here comes from a read-only aggregation over the normalised transaction
store, the warmup profile table, or the graph the pipeline builds. No scoring, no
inference, no new signals.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SeriesPointView(BaseModel):
    bucket: str
    count: int = Field(..., ge=0)
    value: float


class VolumeSeriesView(BaseModel):
    bucket: str
    node: str | None = None
    points: list[SeriesPointView] = Field(default_factory=list)
    total_count: int = Field(0, ge=0)
    total_value: float = 0.0


class BandView(BaseModel):
    label: str
    count: int = Field(..., ge=0)
    value: float
    lower: float | None = None
    upper: float | None = None


class DistributionsView(BaseModel):
    """Shape of the loaded slice: amount bands, payment formats, currencies."""

    transactions: int = Field(0, ge=0)
    amount_bands: list[BandView] = Field(default_factory=list)
    payment_formats: list[BandView] = Field(default_factory=list)
    currencies: list[BandView] = Field(default_factory=list)


class CorridorCellView(BaseModel):
    row: str
    values: list[float] = Field(default_factory=list)


class CorridorHeatView(BaseModel):
    """Currency corridor intensity per period.

    AMLworld carries no country data, so the rows are payment currencies rather than
    jurisdictions. Named for what it is.
    """

    rows: list[CorridorCellView] = Field(default_factory=list)
    columns: list[str] = Field(default_factory=list)
    row_label: str = "currency"
    note: str = ""


class SegmentView(BaseModel):
    label: str
    accounts: int = Field(..., ge=0)
    share: float = Field(0.0, ge=0.0, le=1.0)


class SegmentsView(BaseModel):
    """Behavioural peer clusters as sized segments, from the warmup peer model."""

    available: bool = True
    reason: str | None = None
    clusters: list[SegmentView] = Field(default_factory=list)
    accounts: int = Field(0, ge=0)
    features: list[str] = Field(default_factory=list)


class CandidatePointView(BaseModel):
    node: str
    rank: float
    x: float
    y: float
    size: float


class CandidateScatterView(BaseModel):
    """The screener's candidate pool, projected onto two of its own features."""

    available: bool = True
    reason: str | None = None
    x_label: str = "in_degree"
    y_label: str = "in_sum"
    size_label: str = "velocity"
    eligible: int = Field(0, ge=0)
    dropped: int = Field(0, ge=0)
    points: list[CandidatePointView] = Field(default_factory=list)


class FlowNodeView(BaseModel):
    id: str
    label: str
    column: int = Field(..., ge=0, le=3)
    role: str


class FlowLinkView(BaseModel):
    source: str
    target: str
    value: float
    tx_count: int = Field(0, ge=0)


class MoneyFlowView(BaseModel):
    """Staged money flow around one account: feeders -> hub -> beneficiaries."""

    centre: str
    nodes: list[FlowNodeView] = Field(default_factory=list)
    links: list[FlowLinkView] = Field(default_factory=list)
    inbound_value: float = 0.0
    outbound_value: float = 0.0
    truncated: bool = False


class EntityEventView(BaseModel):
    """One dated event in an account's own history, straight from the ledger."""

    tx_id: int
    at: str
    day: int = Field(..., ge=1)
    kind: str
    channel: str = "electronic"
    direction: str
    counterparty: str
    amount: float
    currency: str
    payment_format: str
    labelled: bool = False


class EntityTimelineView(BaseModel):
    node: str
    first_seen: str | None = None
    last_seen: str | None = None
    span_days: int = Field(0, ge=0)
    events: list[EntityEventView] = Field(default_factory=list)
    truncated: bool = False
