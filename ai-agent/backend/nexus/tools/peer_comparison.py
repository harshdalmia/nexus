"""peer_comparison — is this account unusual for *similar* accounts?

Robust deviation (median/MAD z) of the account's behavioral features vs its peer cluster
(or the global population when the cluster is too small / zero-spread). Emits a
`peer_deviation` EvidenceRecord.
"""

from __future__ import annotations

import duckdb

from . import clamp
from .. import families
from ..ledger import EvidenceLedger
from ..peers import PeerModel
from ..schemas import EvidenceRecord


def _inbound_tx_ids(con: duckdb.DuckDBPyConnection, node: str) -> list[int]:
    bank, acct = node.split("|", 1)
    rows = con.execute(
        "SELECT tx_id FROM transactions WHERE to_bank = ? AND receiver_account = ?",
        [bank, acct],
    ).fetchall()
    return [r[0] for r in rows]


def run(
    con: duckdb.DuckDBPyConnection,
    peers: PeerModel,
    node: str,
    ledger: EvidenceLedger,
) -> EvidenceRecord:
    dev = peers.deviation(node)
    strength = clamp(abs(dev.z) / 5.0)
    if dev.feature is None:
        claim = "no comparable peers were available, so no deviation could be measured"
    else:
        claim = (
            f"its {families.feature_label(dev.feature)} sits {abs(dev.z):.1f} robust standard "
            f"deviations {'above' if dev.direction == 'high' else 'below'} "
            f"{families.peer_set_phrase(dev.peer_set, dev.peer_count)}"
        )
    return ledger.add(EvidenceRecord(
        claim_id=ledger.mint_id(),
        family="peer_deviation",
        claim=claim,
        calculation="robust z = (log1p(x) - cluster_median) / (1.4826 * cluster_MAD)",
        value=round(dev.z, 3),
        direction=dev.direction,
        strength=round(strength, 3),
        transactions=_inbound_tx_ids(con, node),
    ))
