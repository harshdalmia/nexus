import { useState } from 'react';
import { Download, FileSignature, Pin, Send } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { DataTable } from '@/components/primitives/DataTable';
import type { Column } from '@/components/primitives/DataTable';
import { ScoreValue, SeverityTag, Tone } from '@/components/primitives/Severity';
import { EntityGraph } from '@/components/viz/EntityGraph';
import { caseTimeline } from '@/data/caseFile';
import { useLiveGraph } from '@/hooks/useLiveGraph';
import { useRunReport } from '@/hooks/useRunReport';
import { api } from '@/lib/api';
import { useAgent } from '@/store/agentStore';
import { useAudit } from '@/store/auditStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import { severityOfLevel } from '@/types/aml';
import type { FindingRow, Scenario, TimelineEvent } from '@/types/aml';

/** Byte sizes come from the API, so they are formatted rather than invented. */
const artifactBytes = (value: number): string => {
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

/* ---------------------------- executive summary ---------------------------- */

export const SummaryBlock = ({ scenario }: { readonly scenario: Scenario }) => {
  const { query, totalMs, ranCount, skippedCount, failedCount } = useAgent();
  const metric = scenario.headlineMetric;

  return (
    <div className="grid gap-0 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <div
        className={`hair-r flex flex-col justify-center px-6 py-5 ${
          metric.severity === 'severe'
            ? 'bg-sev-bg/30'
            : metric.severity === 'review'
              ? 'bg-rev-bg/25'
              : 'bg-raise/40'
        }`}
      >
        <p className="eyebrow pb-2">{metric.label}</p>
        <p
          className={`metric text-display ${
            metric.severity === 'severe' ? 'text-sev' : metric.severity === 'review' ? 'text-rev' : 'text-ink'
          }`}
        >
          {metric.value}
        </p>
        <p className="pt-1 text-meta text-faint">
          {(totalMs / 1000).toFixed(1)}s · {ranCount} tools invoked · {skippedCount} declined
          {failedCount > 0 && ` · ${String(failedCount)} degraded`}
        </p>
      </div>

      <div className="flex flex-col gap-3 px-6 py-5">
        <p className="max-w-[64ch] text-section leading-tight text-ink">{scenario.resultHeadline}</p>
        <p className="max-w-[86ch] text-label leading-relaxed text-muted">
          Answering “{query}”. {scenario.plannerNote}
        </p>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          {scenario.summary.map((stat) => (
            <div key={stat.label}>
              <dt className="eyebrow">{stat.label}</dt>
              <dd
                className={`metric text-metric ${
                  stat.severity === 'severe'
                    ? 'text-sev'
                    : stat.severity === 'review'
                      ? 'text-rev'
                      : stat.severity === 'clear'
                        ? 'text-ok'
                        : 'text-ink'
                }`}
              >
                {stat.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
};

/* ------------------------------ evidence table ------------------------------ */

export const EvidenceBlock = ({ scenario }: { readonly scenario: Scenario }) => {
  const { revealedRows, phase } = useAgent();
  const { pin, notify, selectEntity, navigate } = useWorkspaceActions();
  const { activeCaseId } = useWorkspaceState();
  const rows = phase === 'complete' ? scenario.rows : scenario.rows.slice(0, revealedRows);

  const columns: ReadonlyArray<Column<FindingRow>> = [
    {
      id: 'entity',
      header: scenario.columns[0] ?? 'entity',
      width: '26%',
      sortValue: (row) => row.entity,
      render: (row) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="ident shrink-0 text-body-lg font-medium text-ink">{row.entity}</span>
          <span className="truncate text-muted">{row.name}</span>
        </span>
      ),
    },
    {
      id: 'primary',
      header: scenario.columns[1] ?? '',
      align: 'right',
      width: '14%',
      sortValue: (row) => Number.parseFloat(row.primary.replace(/[^0-9.]/g, '')) || 0,
      render: (row) => <span className="num text-ink">{row.primary}</span>,
    },
    {
      id: 'secondary',
      header: scenario.columns[2] ?? '',
      align: 'right',
      width: '16%',
      render: (row) => <span className="num">{row.secondary}</span>,
    },
    {
      id: 'pattern',
      header: scenario.columns[3] ?? '',
      width: '26%',
      render: (row) => <span className="truncate">{row.pattern}</span>,
    },
    {
      id: 'score',
      header: scenario.columns[4] ?? 'risk',
      align: 'right',
      width: '14%',
      sortValue: (row) => row.score,
      render: (row) => (
        <span className="inline-flex items-center gap-2">
          <SeverityTag severity={severityOfLevel(row.level)} />
          <ScoreValue score={row.score} />
        </span>
      ),
    },
  ];

  return (
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      ariaLabel="Investigation findings"
      rowSeverity={(row) => severityOfLevel(row.level)}
      minWidth="52rem"
      onActivate={(row) => {
        selectEntity(row.entity);
        navigate('graph');
      }}
      renderPeek={(row) => (
        <div className="flex flex-wrap items-start gap-x-8 gap-y-2">
          <div>
            <p className="eyebrow pb-2">pattern</p>
            <p className="text-label text-muted">{row.pattern}</p>
          </div>
          <div>
            <p className="eyebrow pb-2">measures</p>
            <p className="num text-label text-muted">
              {row.primary} · {row.secondary}
            </p>
          </div>
          <div>
            <p className="eyebrow pb-2">disposition</p>
            <p className="text-label text-muted">
              {row.score >= 75
                ? 'report — multiple rules concur'
                : row.score >= 40
                  ? 'review — single-signal hit'
                  : 'monitor — below alerting band'}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="xs"
              onClick={() => {
                pin({
                  id: `sp-find-${row.id}`,
                  kind: 'entity',
                  label: `${row.entity} · ${row.name}`,
                  meta: `${row.pattern} · score ${String(row.score)}`,
                  caseId: activeCaseId,
                });
                notify('Pinned to spine', `${row.entity} attached to ${activeCaseId}.`, 'clear');
              }}
            >
              <Pin className="size-2.5" aria-hidden="true" />
              pin
            </Button>
            <Button
              size="xs"
              variant="primary"
              onClick={() => {
                selectEntity(row.entity);
                navigate('graph');
              }}
            >
              open graph
            </Button>
          </div>
        </div>
      )}
      footNote={
        <span className="num">
          {rows.length} of {scenario.rows.length} findings
        </span>
      }
    />
  );
};

/* ------------------------------ entity graph ------------------------------ */

export const GraphBlock = ({ note }: { readonly note?: string }) => {
  const { selectedEntityId } = useWorkspaceState();
  const { selectEntity, navigate } = useWorkspaceActions();
  const { scenario } = useAgent();
  /* On a live run the graph tile shows the engine's network for the top finding
     rather than the bundled one. */
  const subject = scenario?.live === true ? (scenario.rows[0]?.entity ?? selectedEntityId) : selectedEntityId;
  const { graph } = useLiveGraph(subject, scenario?.live === true);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EntityGraph
        selectedId={graph === null ? selectedEntityId : subject}
        onSelect={selectEntity}
        expanded={false}
        focusNeighbours={false}
        compact
        {...(graph === null ? {} : { nodes: graph.nodes, edges: graph.edges })}
      />
      <div className="hair-t flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-meta text-faint">
        <span>
          {graph === null
            ? 'shape encodes entity type · size encodes centrality'
            : `engine network · ${String(graph.nodes.length)} entities · size encodes degree share`}
        </span>
        {note !== undefined && <span className="text-rev">{note}</span>}
        <button
          type="button"
          onClick={() => navigate('graph')}
          className="ml-auto text-info underline decoration-dotted hover:text-ink"
        >
          open full canvas
        </button>
      </div>
    </div>
  );
};

/* ------------------------------ timeline ------------------------------ */

const laneTone = {
  severe: 'bg-sev border-sev',
  review: 'bg-rev border-rev',
  clear: 'bg-ok border-ok',
} as const;

export const TimelineBlock = () => {
  const [selected, setSelected] = useState<TimelineEvent>(caseTimeline[10]);
  const { pin, notify } = useWorkspaceActions();
  const { activeCaseId } = useWorkspaceState();
  const { record } = useAudit();

  /* Opening an event on the timeline is an inspection step, so it is recorded
     with the day and event it exposed. */
  const expand = (event: TimelineEvent) => {
    setSelected(event);
    record({
      action: 'timeline.expanded',
      detail: `Timeline day ${String(event.day)} expanded · ${event.label}`,
      investigation: activeCaseId,
      workspace: 'ask',
      metadata: {
        day: String(event.day),
        kind: event.kind,
        ...(event.amount === undefined ? {} : { amount: event.amount }),
      },
    });
  };
  const lanes = ['deposit', 'wire', 'alert', 'model', 'account', 'note', 'sar'] as const;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-6 py-5">
      <div className="flex flex-col gap-[3px]">
        {lanes.map((lane) => {
          const events = caseTimeline.filter((event) => event.kind === lane);

          if (events.length === 0) {
            return null;
          }

          return (
            <div key={lane} className="flex items-center gap-2">
              <span className="w-12 shrink-0 text-right text-meta text-faint">{lane}</span>
              <div className="relative h-3.5 flex-1 border-b border-line/60">
                {events.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => expand(event)}
                    aria-label={`Day ${String(event.day)}: ${event.label}`}
                    title={`day ${String(event.day)} · ${event.label}`}
                    className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 border transition-transform duration-150 hover:scale-150 ${
                      laneTone[event.severity]
                    } ${selected.id === event.id ? 'scale-[1.6] ring-1 ring-info ring-offset-1 ring-offset-[var(--s-panel)]' : ''}`}
                    style={{ left: `${String((event.day / 30) * 100)}%` }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 pl-14">
        {[1, 8, 15, 22, 30].map((day) => (
          <span key={day} className="num flex-1 text-meta text-faint">
            day {day}
          </span>
        ))}
      </div>

      <article className="mt-auto flex flex-wrap items-start gap-3 rounded-[2px] border border-line bg-raise px-6 py-4.5 shadow-[var(--elev-1)]">
        <div className="min-w-[16rem] flex-1">
          <p className="flex items-baseline gap-2">
            <span className="num text-meta text-faint">day {selected.day}</span>
            <span className="text-xs2 font-semibold text-ink">{selected.label}</span>
            {selected.amount !== undefined && (
              <span className="num text-label text-sev">{selected.amount}</span>
            )}
          </p>
          <p className="max-w-[90ch] pt-1 text-label leading-relaxed text-muted">{selected.detail}</p>
        </div>
        <Button
          size="xs"
          onClick={() => {
            pin({
              id: `sp-tl-${selected.id}`,
              kind: 'transaction',
              label: `${selected.label} · day ${String(selected.day)}`,
              meta: selected.detail,
              caseId: activeCaseId,
            });
            notify('Pinned to spine', 'Timeline event added in chronological position.', 'clear');
          }}
        >
          <Pin className="size-2.5" aria-hidden="true" />
          pin event
        </Button>
      </article>
    </div>
  );
};

/* ------------------------------ SAR + downloads ------------------------------ */

/* Both blocks below read the engine's own draft report. They previously rendered a
   fixture: hardcoded paragraph text, invented artefact names and invented byte sizes.
   Now the paragraphs, the file names and the sizes are whatever the backend actually
   produced, and when no run has happened they say so instead of showing a specimen. */

export const SarBlock = () => {
  const { navigate, notify } = useWorkspaceActions();
  const { report, loading, reason } = useRunReport();

  if (report === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-between px-6 py-5">
        <p className="max-w-[92ch] text-label leading-relaxed text-muted">
          {loading ? 'Assembling the draft from this run…' : reason}
        </p>
        <Button size="xs" variant="quiet" onClick={() => navigate('reports')}>
          <FileSignature className="size-3" aria-hidden="true" />
          open composer
        </Button>
      </div>
    );
  }

  const blocked = report.readiness.filter((item) => item.status !== 'ok');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="scroll min-h-0 flex-1 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <Tone kind="neutral">draft · unfiled</Tone>
          <span className="num text-meta text-faint">
            {report.case_id} · {report.sections.length} sourced paragraphs · subject{' '}
            {report.subject}
          </span>
        </div>
        {report.sections.slice(0, 3).map((section) => (
          <div key={section.heading} className="pb-2.5">
            <p className="eyebrow pb-2">{section.heading}</p>
            <p className="max-w-[92ch] text-read whitespace-pre-line text-ink">{section.body}</p>
          </div>
        ))}
        {report.sections.length > 3 && (
          <p className="text-meta text-faint italic">
            {report.sections.length - 3} further section(s), including the methodology and its
            stated limitations, continue in the composer.
          </p>
        )}
      </div>
      <div className="hair-t flex flex-wrap items-center gap-1.5 px-6 py-4.5">
        <Button size="xs" variant="quiet" onClick={() => navigate('reports')}>
          <FileSignature className="size-3" aria-hidden="true" />
          open composer
        </Button>
        <Button
          size="xs"
          variant="primary"
          disabled={blocked.length > 0}
          onClick={() =>
            notify(
              'Submission blocked',
              `${String(blocked.length)} readiness item(s) still require attention.`,
              'review',
            )
          }
        >
          <Send className="size-3" aria-hidden="true" />
          submit to FIU
        </Button>
        <span className="ml-auto text-meta text-faint">
          every paragraph names the evidence it came from
        </span>
      </div>
    </div>
  );
};

export const DownloadsBlock = () => {
  const { record } = useAudit();
  const { report, loading, reason } = useRunReport();

  if (report === null || report.artifacts.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-start px-6 py-5">
        <p className="max-w-[92ch] text-label leading-relaxed text-muted">
          {loading ? 'Rendering artefacts…' : report === null ? reason : 'This run produced no artefacts.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 px-6 py-5">
      {report.artifacts.map((artifact) => (
        <a
          key={artifact.name}
          href={api.artifactHref(artifact)}
          download={artifact.name}
          title={`sha256 ${artifact.sha256}`}
          onClick={() => {
            record({
              action: 'export.generated',
              detail: `Downloaded ${artifact.name} (${artifact.sha256.slice(0, 12)})`,
              investigation: report.case_id,
              entity: report.subject ?? '',
              workspace: 'ask',
              metadata: { artefact: artifact.name, sha256: artifact.sha256 },
            });
          }}
          className="group flex items-center gap-2 rounded-[2px] border border-line bg-raise px-4.5 py-3.5 text-left shadow-[var(--elev-1)] transition-colors hover:border-info-line hover:bg-info-bg/40"
        >
          <Download className="size-3 shrink-0 text-faint group-hover:text-info" aria-hidden="true" />
          <span className="num min-w-0 flex-1 truncate text-label text-ink">{artifact.name}</span>
          <span className="shrink-0 text-meta text-faint">
            {artifactBytes(artifact.bytes)} · {artifact.label}
          </span>
        </a>
      ))}
      <p className="mt-auto text-meta leading-relaxed text-faint">
        Each file carries a content digest, so a download can be verified against what the
        engine rendered. Exports are not redacted; the API reports that rather than claiming a
        redaction profile no code implements.
      </p>
    </div>
  );
};
