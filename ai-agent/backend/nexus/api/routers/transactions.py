"""Ledger reads: filtered, sorted, paginated transactions from the normalised store."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..core.envelope import Envelope, ok, page_meta
from ..core.pagination import PageRequest, page_params
from ..deps import get_stored_run, require_engine
from ..errors import ApiError
from ..schemas.views import AttributionView, TransactionView
from ..services import attribution
from ..services import transactions as service
from ..services.runs import StoredRun
from ..state import EngineState

router = APIRouter(prefix="/transactions", tags=["transactions"])


@router.get(
    "",
    response_model=Envelope[list[TransactionView]],
    summary="Query the transaction ledger",
    description=(
        "Read-only access to the normalised transaction store. Amounts are reported both as "
        "paid/received in original currency and converted to base currency by the engine's "
        f"FX table. Sortable fields: {', '.join(service.SORTABLE)}.\n\n"
        "`meta.page.truncated` is true when more rows match than the server will count, so "
        "`total` should be read as a floor."
    ),
)
def list_transactions(
    page: PageRequest = Depends(page_params),
    node: str | None = Query(None, description="either side of the transaction, `bank|account`"),
    sender: str | None = Query(None, description="sending account, `bank|account`"),
    receiver: str | None = Query(None, description="receiving account, `bank|account`"),
    bank: str | None = Query(None, description="either bank id"),
    payment_format: str | None = Query(None, description="e.g. Cash, Wire, Cheque, ACH"),
    currency: str | None = Query(None, description="payment or receiving currency"),
    min_amount: float | None = Query(None, ge=0, description="minimum base-currency amount"),
    max_amount: float | None = Query(None, ge=0, description="maximum base-currency amount"),
    start: str | None = Query(None, description="ISO timestamp lower bound (inclusive)"),
    end: str | None = Query(None, description="ISO timestamp upper bound (inclusive)"),
    laundering_only: bool = Query(False, description="dataset label filter (ground truth)"),
    cross_currency_only: bool = Query(False, description="only cross-currency transactions"),
    engine: EngineState = Depends(require_engine),
) -> dict:
    if min_amount is not None and max_amount is not None and min_amount > max_amount:
        raise ApiError(
            400, "INVALID_AMOUNT_RANGE",
            "min_amount must not exceed max_amount.",
            {"min_amount": min_amount, "max_amount": max_amount},
        )

    filters = service.TransactionFilters(
        node=node, sender=sender, receiver=receiver, bank=bank,
        payment_format=payment_format, currency=currency,
        min_amount=min_amount, max_amount=max_amount,
        start=start, end=end,
        laundering_only=laundering_only, cross_currency_only=cross_currency_only,
    )

    rows, total, truncated = service.query(engine, filters, page)
    return ok(
        rows,
        source="dataset", variant=engine.settings.variant,
        page=page_meta(
            page=page.page, page_size=page.page_size, total=total,
            sort=page.sort, filters=filters.as_meta(), truncated=truncated,
        ),
    )


@router.get(
    "/attribution/{run_id}",
    response_model=Envelope[AttributionView],
    tags=["evidence"],
    summary="Every transaction a run's evidence cites, with the citing claims",
    description=(
        "Joins the `tx_ids` each evidence record publishes back to ledger rows. This is "
        "attribution, not per-transaction scoring: the engine scores accounts, so the risk "
        "reported alongside a row belongs to the account the claim was made about. Only "
        "cited transactions appear — typically tens per finding, which is the set that "
        "explains a case."
    ),
    responses={404: {"description": "No run with that id is held in memory"}},
)
def transaction_attribution(
    limit: int = Query(
        attribution.MAX_CITED_TRANSACTIONS, ge=1, le=attribution.MAX_CITED_TRANSACTIONS,
        description="cap on cited transactions returned",
    ),
    run: StoredRun = Depends(get_stored_run),
    engine: EngineState = Depends(require_engine),
) -> dict:
    view = attribution.annotate(engine, run, limit=limit)

    return ok(
        view,
        source="cache",
        run_id=run.run_id,
        variant=engine.settings.variant,
        notes=[view.note],
    )


@router.get(
    "/facets",
    response_model=Envelope[dict[str, list[dict]]],
    summary="Distinct payment formats, currencies and the ledger time span",
    description="Filter options with counts, so the client never hardcodes a facet list.",
)
def transaction_facets(engine: EngineState = Depends(require_engine)) -> dict:
    return ok(service.facets(engine), source="dataset", variant=engine.settings.variant)


@router.get(
    "/{tx_id}",
    response_model=Envelope[TransactionView],
    summary="One transaction by id",
    responses={404: {"description": "No transaction with that id"}},
)
def get_transaction(
    tx_id: int,
    engine: EngineState = Depends(require_engine),
) -> dict:
    rows = service.by_ids(engine, [tx_id])
    if not rows:
        raise ApiError(
            404, "TRANSACTION_NOT_FOUND",
            f"No transaction with id {tx_id}.", {"tx_id": tx_id},
        )
    return ok(rows[0], source="dataset", variant=engine.settings.variant)
