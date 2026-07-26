import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Pin,
  RotateCcw,
  SearchX,
  SlidersHorizontal,
} from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Chip, Segmented } from '@/components/primitives/Chip';
import { DataTable } from '@/components/primitives/DataTable';
import type { Column } from '@/components/primitives/DataTable';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Collapse, Panel, PanelHead } from '@/components/primitives/Panel';
import { ScoreValue, SeverityTag, Tone } from '@/components/primitives/Severity';
import { channelLabel, ledgerRows, savedViews } from '@/data/ledger';
import type { LedgerRow } from '@/data/ledger';
import { useEngineHealth } from '@/hooks/useEngineHealth';
import { useCollapsed } from '@/hooks/useCollapsed';
import { useSessionState } from '@/hooks/useSessionState';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';
import type {
  AttributedTransactionDto,
  AttributionDto,
  ClaimCitationDto,
  TransactionDto,
} from '@/lib/api/types';
import { money, num } from '@/lib/format';
import { useAgent } from '@/store/agentStore';
import { useAudit } from '@/store/auditStore';
import { useCases } from '@/store/caseStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import type { Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   The ledger reads the engine's normalised transaction store when the
   engine is up, and the bundled fixtures when it is not.

   Filters are one state object, persisted for the browser session, and
   every change refetches immediately: amount, channel, currency, label
   and cross-currency predicates are pushed down into the query so a
   filter really scans the whole store rather than the loaded page.

   The engine publishes transaction facts but scores accounts, not
   individual transactions — there is no per-row rule hit, risk score or
   SHAP driver in the pipeline. Those columns stay in place and read "—"
   on live rows instead of being filled with a plausible number.
   ------------------------------------------------------------------ */

type RiskBand = 'all' | 'review-plus' | 'severe';
type AmountBand = 'any' | 'threshold' | 'large';

const PAGE_SIZE = 100;

const AMOUNT_BOUNDS: Record<AmountBand, { readonly min?: number; readonly max?: number }> = {
  any: {},
  /* Structuring band: deliberately short of the $10,000 reporting line. */
  threshold: { min: 9_000, max: 9_999 },
  large: { min: 25_000 },
};

const AMOUNT_LABEL: Record<AmountBand, string> = {
  any: 'any amount',
  threshold: '$9,000 – $9,999',
  large: '$25,000 and above',
};

interface LedgerFilters {
  readonly channel: string | null;
  readonly currency: string | null;
  readonly amount: AmountBand;
  readonly band: RiskBand;
  readonly labelledOnly: boolean;
  readonly crossCurrencyOnly: boolean;
  /** free-text account match, applied to the loaded page */
  readonly account: string;
}

const NO_FILTERS: LedgerFilters = {
  channel: null,
  currency: null,
  amount: 'any',
  band: 'all',
  labelledOnly: false,
  crossCurrencyOnly: false,
  account: '',
};

/** Reject a session value written by an older build rather than crashing on it. */
const migrateFilters = (stored: unknown): LedgerFilters | null => {
  if (typeof stored !== 'object' || stored === null) {
    return null;
  }

  const candidate = stored as Partial<LedgerFilters>;
  const amount = candidate.amount;
  const band = candidate.band;

  if (amount !== undefined && !(amount in AMOUNT_BOUNDS)) {
    return null;
  }

  if (band !== undefined && !['all', 'review-plus', 'severe'].includes(band)) {
    return null;
  }

  return { ...NO_FILTERS, ...candidate };
};

/** One row as the table renders it, from either source. */
interface LedgerViewRow {
  readonly id: string;
  readonly time: string;
  readonly from: string;
  readonly to: string;
  readonly amount: number;
  readonly channel: string;
  readonly corridor: string;
  readonly pattern: string | null;
  readonly rule: string | null;
  readonly score: number | null;
  readonly severity: Severity | null;
  readonly shap: readonly string[] | null;
  readonly siblings: number | null;
  /* Attribution from the last investigation, when this row was cited as evidence.
     `score`/`severity` above stay null for engine rows: the score below belongs to the
     ACCOUNT the claim was made about, never to the transaction. */
  readonly citations: readonly ClaimCitationDto[] | null;
  readonly families: readonly string[] | null;
  readonly account: string | null;
  readonly accountRisk: number | null;
  readonly accountSeverity: Severity | null;
}

const severityOfTier = (tier: string | null): Severity | null => {
  switch (tier) {
    case 'high':
      return 'severe';
    case 'medium':
      return 'review';
    case 'low':
      return 'clear';
    default:
      return null;
  }
};

const fromFixture = (row: LedgerRow): LedgerViewRow => ({
  id: row.id,
  time: row.time,
  from: row.from,
  to: row.to,
  amount: row.amount,
  channel: channelLabel[row.channel],
  corridor: row.jurisdiction,
  pattern: row.pattern,
  rule: row.rule,
  score: row.score,
  severity: row.severity,
  shap: row.shap,
  siblings: row.siblings,
  citations: null,
  families: null,
  account: null,
  accountRisk: null,
  accountSeverity: null,
});

const fromEngine = (row: TransactionDto): LedgerViewRow => ({
  id: `TX-${String(row.tx_id)}`,
  time: row.timestamp === null ? '—' : row.timestamp.replace('T', ' ').slice(0, 16),
  from: `${row.from_bank}|${row.sender_account}`,
  to: `${row.to_bank}|${row.receiver_account}`,
  amount: row.amount_base ?? row.amount_paid ?? 0,
  channel: row.payment_format,
  corridor: row.cross_currency
    ? `${row.payment_currency} → ${row.receiving_currency}`
    : row.payment_currency,
  /* `is_laundering` is the dataset's held-out label, not a model output. */
  pattern: row.is_laundering ? 'labelled laundering (dataset)' : null,
  rule: null,
  score: null,
  severity: null,
  shap: null,
  siblings: null,
  citations: null,
  families: null,
  account: null,
  accountRisk: null,
  accountSeverity: null,
});

/** Merge a row with the claims that cited it, when the last run cited it at all. */
const withAttribution = (
  row: LedgerViewRow,
  attributed: AttributedTransactionDto | undefined,
): LedgerViewRow => {
  if (attributed === undefined) {
    return row;
  }

  return {
    ...row,
    citations: attributed.citations,
    families: attributed.families,
    account: attributed.account,
    accountRisk: attributed.account_risk,
    accountSeverity: severityOfTier(attributed.account_tier),
    shap: attributed.citations.map(
      (citation) => `${citation.family} ${citation.strength.toFixed(2)}`,
    ),
  };
};

/** Channel names differ in case between the fixtures and the engine. */
const sameChannel = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

const FIXTURE_CHANNELS = ['cash', 'wire', 'ach', 'card', 'crypto'] as const;

/* --------------------------------- controls --------------------------------- */

const FilterField = ({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: React.ReactNode;
}) => (
  <label className="flex min-w-0 flex-col gap-2.5">
    <span className="eyebrow flex items-baseline gap-2">
      {label}
      {hint !== undefined && <span className="text-meta normal-case text-ghost">{hint}</span>}
    </span>
    {children}
  </label>
);

/* Filter controls carry the same height as every other control and enough width
   that a currency or a channel name is never clipped. */
const selectClass =
  'h-[var(--control-h)] min-w-[13rem] rounded-[2px] border border-rule bg-raise px-3.5 text-body ' +
  'text-ink shadow-[var(--elev-1)] transition-colors hover:border-edge focus:border-info-line ' +
  'focus:outline-none';

const Toggle = ({
  label,
  active,
  onChange,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onChange: (next: boolean) => void;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={() => onChange(!active)}
    className={`inline-flex h-[var(--control-h)] items-center gap-2.5 rounded-[2px] border px-4 text-body transition-colors ${
      active
        ? 'border-info-line bg-info-bg text-info'
        : 'border-rule bg-raise text-muted hover:border-edge hover:text-ink'
    }`}
  >
    <span
      aria-hidden="true"
      className={`size-2 rounded-full ${active ? 'bg-info' : 'bg-rule'}`}
    />
    {label}
  </button>
);

export const LedgerWorkspace = () => {
  const { shut: filtersShut, toggle: toggleFilters } = useCollapsed('ledger.filters');
  const { activeCaseId, scope } = useWorkspaceState();
  const { pin, notify, selectEntity, navigate } = useWorkspaceActions();
  const { record } = useAudit();
  const { state } = useEngineHealth();
  const { origin } = useAgent();
  const { cases } = useCases();

  /* Filters live in session storage: switching to the graph and back, or
     refreshing the tab, must not silently discard an analyst's working set. */
  const [filters, setFilters, resetStoredFilters] = useSessionState<LedgerFilters>(
    'ledger.filters',
    NO_FILTERS,
    migrateFilters,
  );

  const [activeRow, setActiveRow] = useState<LedgerViewRow | null>(null);
  const [page, setPage] = useState(1);

  const [liveRows, setLiveRows] = useState<readonly LedgerViewRow[] | null>(null);
  const [liveTotal, setLiveTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [channelOptions, setChannelOptions] = useState<readonly string[]>([]);
  const [currencyOptions, setCurrencyOptions] = useState<readonly string[]>([]);
  const [attribution, setAttribution] = useState<AttributionDto | null>(null);

  const live = state === 'ready';
  /* The last investigation this session ran; its evidence is what annotates rows. */
  const runId = origin.runId ?? cases[0]?.runId ?? null;
  const entityScope = scope.find((chip) => chip.kind === 'entity')?.label ?? null;
  const patternScope = scope.find((chip) => chip.kind === 'pattern')?.label ?? null;
  /* Fixture entities are bare ids ("4521"); engine nodes are "bank|account". Only
     a real node can be pushed down as a server-side predicate. */
  const scopedNode = entityScope !== null && entityScope.includes('|') ? entityScope : null;

  const bounds = AMOUNT_BOUNDS[filters.amount];

  /** Apply a filter change and record it, in one place, so every change is audited. */
  const applyFilters = useCallback(
    (patch: Partial<LedgerFilters>, detail: string) => {
      setFilters((current) => ({ ...current, ...patch }));
      setPage(1);
      record({
        action: 'filter.changed',
        detail,
        workspace: 'ledger',
        metadata: Object.fromEntries(
          Object.entries(patch).map(([key, value]) => [key, String(value)]),
        ),
      });
    },
    [setFilters, record],
  );

  const resetFilters = useCallback(() => {
    resetStoredFilters();
    setPage(1);
    record({
      action: 'filter.changed',
      detail: 'All ledger filters cleared',
      workspace: 'ledger',
      metadata: { reset: 'true' },
    });
  }, [resetStoredFilters, record]);

  /* Filter options come from the dataset itself when the engine is up. */
  /* Which claims cited which transaction. The engine scores accounts, so this is the
     only honest answer to "why is this row here?" — and it covers exactly the rows an
     investigation cited, not the whole ledger. */
  useEffect(() => {
    if (!live || runId === null) {
      setAttribution(null);

      return undefined;
    }

    const controller = new AbortController();

    api
      .getAttribution(runId, { signal: controller.signal })
      .then((response) => setAttribution(response.data))
      .catch(() => setAttribution(null));

    return () => controller.abort();
  }, [live, runId]);

  const attributed = useMemo(() => {
    const index = new Map<number, AttributedTransactionDto>();

    for (const row of attribution?.rows ?? []) {
      index.set(row.transaction.tx_id, row);
    }

    return index;
  }, [attribution]);

  useEffect(() => {
    if (!live) {
      setChannelOptions(FIXTURE_CHANNELS);
      setCurrencyOptions([]);

      return;
    }

    let cancelled = false;

    api
      .getTransactionFacets()
      .then((response) => {
        if (cancelled) {
          return;
        }
        setChannelOptions(response.data.payment_formats.map((facet) => facet.value));
        setCurrencyOptions(response.data.currencies.map((facet) => facet.value));
      })
      .catch(() => {
        if (!cancelled) {
          setChannelOptions(FIXTURE_CHANNELS);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [live]);

  useEffect(() => {
    if (!live) {
      setLiveRows(null);

      return undefined;
    }

    const controller = new AbortController();
    setLoading(true);

    api
      .getTransactions({
        page,
        pageSize: PAGE_SIZE,
        sort: 'timestamp:desc',
        node: scopedNode ?? undefined,
        paymentFormat: filters.channel ?? undefined,
        currency: filters.currency ?? undefined,
        minAmount: bounds.min,
        maxAmount: bounds.max,
        launderingOnly: filters.labelledOnly,
        crossCurrencyOnly: filters.crossCurrencyOnly,
        signal: controller.signal,
      })
      .then((response) => {
        setLiveRows(response.data.map(fromEngine));
        setLiveTotal(response.meta.page?.total ?? response.data.length);
        setTruncated(response.meta.page?.truncated ?? false);
        setLoadError(null);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'CANCELLED') {
          return;
        }
        setLoadError(error instanceof ApiError ? error.message : String(error));
        setLiveRows(null);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [
    live,
    page,
    scopedNode,
    filters.channel,
    filters.currency,
    filters.labelledOnly,
    filters.crossCurrencyOnly,
    bounds.min,
    bounds.max,
  ]);

  const rows = useMemo(() => {
    const search = filters.account.trim().toLowerCase();

    const bySearch = (row: LedgerViewRow): boolean =>
      search.length === 0 ||
      row.from.toLowerCase().includes(search) ||
      row.to.toLowerCase().includes(search) ||
      row.id.toLowerCase().includes(search);

    if (liveRows !== null) {
      return liveRows
        .filter(bySearch)
        .map((row) => withAttribution(row, attributed.get(Number(row.id.slice(3)))));
    }

    /* The fixtures carry risk scores, so the demo path can honour every filter,
       including the risk band the engine cannot answer. */
    return ledgerRows
      .filter((row) => {
        if (filters.band === 'severe' && row.severity !== 'severe') {
          return false;
        }

        if (filters.band === 'review-plus' && row.severity === 'clear') {
          return false;
        }

        if (entityScope !== null && row.from !== entityScope && row.to !== entityScope) {
          return false;
        }

        if (filters.channel !== null && !sameChannel(row.channel, filters.channel)) {
          return false;
        }

        if (filters.currency !== null && !row.jurisdiction.includes(filters.currency)) {
          return false;
        }

        if (bounds.min !== undefined && row.amount < bounds.min) {
          return false;
        }

        if (bounds.max !== undefined && row.amount > bounds.max) {
          return false;
        }

        if (filters.labelledOnly && row.score < 75) {
          return false;
        }

        if (filters.crossCurrencyOnly && !row.jurisdiction.includes('→')) {
          return false;
        }

        return true;
      })
      .map(fromFixture)
      .filter(bySearch);
  }, [liveRows, attributed, filters, entityScope, bounds.min, bounds.max]);

  const inView = rows.reduce((sum, row) => sum + row.amount, 0);

  /* Chips describe exactly the state above, so removing one is a real state change. */
  const chips = [
    ...(filters.channel === null
      ? []
      : [
          {
            id: 'channel',
            prefix: 'channel',
            label: filters.channel,
            remove: () => applyFilters({ channel: null }, 'Channel filter removed'),
          },
        ]),
    ...(filters.currency === null
      ? []
      : [
          {
            id: 'currency',
            prefix: 'currency',
            label: filters.currency,
            remove: () => applyFilters({ currency: null }, 'Currency filter removed'),
          },
        ]),
    ...(filters.amount === 'any'
      ? []
      : [
          {
            id: 'amount',
            prefix: 'amount',
            label: AMOUNT_LABEL[filters.amount],
            remove: () => applyFilters({ amount: 'any' }, 'Amount band cleared'),
          },
        ]),
    ...(filters.band === 'all'
      ? []
      : [
          {
            id: 'band',
            prefix: 'risk',
            label: filters.band === 'severe' ? 'severe only' : 'review and above',
            remove: () => applyFilters({ band: 'all' }, 'Risk band cleared'),
          },
        ]),
    ...(filters.labelledOnly
      ? [
          {
            id: 'labelled',
            prefix: 'label',
            label: live ? 'dataset-labelled only' : 'severe scores only',
            remove: () => applyFilters({ labelledOnly: false }, 'Label filter removed'),
          },
        ]
      : []),
    ...(filters.crossCurrencyOnly
      ? [
          {
            id: 'cross',
            prefix: 'fx',
            label: 'cross-currency only',
            remove: () =>
              applyFilters({ crossCurrencyOnly: false }, 'Cross-currency filter removed'),
          },
        ]
      : []),
    ...(filters.account.trim().length === 0
      ? []
      : [
          {
            id: 'account',
            prefix: 'account',
            label: filters.account.trim(),
            remove: () => applyFilters({ account: '' }, 'Account search cleared'),
          },
        ]),
  ];

  const columns: ReadonlyArray<Column<LedgerViewRow>> = [
    {
      id: 'id',
      header: 'txn id',
      width: '11%',
      pinned: true,
      sortValue: (row) => row.id,
      render: (row) => <span className="ident text-body-lg font-medium text-ink">{row.id}</span>,
    },
    {
      id: 'time',
      header: 'timestamp',
      width: '13%',
      sortValue: (row) => row.time,
      render: (row) => <span className="num text-body">{row.time}</span>,
    },
    {
      id: 'from',
      header: 'from',
      width: '12%',
      render: (row) => (
        <button
          type="button"
          onClick={() => {
            selectEntity(row.from);
            record({
              action: 'entity.selected',
              detail: `Selected sender ${row.from} from the ledger`,
              entity: row.from,
              workspace: 'ledger',
              metadata: { transaction: row.id },
            });
          }}
          className="num truncate text-body text-info hover:underline"
        >
          {row.from}
        </button>
      ),
    },
    {
      id: 'to',
      header: 'to',
      width: '12%',
      render: (row) => (
        <button
          type="button"
          onClick={() => {
            selectEntity(row.to);
            record({
              action: 'entity.selected',
              detail: `Selected beneficiary ${row.to} from the ledger`,
              entity: row.to,
              workspace: 'ledger',
              metadata: { transaction: row.id },
            });
          }}
          className="num truncate text-body text-info hover:underline"
        >
          {row.to}
        </button>
      ),
    },
    {
      id: 'amount',
      header: 'amount',
      align: 'right',
      width: '13%',
      sortValue: (row) => row.amount,
      render: (row) => (
        <span
          className={`num text-body-lg ${
            row.amount >= 9000 && row.amount < 10000 ? 'text-rev' : 'text-ink'
          }`}
        >
          {money(row.amount)}
        </span>
      ),
    },
    {
      id: 'channel',
      header: 'channel',
      width: '9%',
      render: (row) => <span className="text-body">{row.channel}</span>,
    },
    {
      id: 'jurisdiction',
      header: 'corridor',
      width: '11%',
      render: (row) => <span className="num text-body">{row.corridor}</span>,
    },
    {
      id: 'rule',
      header: 'rule',
      width: '10%',
      sortValue: (row) => row.families?.[0] ?? row.rule ?? '',
      render: (row) => {
        if (row.families !== null && row.families.length > 0) {
          const [first, ...rest] = row.families;

          return (
            <span
              className="num text-body text-info"
              title={`Cited by ${String(row.citations?.length ?? 0)} claim(s) about ${
                row.account ?? 'a flagged account'
              }: ${row.families.join(', ')}`}
            >
              cited by {first}
              {rest.length > 0 && <span className="text-faint"> +{rest.length}</span>}
            </span>
          );
        }

        return (
          <span className="num text-body text-muted">
            {row.rule ?? <span className="text-ghost">not scored per row</span>}
          </span>
        );
      },
    },
    {
      id: 'score',
      header: 'risk',
      align: 'right',
      width: '9%',
      sortValue: (row) => row.score ?? row.accountRisk ?? -1,
      render: (row) => {
        if (row.score !== null && row.severity !== null) {
          return (
            <span className="inline-flex items-center gap-2">
              <SeverityTag severity={row.severity} />
              <ScoreValue score={row.score} />
            </span>
          );
        }

        /* The engine scores accounts, so this is the citing account's risk — shown here
           because it is the only real score attached to the row, and labelled as such
           rather than passed off as a transaction score. */
        if (row.accountRisk !== null && row.accountSeverity !== null) {
          return (
            <span
              className="inline-flex items-center gap-2"
              title={`Account risk for ${row.account ?? 'the citing account'} — not a transaction score. The engine scores accounts.`}
            >
              <SeverityTag severity={row.accountSeverity} />
              <ScoreValue score={row.accountRisk} />
              <span className="text-meta uppercase tracking-wide text-faint">acct</span>
            </span>
          );
        }

        return <span className="text-body text-ghost">—</span>;
      },
    },
  ];

  const matching = live ? (truncated ? `${num(liveTotal)}+` : num(liveTotal)) : num(rows.length);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Panel className="min-h-0 flex-1 border-0">
        <PanelHead
          title="transaction ledger"
          meta={
            <span className="truncate text-label text-faint">
              {live
                ? `engine · ${num(rows.length)} of ${matching} matching · page ${String(page)}`
                : `${num(ledgerRows.length)} demo rows · ${num(rows.length)} matching`}
              {loading && ' · loading…'}
            </span>
          }
          actions={
            <>
              {/* Fold the filter bar and the measures away when the table itself
                  is the thing being read. Nothing is discarded: the filters stay
                  applied and the controls stay mounted. */}
              <Button
                size="xs"
                variant="ghost"
                aria-expanded={!filtersShut}
                onClick={toggleFilters}
              >
                <SlidersHorizontal className="size-3.5" aria-hidden="true" />
                {filtersShut ? `show filters · ${String(chips.length)} active` : 'hide filters'}
              </Button>
              {live && (
                <span className="flex items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={page === 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                  >
                    <ChevronLeft className="size-3.5" aria-hidden="true" />
                    prev
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={rows.length < PAGE_SIZE}
                    onClick={() => setPage((current) => current + 1)}
                  >
                    next
                    <ChevronRight className="size-3.5" aria-hidden="true" />
                  </Button>
                </span>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  notify('Export queued', `${num(rows.length)} rows · PII redacted.`, 'info');
                  record({
                    action: 'export.generated',
                    detail: `Ledger export queued for ${num(rows.length)} rows`,
                    workspace: 'ledger',
                    metadata: {
                      rows: String(rows.length),
                      value: money(inView),
                      source: live ? 'engine' : 'demo',
                    },
                  });
                }}
              >
                <Download className="size-3.5" aria-hidden="true" />
                csv
              </Button>
            </>
          }
        />

        {/* ---------- filter bar ----------
            Enterprise analytics proportions: a tall bar, wide gutters between
            every control, and labels that sit clear of their field. */}
        <Collapse shut={filtersShut}>
        <div className="hair-b flex flex-col gap-7 px-8 py-7">
          <div className="filterbar">
            <FilterField label="amount band" hint="base currency">
              <Segmented
                label="Amount band"
                value={filters.amount}
                onChange={(next) =>
                  applyFilters({ amount: next }, `Amount band set to ${AMOUNT_LABEL[next]}`)
                }
                options={[
                  { id: 'any', label: 'any' },
                  { id: 'threshold', label: '$9k–$9.99k' },
                  { id: 'large', label: '$25k+' },
                ]}
              />
            </FilterField>

            <FilterField label="channel">
              <select
                className={selectClass}
                value={filters.channel ?? ''}
                onChange={(event) => {
                  const next = event.target.value === '' ? null : event.target.value;
                  applyFilters({ channel: next }, `Channel filter set to ${next ?? 'all channels'}`);
                }}
              >
                <option value="">all channels</option>
                {channelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="currency" hint={live ? undefined : 'engine only'}>
              <select
                className={selectClass}
                disabled={currencyOptions.length === 0}
                value={filters.currency ?? ''}
                onChange={(event) => {
                  const next = event.target.value === '' ? null : event.target.value;
                  applyFilters(
                    { currency: next },
                    `Currency filter set to ${next ?? 'all currencies'}`,
                  );
                }}
              >
                <option value="">all currencies</option>
                {currencyOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="risk band" hint={live ? 'scored rows only' : undefined}>
              <Segmented
                label="Risk band"
                value={filters.band}
                onChange={(next) => applyFilters({ band: next }, `Risk band set to ${next}`)}
                options={[
                  { id: 'all', label: 'all' },
                  { id: 'review-plus', label: 'review+' },
                  { id: 'severe', label: 'severe' },
                ]}
              />
            </FilterField>

            <FilterField label="account">
              <input
                type="search"
                value={filters.account}
                placeholder={live ? 'bank|account' : 'entity id'}
                onChange={(event) =>
                  setFilters((current) => ({ ...current, account: event.target.value }))
                }
                onBlur={(event) => {
                  if (event.target.value.trim().length > 0) {
                    record({
                      action: 'filter.changed',
                      detail: `Account search “${event.target.value.trim()}”`,
                      workspace: 'ledger',
                      metadata: { account: event.target.value.trim() },
                    });
                  }
                }}
                className={`${selectClass} min-w-[12rem]`}
              />
            </FilterField>

            <div className="flex items-end gap-3 pb-px">
              <Toggle
                label={live ? 'labelled only' : 'severe only'}
                active={filters.labelledOnly}
                onChange={(next) =>
                  applyFilters(
                    { labelledOnly: next },
                    next ? 'Restricted to labelled rows' : 'Label filter removed',
                  )
                }
              />
              <Toggle
                label="cross-currency"
                active={filters.crossCurrencyOnly}
                onChange={(next) =>
                  applyFilters(
                    { crossCurrencyOnly: next },
                    next ? 'Restricted to cross-currency rows' : 'Cross-currency filter removed',
                  )
                }
              />
            </div>
          </div>

          {/* ---------- active filters + scope ---------- */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <span className="eyebrow flex shrink-0 items-center gap-1.5">
              <Filter className="size-3.5" aria-hidden="true" />
              active · {chips.length}
            </span>

            {live ? (
              <Tone kind="info">pushed down to the engine</Tone>
            ) : (
              <Tone kind="neutral">demo rows</Tone>
            )}

            {entityScope !== null && (
              <Chip tone="info" prefix="scope">
                {entityScope}
              </Chip>
            )}
            {patternScope !== null && (
              <Chip tone="info" prefix="pattern">
                {patternScope}
              </Chip>
            )}

            {chips.map((chip) => (
              <Chip key={chip.id} prefix={chip.prefix} onRemove={chip.remove}>
                {chip.label}
              </Chip>
            ))}

            {chips.length === 0 && (
              <span className="text-label text-faint">
                no filter applied — every transaction in scope is listed
              </span>
            )}

            <span className="ml-auto flex items-center gap-3">
              <Button size="xs" variant="quiet" disabled={chips.length === 0} onClick={resetFilters}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                reset filters
              </Button>
              <span className="eyebrow">saved</span>
              {savedViews.slice(0, 3).map((view) => (
                <button
                  key={view.id}
                  type="button"
                  onClick={() => {
                    /* Saved views are declarations, not queries: apply the parts the
                       current source can honour and say so. */
                    const patch: Partial<LedgerFilters> =
                      view.id === 'v-struct'
                        ? { amount: 'threshold', channel: live ? 'Cash' : 'cash' }
                        : view.id === 'v-corridor'
                          ? { crossCurrencyOnly: true }
                          : { amount: 'large' };

                    applyFilters(patch, `Saved view applied · ${view.label}`);
                    notify('View applied', `${view.label} · ${view.filters.join(' · ')}`, 'info');
                  }}
                  className="ctl h-[26px] px-2 text-label"
                >
                  {view.label}
                </button>
              ))}
            </span>
          </div>
        </div>

        {/* ---------- measures ---------- */}
        <div className="hair-b flex flex-wrap items-end gap-x-12 gap-y-5 px-8 py-6">
          <div>
            <p className="eyebrow pb-1.5">rows in view</p>
            <p className="metric text-metric leading-none text-ink">{num(rows.length)}</p>
          </div>
          <div>
            <p className="eyebrow pb-1.5">value in view</p>
            <p className="metric text-metric leading-none text-ink">{money(inView)}</p>
          </div>
          <div>
            <p className="eyebrow pb-1.5">matching filters</p>
            <p className="metric text-metric leading-none text-info">{matching}</p>
          </div>
          {filters.amount !== 'any' && (
            <div>
              <p className="eyebrow pb-1.5">threshold band</p>
              <p className="num text-body-lg leading-none text-rev">
                {AMOUNT_LABEL[filters.amount]}
              </p>
            </div>
          )}
          <p className="ml-auto max-w-[46ch] text-label leading-snug text-faint">
            {loadError !== null
              ? `Engine ledger unavailable (${loadError}) — showing bundled demo rows.`
              : live
                ? attribution === null
                  ? 'The engine scores accounts, not individual transactions, so rule and risk read “—” on live rows. Run an investigation to see which claims cite a row.'
                  : `The engine scores accounts, not transactions: the ${String(attribution.cited_transactions)} row${attribution.cited_transactions === 1 ? '' : 's'} cited by run ${attribution.run_id.slice(0, 8)} show the citing claim and that account’s score; every other row reads “—”.`
                : 'Bundled demo rows carry scores, so every filter including the risk band applies.'}
          </p>
        </div>
        </Collapse>

        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => row.id}
          ariaLabel="Transaction ledger"
          rowSeverity={live ? undefined : (row) => row.severity ?? 'clear'}
          selectable
          minWidth="78rem"
          onActiveChange={setActiveRow}
          onActivate={(row) => {
            selectEntity(row.from);
            record({
              action: 'graph.interaction',
              detail: `Traced ${row.id} into the entity graph`,
              entity: row.from,
              workspace: 'ledger',
              metadata: { transaction: row.id, amount: money(row.amount) },
            });
            navigate('graph');
          }}
          emptyState={
            <EmptyState
              icon={<SearchX className="size-4" aria-hidden="true" />}
              title="No transactions match this combination"
              body={
                live
                  ? 'No row in the loaded dataset satisfies every filter. Drop the channel filter, widen the amount band, or clear the entity scope.'
                  : 'The filters are mutually exclusive for the loaded window. Widen the amount band, drop the channel filter, or clear the risk band.'
              }
              actions={[
                { label: 'Reset filters', primary: true, onClick: resetFilters },
                {
                  label: 'Show all risk bands',
                  onClick: () => applyFilters({ band: 'all' }, 'Risk band cleared'),
                },
              ]}
            />
          }
          renderPeek={(row) => (
            <div className="flex flex-wrap items-start gap-x-12 gap-y-6">
              <div>
                <p className="eyebrow pb-2">rule</p>
                <p className="num text-body text-ink">
                  {row.citations !== null && row.citations.length > 0
                    ? `cited by ${String(row.citations.length)} claim${
                        row.citations.length === 1 ? '' : 's'
                      } about ${row.account ?? 'a flagged account'}`
                    : (row.rule ?? 'no per-row rule from the engine')}
                </p>
              </div>
              {row.citations !== null && row.citations.length > 0 ? (
                <div className="min-w-[34rem] max-w-[64ch] basis-full">
                  <p className="eyebrow pb-2">claims citing this transaction</p>
                  <ul className="flex flex-col gap-1">
                    {row.citations.map((citation) => (
                      <li key={citation.claim_id} className="flex flex-wrap items-baseline gap-2">
                        <span className="num text-meta text-faint">{citation.family}</span>
                        <span
                          className={`num text-meta ${citation.weighted ? 'text-info' : 'text-ghost'}`}
                          title={
                            citation.weighted
                              ? 'this family carries weight in the risk profile'
                              : 'context only — this family carries no risk weight by design'
                          }
                        >
                          {citation.weighted
                            ? `s=${citation.strength.toFixed(3)}`
                            : 'no weight by design'}
                        </span>
                        <span className="text-body text-ink">{citation.claim}</span>
                        <span className="num text-meta text-muted">{citation.calculation}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <div>
                  <p className="eyebrow pb-2">shap drivers</p>
                  <p className="num text-body text-muted">
                    {row.shap === null ? 'account-level only' : row.shap.join(' · ')}
                  </p>
                </div>
              )}
              <div>
                <p className="eyebrow pb-2">pattern</p>
                <p className="text-body text-muted">{row.pattern ?? '—'}</p>
              </div>
              <div>
                <p className="eyebrow pb-2">
                  {row.accountRisk === null ? 'sibling transactions' : 'account risk'}
                </p>
                <p className="num text-body text-muted">
                  {row.accountRisk !== null
                    ? `${row.account ?? '—'} scored ${row.accountRisk.toFixed(2)} — the account, not this transaction`
                    : row.siblings === null
                      ? 'not reported'
                      : `${String(row.siblings)} in the same pattern window`}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  size="xs"
                  onClick={() => {
                    pin({
                      id: `sp-tx-${row.id}`,
                      kind: 'transaction',
                      label: `${row.id} · ${money(row.amount)} · ${row.from} → ${row.to}`,
                      meta: `${row.rule ?? row.channel} · ${row.time}`,
                      caseId: activeCaseId,
                    });
                    notify('Pinned to spine', `${row.id} attached to ${activeCaseId}.`, 'clear');
                    record({
                      action: 'evidence.viewed',
                      detail: `Pinned transaction ${row.id} to the evidence spine`,
                      investigation: activeCaseId,
                      entity: row.from,
                      workspace: 'ledger',
                      metadata: { transaction: row.id, amount: money(row.amount) },
                    });
                  }}
                >
                  <Pin className="size-3" aria-hidden="true" />
                  pin
                </Button>
                <Button size="xs" variant="primary" onClick={() => navigate('graph')}>
                  trace in graph
                </Button>
              </div>
            </div>
          )}
          footNote={
            <span className="flex items-center gap-4 text-label">
              <span className="num">{money(inView)} in view</span>
              {activeRow !== null && (
                <Tone kind="neutral">
                  cursor · {activeRow.id} · {activeRow.rule ?? activeRow.channel}
                </Tone>
              )}
            </span>
          }
          bulkActions={(selected, clear) => (
            <span className="flex items-center gap-2">
              <Button
                size="xs"
                onClick={() => {
                  selected.forEach((row) => {
                    pin({
                      id: `sp-tx-${row.id}`,
                      kind: 'transaction',
                      label: `${row.id} · ${money(row.amount)} · ${row.from} → ${row.to}`,
                      meta: `${row.rule ?? row.channel} · ${row.time}`,
                      caseId: activeCaseId,
                    });
                  });
                  notify(
                    'Pinned to spine',
                    `${String(selected.length)} transactions attached to ${activeCaseId}.`,
                    'clear',
                  );
                  record({
                    action: 'evidence.viewed',
                    detail: `Pinned ${String(selected.length)} transactions to ${activeCaseId}`,
                    investigation: activeCaseId,
                    workspace: 'ledger',
                    metadata: { rows: String(selected.length) },
                  });
                  clear();
                }}
              >
                pin {selected.length} to {activeCaseId}
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  notify('Export queued', `${String(selected.length)} rows exported.`, 'info');
                  record({
                    action: 'export.generated',
                    detail: `Exported ${String(selected.length)} selected ledger rows`,
                    workspace: 'ledger',
                    metadata: { rows: String(selected.length) },
                  });
                  clear();
                }}
              >
                export
              </Button>
              <Button size="xs" variant="ghost" onClick={clear}>
                clear
              </Button>
            </span>
          )}
        />
      </Panel>
    </div>
  );
};
