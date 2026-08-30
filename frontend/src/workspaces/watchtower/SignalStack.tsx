import { useEffect, useState } from 'react';
import { ArrowUpRight, BrainCircuit, Clock, TrendingUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { SourceMeta, SourcePending } from '@/components/primitives/DataState';
import { Meter, MeterList } from '@/components/primitives/Meter';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { VizRenderer } from '@/components/viz/VizRenderer';
import { alertTrend } from '@/data/models';
import { analystActivity, signals } from '@/data/queue';
import type { SignalCard } from '@/data/queue';
import { useDataSource } from '@/store/dataSourceStore';
import { api } from '@/lib/api';
import type { VolumeSeriesDto } from '@/lib/api/types';
import { num } from '@/lib/format';
import { auditActionLabel, useAudit } from '@/store/auditStore';
import { useCases } from '@/store/caseStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import type { ChartSpec, Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Signal, not statistics.

   With the engine up, the trend is real transaction volume, the
   workload counters are this session's own cases and pinned evidence,
   and the activity feed is the session audit trail. The three signal
   cards stay bundled: they describe standing conditions (rule coverage
   gaps, SLA breaches, week-on-week drift) that need a persistent
   backend to compute.
   ------------------------------------------------------------------ */

const demoTrend: ChartSpec = {
  kind: 'area',
  title: 'Alert volume',
  subtitle: 'weekly alerts · falling as precision improves',
  unit: 'alerts',
  data: alertTrend.map((value, index) => ({ label: `W${String(index + 1)}`, value })),
  footnote: 'down 32% over the quarter against flat transaction volume',
};

const liveTrend = (series: VolumeSeriesDto): ChartSpec => ({
  kind: 'area',
  title: 'Transaction volume',
  subtitle: `daily · ${num(series.total_count)} transactions in the loaded dataset`,
  unit: 'transactions',
  /* Labels are month-day: the loaded slice spans weeks, not years. */
  data: series.points.map((point) => ({
    label: point.bucket.slice(5),
    value: point.count,
  })),
  footnote: 'measured from the ledger, not an alert count',
});

const kindIcon: Record<SignalCard['kind'], LucideIcon> = {
  model: BrainCircuit,
  coverage: BrainCircuit,
  sla: Clock,
  drift: TrendingUp,
};

const toneClass = {
  severe: 'border-l-sev bg-sev-bg/40',
  review: 'border-l-rev bg-rev-bg/40',
  clear: 'border-l-ok bg-ok-bg/40',
  model: 'border-l-model bg-model-bg/40',
} as const;

const clockOf = (iso: string): string => {
  const at = new Date(iso);

  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleTimeString('en-GB', { hour12: false, hour: '2-digit', minute: '2-digit' });
};

export const SignalStack = () => {
  const { navigate, notify, openCase } = useWorkspaceActions();
  const { spine } = useWorkspaceState();
  const { cases } = useCases();
  const { events } = useAudit();
  const { isLive: live, isDemo } = useDataSource();
  const [series, setSeries] = useState<VolumeSeriesDto | null>(null);

  useEffect(() => {
    if (!live) {
      setSeries(null);

      return undefined;
    }

    const controller = new AbortController();

    /* Daily buckets: HI-Small covers under three weeks, so a monthly series would
       be a single bar. */
    api
      .getVolumeSeries({ bucket: 'day', limit: 60, signal: controller.signal })
      .then((response) => setSeries(response.data))
      .catch(() => setSeries(null));

    return () => controller.abort();
  }, [live]);

  const act = (signal: SignalCard) => {
    switch (signal.kind) {
      case 'sla':
        openCase(cases[0]?.id ?? 'C-114');
        break;
      case 'drift':
        navigate('models');
        break;
      default:
        navigate('models');
        notify('Rule coverage', 'Opened the detection catalogue for rule review.', 'info');
    }
  };

  /* Counters describe this session: cases opened, how they were banded, and how much
     evidence the analyst has pinned. */
  const reportable = cases.filter((item) => item.escalation === 'report').length;
  const reviewable = cases.filter((item) => item.escalation === 'review').length;
  const total = Math.max(cases.length, 1);

  const workloadRows: ReadonlyArray<{
    readonly label: string;
    readonly value: number;
    readonly total: number;
    readonly severity: Severity;
  }> = [
    { label: 'cases this session', value: cases.length, total, severity: 'clear' },
    { label: 'report band', value: reportable, total, severity: 'severe' },
    { label: 'review band', value: reviewable, total, severity: 'review' },
    {
      label: 'evidence pinned',
      value: spine.length,
      total: Math.max(spine.length, 1),
      severity: 'review',
    },
  ];

  const activity = events.slice(0, 6);

  return (
    <div className="hair-l flex min-h-0 w-full shrink-0 flex-col lg:w-[22rem] 2xl:w-[26rem]">
      <Panel collapseId="watchtower.signal" className="hair-b min-h-0 flex-1 border-0">
        <PanelHead title="signal" meta="what changed, and what to do about it" />
        <div className="scroll min-h-0 flex-1">
          {/* Standing conditions are bundled illustrations, so they are held to the
              same rule as every other demo figure: shown only when there is no
              engine to compute them. */}
          {!isDemo && (
            <p className="px-6 py-5 text-label leading-relaxed text-faint">
              The engine exposes no standing-conditions endpoint, so there is nothing to
              compute here yet. Illustrative signals are shown only when the app is
              running on demo data.
            </p>
          )}
          {isDemo && signals.map((signal) => {
            const Icon = kindIcon[signal.kind];

            return (
              <article
                key={signal.id}
                className={`hair-b border-l-2 px-6 py-5 ${toneClass[signal.severity]}`}
              >
                <p className="flex items-start gap-2 text-body-lg font-semibold text-ink">
                  <Icon className="mt-px size-3.5 shrink-0 opacity-80" aria-hidden="true" />
                  {signal.headline}
                </p>
                <p className="pt-1 pl-[1.375rem] text-label leading-relaxed text-muted">{signal.body}</p>
                <button
                  type="button"
                  onClick={() => act(signal)}
                  className="mt-1.5 ml-[1.375rem] inline-flex items-center gap-1 text-label text-info underline decoration-dotted transition-colors hover:text-ink"
                >
                  {signal.action}
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </button>
              </article>
            );
          })}
          {isDemo && (
            <p className="px-6 py-4 text-meta leading-relaxed text-faint">
              Standing conditions need a persistent backend to compute; these three are
              illustrative until one exists.
            </p>
          )}
        </div>
      </Panel>

      <Panel collapseId="watchtower.model" className="hair-b shrink-0 border-0">
        <PanelHead
          title={series === null ? 'alert trend' : 'volume trend'}
          meta={<SourceMeta live="from the loaded dataset" demo="12 weeks" />}
        />
        {isDemo ? (
          <VizRenderer spec={demoTrend} />
        ) : series === null ? (
          <SourcePending label="loading the volume trend from the engine" />
        ) : (
          <VizRenderer spec={liveTrend(series)} />
        )}
      </Panel>

      <Panel collapseId="watchtower.sla" className="hair-b shrink-0 border-0">
        <PanelHead
          title="workload"
          meta={
            <span className="truncate text-label text-faint">
              {cases.length > 0 ? 'this session' : 'nothing opened yet'}
            </span>
          }
        />
        <div className="px-6 py-4.5">
          <MeterList>
            {workloadRows.map(({ label, value, total: rowTotal, severity }) => (
              <Meter
                key={label}
                label={label}
                value={String(value)}
                ratio={rowTotal === 0 ? 0 : (value / rowTotal) * 100}
                tone={severity}
                labelWidth="8.5rem"
              />
            ))}
          </MeterList>
        </div>
      </Panel>

      <Panel collapseId="watchtower.activity" className="shrink-0 border-0">
        <PanelHead
          title="session activity"
          meta={
            <span className="truncate text-label text-faint">
              {activity.length > 0 ? 'newest first' : 'nothing recorded yet'}
            </span>
          }
        />
        <ul className="flex flex-col px-6 py-4">
          {activity.length === 0 ? (
            /* An empty session trail is a fact, not a gap to paper over: the sample
               entries stand in only when the app is running on demo data. */
            isDemo ? (
              analystActivity.slice(0, 4).map((entry) => (
                <li key={entry.time} className="flex items-baseline gap-2 py-[3px]">
                  <span className="num shrink-0 text-meta text-faint">{entry.time}</span>
                  <span className="shrink-0 text-meta text-muted">{entry.who}</span>
                  <span className="text-label leading-relaxed text-muted">{entry.text}</span>
                </li>
              ))
            ) : (
              <li className="py-[3px] text-label leading-relaxed text-faint">
                Nothing recorded yet. Actions you take this session appear here.
              </li>
            )
          ) : (
            activity.map((event) => (
                <li key={event.id} className="flex items-baseline gap-2 py-[3px]">
                  <span className="num shrink-0 text-meta text-faint">{clockOf(event.at)}</span>
                  <span className="shrink-0 text-meta text-info">
                    {auditActionLabel[event.action].split(' ')[0].toLowerCase()}
                  </span>
                  <span className="truncate text-label leading-relaxed text-muted" title={event.detail}>
                    {event.detail}
                  </span>
                </li>
            ))
          )}
        </ul>
      </Panel>
    </div>
  );
};
