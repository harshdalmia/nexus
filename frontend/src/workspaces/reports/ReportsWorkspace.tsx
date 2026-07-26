import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, FileSignature, Send, ShieldCheck, User } from 'lucide-react';
import { Button } from '@/components/primitives/Button';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { EmptyState } from '@/components/primitives/EmptyState';
import { SkeletonLines } from '@/components/primitives/Skeleton';
import { Tone } from '@/components/primitives/Severity';
import { ApiError, api } from '@/lib/api';
import type { ArtifactDto, ReportDto } from '@/lib/api';
import { useAudit } from '@/store/auditStore';
import { useCases } from '@/store/caseStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';

/* The composer renders the engine's own draft. Every paragraph below was assembled
   by the backend from that run's evidence and carries its sources, so hovering a
   source highlights the claim that produced the sentence.

   This workspace used to fake the whole thing: a 1.4s setTimeout, hardcoded artefact
   names and byte sizes, and a checklist from a fixture. It is now the real
   /investigations/{run_id}/report and /artifacts endpoints, which means it can also
   legitimately show nothing when no investigation has been run. */

const bytes = (value: number): string => {
  if (value < 1024) return `${String(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
};

const statusIcon = (status: 'ok' | 'blocked' | 'manual') => {
  if (status === 'ok') return <Check className="mt-px size-3 shrink-0 text-ok" aria-hidden="true" />;
  if (status === 'manual') return <User className="mt-px size-3 shrink-0 text-info" aria-hidden="true" />;
  return <AlertTriangle className="mt-px size-3 shrink-0 text-rev" aria-hidden="true" />;
};

export const ReportsWorkspace = () => {
  const { spine, activeCaseId } = useWorkspaceState();
  const { notify, navigate } = useWorkspaceActions();
  const { record: audit } = useAudit();
  const { cases } = useCases();

  const [report, setReport] = useState<ReportDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoverRef, setHoverRef] = useState<string | null>(null);

  /* Prefer the case the analyst opened; otherwise the newest run this session. */
  const record = cases.find((item) => item.id === activeCaseId) ?? cases[0] ?? null;
  const runId = record?.runId ?? null;
  const items = spine.filter((item) => item.caseId === activeCaseId);

  const load = useCallback(
    async (id: string, rebuild: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const response = rebuild ? await api.buildReport(id) : await api.getReport(id);
        setReport(response.data);
        if (rebuild) {
          const built = response.data.artifacts.map((item) => item.name).join(', ');
          notify(
            'Report package built',
            response.data.artifacts.length > 0
              ? `${built} ready to download.`
              : 'The engine produced no artefacts for this run.',
            'clear',
          );
          audit({
            action: 'export.generated',
            detail: `Draft report and ${String(response.data.artifacts.length)} artefact(s) rendered for run ${id.slice(0, 8)}`,
            investigation: record?.id ?? id,
            entity: record?.entity ?? response.data.subject ?? '',
            workspace: 'reports',
            metadata: { artefacts: built },
          });
        }
      } catch (cause) {
        setError(
          cause instanceof ApiError ? cause.message : 'The report could not be loaded.',
        );
      } finally {
        setLoading(false);
      }
    },
    [audit, notify, record],
  );

  useEffect(() => {
    if (runId === null) {
      setReport(null);
      return;
    }
    void load(runId, false);
  }, [runId, load]);

  if (runId === null) {
    return (
      <Panel className="border-0">
        <PanelHead title="report composer" meta="no investigation in this session" />
        <EmptyState
          icon={<FileSignature className="size-4" aria-hidden="true" />}
          title="A report is assembled from a run, not from a blank page"
          body="Ask the agent a question first. The composer then drafts every paragraph from that run's own evidence, with the transactions behind each claim attached."
          actions={[
            { label: 'Ask the agent', primary: true, onClick: () => navigate('ask') },
            { label: 'Open cases', onClick: () => navigate('cases') },
          ]}
        />
      </Panel>
    );
  }

  if (report === null) {
    return (
      <Panel className="border-0">
        <PanelHead title="report composer" meta={loading ? 'loading the draft' : 'unavailable'} />
        <div className="px-7 py-5">
          {error === null ? <SkeletonLines lines={6} /> : <p className="text-label text-rev">{error}</p>}
        </div>
      </Panel>
    );
  }

  if (!report.available) {
    return (
      <Panel className="border-0">
        <PanelHead title="report composer" meta={report.case_id} />
        <EmptyState
          icon={<FileSignature className="size-4" aria-hidden="true" />}
          title="This run has nothing to report"
          body={report.reason ?? 'The engine flagged no account for this query, so there is no draft to compose.'}
          actions={[{ label: 'Ask another question', primary: true, onClick: () => navigate('ask') }]}
        />
      </Panel>
    );
  }

  const blocked = report.readiness.filter((item) => item.status !== 'ok');
  const satisfied = report.readiness.length - blocked.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <Panel collapseId="reports.spine" className="hair-r min-h-0 w-full shrink-0 border-0 xl:w-[20rem] 2xl:w-[23rem]">
        <PanelHead title="evidence spine" meta={`${String(items.length)} pinned by you`} />
        {items.length === 0 ? (
          <p className="px-6 py-4.5 text-label leading-relaxed text-muted">
            Nothing pinned. The draft on the right is built from the run&apos;s evidence
            regardless; pinning is for the items you want to argue from.
          </p>
        ) : (
          <ol className="scroll min-h-0 flex-1">
            {items.map((item, index) => (
              <li
                key={item.id}
                className="hair-b flex items-start gap-2 px-6 py-4.5"
              >
                <span className="num mt-px w-4 shrink-0 text-meta text-faint">{index + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-label leading-snug text-ink">{item.label}</span>
                  <span className="block text-meta text-faint">{item.meta}</span>
                </span>
                <span className="shrink-0 text-meta tracking-wide text-faint uppercase">{item.kind}</span>
              </li>
            ))}
          </ol>
        )}
        <footer className="hair-t px-6 py-4 text-meta leading-relaxed text-faint">
          The engine cites its own sources under each paragraph. Nothing enters the draft
          without one.
        </footer>
      </Panel>

      <Panel collapseId="reports.composer" className="min-h-0 flex-1 border-0">
        <PanelHead
          title="draft report"
          meta={
            <span className="flex items-center gap-2">
              <span className="num text-ink">{report.case_id}</span>
              <span className="truncate">{report.subject}</span>
              <Tone kind="neutral">draft &middot; not filed</Tone>
            </span>
          }
          actions={
            <>
              <Button size="xs" variant="ghost" onClick={() => void load(runId, true)} disabled={loading}>
                <Download className="size-3" aria-hidden="true" />
                {loading ? 'building…' : 'rebuild package'}
              </Button>
              <Button
                size="xs"
                variant="primary"
                disabled={blocked.length > 0}
                onClick={() =>
                  notify(
                    'Submission blocked',
                    `${String(blocked.length)} readiness item(s) still need attention.`,
                    'review',
                  )
                }
              >
                <Send className="size-3" aria-hidden="true" />
                submit to FIU
              </Button>
            </>
          }
        />

        <div className="scroll min-h-0 flex-1">
          <dl className="hair-b grid grid-cols-2 sm:grid-cols-4">
            {[
              ['subject', report.subject ?? '—'],
              ['typology', report.typology ?? '—'],
              ['risk', `${String(report.risk)} / 100 · ${report.tier ?? '—'}`],
              ['recommended', report.escalation ?? '—'],
            ].map(([label, value]) => (
              <div key={label} className="hair-r px-6 py-4.5 last:border-r-0">
                <dt className="eyebrow">{label}</dt>
                <dd className="num truncate text-label text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          {report.sections.map((section) => (
            <article
              key={section.heading}
              className="hair-b border-l-2 border-l-transparent px-6 py-5"
            >
              <h3 className="eyebrow pb-2.5">{section.heading}</h3>
              <p className="max-w-[86ch] text-read whitespace-pre-line text-ink">{section.body}</p>

              {section.sources.length > 0 && (
                <ul className="flex flex-col gap-0.5 pt-2">
                  {section.sources.map((source) => (
                    <li
                      key={`${section.heading}-${source.kind}-${source.ref}`}
                      onMouseEnter={() => setHoverRef(source.ref)}
                      onMouseLeave={() => setHoverRef(null)}
                      className={`flex items-start gap-2 px-1 text-meta leading-relaxed transition-colors duration-100 ${
                        hoverRef === source.ref ? 'bg-info-bg text-ink' : 'text-faint'
                      }`}
                    >
                      <span className="shrink-0 tracking-wide uppercase">{source.kind}</span>
                      <span className="num shrink-0 text-ink">{source.ref}</span>
                      <span className="min-w-0 flex-1">{source.detail}</span>
                      {source.tx_count > 0 && (
                        <span className="num shrink-0">{source.tx_count} txn</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}

          <div className="flex items-start gap-3 px-7 py-5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
            <div className="max-w-[86ch] text-label leading-relaxed text-faint">
              {report.notes.map((note) => (
                <p key={note}>{note}</p>
              ))}
              <p className="pt-1">Generated {report.generated_at}.</p>
            </div>
          </div>
        </div>
      </Panel>

      <Panel collapseId="reports.sources" className="hair-l min-h-0 w-full shrink-0 border-0 xl:w-[21rem] 2xl:w-[24rem]">
        <PanelHead
          title="filing readiness"
          meta={`${String(satisfied)} of ${String(report.readiness.length)} satisfied`}
        />
        <div className="scroll min-h-0 flex-1">
          <div className="hair-b px-6 py-5">
            <div className="flex h-1 overflow-hidden bg-raise">
              <span
                className="bg-rev transition-[width] duration-300"
                style={{
                  width: `${String(
                    report.readiness.length === 0 ? 0 : (satisfied / report.readiness.length) * 100,
                  )}%`,
                }}
              />
            </div>
            <p className="pt-1.5 text-meta text-muted">
              Items marked with a person icon need a human. The engine reports them as
              outstanding rather than pretending to satisfy them.
            </p>
          </div>

          <ul className="flex flex-col">
            {report.readiness.map((item) => (
              <li key={item.id} className="hair-b flex items-start gap-2 px-6 py-4">
                {statusIcon(item.status)}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-label leading-snug ${
                      item.status === 'ok' ? 'text-muted' : 'text-ink'
                    }`}
                  >
                    {item.label}
                  </span>
                  {item.blocker !== null && (
                    <span className="block text-meta leading-relaxed text-faint">{item.blocker}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>

          <div className="px-6 py-5">
            <p className="eyebrow pb-2.5">artefacts</p>
            {report.artifacts.length === 0 ? (
              <p className="text-label leading-relaxed text-muted">
                No artefact has been rendered for this run yet. Use “rebuild package”.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {report.artifacts.map((artifact: ArtifactDto) => (
                  <li
                    key={artifact.name}
                    className="flex items-center gap-2 rounded-[2px] border border-line bg-raise px-4.5 py-3.5 shadow-[var(--elev-1)]"
                  >
                    <Download className="size-3 shrink-0 text-info" aria-hidden="true" />
                    <a
                      href={api.artifactHref(artifact)}
                      download={artifact.name}
                      className="num min-w-0 flex-1 truncate text-label text-ink underline decoration-dotted underline-offset-2"
                      title={`sha256 ${artifact.sha256}`}
                    >
                      {artifact.name}
                    </a>
                    <span className="shrink-0 text-meta text-faint">
                      {bytes(artifact.bytes)} · {artifact.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
};
