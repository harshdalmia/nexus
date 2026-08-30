import { useEffect, useMemo, useState } from 'react';
import { Banknote, BrainCircuit, FileSignature, Landmark, Pin, Siren, StickyNote, Waves } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SourcePending } from '@/components/primitives/DataState';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { Segmented } from '@/components/primitives/Chip';
import { caseTimeline } from '@/data/caseFile';
import { ApiError } from '@/lib/api/client';
import { api } from '@/lib/api';
import type { EntityTimelineDto } from '@/lib/api/types';
import { money } from '@/lib/format';
import { useAudit } from '@/store/auditStore';
import type { AuditEvent } from '@/store/auditStore';
import { caseViews, useCases } from '@/store/caseStore';
import { useDataSource } from '@/store/dataSourceStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import type { Severity, TimelineEvent, TimelineKind } from '@/types/aml';

/* ------------------------------------------------------------------
   The case timeline, built from what actually happened.

   For a live case the money lanes are the subject's own ledger history
   from the engine, and the analyst lanes are the audit events this
   session recorded against the case. Demo cases keep the bundled
   narrative so the workspace still reads without a backend.
   ------------------------------------------------------------------ */

const kindIcon: Record<TimelineKind, LucideIcon> = {
  account: Landmark,
  deposit: Banknote,
  wire: Waves,
  model: BrainCircuit,
  note: StickyNote,
  sar: FileSignature,
  alert: Siren,
};

const laneOrder: readonly TimelineKind[] = ['account', 'deposit', 'wire', 'alert', 'model', 'note', 'sar'];

const laneLabel: Record<TimelineKind, string> = {
  account: 'accounts',
  deposit: 'deposits',
  wire: 'wires',
  alert: 'rules',
  model: 'model',
  note: 'analyst',
  sar: 'filing',
};

const severityDot = {
  severe: 'bg-sev border-sev',
  review: 'bg-rev border-rev',
  clear: 'bg-ok border-ok',
} as const;

type LaneFilter = 'all' | 'flags' | 'money';

/** Which lane an audit action belongs in. */
const auditLane: Record<string, TimelineKind> = {
  'investigation.started': 'model',
  'investigation.completed': 'model',
  'investigation.failed': 'model',
  'report.generated': 'sar',
  'risk.reviewed': 'alert',
  'case.opened': 'account',
  'case.closed': 'note',
  'evidence.viewed': 'note',
  'entity.selected': 'note',
  'timeline.expanded': 'note',
  'graph.interaction': 'note',
  'filter.changed': 'note',
  'export.generated': 'sar',
  'scope.changed': 'note',
  'session.started': 'account',
};

const dayOf = (iso: string, first: number, span: number): number => {
  const at = new Date(iso).getTime();

  if (Number.isNaN(at) || span <= 0) {
    return 1;
  }

  return Math.min(span, Math.max(1, Math.floor((at - first) / 86_400_000) + 1));
};

/** Ledger events + this session's audit events for the case, on one day axis. */
const liveEvents = (
  timeline: EntityTimelineDto,
  events: readonly AuditEvent[],
  caseId: string,
): { readonly events: readonly TimelineEvent[]; readonly days: number } => {
  const span = Math.max(timeline.span_days, 1);
  const firstMs = timeline.first_seen === null ? Date.now() : new Date(timeline.first_seen).getTime();

  const ledger: TimelineEvent[] = timeline.events.map((event) => {
    /* Severity here describes the transaction's own shape, not a model score: the
       engine does not score individual transactions. */
    const severity: Severity =
      event.amount >= 9_000 && event.amount < 10_000
        ? 'severe'
        : event.labelled
          ? 'review'
          : 'clear';

    return {
      id: `tx-${String(event.tx_id)}`,
      day: Math.min(span, Math.max(1, event.day)),
      kind: event.kind === 'deposit' ? 'deposit' : 'wire',
      label:
        event.direction === 'in'
          ? `${event.payment_format || 'transfer'} in from ${event.counterparty}`
          : `${event.payment_format || 'transfer'} out to ${event.counterparty}`,
      detail:
        `${money(event.amount)} ${event.currency} · ${event.payment_format || 'unspecified channel'}` +
        ` · ${event.at.replace('T', ' ').slice(0, 16)}` +
        (event.labelled ? ' · labelled in the dataset' : ''),
      severity,
      amount: money(event.amount),
    };
  });

  const trail: TimelineEvent[] = events
    .filter((event) => event.investigation === caseId)
    .map((event) => ({
      id: event.id,
      day: dayOf(event.at, firstMs, span),
      kind: auditLane[event.action] ?? 'note',
      label: event.detail,
      detail:
        `${event.user} · ${event.role} · ${event.at.replace('T', ' ').slice(0, 19)}` +
        (Object.keys(event.metadata).length > 0
          ? ` · ${Object.entries(event.metadata)
              .map(([key, value]) => `${key}=${value}`)
              .join(' ')}`
          : ''),
      severity: event.status === 'ok' ? 'clear' : event.status === 'failed' ? 'severe' : 'review',
    }));

  return { events: [...ledger, ...trail], days: span };
};

export const CaseTimeline = () => {
  const { pin, notify } = useWorkspaceActions();
  const { activeCaseId } = useWorkspaceState();
  const { cases } = useCases();
  const { isDemo } = useDataSource();
  const { events: auditEvents, record } = useAudit();

  const [filter, setFilter] = useState<LaneFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<EntityTimelineDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const view = caseViews(cases, isDemo).find((item) => item.id === activeCaseId);
  const subject = view?.session?.entity ?? null;

  /* A real case whose timeline has not arrived yet. The bundled timeline is the
     fallback for a demo case or a failed fetch — not for a request in flight, so
     the lanes hold a placeholder until the engine answers. */
  const pending = subject !== null && timeline === null && error === null;

  useEffect(() => {
    if (subject === null) {
      setTimeline(null);

      return undefined;
    }

    let cancelled = false;

    api
      .getEntityTimeline(subject, { limit: 300 })
      .then((response) => {
        if (!cancelled) {
          setTimeline(response.data);
          setError(null);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setTimeline(null);
          setError(cause instanceof ApiError ? cause.message : String(cause));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [subject]);

  const { events, days } = useMemo(() => {
    if (timeline !== null) {
      return liveEvents(timeline, auditEvents, activeCaseId);
    }

    return { events: caseTimeline, days: 30 };
  }, [timeline, auditEvents, activeCaseId]);

  const [cursor, setCursor] = useState(days);

  /* A new subject means a new axis, so the cursor returns to the end of it. */
  useEffect(() => {
    setCursor(days);
    setSelectedId(null);
  }, [days, subject]);

  const lanes = useMemo(() => {
    const visibleKinds =
      filter === 'flags'
        ? (['alert', 'model', 'sar'] as const)
        : filter === 'money'
          ? (['deposit', 'wire'] as const)
          : laneOrder;

    return laneOrder
      .filter((kind) => (visibleKinds as readonly TimelineKind[]).includes(kind))
      .map((kind) => ({ kind, events: events.filter((event) => event.kind === kind) }))
      .filter((lane) => lane.events.length > 0);
  }, [filter, events]);

  const selected =
    events.find((event) => event.id === selectedId) ??
    /* Default to the latest event, which is what an analyst returning to a case wants. */
    events[events.length - 1] ??
    caseTimeline[0];

  const expand = (event: TimelineEvent) => {
    setSelectedId(event.id);
    record({
      action: 'timeline.expanded',
      detail: `Case timeline day ${String(event.day)} expanded · ${event.label}`,
      investigation: activeCaseId,
      ...(subject === null ? {} : { entity: subject }),
      workspace: 'cases',
      metadata: { day: String(event.day), kind: event.kind },
    });
  };

  return (
    <Panel collapseId="cases.timeline" className="min-h-0 flex-1 border-0">
      <PanelHead
        title="evidence timeline"
        meta={
          <span className="truncate text-label text-faint">
            {timeline !== null
              ? `${subject ?? ''} · ${String(events.length)} events over ${String(days)} days` +
                (timeline.truncated ? ' · truncated' : '')
              : error !== null
                ? `engine timeline unavailable (${error}) — showing the demo case`
                : pending
                  ? `resolving ${subject ?? 'the subject'}'s timeline…`
                  : `demo case · day 1 → ${String(days)}`}
          </span>
        }
        summary={
          <span className="truncate text-label text-faint">
            folded · {String(events.length)} events over {String(days)} days
          </span>
        }
        actions={
          <Segmented
            label="Timeline lanes"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'all' },
              { id: 'money', label: 'money' },
              { id: 'flags', label: 'flags' },
            ]}
          />
        }
      />

      {pending ? (
        <SourcePending label={`loading ${subject ?? 'the subject'}'s timeline from the engine`} />
      ) : (
      <div className="min-h-0 flex-1 overflow-hidden px-6 py-4.5">
        <div className="relative">
          <div className="flex flex-col gap-[3px]">
            {lanes.map((lane) => (
              <div key={lane.kind} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-right text-meta text-faint">
                  {laneLabel[lane.kind]}
                </span>
                <div className="relative h-4 flex-1 border-b border-line/60">
                  {lane.events.map((event) => {
                    const isPast = event.day <= cursor;
                    const isSelected = event.id === selected.id;

                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => expand(event)}
                        aria-label={`Day ${String(event.day)}: ${event.label}`}
                        title={`Day ${String(event.day)} · ${event.label}`}
                        className={`absolute top-1/2 grid size-3 -translate-x-1/2 -translate-y-1/2 place-items-center border transition-all duration-150 ${
                          severityDot[event.severity]
                        } ${isPast ? 'opacity-100' : 'opacity-25'} ${
                          isSelected ? 'scale-[1.5] ring-1 ring-info ring-offset-1 ring-offset-[var(--s-panel)]' : ''
                        }`}
                        style={{ left: `${String((event.day / days) * 100)}%` }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-16 border-l border-info/70"
            style={{ left: `calc(4rem + ${String((cursor / days) * 100)}% * 0.94)` }}
          />
        </div>

        <div className="mt-2 flex items-center gap-2 pl-16">
          <input
            type="range"
            min={1}
            max={days}
            value={Math.min(cursor, days)}
            onChange={(event) => setCursor(Number(event.target.value))}
            aria-label="Timeline cursor, day of the review period"
            className="scrub flex-1"
          />
          <span className="num w-14 shrink-0 text-right text-meta text-info">day {cursor}</span>
        </div>

        <article className="mt-2 flex flex-wrap items-start gap-3 rounded-[2px] border border-line bg-raise px-6 py-4.5 shadow-[var(--elev-1)]">
          {(() => {
            const Icon = kindIcon[selected.kind];

            return <Icon className="mt-0.5 size-3.5 shrink-0 text-info" aria-hidden="true" />;
          })()}
          <div className="min-w-[18rem] flex-1">
            <p className="flex items-baseline gap-2">
              <span className="num text-meta text-faint">day {selected.day}</span>
              <span className="text-body font-semibold text-ink">{selected.label}</span>
              {selected.amount !== undefined && (
                <span className="num text-label text-sev">{selected.amount}</span>
              )}
            </p>
            <p className="max-w-[92ch] pt-1 text-label leading-relaxed text-muted">{selected.detail}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              pin({
                id: `sp-tl-${selected.id}`,
                kind: selected.kind === 'note' ? 'note' : 'transaction',
                label: `${selected.label} · day ${String(selected.day)}`,
                meta: selected.detail,
                caseId: activeCaseId,
              });
              notify('Pinned to spine', 'Timeline event added in chronological position.', 'clear');
            }}
            className="flex h-[26px] shrink-0 items-center gap-1.5 border border-line px-2 text-label text-muted transition-colors hover:border-info-line hover:text-info"
          >
            <Pin className="size-3" aria-hidden="true" />
            pin event
          </button>
        </article>
      </div>
      )}
    </Panel>
  );
};
