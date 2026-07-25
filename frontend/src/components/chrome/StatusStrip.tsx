import { Database, Gauge, GitCommitHorizontal, Keyboard, Radio } from 'lucide-react';
import { performance } from '@/data/models';
import { useEngineHealth } from '@/hooks/useEngineHealth';
import type { EngineState } from '@/hooks/useEngineHealth';
import type { HealthDto } from '@/lib/api';
import { useAgent } from '@/store/agentStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import { num, seconds } from '@/lib/format';

/* Provenance strip. Model version, data vintage and last run latency stay
   on screen permanently — an analyst should never have to open settings to
   find out which model produced a number. */
/* Engine state drives the leftmost lamp: an analyst should be able to tell at a
   glance whether what they are looking at came from the engine or from the
   bundled demo set. */
const engineLamp: Record<EngineState, { readonly label: string; readonly tone: string }> = {
  unknown: { label: 'connecting', tone: 'text-faint' },
  warming: { label: 'loading dataset', tone: 'text-rev' },
  ready: { label: 'engine live', tone: 'text-ok' },
  error: { label: 'engine error', tone: 'text-sev' },
  offline: { label: 'demo data', tone: 'text-rev' },
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

const modelLabel = (health: HealthDto | null): string => {
  const model = health?.model ?? null;
  if (model === null) return `${performance.modelVersion} · bundled demo metadata`;
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
  const { state, health } = useEngineHealth();

  const lamp = engineLamp[state];

  return (
    <footer className="hair-t flex h-9 shrink-0 items-center gap-5 bg-sunken px-5 text-meta tracking-tight text-faint shadow-[var(--elev-1)]">
      <span className={`flex items-center gap-1.5 ${lamp.tone}`} title={health?.error ?? undefined}>
        <span
          aria-hidden="true"
          className={`size-1.5 rounded-full ${
            state === 'ready' ? 'bg-ok' : state === 'error' ? 'bg-sev' : 'bg-rev'
          }`}
        />
        <span className="tracking-wider uppercase">{lamp.label}</span>
      </span>
      <span aria-hidden="true" className="h-3 w-px bg-rule" />

      <span className="flex items-center gap-1.5" title={vintage(health) ?? undefined}>
        <Database className="size-3" aria-hidden="true" />
        {health === null
          ? 'IBM AML HI-Small · bundled demo dataset'
          : `IBM AML ${health.variant} · ${num(health.transactions)} txns · ${num(health.accounts)} accounts${
              health.dataset_as_of === null ? '' : ` · data to ${day(health.dataset_as_of)}`
            }`}
      </span>

      {/* Model provenance, read off the artefact's own bytes when the engine is live.
          No PSI figure: nothing in the pipeline computes drift, and a provenance strip
          showing an invented number defeats its own purpose. */}
      <span className="flex items-center gap-1.5" title={health?.model?.sha256 ?? undefined}>
        <GitCommitHorizontal className="size-3" aria-hidden="true" />
        {modelLabel(health)}
      </span>

      <span className="flex items-center gap-1.5">
        <Gauge className="size-3" aria-hidden="true" />
        {phase === 'idle'
          ? 'no run in this session'
          : `run ${startedAt ?? '—'} · ${seconds(phase === 'complete' ? totalMs : elapsedMs)} · ${String(ranCount)} invoked / ${String(skippedCount)} declined${
              failedCount > 0 ? ` / ${String(failedCount)} degraded` : ''
            }`}
      </span>

      {phase !== 'idle' && (
        <span
          className={`flex items-center gap-1.5 ${origin.source === 'engine' ? 'text-ok' : 'text-rev'}`}
          title={origin.fallbackReason ?? undefined}
        >
          <Radio className="size-3" aria-hidden="true" />
          {origin.source === 'engine'
            ? `live run ${origin.runId?.slice(0, 8) ?? ''}`
            : 'demo run · engine not used'}
        </span>
      )}

      <span className="ml-auto flex items-center gap-3">
        <span className="num text-dim">{spine.length} evidence items pinned</span>
        <span aria-hidden="true" className="h-3 w-px bg-rule" />
        <button
          type="button"
          onClick={() => setShortcuts(true)}
          className="flex items-center gap-1.5 transition-colors hover:text-ink"
        >
          <Keyboard className="size-3" aria-hidden="true" />
          shortcuts
        </button>
      </span>
    </footer>
  );
};
