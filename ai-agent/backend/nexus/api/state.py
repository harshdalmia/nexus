"""Engine state with eager background warmup and a connection lock.

Warmup runs in a background thread at startup so the server answers /health immediately
(status "warming") instead of hanging the first investigation for ~30-60s while 5M rows load.

DuckDB connections are not safe for concurrent use from multiple threads, and FastAPI runs
sync endpoints in a threadpool — so every query path takes `lock`.
"""

from __future__ import annotations

import threading
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ..config import Settings


def _dataset_span(con) -> tuple[str | None, str | None]:
    """(earliest, latest) transaction timestamp. One aggregate query, once, at warmup."""
    try:
        row = con.execute("SELECT MIN(timestamp), MAX(timestamp) FROM transactions").fetchone()
    except Exception:  # pragma: no cover - a broken store already fails warmup louder
        return None, None
    if row is None:
        return None, None
    return (
        row[0].isoformat() if row[0] is not None else None,
        row[1].isoformat() if row[1] is not None else None,
    )


@dataclass
class EngineState:
    settings: Settings = field(default_factory=Settings)
    root: Path | None = None
    status: str = "warming"          # warming | ready | error
    error: str | None = None
    ds: object | None = None
    profiles: object | None = None
    peers: object | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)
    # Data vintage. `data_loaded_at` is when THIS process finished ingesting; `dataset_as_of`
    # is the newest timestamp inside the data itself. They answer different questions and the
    # status strip needs both: one is service freshness, the other is data freshness.
    data_loaded_at: str | None = None
    dataset_as_of: str | None = None
    dataset_from: str | None = None

    # ---- readiness ----
    @property
    def ready(self) -> bool:
        return self.status == "ready"

    def stats(self) -> dict:
        if not self.ready:
            return {"transactions": 0, "accounts": 0}
        return {
            "transactions": int(getattr(self.ds, "n_transactions", 0)),
            "accounts": int(len(self.profiles)),
        }

    def has_node(self, node: str) -> bool:
        return bool(self.ready and node in self.profiles.index)

    # ---- warmup ----
    def warm(self) -> None:
        """Load data, build profiles, fit peer clusters. Safe to call once."""
        try:
            from ..ingest import load_dataset
            from ..peers import PeerModel
            from ..profiles import build_profiles

            ds = load_dataset(self.settings, root=self.root)
            profiles = build_profiles(ds.con)
            peers = PeerModel(profiles)
            span = _dataset_span(ds.con)
            with self.lock:
                self.ds, self.profiles, self.peers = ds, profiles, peers
                self.data_loaded_at = datetime.now(timezone.utc).isoformat(
                    timespec="seconds"
                )
                self.dataset_from, self.dataset_as_of = span
                self.status = "ready"
        except Exception as exc:  # surfaced via /health rather than crashing the server
            self.status = "error"
            self.error = f"{type(exc).__name__}: {exc}"
            traceback.print_exc()

    def warm_in_background(self) -> threading.Thread:
        t = threading.Thread(target=self.warm, name="nexus-warmup", daemon=True)
        t.start()
        return t


def state_from_parts(ds, profiles, peers, settings: Settings | None = None) -> EngineState:
    """Build an already-ready state (used by tests and by pre-seeded demos)."""
    s = EngineState(settings=settings or Settings())
    s.ds, s.profiles, s.peers, s.status = ds, profiles, peers, "ready"
    s.data_loaded_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    con = getattr(ds, "con", None)
    if con is not None:
        s.dataset_from, s.dataset_as_of = _dataset_span(con)
    return s
