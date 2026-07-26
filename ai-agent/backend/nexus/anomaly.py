"""IsolationForest anomaly model — the 'generic AI' detector.

Unsupervised: trained on behavioral account profiles only (NO labels — no leakage). Produces
a per-account anomaly score in [0,1]. Used two ways:
  - as the generic-AI baseline in eval (Baseline 2),
  - as a neutral, proof-carrying `anomaly` evidence family in the live ledger (kept OUT of
    the risk weights and hypothesis fingerprints, so the locked anchors are unchanged).
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from .config import REPO_ROOT
from .profiles import CLUSTER_FEATURES

MODEL_PATH = REPO_ROOT / "models" / "isoforest.joblib"
FEATURES = CLUSTER_FEATURES


@dataclass
class AnomalyModel:
    iso: IsolationForest
    scaler: StandardScaler
    p_low: float
    p_high: float

    def _raw(self, x: np.ndarray) -> np.ndarray:
        # Higher raw = more anomalous (decision_function is higher for normal points).
        return -self.iso.decision_function(self.scaler.transform(x))

    def score_row(self, feat: pd.Series) -> float:
        x = np.log1p(feat[FEATURES].to_numpy(dtype=float)).reshape(1, -1)
        raw = float(self._raw(x)[0])
        span = self.p_high - self.p_low
        return float(np.clip((raw - self.p_low) / span, 0.0, 1.0)) if span > 0 else 0.0

    def score_frame(self, profiles: pd.DataFrame) -> pd.Series:
        x = np.log1p(profiles[FEATURES].to_numpy(dtype=float))
        raw = self._raw(x)
        span = self.p_high - self.p_low
        norm = np.clip((raw - self.p_low) / span, 0.0, 1.0) if span > 0 else raw * 0.0
        return pd.Series(norm, index=profiles.index)


def train(profiles: pd.DataFrame, seed: int = 0, contamination: float = 0.01) -> AnomalyModel:
    x = np.log1p(profiles[FEATURES].to_numpy(dtype=float))
    scaler = StandardScaler().fit(x)
    iso = IsolationForest(
        n_estimators=100, contamination=contamination, random_state=seed, n_jobs=-1
    ).fit(scaler.transform(x))
    raw = -iso.decision_function(scaler.transform(x))
    p_low, p_high = float(np.percentile(raw, 1)), float(np.percentile(raw, 99))
    return AnomalyModel(iso=iso, scaler=scaler, p_low=p_low, p_high=p_high)


def save(model: AnomalyModel, path: Path = MODEL_PATH) -> None:
    import joblib
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, path)


def load(path: Path = MODEL_PATH) -> AnomalyModel | None:
    """Load the persisted model, or None if it hasn't been trained yet."""
    if not Path(path).is_file():
        return None
    try:
        import joblib
        return joblib.load(path)
    except Exception:
        return None


@dataclass(frozen=True)
class ArtifactIdentity:
    """Provenance for the persisted model file.

    Every field is read off the artefact itself, so it cannot drift from what is loaded:
    `trained_at` is the file's modification time, `sha256` is a digest of its bytes, and
    `features` is the exact feature list this module scores with. There is deliberately no
    drift or PSI figure — nothing in the pipeline computes one, and inventing a number for a
    provenance strip would defeat the point of a provenance strip.
    """

    present: bool
    path: str
    name: str = "isolation_forest"
    kind: str = "unsupervised"
    version: str | None = None
    trained_at: str | None = None
    sha256: str | None = None
    bytes: int | None = None
    features: tuple[str, ...] = ()
    reason: str | None = None


def identity(path: Path = MODEL_PATH) -> ArtifactIdentity:
    """Describe the model artefact on disk without loading or fitting anything."""
    file = Path(path)
    if not file.is_file():
        return ArtifactIdentity(
            present=False, path=str(file), features=tuple(FEATURES),
            reason="no trained artifact on disk (run scripts/train_model.py)",
        )

    raw = file.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    stat = file.stat()
    return ArtifactIdentity(
        present=True,
        path=str(file),
        # Short digest doubles as the version: the bytes are the only identity the artefact
        # actually has, since nothing stamps a semantic version into it.
        version=digest[:12],
        trained_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(
            timespec="seconds"
        ),
        sha256=digest,
        bytes=len(raw),
        features=tuple(FEATURES),
    )
