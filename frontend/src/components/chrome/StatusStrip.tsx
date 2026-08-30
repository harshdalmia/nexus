import { Database, Gauge, GitCommitHorizontal, Keyboard, Radio } from 'lucide-react';
import { performance } from '@/data/models';
import type { HealthDto } from '@/lib/api';
import { useAgent } from '@/store/agentStore';
import { useDataSource } from '@/store/dataSourceStore';
import type { DataSource } from '@/store/dataSourceStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import { num, seconds } from '@/lib/format';

/* Provenance strip. Model version, data vintage and last run latency stay
   on screen permanently — an analyst should never have to open settings to
   find out which model produced a number. */
/* The resolved source drives the leftmost lamp: an analyst should be able to tell
   at a glance whether what they are looking at came from the engine or from the
   bundled demo set — and the lamp now reads off the same verdict the panels do, so
   it cannot say "connecting" while a panel shows demo figures. */
const sourceLamp: Record<DataSource, { readonly label: string; readonly tone: string; readonly dot: string }> = {
  live: { label: 'engine live', tone: 'text-ok', dot: 'bg-ok' },
  demo: { label: 'demo data', tone: 'text-rev', dot: 'bg-rev' },
  pending: { label: 'connecting', tone: 'text-faint', dot: 'bg-rule' },
};

const day = (iso: string): string => iso.slice(0, 10);

/** Tooltip: when this process ingested, and the window the data itself covers. */
const vintage = (health: HealthDto | null): string | null => {
  if (health === null) return null;
  const parts: string[] = [];
  if (health.data_loaded_at !== null) parts.push(`ingested ${health.data_loaded_at}`);
  if (health.dataset_from !== null && health.dataset_as_of !== null) {
    parts.push(`data covers ${day(health.dataset_from)} to ${day(health.dataset_as_of)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
};

const modelLabel = (health: HealthDto | null, isDemo: boolean): string => {
  const model = health?.model ?? null;
  if (model === null) {
    return isDemo
      ? `${performance.modelVersion} · bundled demo metadata`
      : 'model provenance not reported yet';
  }
  if (!model.present) return model.reason ?? 'no model artefact on disk';
  return `${model.name} ${model.version ?? ''} · trained ${
    model.trained_at === null ? 'unknown' : day(model.trained_at)
  } · drift not measured`;
};

export const StatusStrip = () => {
  const { elapsedMs, totalMs, phase, ranCount, skippedCount, failedCount, startedAt, origin } =
    useAgent();
  const { spine } = useWorkspaceState();
  const { setShortcuts } = useWorkspaceActions();
  const { source, engineState, health, error, reason, isDemo } = useDataSource();

  const lamp = sourceLamp[source];
  /* Warming deserves its own word: the engine is up, it just cannot answer yet. */
  const lampLabel = source === 'pending' && engineState === 'warming' ? 'loading dataset' : lamp.label;

  const datasetLabel =
    health === null
      ? isDemo
        ? 'IBM AML HI-Small · bundled demo dataset'
        : 'dataset not reported yet'
      : `IBM AML ${health.variant} · ${num(health.transactions)} txns · ${num(health.accounts)} accounts${
          health.dataset_as_of === null ? '' : ` · data to ${day(health.dataset_as_of)}`
        }`;

  const runLabel =
    phase === 'idle'
      ? 'no run in this session'
      : `run ${startedAt ?? '—'} · ${seconds(phase === 'complete' ? totalMs : elapsedMs)} · ${String(ranCount)} invoked / ${String(skippedCount)} declined${
          failedCount > 0 ? ` / ${String(failedCount)} degraded` : ''
        }`;

  /* One line, always. Every segment truncates rather than wrapping, and the
     lower-priority ones drop out entirely as the viewport narrows — a footer that
     reflows into two rows would overlap the workspace above it, because its height
     is fixed so the shell can rely on it. Order of sacrifice: model provenance,
     then run telemetry, then the dataset, then the pinned count. The source lamp
     never drops: it is the one thing that must always be legible. */
  return (
    <footer className="hair-t flex h-11 shrink-0 items-center gap-4 overflow-hidden bg-sunken px-4 text-meta tracking-tight text-faint shadow-[var(--elev-1)] xl:gap-7 xl:px-7">
      <span
        className={`flex shrink-0 items-center gap-1.5 ${lamp.tone}`}
        title={reason ?? health?.error ?? error ?? undefined}
      >
        <span aria-hidden="true" className={`size-1.5 rounded-full ${lamp.dot}`} />
        <span className="tracking-wider uppercase">{lampLabel}</span>
      </span>
      <span aria-hidden="true" className="hidden h-3 w-px shrink-0 bg-rule sm:block" />

      <span
        className="hidden min-w-0 items-center gap-1.5 sm:flex"
        title={vintage(health) ?? datasetLabel}
      >
        <Database className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{datasetLabel}</span>
      </span>

      {/* Model provenance, read off the artefact's own bytes when the engine is live.
          No PSI figure: nothing in the pipeline computes drift, and a provenance strip
          showing an invented number defeats its own purpose. */}
      <span
        className="hidden min-w-0 items-center gap-1.5 2xl:flex"
        title={health?.model?.sha256 ?? modelLabel(health, isDemo)}
      >
        <GitCommitHorizontal className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{modelLabel(health, isDemo)}</span>
      </span>

      <span className="hidden min-w-0 items-center gap-1.5 lg:flex" title={runLabel}>
        <Gauge className="size-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{runLabel}</span>
      </span>

      {phase !== 'idle' && (
        <span
          className={`flex shrink-0 items-center gap-1.5 ${origin.source === 'engine' ? 'text-ok' : 'text-rev'}`}
          title={origin.fallbackReason ?? undefined}
        >
          <Radio className="size-3 shrink-0" aria-hidden="true" />
          <span className="hidden md:inline">
            {origin.source === 'engine'
              ? `live run ${origin.runId?.slice(0, 8) ?? ''}`
              : 'demo run · engine not used'}
          </span>
        </span>
      )}

      <span className="ml-auto flex shrink-0 items-center gap-3">
        <span className="num hidden text-dim md:inline">
          {spine.length} evidence items pinned
        </span>
        <span aria-hidden="true" className="hidden h-3 w-px bg-rule md:block" />
        <button
          type="button"
          onClick={() => setShortcuts(true)}
          className="flex items-center gap-1.5 transition-colors hover:text-ink"
        >
          <Keyboard className="size-3" aria-hidden="true" />
          <span className="hidden sm:inline">shortcuts</span>
        </button>
      </span>
    </footer>
  );
};
