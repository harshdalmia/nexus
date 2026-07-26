import { useEffect, useState } from 'react';
import { Check, ChevronRight, CircleSlash, Loader2, TriangleAlert } from 'lucide-react';
import type { StepState, TraceStep } from '@/types/aml';

const stateMeta: Record<
  StepState,
  { readonly label: string; readonly tone: string; readonly border: string; readonly badge: string }
> = {
  queued: {
    label: 'queued',
    tone: 'text-ghost',
    border: 'border-line',
    badge: 'border-line bg-sunken text-ghost',
  },
  running: {
    label: 'running',
    tone: 'text-info',
    border: 'border-info-line',
    badge: 'border-info-line bg-info-bg text-info',
  },
  done: {
    label: 'completed',
    tone: 'text-ok',
    border: 'border-ok-line',
    badge: 'border-ok-line bg-ok-bg text-ok',
  },
  skipped: {
    label: 'declined',
    tone: 'text-faint',
    border: 'border-line',
    badge: 'border-line bg-sunken text-faint',
  },
  failed: {
    label: 'degraded',
    tone: 'text-sev',
    border: 'border-sev-line',
    badge: 'border-sev-line bg-sev-bg text-sev',
  },
};

const StateIcon = ({ state }: { readonly state: StepState }) => {
  switch (state) {
    case 'running':
      return <Loader2 className="size-3 animate-spin text-info" aria-hidden="true" />;
    case 'done':
      return <Check className="size-3 text-ok" aria-hidden="true" />;
    case 'skipped':
      return <CircleSlash className="size-3 text-faint" aria-hidden="true" />;
    case 'failed':
      return <TriangleAlert className="size-3 text-sev" aria-hidden="true" />;
    default:
      return <span aria-hidden="true" className="size-1.5 rounded-full bg-ghost" />;
  }
};

interface ExecutionNodeProps {
  readonly step: TraceStep;
  readonly state: StepState;
  readonly progress: number;
  /** ms since this node resolved — drives the brief auto-expansion */
  readonly age: number;
  readonly isLast: boolean;
}

export const ExecutionNode = ({ step, state, progress, age, isLast }: ExecutionNodeProps) => {
  const [manualOpen, setManualOpen] = useState<boolean | null>(null);
  const [activityIndex, setActivityIndex] = useState(0);

  useEffect(() => {
    if (state !== 'running' || step.activity === undefined) {
      return undefined;
    }

    const activity = step.activity;
    const timer = window.setInterval(() => {
      setActivityIndex((current) => Math.min(activity.length - 1, current + 1));
    }, Math.max(600, step.durationMs / Math.max(1, activity.length) / 1.4));

    return () => window.clearInterval(timer);
  }, [state, step.activity, step.durationMs]);

  const hasArtifacts = (step.inputs?.length ?? 0) + (step.outputs?.length ?? 0) > 0;
  const autoOpen =
    (state === 'done' && age >= 0 && age < 5200 && hasArtifacts) || state === 'failed' || state === 'running';
  const isOpen = manualOpen ?? autoOpen;
  const meta = stateMeta[state];
  const liveMs = state === 'running' ? Math.round(step.durationMs * progress) : step.durationMs;

  return (
    <li className="relative pl-7">
      {!isLast && (
        <span
          aria-hidden="true"
          className={`absolute top-7 left-[11px] w-px transition-colors duration-300 ${
            state === 'done' || state === 'failed' ? 'bg-info/45' : 'bg-line'
          }`}
          style={{ height: 'calc(100% - 1rem)' }}
        />
      )}

      <span
        className={`absolute top-1.5 left-0 grid size-[23px] place-items-center border bg-panel transition-colors duration-200 ${meta.border} ${
          state === 'running' ? 'anim-pulse-ring' : ''
        }`}
      >
        <StateIcon state={state} />
      </span>

      <div
        className={`mb-1.5 border transition-colors duration-200 ${
          state === 'queued'
            ? 'border-transparent'
            : state === 'running'
              ? 'border-info-line bg-info-bg/25'
              : state === 'failed'
                ? 'border-sev-line bg-sev-bg/25'
                : state === 'skipped'
                  ? 'border-line/70 bg-sunken'
                  : 'border-line bg-raise/45'
        }`}
      >
        <button
          type="button"
          onClick={() => setManualOpen(!isOpen)}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-2 px-6 py-4 text-left"
        >
          <span
            className={`truncate text-dense font-semibold tracking-tight ${
              state === 'queued'
                ? 'text-ghost'
                : state === 'skipped'
                  ? 'text-faint line-through decoration-1'
                  : 'text-ink'
            }`}
          >
            {step.label}
          </span>
          <code className="hidden shrink-0 text-meta text-faint sm:block">{step.tool}</code>

          <span className={`badge ml-auto shrink-0 ${meta.badge}`}>{meta.label}</span>
          {state !== 'queued' && state !== 'skipped' && (
            <span className="num shrink-0 text-meta text-dim tabular-nums">
              {liveMs.toLocaleString('en-US')}
              <span className="pl-0.5 text-faint">ms</span>
            </span>
          )}
          {hasArtifacts && (
            <ChevronRight
              className={`size-3 shrink-0 text-faint transition-transform duration-150 ${isOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
          )}
        </button>

        {state === 'running' && (
          <div className="px-4 pb-3">
            <div className="sweep-line relative h-[4px] overflow-hidden rounded-[1px] bg-sunken shadow-[inset_0_1px_1px_0_rgb(0_0_0/0.35)]">
              <span
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-info/70 to-info transition-[width] duration-100"
                style={{ width: `${String(progress * 100)}%` }}
              />
            </div>
            {step.activity !== undefined && (
              <p className="num pt-1 text-meta text-info">
                {step.activity[Math.min(activityIndex, step.activity.length - 1)]}
                <span className="anim-caret">▍</span>
              </p>
            )}
          </div>
        )}

        {state === 'skipped' && (
          <p className="px-2.5 pb-1.5 text-meta leading-relaxed text-faint">{step.reason}</p>
        )}

        {state === 'failed' && step.detail !== undefined && (
          <p className="border-t border-sev-line/50 px-6 py-4 font-mono text-meta leading-relaxed text-sev">
            {step.detail}
          </p>
        )}

        {isOpen && state !== 'skipped' && state !== 'queued' && hasArtifacts && (
          <div className="anim-fade grid gap-0 border-t border-line/70 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div className="hair-r px-6 py-4">
              <p className="eyebrow pb-2">input</p>
              {(step.inputs ?? []).map((artifact) => (
                <p key={artifact.label} className="flex items-baseline gap-1.5 text-meta">
                  <span className="text-faint">{artifact.label}</span>
                  <span className="num truncate text-muted">{artifact.value}</span>
                </p>
              ))}
              {(step.inputs ?? []).length === 0 && (
                <p className="text-meta text-faint">upstream state</p>
              )}
            </div>
            <div className="px-6 py-4">
              <p className="eyebrow pb-2">output</p>
              <div className="flex flex-col gap-0.5">
                {(step.outputs ?? []).map((artifact) => (
                  <p key={artifact.label} className="flex items-baseline gap-2 text-meta">
                    <span className="w-[8.5rem] shrink-0 truncate text-faint">{artifact.label}</span>
                    <span
                      className={`num truncate ${
                        artifact.emphasis === true ? 'text-label text-ink' : 'text-muted'
                      }`}
                    >
                      {artifact.value}
                    </span>
                  </p>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </li>
  );
};
