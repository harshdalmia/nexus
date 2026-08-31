import { useMemo, useState } from 'react';
import { Download, Eraser, ScrollText } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Segmented } from '@/components/primitives/Chip';
import { DataTable } from '@/components/primitives/DataTable';
import type { Column } from '@/components/primitives/DataTable';
import { EmptyState } from '@/components/primitives/EmptyState';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { SeverityTag, Tone } from '@/components/primitives/Severity';
import { auditLog } from '@/data/caseFile';
import { auditActionLabel, useAudit } from '@/store/auditStore';
import type { AuditEvent, AuditStatus } from '@/store/auditStore';
import { useDataSource } from '@/store/dataSourceStore';
import { useWorkspaceActions } from '@/store/workspaceStore';
import type { Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Two trails, one table.

   `session` is what this browser session actually did — recorded live
   into sessionStorage, newest first, and gone when the session ends.
   `system` is the seeded institutional log, which stands in for the
   durable server-side trail the backend does not yet keep.
   ------------------------------------------------------------------ */

type Source = 'session' | 'system';
type ActorFilter = 'all' | 'analyst' | 'agent';

const kindTone: Record<string, 'info' | 'model' | 'neutral'> = {
  query: 'model',
  scoring: 'model',
  model: 'model',
  evidence: 'info',
  filing: 'info',
  case: 'info',
  disposition: 'neutral',
  config: 'neutral',
  export: 'neutral',
};

/* Which audit actions read as agent work rather than analyst work. */
const AGENT_ACTIONS = new Set([
  'investigation.started',
  'investigation.completed',
  'investigation.failed',
  'report.generated',
]);

const statusSeverity: Record<AuditStatus, Severity> = {
  ok: 'clear',
  pending: 'review',
  blocked: 'review',
  failed: 'severe',
};

const statusLabel: Record<AuditStatus, string> = {
  ok: 'ok',
  pending: 'running',
  blocked: 'blocked',
  failed: 'failed',
};

const clockOf = (iso: string): string => {
  const at = new Date(iso);

  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const metadataText = (event: AuditEvent): string =>
  Object.entries(event.metadata)
    .map(([key, value]) => `${key}=${value}`)
    .join(' · ');

type SystemEntry = (typeof auditLog)[number];

export const AuditWorkspace = () => {
  const { notify } = useWorkspaceActions();
  const { events, record, clear } = useAudit();
  const { isDemo } = useDataSource();
  const [source, setSource] = useState<Source>('session');
  const [filter, setFilter] = useState<ActorFilter>('all');

  /* Events arrive newest first from the store; the filter never reorders them. */
  const sessionRows = useMemo(
    () =>
      events.filter((event) => {
        if (filter === 'agent') {
          return AGENT_ACTIONS.has(event.action);
        }

        if (filter === 'analyst') {
          return !AGENT_ACTIONS.has(event.action);
        }

        return true;
      }),
    [events, filter],
  );

  /* The institutional log is a seeded illustration — the engine keeps no such
     store — so it is held to the same rule as every other bundled figure. */
  const systemRows = useMemo(
    () =>
      (isDemo ? auditLog : []).filter((entry) => {
        if (filter === 'agent') {
          return entry.actor === 'agent' || entry.actor === 'system';
        }

        if (filter === 'analyst') {
          return entry.actor !== 'agent' && entry.actor !== 'system';
        }

        return true;
      }),
    [filter, isDemo],
  );

  const sessionColumns: ReadonlyArray<Column<AuditEvent>> = [
    {
      id: 'at',
      header: 'timestamp',
      width: '11%',
      sortValue: (row) => row.at,
      render: (row) => (
        <span className="num text-body text-ink" title={row.at}>
          {clockOf(row.at)}
        </span>
      ),
    },
    {
      id: 'action',
      header: 'action',
      width: '15%',
      sortValue: (row) => row.action,
      render: (row) => (
        <Tone kind={AGENT_ACTIONS.has(row.action) ? 'model' : 'info'}>
          {auditActionLabel[row.action]}
        </Tone>
      ),
    },
    {
      id: 'detail',
      header: 'detail',
      width: '30%',
      render: (row) => <span className="truncate text-body text-muted">{row.detail}</span>,
    },
    {
      id: 'investigation',
      header: 'investigation',
      width: '11%',
      sortValue: (row) => row.investigation ?? '',
      render: (row) => (
        <span className="num text-body text-ink">
          {row.investigation ?? <span className="text-ghost">—</span>}
        </span>
      ),
    },
    {
      id: 'entity',
      header: 'entity',
      width: '13%',
      render: (row) => (
        <span className="num truncate text-body text-muted">
          {row.entity ?? <span className="text-ghost">—</span>}
        </span>
      ),
    },
    {
      id: 'user',
      header: 'user',
      width: '10%',
      render: (row) => <span className="text-body text-muted">{row.user}</span>,
    },
    {
      id: 'status',
      header: 'status',
      width: '10%',
      align: 'right',
      sortValue: (row) => row.status,
      render: (row) => (
        <SeverityTag severity={statusSeverity[row.status]}>{statusLabel[row.status]}</SeverityTag>
      ),
    },
  ];

  const systemColumns: ReadonlyArray<Column<SystemEntry>> = [
    {
      id: 'time',
      header: 'timestamp',
      width: '15%',
      sortValue: (row) => row.time,
      render: (row) => <span className="num text-body text-ink">{row.time}</span>,
    },
    {
      id: 'actor',
      header: 'actor',
      width: '11%',
      sortValue: (row) => row.actor,
      render: (row) => (
        <span
          className={`text-body ${
            row.actor === 'agent' || row.actor === 'system'
              ? 'text-model'
              : row.actor === 'you'
                ? 'text-info'
                : 'text-muted'
          }`}
        >
          {row.actor}
        </span>
      ),
    },
    {
      id: 'kind',
      header: 'event',
      width: '12%',
      render: (row) => <Tone kind={kindTone[row.kind] ?? 'neutral'}>{row.kind}</Tone>,
    },
    {
      id: 'detail',
      header: 'detail',
      width: '39%',
      render: (row) => <span className="truncate text-body text-muted">{row.detail}</span>,
    },
    {
      id: 'meta',
      header: 'provenance',
      width: '23%',
      align: 'right',
      render: (row) => <span className="num text-body text-faint">{row.meta}</span>,
    },
  ];

  const exportLog = () => {
    notify(
      'Audit export queued',
      source === 'session'
        ? `${String(sessionRows.length)} session events exported.`
        : 'Immutable log exported for the supervisory file.',
      'info',
    );
    record({
      action: 'export.generated',
      detail: `Audit trail exported · ${source} view`,
      workspace: 'audit',
      metadata: {
        view: source,
        rows: String(source === 'session' ? sessionRows.length : systemRows.length),
      },
    });
  };

  return (
    <Panel collapseId="audit.detail" className="border-0">
      <PanelHead
        title="audit trail"
        meta={
          <span className="truncate text-label text-faint">
            {source === 'session'
              ? `this browser session · ${String(events.length)} events · held in session storage, cleared when the session ends`
              : isDemo
                ? 'seeded institutional log · demo data · every query, tool run, disposition and export'
                : 'no institutional log — the engine keeps none'}
          </span>
        }
        actions={
          <>
            <Segmented
              label="Trail source"
              value={source}
              onChange={setSource}
              options={[
                { id: 'session', label: 'this session' },
                { id: 'system', label: 'system log' },
              ]}
            />
            <Segmented
              label="Actor filter"
              value={filter}
              onChange={setFilter}
              options={[
                { id: 'all', label: 'all' },
                { id: 'analyst', label: 'analyst' },
                { id: 'agent', label: 'agent' },
              ]}
            />
            {source === 'session' && (
              <Button
                size="xs"
                variant="ghost"
                disabled={events.length === 0}
                onClick={() => {
                  clear();
                  notify('Session trail cleared', 'Only this browser session was affected.', 'info');
                }}
              >
                <Eraser className="size-3.5" aria-hidden="true" />
                clear
              </Button>
            )}
            <Button size="xs" variant="ghost" onClick={exportLog}>
              <Download className="size-3.5" aria-hidden="true" />
              export log
            </Button>
          </>
        }
      />

      {source === 'session' ? (
        <DataTable
          rows={sessionRows}
          columns={sessionColumns}
          rowKey={(row) => row.id}
          ariaLabel="Session audit trail"
          minWidth="76rem"
          rowSeverity={(row) => statusSeverity[row.status]}
          renderPeek={(row) => (
            <div className="flex flex-wrap items-start gap-x-12 gap-y-6">
              <div className="max-w-[52ch]">
                <p className="eyebrow pb-2">event</p>
                <p className="text-body leading-relaxed text-muted">{row.detail}</p>
              </div>
              <div>
                <p className="eyebrow pb-2">recorded</p>
                <p className="num text-body text-muted">{row.at}</p>
              </div>
              <div>
                <p className="eyebrow pb-2">user</p>
                <p className="text-body text-muted">
                  {row.user} · {row.role}
                </p>
              </div>
              <div>
                <p className="eyebrow pb-2">workspace</p>
                <p className="text-body text-muted">{row.workspace ?? '—'}</p>
              </div>
              <div className="max-w-[52ch]">
                <p className="eyebrow pb-2">metadata</p>
                <p className="num text-body text-muted">
                  {metadataText(row) === '' ? 'none recorded' : metadataText(row)}
                </p>
              </div>
            </div>
          )}
          footNote={
            <span className="text-label">
              <span className="num">{sessionRows.length}</span> of{' '}
              <span className="num">{events.length}</span> session events · newest first · session
              storage only, never localStorage
            </span>
          }
        />
      ) : (
        <DataTable
          rows={systemRows}
          columns={systemColumns}
          rowKey={(row) => row.id}
          ariaLabel="System audit trail"
          minWidth="66rem"
          emptyState={
            <EmptyState
              icon={<ScrollText className="size-4" aria-hidden="true" />}
              title="No institutional log"
              body="The engine records per-run audit receipts, not a standing append-only register, so there is nothing to list here. The seeded example is shown only when the app is running on demo data."
              actions={[
                { label: 'Show this session', primary: true, onClick: () => setSource('session') },
              ]}
            />
          }
          renderPeek={(row) => (
            <div className="flex flex-wrap items-start gap-x-12 gap-y-6">
              <div className="max-w-[52ch]">
                <p className="eyebrow pb-2">event</p>
                <p className="text-body leading-relaxed text-muted">{row.detail}</p>
              </div>
              <div>
                <p className="eyebrow pb-2">provenance</p>
                <p className="num text-body text-muted">{row.meta}</p>
              </div>
              <div>
                <p className="eyebrow pb-2">retention</p>
                <p className="text-body text-muted">append-only · hash-chained · 7 years</p>
              </div>
            </div>
          )}
          footNote={
            <span className="num text-label">
              {systemRows.length} entries · append-only · agent and analyst actions carry equal
              weight
            </span>
          }
        />
      )}
    </Panel>
  );
};
