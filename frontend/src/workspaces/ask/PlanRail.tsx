import { useState } from 'react';
import {
  Check,
  ChevronRight,
  Circle,
  CircleSlash,
  Loader2,
  Maximize2,
  Pin,
  TriangleAlert,
} from 'lucide-react';
import { Panel, PanelFoot, PanelHead } from '@/components/primitives/Panel';
import { Skeleton } from '@/components/primitives/Skeleton';
import { scenarios, stageTitle } from '@/data/scenarios';
import { num, seconds } from '@/lib/format';
import { useAgent } from '@/store/agentStore';
import { useWorkspaceActions, useWorkspaceState } from '@/store/workspaceStore';
import type { StepState, TraceStep } from '@/types/aml';

/* Fourteen nodes are wired; the idle rail shows the roster so the analyst
   knows what could run before anything is dispatched. */
const roster = scenarios[0].steps.map((step) => ({ tool: step.tool, label: step.label, stage: step.stage }));

const stateIcon = (state: StepState) => {
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
      return <Circle className="size-2 text-ghost" aria-hidden="true" />;
  }
};

const StepNode = ({
  step,
  state,
  isLast,
  onPin,
}: {
  readonly step: TraceStep;
  readonly state: StepState;
  readonly isLast: boolean;
  readonly onPin: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const isSkipped = state === 'skipped';
  const isQueued = state === 'queued';

  return (
    <li className="relative pl-6">
      {!isLast && (
        <span
          aria-hidden="true"
          className={`absolute top-5 left-[7px] h-[calc(100%-1rem)] w-px ${
            state === 'done' || state === 'failed' ? 'bg-info/40' : 'bg-line'
          }`}
        />
      )}
      <span
        className={`absolute top-1 left-0 grid size-4 place-items-center border bg-panel ${
          state === 'done'
            ? 'border-ok-line'
            : state === 'running'
              ? 'border-info-line'
              : state === 'failed'
                ? 'border-sev-line'
                : 'border-line'
        }`}
      >
        {stateIcon(state)}
      </span>

      <div className="group flex flex-col gap-0.5 py-1">
        <div className="flex items-baseline gap-1.5">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
            aria-expanded={open}
          >
            <ChevronRight
              className={`size-2.5 shrink-0 text-faint transition-transform duration-150 ${open ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            <span
              className={`truncate text-xs2 font-medium ${
                isSkipped ? 'text-faint line-through' : isQueued ? 'text-ghost' : 'text-ink'
              }`}
            >
              {step.label}
            </span>
          </button>

          {isSkipped ? (
            <span className="shrink-0 text-meta tracking-wide text-faint uppercase">declined</span>
          ) : state === 'failed' ? (
            <span className="shrink-0 text-meta tracking-wide text-sev uppercase">degraded</span>
          ) : isQueued ? (
            <span className="shrink-0 text-meta text-ghost">queued</span>
          ) : (
            <span className="num shrink-0 text-meta text-info">{num(step.durationMs)}ms</span>
          )}

          {(state === 'done' || state === 'failed') && (
            <button
              type="button"
              onClick={onPin}
              aria-label={`Pin ${step.label} to the evidence spine`}
              className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 hover:text-info"
            >
              <Pin className="size-2.5" aria-hidden="true" />
            </button>
          )}
        </div>

        {open ? (
          <div className="anim-fade flex flex-col gap-1.5 pt-1 pl-4">
            <p className={`text-meta leading-relaxed ${isSkipped ? 'text-faint' : 'text-muted'}`}>
              {step.reason}
            </p>
            {step.detail !== undefined && (
              <p
                className={`border-l px-1.5 py-1 font-mono text-meta leading-relaxed break-words ${
                  state === 'failed' ? 'border-sev-line text-sev' : 'border-line bg-raise text-muted'
                }`}
              >
                {step.detail}
              </p>
            )}
            {(step.outputs ?? []).map((artifact) => (
              <p key={artifact.label} className="flex items-baseline gap-1.5 text-meta">
                <span className="text-faint">{artifact.label}</span>
                <span className="num truncate text-muted">{artifact.value}</span>
              </p>
            ))}
            {step.rowsIn !== undefined && (
              <p className="num text-meta text-faint">
                rows_in {num(step.rowsIn)}
                {step.rowsOut !== undefined && ` → rows_out ${num(step.rowsOut)}`}
              </p>
            )}
          </div>
        ) : (
          state !== 'queued' && (
            <p
              className={`truncate pl-4 text-meta ${isSkipped ? 'text-faint italic' : 'text-muted'}`}
              title={step.reason}
            >
              {step.reason}
            </p>
          )
        )}
      </div>
    </li>
  );
};

export const PlanRail = () => {
  const {
    scenario,
    stepStates,
    phase,
    elapsedMs,
    totalMs,
    ranCount,
    skippedCount,
    failedCount,
    expandStage,
  } = useAgent();
  const { pin, notify, requestQuery } = useWorkspaceActions();
  const { activeCaseId } = useWorkspaceState();

  return (
    <Panel className="hair-r w-full border-0 lg:w-[19.5rem]">
      <PanelHead
        title="execution plan"
        meta={
          scenario === null
            ? 'roster idle'
            : phase === 'complete'
              ? `${String(ranCount)} invoked · ${String(skippedCount)} declined`
              : 'dispatching…'
        }
        actions={
          scenario === null ? undefined : (
            <button
              type="button"
              onClick={expandStage}
              aria-label="Reopen the execution stage"
              className="text-faint transition-colors hover:text-ink"
            >
              <Maximize2 className="size-3" aria-hidden="true" />
            </button>
          )
        }
      />

      {scenario === null ? (
        <>
          <div className="hair-b px-4 py-3">
            <p className="eyebrow pb-1">available roster</p>
            <p className="text-label leading-relaxed text-muted">
              Fourteen nodes are wired. The planner decides which of them earn their cost for your
              question — and the ones it declines stay on screen, greyed, with the reason attached.
            </p>
          </div>
          <ol className="scroll min-h-0 flex-1 px-4 py-3">
            {roster.map((tool, index) => (
              <li key={tool.tool} className="relative flex items-center gap-2 py-1 pl-6">
                {index < roster.length - 1 && (
                  <span aria-hidden="true" className="absolute top-5 left-[7px] h-full w-px bg-line" />
                )}
                <span className="absolute top-1 left-0 grid size-4 place-items-center border border-line bg-panel">
                  <Circle className="size-2 text-ghost" aria-hidden="true" />
                </span>
                <span className="text-xs2 text-faint">{tool.label}</span>
                <code className="ml-auto text-meta text-ghost">{stageTitle[tool.stage].split(' ')[0]}</code>
              </li>
            ))}
          </ol>
          <div className="hair-t px-4 py-3">
            <button
              type="button"
              onClick={() => requestQuery('Find structuring patterns in the last 30 days')}
              className="ctl ctl-primary w-full text-xs2 font-medium"
            >
              dispatch an investigation
            </button>
            <p className="pt-1.5 text-meta leading-relaxed text-faint">
              A counting question runs 7 of 14 in nine seconds. A named typology runs 12 in thirty.
            </p>
          </div>
        </>
      ) : (
        <>
          <div className="hair-b bg-raise/50 px-4 py-3">
            <p className="eyebrow pb-1">extracted intent</p>
            {stepStates[0] === 'running' ? (
              <div className="flex flex-col gap-1.5 pt-0.5">
                <Skeleton width="78%" />
                <Skeleton width="60%" />
              </div>
            ) : (
              <dl className="grid grid-cols-1 gap-x-3 gap-y-0.5">
                {scenario.intent.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-2">
                    <dt className="w-24 shrink-0 font-mono text-meta text-faint">{key}</dt>
                    <dd className="truncate font-mono text-meta text-info" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          <div className="hair-b bg-model-bg/30 px-4 py-3">
            <p className="eyebrow pb-1 text-model">planner rationale</p>
            <p className="text-meta leading-relaxed text-muted">{scenario.plannerNote}</p>
          </div>

          <ol className="scroll min-h-0 flex-1 px-4 py-3" aria-live="polite">
            {scenario.steps.map((step, index) => (
              <StepNode
                key={step.tool}
                step={step}
                state={stepStates[index] ?? 'queued'}
                isLast={index === scenario.steps.length - 1}
                onPin={() => {
                  pin({
                    id: `sp-trace-${step.tool}`,
                    kind: 'trace',
                    label: `${step.label} · ${step.tool}`,
                    meta: step.detail ?? step.reason,
                    caseId: activeCaseId,
                  });
                  notify('Pinned to spine', `${step.label} trace attached to ${activeCaseId}.`, 'clear');
                }}
              />
            ))}
          </ol>

          <PanelFoot>
            <span className="num">{seconds(phase === 'complete' ? totalMs : elapsedMs)} elapsed</span>
            <span className="num text-faint">
              {ranCount}/{scenario.steps.length} invoked
            </span>
            {failedCount > 0 && <span className="num text-sev">{failedCount} degraded</span>}
            <span className="num ml-auto text-faint">{skippedCount} declined</span>
          </PanelFoot>
        </>
      )}
    </Panel>
  );
};
