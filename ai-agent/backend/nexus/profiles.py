"""Per-account behavioral profiles, derived from transactions only (no demographics).

One row per node (bank|account) with in/out volume, counts, degree, activity span and
velocity. Feeds peer clustering and the evidence tools.
"""

from __future__ import annotations

import duckdb
import pandas as pd

_PROFILE_SQL = """
WITH sends AS (
  SELECT from_bank AS bank, sender_account AS acct,
         COUNT(*) AS out_count, SUM(amount_base) AS out_sum,
         COUNT(DISTINCT to_bank || '|' || receiver_account) AS out_degree,
         MIN(timestamp) AS out_min, MAX(timestamp) AS out_max
  FROM transactions GROUP BY 1, 2
),
recvs AS (
  SELECT to_bank AS bank, receiver_account AS acct,
         COUNT(*) AS in_count, SUM(amount_base) AS in_sum,
         COUNT(DISTINCT from_bank || '|' || sender_account) AS in_degree,
         MIN(timestamp) AS in_min, MAX(timestamp) AS in_max
  FROM transactions GROUP BY 1, 2
)
SELECT
  COALESCE(s.bank, r.bank) AS bank,
  COALESCE(s.acct, r.acct) AS acct,
  COALESCE(s.out_count, 0) AS out_count,
  COALESCE(s.out_sum, 0.0) AS out_sum,
  COALESCE(s.out_degree, 0) AS out_degree,
  COALESCE(r.in_count, 0) AS in_count,
  COALESCE(r.in_sum, 0.0) AS in_sum,
  COALESCE(r.in_degree, 0) AS in_degree,
  s.out_min, s.out_max, r.in_min, r.in_max
FROM sends s
FULL OUTER JOIN recvs r ON s.bank = r.bank AND s.acct = r.acct
"""

# Features used for peer clustering (log-scaled before standardizing).
CLUSTER_FEATURES = [
    "out_count", "out_sum", "out_degree",
    "in_count", "in_sum", "in_degree",
    "txn_count", "velocity", "span_days",
]


def build_profiles(con: duckdb.DuckDBPyConnection) -> pd.DataFrame:
    """Build the per-account profile table, indexed by node string 'bank|account'."""
    df = con.execute(_PROFILE_SQL).df()

    df["node"] = df["bank"] + "|" + df["acct"]
    t_min = df[["out_min", "in_min"]].min(axis=1)
    t_max = df[["out_max", "in_max"]].max(axis=1)
    df["span_days"] = (t_max - t_min).dt.total_seconds().fillna(0.0) / 86400.0 + 1.0
    df["txn_count"] = df["in_count"] + df["out_count"]
    df["velocity"] = df["txn_count"] / df["span_days"]
    df["io_ratio"] = df["in_sum"] / (df["out_sum"] + 1.0)

    df = df.drop(columns=["out_min", "out_max", "in_min", "in_max"])
    return df.set_index("node")
