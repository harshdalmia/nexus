"""In-process store of completed investigations.

An investigation is expensive (seconds of DuckDB work), and the frontend needs to read
many facets of the same run: execution summary, plan trace, risk, charts, evidence,
recommendations, audit. Re-running the pipeline per facet would be both slow and wrong —
a second run could return different findings.

So a run is executed once, cached under a `run_id`, and every subresource reads that
snapshot. Eviction is oldest-first with a configurable ceiling; RunResult holds pydantic
models, not the dataset.
"""

from __future__ import annotations

import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone

from ...orchestrator import RunResult
from ..errors import ApiError


@dataclass(frozen=True)
class StoredRun:
    """A completed run plus the transport metadata the pipeline does not carry."""

    run_id: str
    query: str
    variant: str
    created_at: str
    duration_ms: float
    result: RunResult

    @property
    def case_id(self) -> str:
        """Stable, human-quotable identifier for the run. Not a pipeline concept."""
        return f"R-{self.run_id[:8].upper()}"


@dataclass
class RunStore:
    max_runs: int = 32
    _runs: "OrderedDict[str, StoredRun]" = field(default_factory=OrderedDict)
    _lock: threading.Lock = field(default_factory=threading.Lock)

    def add(
        self, query: str, variant: str, result: RunResult, duration_ms: float
    ) -> StoredRun:
        run = StoredRun(
            run_id=uuid.uuid4().hex,
            query=query,
            variant=variant,
            created_at=datetime.now(timezone.utc).isoformat(timespec="milliseconds"),
            duration_ms=round(duration_ms, 2),
            result=result,
        )
        with self._lock:
            self._runs[run.run_id] = run
            while len(self._runs) > self.max_runs:
                self._runs.popitem(last=False)
        return run

    def get(self, run_id: str) -> StoredRun | None:
        with self._lock:
            if run_id == "latest":
                return next(reversed(self._runs.values()), None)
            return self._runs.get(run_id)

    def require(self, run_id: str) -> StoredRun:
        run = self.get(run_id)
        if run is None:
            raise ApiError(
                404, "RUN_NOT_FOUND",
                "No investigation with that id is held in memory. "
                "Runs are cached per process and evicted oldest-first.",
                {"run_id": run_id, "cached_runs": self.count()},
            )
        return run

    def list(self) -> list[StoredRun]:
        """Newest first."""
        with self._lock:
            return list(reversed(self._runs.values()))

    def count(self) -> int:
        with self._lock:
            return len(self._runs)

    def clear(self) -> None:
        with self._lock:
            self._runs.clear()
