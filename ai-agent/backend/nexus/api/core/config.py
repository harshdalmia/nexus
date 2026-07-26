"""API-layer configuration, read from the environment exactly once.

Separate from `nexus.config.Settings`, which configures the *pipeline*. Anything here
is transport concern only: CORS, logging, pagination bounds, cache sizing. The pipeline
never reads this module.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache

API_PREFIX = "/api/v1"


def _int(name: str, default: int) -> int:
    raw = os.getenv(name)
    try:
        return int(raw) if raw not in (None, "") else default
    except ValueError:
        return default


def _origins(raw: str) -> list[str]:
    if raw.strip() == "*":
        return ["*"]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@dataclass(frozen=True)
class ApiSettings:
    """Transport configuration. Immutable for the process lifetime."""

    prefix: str = API_PREFIX
    cors_origins: list[str] = field(default_factory=lambda: ["*"])
    log_level: str = "INFO"
    log_requests: bool = True

    # How many completed runs stay addressable by run_id. Each entry holds a RunResult,
    # which is a few hundred KB of pydantic models — not the 5M-row dataset.
    run_cache_size: int = 32

    # Pagination bounds applied to every collection endpoint.
    page_size_default: int = 50
    page_size_max: int = 500

    # Hard ceiling on ledger scans so a bad filter cannot walk 5M rows unbounded.
    transaction_scan_limit: int = 50_000

    # Graph expansion bounds. Depth is capped because ego_subgraph is a live traversal.
    graph_depth_default: int = 1
    graph_depth_max: int = 2
    graph_node_limit: int = 400

    @classmethod
    def from_env(cls) -> "ApiSettings":
        return cls(
            prefix=os.getenv("NEXUS_API_PREFIX", API_PREFIX),
            cors_origins=_origins(os.getenv("NEXUS_CORS_ORIGINS", "*")),
            log_level=os.getenv("NEXUS_LOG_LEVEL", "INFO").upper(),
            log_requests=os.getenv("NEXUS_LOG_REQUESTS", "1") != "0",
            run_cache_size=_int("NEXUS_RUN_CACHE_SIZE", 32),
            page_size_default=_int("NEXUS_PAGE_SIZE_DEFAULT", 50),
            page_size_max=_int("NEXUS_PAGE_SIZE_MAX", 500),
            transaction_scan_limit=_int("NEXUS_TX_SCAN_LIMIT", 50_000),
            graph_depth_default=_int("NEXUS_GRAPH_DEPTH", 1),
            graph_depth_max=_int("NEXUS_GRAPH_DEPTH_MAX", 2),
            graph_node_limit=_int("NEXUS_GRAPH_NODE_LIMIT", 400),
        )


@lru_cache(maxsize=1)
def api_settings() -> ApiSettings:
    return ApiSettings.from_env()
