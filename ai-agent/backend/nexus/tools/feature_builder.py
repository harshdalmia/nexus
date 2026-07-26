"""feature_builder — engineered AML features as a visible, declinable agent step.

`profiles.build_profiles()` already produced these features, but it ran once at API warmup
as a silent precondition, so the plan never credited it. This wrapper makes it a roster tool
with a feature manifest, while returning values IDENTICAL to `build_profiles()` — the peer
model and the IsolationForest are calibrated on them, so any drift would move the anchors.

Emits no EvidenceRecord: it aggregates accounts, so it cannot cite real tx_ids, and the
proof-carrying rule forbids a record without them. Its output shows up in the manifest and
in the plan trace instead.
"""

from __future__ import annotations

import duckdb
import pandas as pd

from ..profiles import CLUSTER_FEATURES, build_profiles
from ..schemas import FeatureDefinition, FeatureManifest

# Exactly the engineered feature columns, in report order.
FEATURES: tuple[str, ...] = (
    "out_count", "out_sum", "out_degree", "in_count", "in_sum", "in_degree",
    "txn_count", "span_days", "velocity", "io_ratio",
)

DEFINITIONS: dict[str, str] = {
    "out_count": "number of transactions the account sent",
    "out_sum": "total value sent, normalized to the base currency",
    "out_degree": "distinct counterparties the account paid",
    "in_count": "number of transactions the account received",
    "in_sum": "total value received, normalized to the base currency",
    "in_degree": "distinct counterparties that paid the account (fan-in breadth)",
    "txn_count": "in_count + out_count, total activity",
    "span_days": "days between first and last activity, inclusive",
    "velocity": "txn_count / span_days, transactions per active day",
    "io_ratio": "in_sum / (out_sum + 1), how much more arrives than leaves",
}


# Unit for each feature, so the frontend can format a value without guessing. The transport
# contract says the backend pre-formats nothing, so a unit travels instead of a display string.
UNITS: dict[str, str] = {
    "out_count": "transactions",
    "out_sum": "base_currency",
    "out_degree": "counterparties",
    "in_count": "transactions",
    "in_sum": "base_currency",
    "in_degree": "counterparties",
    "txn_count": "transactions",
    "span_days": "days",
    "velocity": "transactions_per_day",
    "io_ratio": "ratio",
}


def manifest_for(features: pd.DataFrame, source: str) -> FeatureManifest:
    return FeatureManifest(
        features=[
            FeatureDefinition(name=n, definition=DEFINITIONS[n], unit=UNITS[n])
            for n in FEATURES
        ],
        cluster_features=list(CLUSTER_FEATURES),
        accounts=int(len(features)),
        source=source,  # type: ignore[arg-type]
    )


def values_for(features: pd.DataFrame | None, node: str) -> dict[str, float]:
    """The engineered feature values for ONE account.

    `build_profiles` already computed every one of these for every account at warmup, so this
    is a row lookup, not a computation. The manifest used to declare that ten features exist
    while never saying what they evaluated to for the account on screen, which is the
    difference between a feature list and a feature explanation.
    """
    if features is None or node not in features.index:
        return {}
    row = features.loc[node]
    out: dict[str, float] = {}
    for name in FEATURES:
        if name in features.columns:
            out[name] = round(float(row[name]), 4)
    return out


def run(
    con: duckdb.DuckDBPyConnection,
    prebuilt: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, FeatureManifest]:
    """Return (feature_table, manifest).

    `prebuilt` is the warmup table: returned unchanged with zero database queries, which is
    both the fast path and what keeps the peer model and the screener consistent.
    """
    if prebuilt is not None:
        return prebuilt, manifest_for(prebuilt, "warmup")

    df = build_profiles(con)
    # build_profiles also carries `bank`/`acct`; project to the declared feature set only.
    return df[list(FEATURES)], manifest_for(df, "built")
