"""Request bodies and query models."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class InvestigationRequest(BaseModel):
    """A natural-language investigation request.

    The query is the only input the pipeline takes. Caps mirror the engine's own cost
    ceilings and are optional: omitted means "use the server configuration".
    """

    model_config = ConfigDict(extra="forbid")

    query: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="analyst question in plain language",
        examples=[
            "Find structuring patterns in the last 30 days",
            "Is customer 0500|C1 suspicious?",
            "trace ring at 0048309|811C599A0",
        ],
    )
    max_investigations: int | None = Field(
        None, ge=0, le=100,
        description="cap on accounts investigated; server default when omitted",
    )
    max_candidates: int | None = Field(
        None, ge=1, le=5000,
        description="cap on the screened candidate pool; server default when omitted",
    )

    @field_validator("query")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("query must not be blank")
        return cleaned
