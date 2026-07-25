import { useMemo, useState } from 'react';
import { Check, Inbox, Pin, X } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { DataTable } from '@/components/primitives/DataTable';
import type { Column } from '@/components/primitives/DataTable';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { ScoreValue, SeverityTag } from '@/components/primitives/Severity';
import { Segmented } from '@/components/primitives/Chip';
import { useAudit } from '@/store/auditStore';
import { caseViews, useCases } from '@/store/caseStore';
import type { CaseStage, CaseView } from '@/store/caseStore';
import { useWorkspaceActions } from '@/store/workspaceStore';

/* ------------------------------------------------------------------
   The triage queue.

   The engine keeps no standing alert queue — it answers questions — so
   the queue is every case this session has opened from a real
   investigation, ordered by the risk the engine assigned. Until a query
   has been run it shows the bundled demo queue and says so.

   There is no assignee and no SLA clock in the stack, so the queue
   filters by escalation band instead of by owner.
   ------------------------------------------------------------------ */

type QueueFilter = 'all' | 'report' | 'review';

const stageLabel: Record<CaseStage, string> = {
  triage: 'triage',
  investigating: 'investigating',
  'sar-draft': 'SAR draft',
  filed: 'filed',
};

export const AlertQueue = () => {
  const [filter, setFilter] = useState<QueueFilter>('all');
  const { openCase, notify, pin } = useWorkspaceActions();
  const { record } = useAudit();
  const { cases } = useCases();

  const live = cases.length > 0;
  const views = useMemo(() => caseViews(cases), [cases]);

  const rows = useMemo(() => {
    const filtered = views.filter((view) => {
      if (filter === 'report') {
        return view.session?.escalation === 'report' || view.stage === 'sar-draft';
      }

      if (filter === 'review') {
        return view.session?.escalation === 'review' || view.stage === 'investigating';
      }

      return true;
    });

    /* Ordered by the engine's own score. Without an SLA clock there is nothing
       else to weight it against. */
    return [...filtered].sort((a, b) => b.score - a.score);
  }, [views, filter]);

  const severeCount = rows.filter((row) => row.severity === 'severe').length;

  const columns: ReadonlyArray<Column<CaseView>> = [
    {
      id: 'case',
      header: 'case',
      width: '19%',
      sortValue: (row) => row.id,
      render: (row) => (
        <span className="flex items-baseline gap-2">
          <span className="ident text-body-lg font-medium text-ink">{row.id}</span>
          <span className="num truncate text-faint">{row.entity}</span>
        </span>
      ),
    },
    {
      id: 'subject',
      header: 'subject',
      width: '25%',
      sortValue: (row) => row.name,
      render: (row) => <span className="truncate text-body-lg text-ink">{row.name}</span>,
    },
    {
      id: 'pattern',
      header: 'pattern',
      width: '20%',
      render: (row) => <span className="truncate text-body">{row.pattern}</span>,
    },
    {
      id: 'stage',
      header: 'stage',
      width: '13%',
      render: (row) => <span className="text-body text-muted">{stageLabel[row.stage]}</span>,
    },
    {
      id: 'opened',
      header: 'opened',
      align: 'right',
      width: '12%',
      sortValue: (row) => row.opened,
      render: (row) => <span className="num text-body text-muted">{row.opened}</span>,
    },
    {
      id: 'score',
      header: 'risk',
      align: 'right',
      width: '11%',
      sortValue: (row) => row.score,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <SeverityTag severity={row.severity} />
          <ScoreValue score={row.score} />
        </span>
      ),
    },
  ];

  return (
    <Panel className="hair-b min-h-0 flex-[3] border-0">
      <PanelHead
        title="triage queue"
        meta={
          <span className="truncate text-label text-faint">
            {live
              ? `${String(rows.length)} case(s) opened this session · ordered by engine risk`
              : `${String(rows.length)} demo cases · run a query in Ask to fill the queue`}
          </span>
        }
        actions={
          <Segmented
            label="Queue filter"
            value={filter}
            onChange={setFilter}
            options={[
              { id: 'all', label: 'all' },
              { id: 'report', label: 'report' },
              { id: 'review', label: 'review' },
            ]}
          />
        }
      />

      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(row) => row.id}
        ariaLabel="Case triage queue"
        rowSeverity={(row) => row.severity}
        selectable
        minWidth="58rem"
        onActivate={(row) => openCase(row.id)}
        emptyState={
          <EmptyState
            icon={<Inbox className="size-4" aria-hidden="true" />}
            title="Queue clear for this filter"
            body="Nothing sits in this band. The engine builds the queue from investigations you run, so asking a question in Ask is what fills it."
            actions={[{ label: 'Show every band', primary: true, onClick: () => setFilter('all') }]}
          />
        }
        renderPeek={(row) => (
          <div className="flex flex-wrap items-start gap-x-10 gap-y-3">
            <div>
              <p className="eyebrow pb-1">exposure</p>
              <p className="num text-body text-ink">{row.exposure}</p>
            </div>
            <div>
              <p className="eyebrow pb-1">opened</p>
              <p className="num text-body text-muted">{row.opened}</p>
            </div>
            <div>
              <p className="eyebrow pb-1">escalation</p>
              <p className="text-body text-muted">{row.session?.escalation ?? stageLabel[row.stage]}</p>
            </div>
            <div className="max-w-[46ch]">
              <p className="eyebrow pb-1">agent summary</p>
              <p className="text-body leading-relaxed text-muted">
                {row.session
                  ? `${row.session.evidenceCount} evidence record(s) over ${row.session.transactionCount.toLocaleString('en-US')} transactions, from “${row.session.query}”.`
                  : `${row.pattern} detected on entity ${row.entity}. Score ${String(row.score)} with ${
                      row.severity === 'severe' ? 'multiple concurring rules' : 'a single-signal hit'
                    }.`}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                size="xs"
                onClick={() => {
                  pin({
                    id: `sp-case-${row.id}`,
                    kind: 'entity',
                    label: `${row.id} · ${row.name}`,
                    meta: `${row.pattern} · score ${String(row.score)}`,
                    caseId: row.id,
                  });
                  notify('Pinned to spine', `${row.id} attached as evidence.`, 'clear');
                }}
              >
                <Pin className="size-3" aria-hidden="true" />
                pin
              </Button>
              <Button
                size="xs"
                variant="danger"
                onClick={() => {
                  notify(
                    'Escalated',
                    `${row.id} sent to L3 with the current evidence spine.`,
                    'severe',
                  );
                  record({
                    action: 'risk.reviewed',
                    detail: `${row.id} escalated to L3 at score ${String(row.score)}`,
                    investigation: row.id,
                    entity: row.entity,
                    workspace: 'watchtower',
                    metadata: {
                      disposition: 'escalated',
                      score: String(row.score),
                      pattern: row.pattern,
                    },
                  });
                }}
              >
                <Check className="size-3" aria-hidden="true" />
                escalate
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  notify(
                    'Disposition recorded',
                    `${row.id} dismissed — reason required in audit trail.`,
                    'info',
                  );
                  record({
                    action: 'case.closed',
                    detail: `${row.id} dismissed at triage · ${row.name}`,
                    investigation: row.id,
                    entity: row.entity,
                    status: 'blocked',
                    workspace: 'watchtower',
                    metadata: {
                      disposition: 'dismissed',
                      score: String(row.score),
                      pattern: row.pattern,
                    },
                  });
                }}
              >
                <X className="size-3" aria-hidden="true" />
                dismiss
              </Button>
              <Button size="xs" variant="primary" onClick={() => openCase(row.id)}>
                open case
              </Button>
            </div>
          </div>
        )}
        bulkActions={(selected, clear) => (
          <span className="flex items-center gap-2">
            <Button
              size="xs"
              onClick={() => {
                selected.forEach((row) => {
                  pin({
                    id: `sp-case-${row.id}`,
                    kind: 'entity',
                    label: `${row.id} · ${row.name}`,
                    meta: `${row.pattern} · score ${String(row.score)}`,
                    caseId: row.id,
                  });
                });
                notify(
                  'Pinned to spine',
                  `${String(selected.length)} case(s) attached as evidence.`,
                  'clear',
                );
                clear();
              }}
            >
              pin {selected.length}
            </Button>
            <Button
              size="xs"
              variant="danger"
              onClick={() => {
                notify('Escalated', `${String(selected.length)} cases escalated to L3.`, 'severe');
                record({
                  action: 'risk.reviewed',
                  detail: `${String(selected.length)} cases escalated to L3 from the queue`,
                  workspace: 'watchtower',
                  metadata: { disposition: 'escalated', cases: String(selected.length) },
                });
                clear();
              }}
            >
              escalate
            </Button>
            <Button size="xs" variant="ghost" onClick={clear}>
              clear selection
            </Button>
          </span>
        )}
        footNote={
          <span className="num text-label">
            {rows.length} in view · {severeCount} severe ·{' '}
            {live ? 'built from this session’s investigations' : 'bundled demo queue'}
          </span>
        }
      />
    </Panel>
  );
};
