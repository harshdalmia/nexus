"""near_threshold — structuring detector (Typology A).

Counts inbound deposits sitting just below the reporting threshold, i.e. in
[threshold * (1 - band), threshold). Many such deposits are the fingerprint of
structuring. Entity-level: if `entity_nodes` is given, aggregates across an entity's
accounts; otherwise scores the single account. Emits `typology_rule`.
"""

from __future__ import annotations

import duckdb

from . import clamp
from ..config import Settings
from ..ledger import EvidenceLedger
from ..schemas import EvidenceRecord, FilterScope
from .. import scope as scope_mod

# Deposit count at/above which the "enough of them to be deliberate" half saturates.
_SATURATE_AT = 5.0
# Fewer near-threshold deposits than this is not a pattern, whatever the share.
_MIN_PATTERN = 2
# Count and share are weighted equally. See `_strength`.
_COUNT_SHARE_SPLIT = 0.5


def _strength(n_near: int, n_in: int) -> float:
    """How much the near-threshold deposits look like deliberate splitting.

    Half count, half share, and the share half is the fix for a real defect: strength used to
    be `n_near / 5` alone, so the `n_in` the claim printed was never actually used. Three
    near-threshold deposits out of three and three out of fifty-two both scored 0.6, both
    reached 60/100, and both landed in "review" — while the claim text invited the reader to
    compute 5.8% and reach the opposite conclusion. The number on the page and the number in
    the score disagreed.

    Structuring is deliberate splitting, so both halves are needed. A handful of
    near-threshold deposits among hundreds of ordinary ones is a coincidence; the same
    handful when they are ALL of the account's deposits is a pattern.
    """
    if n_in <= 0 or n_near <= 0:
        return 0.0
    count_factor = min(1.0, n_near / _SATURATE_AT)
    share = n_near / n_in
    return clamp(_COUNT_SHARE_SPLIT * count_factor + (1.0 - _COUNT_SHARE_SPLIT) * share)


def run(
    con: duckdb.DuckDBPyConnection,
    node: str,
    ledger: EvidenceLedger,
    settings: Settings | None = None,
    entity_nodes: list[str] | None = None,
    scope: FilterScope | None = None,
) -> EvidenceRecord:
    settings = settings or Settings()
    low = settings.near_threshold * (1.0 - settings.near_threshold_band)
    high = settings.near_threshold
    nodes = entity_nodes or [node]

    # "cash deposits in March" is precisely this tool's question, so it honours the filter.
    count_where, count_params = scope_mod.where(scope, "to_bank = ?", "receiver_account = ?")
    band_where, band_params = scope_mod.where(
        scope, "to_bank = ?", "receiver_account = ?",
        "amount_base >= ?", "amount_base < ?",
    )

    tx_ids: list[int] = []
    n_near = 0
    n_in = 0
    for n in nodes:
        bank, acct = n.split("|", 1)
        n_in += con.execute(
            f"SELECT COUNT(*) FROM transactions {count_where}",
            [bank, acct] + count_params,
        ).fetchone()[0]
        rows = con.execute(
            f"SELECT tx_id FROM transactions {band_where}",
            [bank, acct, low, high] + band_params,
        ).fetchall()
        n_near += len(rows)
        tx_ids.extend(int(r[0]) for r in rows)

    # High when several deposits cluster near the threshold. Otherwise a *strong low*
    # signal (deposits exist but aren't threshold-shaped) so the benign theory can win;
    # neutral only when there are no deposits at all.
    if n_in == 0:
        direction, strength = "low", 0.0
    elif n_near >= _MIN_PATTERN:
        direction, strength = "high", _strength(n_near, n_in)
    else:
        direction, strength = "low", clamp(n_in / 8.0)

    across = (
        f" across {len(nodes)} accounts belonging to the same entity" if entity_nodes else ""
    )
    currency = settings.base_currency
    return ledger.add(EvidenceRecord(
        claim_id=ledger.mint_id(),
        family="typology_rule",
        claim=(
            f"{n_near} of {n_in} inbound deposits landed between {low:,.0f} and "
            f"{high:,.0f} {currency}, just under the {high:,.0f} reporting "
            f"threshold{across}"
        ),
        calculation=(
            f"deposits in the near-threshold band; suspicious when at least {_MIN_PATTERN} "
            f"of them exist. strength = {_COUNT_SHARE_SPLIT:g}*min(1, n_near/"
            f"{_SATURATE_AT:.0f}) + {1 - _COUNT_SHARE_SPLIT:g}*(n_near/n_in), so both how "
            "many and what share of the account's deposits they are"
        ),
        value=float(n_near),
        direction=direction,
        strength=round(strength, 3),
        transactions=tx_ids,
    ))
