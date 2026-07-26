import { Activity, ChevronsDownUp, Cpu, Gauge, Layers, Rewind, Zap } from 'lucide-react';
import { useEffect } from 'react';
import { Minimize2 } from 'lucide-react';
import { Segmented } from '@/components/primitives/Chip';
import { Kbd } from '@/components/primitives/Button';
import { useWorkspaceState } from '@/store/workspaceStore';
import { detailFor } from '@/data/agentDetail';
import { stageOrder, stageTitle } from '@/data/scenarios';
import { seconds } from '@/lib/format';
import { useAgent } from '@/store/agentStore';
import { ExecutionNode } from '@/workspaces/ask/ExecutionNode';
import type { ExecutionStage as Stage, PlanningStage } from '@/types/aml';

/* which node has to resolve before each planning derivation is honest */
const planningGate: Record<PlanningStage, string> = {
  intent_extraction: 'intent_classifier',
  entity_extraction: 'intent_classifier',
  filter_detection: 'intent_classifier',
  pattern_detection: 'intent_classifier',
  tool_selection: 'planner',
  execution_planning: 'tool_selector',
};

const stageCaption: Record<PlanningStage, string> = {
  intent_extraction: 'intent extraction',
  entity_extraction: 'entity extraction',
  filter_detection: 'filter detection',
  pattern_detection: 'AML pattern detection',
  tool_selection: 'dynamic tool selection',
  execution_planning: 'execution planning',
};

/* The execution stage is deliberately the largest thing on screen while a
   run is in flight. A 30-second orchestration is the product's core claim,
   so it is staged rather than hidden behind a spinner. */
export const ExecutionStage = () => {
  const {
    scenario,
    query,
    stepStates,
    stepProgress,
    schedule,
    elapsedMs,
    totalMs,
    phase,
    unlocked,
    liveRisk,
    ranCount,
    skippedCount,
    failedCount,
    speed,
    setSpeed,
    collapseStage,
    startedAt,
    origin,
  } = useAgent();
  const { paletteOpen, shortcutsOpen } = useWorkspaceState();

  /* Escape leaves full canvas. The stage covers the workspace, so without this
     the only way out was one small button — the analyst could reasonably feel
     stuck. Overlays own Escape first: if the palette or the shortcut sheet is
     open, that layer closes and the stage stays. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || paletteOpen || shortcutsOpen) {
        return;
      }

      const target = event.target;

      /* never steal Escape from a field the analyst is typing in */
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      event.preventDefault();
      collapseStage();
    };

    window.addEventListener('keydown', onKey);

    return () => window.removeEventListener('keydown', onKey);
  }, [collapseStage, paletteOpen, shortcutsOpen]);

  if (scenario === null) {
    return null;
  }

  const detail = detailFor(scenario);
  const edaIndex = scenario.steps.findIndex((step) => step.tool === 'eda_profiler');
  const edaStep = edaIndex === -1 ? undefined : scenario.steps[edaIndex];
  const edaState = edaIndex === -1 ? undefined : stepStates[edaIndex];
  const edaResolved = edaState === 'done' || edaState === 'skipped' || edaState === 'failed';

  /* A live run only populates the acts its roster actually covers, so empty
     stages are dropped from the ribbon rather than shown as 0/0. */
  const stages = stageOrder.filter((stage) =>
    scenario.steps.some((step) => step.stage === stage),
  );

  const progress = totalMs === 0 ? 0 : Math.min(1, elapsedMs / totalMs);
  const isDone = phase === 'complete';
  const currentStage: Stage =
    scenario.steps[stepStates.findIndex((state) => state === 'running')]?.stage ??
    (isDone ? 'reporting' : 'understanding');

  const telemetry = scenario.steps
    .filter((step, index) => (stepStates[index] === 'done' || stepStates[index] === 'failed') && step.outputs)
    .flatMap((step) => (step.outputs ?? []).filter((artifact) => artifact.emphasis === true).map((artifact) => ({ artifact, step })))
    .slice(-7)
    .reverse();

  return (
    <section
      className="hair-b anim-canvas-in flex min-h-0 flex-1 flex-col bg-sunken"
      aria-label="Investigation execution"
    >
      {/* ---------- header ---------- */}
      <header className="blueprint hair-b relative overflow-hidden px-8 py-7">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-sunken" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2">
              <span className="eyebrow text-info">{isDone ? 'investigation complete' : 'agent orchestration'}</span>
              <span className="num text-meta text-faint">
                dispatched {startedAt ?? '—'} · {scenario.action}
              </span>
            </p>
            <h2 className="display pt-1 text-display text-ink">
              {isDone ? 'Investigation ready' : 'Investigating'}
              {!isDone && <span className="anim-caret text-info">…</span>}
            </h2>
            <div className="pt-2">
              <p className="eyebrow pb-1.5">investigation query</p>
              <p className="max-w-[68ch] border-l-2 border-info pl-2.5 text-lede text-ink">“{query}”</p>
            </div>

            {/* Provenance: engine output or bundled demo data, never ambiguous. */}
            <p className="flex flex-wrap items-center gap-2 pt-2">
              {origin.source === 'engine' ? (
                <>
                  <span className="badge badge-cap border-ok-line bg-ok-bg text-ok">live engine</span>
                  <span className="num text-meta text-faint">
                    run {origin.runId?.slice(0, 8) ?? '—'} · every number below is pipeline output
                  </span>
                </>
              ) : (
                <>
                  <span className="badge badge-cap border-rule bg-raise text-faint">demo data</span>
                  <span className="max-w-[80ch] text-meta text-faint">
                    {origin.fallbackReason ?? 'replaying a bundled scenario'}
                  </span>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <div className="flex items-baseline gap-1.5">
              <span className="metric text-display text-ink tabular-nums">{(elapsedMs / 1000).toFixed(1)}</span>
              <span className="text-body-lg text-faint">s elapsed</span>
            </div>
            <p className="num text-meta text-faint">
              of ~{seconds(totalMs)} estimated · {(progress * 100).toFixed(0)}% complete
            </p>
            <div className="flex items-center gap-1.5">
              <Segmented
                label="Replay speed"
                value={String(speed)}
                onChange={(next) => setSpeed(Number(next))}
                options={[
                  { id: '1', label: '1×' },
                  { id: '2', label: '2×' },
                  { id: '4', label: '4×' },
                ]}
              />
              {/* The way out of full canvas, stated plainly and present in both
                  states — mid-run and finished. */}
              <button
                type="button"
                onClick={collapseStage}
                className={`ctl gap-2 ${isDone ? 'ctl-primary' : ''}`}
                aria-label={isDone ? 'Exit full canvas and open the dossier' : 'Exit full canvas'}
              >
                {isDone ? (
                  <ChevronsDownUp className="size-4" aria-hidden="true" />
                ) : (
                  <Minimize2 className="size-4" aria-hidden="true" />
                )}
                {isDone ? 'open dossier' : 'exit full canvas'}
                <Kbd>esc</Kbd>
              </button>
            </div>
          </div>
        </div>

        {/* ---------- the six planning derivations ---------- */}
        <div className="relative pt-4">
          <p className="eyebrow pb-2 text-model">dynamic agent planning · derived from your sentence</p>
          <ol className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
            {detail.planning.map((decision) => {
              const gate = planningGate[decision.stage];
              const gateIndex = scenario.steps.findIndex((step) => step.tool === gate);
              const resolved = gateIndex >= 0 && (stepStates[gateIndex] === 'done' || stepStates[gateIndex] === 'failed');

              return (
                <li
                  key={decision.stage}
                  className={`min-w-0 rounded-[2px] border px-4.5 py-3 transition-colors duration-300 ${
                    resolved ? 'anim-fade-up border-model-line bg-model-bg/30' : 'border-line bg-sunken'
                  }`}
                >
                  <p className="eyebrow truncate">{stageCaption[decision.stage]}</p>
                  {resolved ? (
                    <>
                      <p className="num truncate text-label text-ink" title={decision.value}>
                        {decision.value}
                      </p>
                      <p className="truncate text-meta text-muted" title={decision.detail}>
                        {decision.detail}
                      </p>
                    </>
                  ) : (
                    <p className="text-meta text-ghost">deriving…</p>
                  )}
                </li>
              );
            })}
          </ol>
          {edaStep !== undefined && (
            <p className="flex flex-wrap items-center gap-2 pt-2">
              <span className="eyebrow">selective EDA</span>
              {edaResolved ? (
                <>
                  <span
                    className={`badge badge-cap ${
                      edaStep.status === 'skipped'
                        ? 'border-rule bg-raise text-faint'
                        : 'border-ok-line bg-ok-bg text-ok'
                    }`}
                  >
                    {edaStep.status === 'skipped' ? 'skipped' : 'executed'}
                  </span>
                  <span className="max-w-[92ch] text-meta text-muted">{edaStep.reason}</span>
                </>
              ) : (
                <span className="text-meta text-ghost">pending planner verdict</span>
              )}
            </p>
          )}
        </div>

        {/* stage ribbon */}
        <ol className="relative flex flex-wrap items-center gap-x-1 gap-y-2 pt-4">
          {stages.map((stage, index) => {
            const stageSteps = scenario.steps
              .map((step, stepIndex) => ({ step, state: stepStates[stepIndex] }))
              .filter((entry) => entry.step.stage === stage);
            const resolved = stageSteps.filter(
              (entry) => entry.state === 'done' || entry.state === 'skipped' || entry.state === 'failed',
            ).length;
            const isActive = currentStage === stage && !isDone;
            const isComplete = resolved === stageSteps.length;

            return (
              <li key={stage} className="flex min-w-0 flex-1 items-center gap-1">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5">
                    <span className="num text-meta text-faint">0{index + 1}</span>
                    <span
                      className={`truncate text-label font-medium transition-colors duration-200 ${
                        isActive ? 'text-info' : isComplete ? 'text-ink' : 'text-ghost'
                      }`}
                    >
                      {stageTitle[stage]}
                    </span>
                    <span className="num ml-auto shrink-0 text-meta text-faint">
                      {resolved}/{stageSteps.length}
                    </span>
                  </div>
                  <div className="mt-1 h-[3px] overflow-hidden bg-raise">
                    <span
                      className={`block h-full transition-[width] duration-300 ${
                        isComplete ? 'bg-ok' : isActive ? 'bg-info' : 'bg-line'
                      }`}
                      style={{ width: `${String((resolved / Math.max(1, stageSteps.length)) * 100)}%` }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </header>

      {/* ---------- body ---------- */}
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <div className="scroll hair-r min-h-0 flex-1 px-6 py-4">
          {stages.map((stage) => {
            const entries = scenario.steps
              .map((step, index) => ({ step, index }))
              .filter((entry) => entry.step.stage === stage);

            if (entries.length === 0) {
              return null;
            }

            return (
              <section key={stage} className="pb-4 last:pb-0">
                <p className="eyebrow pb-2">{stageTitle[stage]}</p>
                <ol>
                  {entries.map((entry, position) => {
                    const slot = schedule[entry.index];
                    const age = slot === undefined ? -1 : elapsedMs - slot.end;

                    return (
                      <ExecutionNode
                        key={entry.step.tool}
                        step={entry.step}
                        state={stepStates[entry.index] ?? 'queued'}
                        progress={stepProgress[entry.index] ?? 0}
                        age={age}
                        isLast={position === entries.length - 1}
                      />
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>

        {/* ---------- live telemetry ---------- */}
        <aside className="flex w-full shrink-0 flex-col xl:w-[22rem] 2xl:w-[26rem]">
          <div className="hair-b px-6 py-4.5">
            <p className="eyebrow pb-2.5">live risk</p>
            <div className="flex items-end gap-2">
              <span
                className={`metric text-display tabular-nums transition-colors duration-300 ${
                  liveRisk >= 75 ? 'text-sev' : liveRisk >= 40 ? 'text-rev' : 'text-ghost'
                }`}
              >
                {liveRisk === 0 ? '—' : liveRisk}
              </span>
              <span className="pb-1 text-meta text-faint">
                {liveRisk === 0 ? 'awaiting risk engine' : liveRisk >= 75 ? '/ 100 · high' : '/ 100 · medium'}
              </span>
            </div>
            <div className="mt-2 h-[3px] overflow-hidden bg-raise">
              <span
                className={`block h-full transition-[width] duration-200 ${
                  liveRisk >= 75 ? 'bg-sev' : liveRisk >= 40 ? 'bg-rev' : 'bg-line'
                }`}
                style={{ width: `${String(liveRisk)}%` }}
              />
            </div>
          </div>

          <div className="hair-b grid grid-cols-3">
            {[
              ['invoked', ranCount, 'text-ok', Cpu],
              ['declined', skippedCount, 'text-faint', Layers],
              ['degraded', failedCount, failedCount > 0 ? 'text-sev' : 'text-faint', Activity],
            ].map(([label, value, tone, Icon]) => {
              const IconComponent = Icon as typeof Cpu;

              return (
                <div key={String(label)} className="hair-r px-6 py-4.5 last:border-r-0">
                  <p className="flex items-center gap-1 text-meta text-faint">
                    <IconComponent className="size-2.5" aria-hidden="true" />
                    {String(label)}
                  </p>
                  <p className={`metric text-metric ${String(tone)}`}>{String(value)}</p>
                </div>
              );
            })}
          </div>

          <div className="hair-b min-h-0 flex-1 overflow-hidden">
            <p className="eyebrow px-4 pt-3 pb-1.5">telemetry</p>
            <ul className="scroll max-h-full px-4 pb-3">
              {telemetry.length === 0 ? (
                <li className="text-meta text-faint">
                  Node outputs stream here as each tool resolves.
                </li>
              ) : (
                telemetry.map(({ artifact, step }) => (
                  <li
                    key={`${step.tool}-${artifact.label}`}
                    className="anim-fade-up flex items-baseline gap-2 py-[3px]"
                  >
                    <span className="num shrink-0 text-meta text-faint">{step.tool.slice(0, 12)}</span>
                    <span className="min-w-0 flex-1 truncate text-meta text-muted">{artifact.label}</span>
                    <span className="num shrink-0 text-label text-ink">{artifact.value}</span>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="px-6 py-4.5">
            <p className="eyebrow pb-2.5">
              dossier assembling · {unlocked.length} of {scenario.sections.length}
            </p>
            <div className="flex flex-wrap gap-1">
              {scenario.sections.map((sectionItem) => {
                const isUnlocked = unlocked.includes(sectionItem.id);

                return (
                  <span
                    key={sectionItem.id}
                    className={`border px-1.5 py-px text-meta transition-colors duration-300 ${
                      isUnlocked
                        ? 'anim-fade-up border-ok-line bg-ok-bg text-ok'
                        : 'border-line bg-sunken text-ghost'
                    }`}
                  >
                    {sectionItem.title}
                  </span>
                );
              })}
            </div>
            {isDone && (
              <p className="flex items-center gap-1.5 pt-2 text-meta text-ok">
                <Zap className="size-3" aria-hidden="true" />
                every section materialised — handing over to the dossier
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* ---------- foot: master progress ---------- */}
      <footer className="hair-t flex items-center gap-4 bg-panel px-6 py-3">
        <Gauge className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        <div className="relative h-[4px] flex-1 overflow-hidden bg-raise">
          <span
            className={`absolute inset-y-0 left-0 transition-[width] duration-100 ${isDone ? 'bg-ok' : 'bg-info'}`}
            style={{ width: `${String(progress * 100)}%` }}
          />
        </div>
        <span className="num shrink-0 text-meta text-muted">
          {(progress * 100).toFixed(0)}% · {seconds(elapsedMs)} / {seconds(totalMs)}
        </span>
        {isDone && (
          <span className="flex items-center gap-1.5 text-meta text-faint">
            <Rewind className="size-3.5" aria-hidden="true" />
            replay from the plan rail
          </span>
        )}
        {/* second exit, at the end of a long scroll: the analyst should never
            have to scroll back up to leave */}
        <button
          type="button"
          onClick={collapseStage}
          className="ctl ctl-ghost shrink-0 gap-2 text-meta"
          aria-label="Exit full canvas"
        >
          <Minimize2 className="size-3.5" aria-hidden="true" />
          exit full canvas
        </button>
      </footer>
    </section>
  );
};
