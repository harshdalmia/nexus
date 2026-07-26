import { useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import { Meter, MeterList } from '@/components/primitives/Meter';
import { Panel, PanelHead } from '@/components/primitives/Panel';
import { Tone } from '@/components/primitives/Severity';
import { Pyramid } from '@/components/viz/Charts';
import { VizRenderer } from '@/components/viz/VizRenderer';
import { agentArchitecture } from '@/data/agentDetail';
import { alertTrend, featureImportance, patternMix, performance, pyramid, scoreWeights } from '@/data/models';
import { useCatalogue } from '@/hooks/useCatalogue';
import { api } from '@/lib/api';
import type { CatalogueSummaryDto, VolumeSeriesDto } from '@/lib/api/types';
import { num } from '@/lib/format';
import { useAgent } from '@/store/agentStore';
import { useCases } from '@/store/caseStore';
import { RuleContributions } from '@/workspaces/models/RuleContributions';
import type { ChartSpec, Severity } from '@/types/aml';

/* ------------------------------------------------------------------
   Models & rules.

   Declared configuration — the hypothesis library, the risk weight
   profiles, the screening signal, which model artifacts exist — is read
   from the engine. Measured values (which explanation won, what actually
   contributed, the screening funnel) come from investigations run in
   this process. Evaluation metrics need an offline harness run, so when
   no report exists the panel says so instead of showing numbers.
   ------------------------------------------------------------------ */

const demoAlertSpec: ChartSpec = {
  kind: 'bars',
  title: 'Alert volume',
  subtitle: '12 weeks · alert count per week',
  unit: 'alerts',
  data: alertTrend.map((value, index) => ({ label: `W${String(index + 1)}`, value })),
};

const demoMixSpec: ChartSpec = {
  kind: 'pie',
  title: 'Typology mix',
  subtitle: 'quarter to date · named patterns only',
  data: patternMix.map((pattern) => ({
    label: pattern.label,
    value: pattern.value,
    severity: pattern.value > 3000 ? 'severe' : pattern.value > 1300 ? 'review' : 'clear',
  })),
  footnote: '21 further anomalies came from novelty detection with no matching rule',
};

const volumeSpec = (series: VolumeSeriesDto): ChartSpec => ({
  kind: 'bars',
  title: 'Transaction volume',
  subtitle: `daily · ${num(series.total_count)} transactions loaded`,
  unit: 'transactions',
  data: series.points.map((point) => ({ label: point.bucket.slice(5), value: point.count })),
  footnote: 'measured from the ledger the engine reads',
});

/** Which explanation won, across this session's runs. */
const outcomeSpec = (catalogue: CatalogueSummaryDto): ChartSpec => ({
  kind: 'pie',
  title: 'Explanations that won',
  subtitle: `${String(catalogue.runs_cached)} run(s) cached in the engine`,
  data: catalogue.outcomes.map((outcome) => ({
    label: outcome.label,
    value: outcome.count,
    severity: outcome.kind === 'suspicious' ? 'severe' : 'clear',
    note: `${outcome.typology} · ${outcome.kind}`,
  })),
  footnote: 'benign explanations winning is the duel ruling a subject out',
});

const funnelSteps = (
  catalogue: CatalogueSummaryDto,
): ReadonlyArray<{
  readonly label: string;
  readonly value: number;
  readonly width: number;
  readonly severity: Severity;
}> => {
  const stages = catalogue.funnel.stages;
  const peak = Math.max(...stages.map((stage) => stage.value), 1);

  return stages.map((stage, index) => ({
    label: `${stage.label} · ${stage.note}`,
    value: stage.value,
    width: Math.max(28, Math.round((stage.value / peak) * 100)),
    severity: index >= stages.length - 2 ? 'severe' : index === 0 ? 'clear' : 'review',
  }));
};

/* The architecture the agent actually runs: logical components, the tool
   nodes each one owns, and — once a run exists — whether the last
   investigation invoked or declined them. */
const ArchitectureMap = () => {
  const { scenario, stepStates } = useAgent();

  const stateOf = (tools: readonly string[]): 'invoked' | 'declined' | 'idle' => {
    if (scenario === null) {
      return 'idle';
    }

    const states = tools
      .map((tool) => scenario.steps.findIndex((step) => step.tool === tool))
      .filter((index) => index >= 0)
      .map((index) => stepStates[index]);

    if (states.length === 0) {
      return 'idle';
    }

    return states.some((state) => state === 'done' || state === 'failed') ? 'invoked' : 'declined';
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="hair-b flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2">
        <Tone kind="model">
          <Boxes className="size-3" aria-hidden="true" />
          autonomous planner · not a fixed pipeline
        </Tone>
        <span className="truncate text-label text-faint">
          {scenario === null
            ? 'Run a query in Ask and this map fills in with what the agent chose.'
            : `Last run · “${scenario.query}”`}
        </span>
      </div>

      <ol className="scroll grid min-h-0 flex-1 auto-rows-min gap-3 px-6 py-4 lg:grid-cols-2">
        {agentArchitecture.map((component, index) => {
          const state = stateOf(component.tools);

          return (
            <li
              key={component.id}
              className={`flex min-w-0 flex-col gap-0.5 rounded-[2px] border px-4.5 py-3 ${
                state === 'invoked'
                  ? 'border-ok-line bg-ok-bg/25'
                  : state === 'declined'
                    ? 'border-line bg-sunken'
                    : 'border-line bg-raise'
              }`}
            >
              <p className="flex items-baseline gap-2">
                <span className="num shrink-0 text-meta text-faint">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="truncate text-body-lg leading-snug text-ink">{component.name}</span>
                <span
                  className={`ml-auto shrink-0 text-meta font-medium ${
                    state === 'invoked' ? 'text-ok' : 'text-faint'
                  }`}
                >
                  {state === 'invoked'
                    ? 'invoked'
                    : state === 'declined'
                      ? 'declined'
                      : component.always
                        ? 'always'
                        : 'conditional'}
                </span>
              </p>
              <p className="line-clamp-2 text-label leading-snug text-muted" title={component.role}>
                {component.role}
              </p>
              <p className="flex flex-wrap items-center gap-1">
                {component.tools.map((tool) => (
                  <code
                    key={tool}
                    className="num rounded-[2px] bg-raise px-1.5 py-px text-meta text-ghost"
                  >
                    {tool}
                  </code>
                ))}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

export const ModelsWorkspace = () => {
  const { cases } = useCases();
  /* A completed investigation changes the measured half of the catalogue. */
  const { catalogue, error } = useCatalogue(cases.length);
  const [series, setSeries] = useState<VolumeSeriesDto | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    /* Daily buckets: the loaded slice is weeks long, so monthly would be one bar. */
    api
      .getVolumeSeries({ bucket: 'day', limit: 60, signal: controller.signal })
      .then((response) => setSeries(response.data))
      .catch(() => setSeries(null));

    return () => controller.abort();
  }, []);

  const measured = catalogue?.feature_importance.measured ?? [];
  const declared = catalogue?.feature_importance.declared ?? [];
  const importanceRows = measured.length > 0 ? measured : declared;
  const maxImportance = Math.max(
    ...(importanceRows.length > 0 ? importanceRows.map((row) => row.value) : [1]),
    0.0001,
  );
  const maxFeature = featureImportance[0].value;

  const weightProfiles = catalogue?.profiles ?? [];
  const perf = catalogue?.performance;

  return (
    <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
      <div className="hair-r flex min-h-0 flex-1 flex-col">
        <Panel collapseId="models.architecture" className="hair-b min-h-0 basis-[45%] border-0">
          <PanelHead
            title="agent architecture"
            meta="ten logical components behind the tool roster"
          />
          <ArchitectureMap />
        </Panel>

        <Panel collapseId="models.rules" className="min-h-0 flex-1 border-0">
          <PanelHead
            title="rule engine"
            meta={
              <span className="truncate text-label text-faint">
                {catalogue === null
                  ? error === null
                    ? 'loading the detection catalogue…'
                    : `catalogue unavailable (${error}) — showing bundled rules`
                  : `${String(catalogue.rules.length)} hypotheses across ${catalogue.typologies.join(', ')}`}
              </span>
            }
          />
          <RuleContributions {...(catalogue === null ? {} : { rules: catalogue.rules })} />
        </Panel>
      </div>

      <div className="flex min-h-0 w-full shrink-0 flex-col xl:w-[26rem] 2xl:w-[30rem]">
        <Panel collapseId="models.performance" className="hair-b shrink-0 border-0">
          <PanelHead
            title="model performance"
            meta={
              <span className="truncate text-label text-faint">
                {perf === undefined
                  ? `${performance.modelVersion} · ${performance.holdout}`
                  : perf.available
                    ? `${perf.variant ?? 'held-out'} · generated ${perf.generated_at ?? 'unknown'}`
                    : 'no evaluation report on disk'}
              </span>
            }
          />
          {perf !== undefined && !perf.available ? (
            /* No metrics rather than invented ones: the harness is an offline job. */
            <div className="flex flex-col gap-2 px-6 py-4.5">
              <p className="max-w-[52ch] text-label leading-relaxed text-muted">{perf.reason}</p>
              <code className="num rounded-[2px] border border-line bg-raise px-2 py-1 text-meta text-ghost">
                {perf.command}
              </code>
              <ul className="flex flex-col gap-1 pt-0.5">
                {perf.artifacts.map((artifact) => (
                  <li key={artifact.name} className="flex items-baseline gap-2">
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        artifact.available ? 'bg-ok' : 'bg-rule'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="text-label text-ink">{artifact.name}</span>
                    <span className="truncate text-meta text-faint" title={artifact.reason ?? artifact.role}>
                      {artifact.available ? artifact.role : (artifact.reason ?? 'not available')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-4">
                {(perf?.available
                  ? perf.metrics.slice(0, 4).map((metric) => [metric.label, metric.value ?? 0] as const)
                  : ([
                      ['precision', performance.precision],
                      ['recall', performance.recall],
                      ['f1', performance.f1],
                      ['roc-auc', performance.auc],
                    ] as const)
                ).map(([label, value]) => (
                  <div key={String(label)} className="hair-r px-6 py-4 last:border-r-0">
                    <p className="eyebrow pb-1.5">{String(label)}</p>
                    <p className="metric text-metric leading-none text-ink">
                      {Number(value).toFixed(2)}
                    </p>
                  </div>
                ))}
              </div>
              <div className="hair-t flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <Tone kind="model">
                  {catalogue === null
                    ? 'hybrid · rules + xgboost + isolation forest'
                    : 'hybrid · rules + hypothesis duel + novelty'}
                </Tone>
                <span className="truncate text-label text-faint">
                  {catalogue === null ? performance.drift : catalogue.screening.note}
                </span>
              </div>
            </>
          )}
        </Panel>

        <Panel collapseId="models.features" className="hair-b min-h-0 flex-1 border-0">
          <PanelHead
            title="feature importance"
            meta={
              <span className="truncate text-label text-faint">
                {measured.length > 0
                  ? `measured across ${String(catalogue?.feature_importance.runs_measured ?? 0)} scored run(s)`
                  : catalogue === null
                    ? 'mean |SHAP| across the flagged population'
                    : (catalogue.feature_importance.reason ?? 'declared weights only')}
              </span>
            }
          />
          <div className="scroll min-h-0 flex-1 px-6 py-4">
            <MeterList>
              {catalogue === null
                ? featureImportance.map((feature) => (
                    <Meter
                      key={feature.label}
                      label={feature.label}
                      note={`${feature.label} · serves ${feature.pattern}`}
                      value={feature.value.toFixed(2)}
                      ratio={(feature.value / maxFeature) * 100}
                      tone="model"
                      mono
                      labelWidth="12rem"
                    />
                  ))
                : importanceRows.map((row) => (
                    <Meter
                      key={`${row.source}-${row.feature}`}
                      label={row.feature}
                      note={`${row.feature} · ${row.note}`}
                      value={row.value.toFixed(2)}
                      ratio={(row.value / maxImportance) * 100}
                      tone={row.source === 'measured' ? 'model' : 'info'}
                      mono
                      labelWidth="12rem"
                    />
                  ))}
            </MeterList>
            <p className="pt-2 text-label leading-snug text-faint">
              {measured.length > 0
                ? 'Mean weighted contribution per evidence family, measured from scored runs — not SHAP: the engine ships no supervised model.'
                : catalogue === null
                  ? 'Threshold-avoidance features dominate — the expected shape when structuring is the prevailing typology in this book.'
                  : 'Declared weights until an investigation has been scored in this process.'}
            </p>
          </div>
        </Panel>

        <Panel collapseId="models.weights" className="shrink-0 border-0">
          <PanelHead
            title="score weights"
            meta={
              <span className="truncate text-label text-faint">
                {weightProfiles.length > 0
                  ? `${String(weightProfiles.length)} profiles · config-driven, no retrain`
                  : 'config-driven, no retrain required'}
              </span>
            }
          />
          <div className="scroll max-h-[14rem] px-6 py-4">
            {weightProfiles.length === 0 ? (
              <MeterList>
                {scoreWeights.map((weight) => (
                  <Meter
                    key={weight.label}
                    label={weight.label}
                    note={weight.note}
                    value={weight.weight.toFixed(2)}
                    ratio={weight.weight * 100}
                    tone="info"
                    labelWidth="9rem"
                  />
                ))}
              </MeterList>
            ) : (
              weightProfiles.map((profile) => (
                <section key={profile.typology} className="pb-2 last:pb-0">
                  <p className="eyebrow pb-2">
                    {profile.typology}
                    {profile.default && ' · default'}
                  </p>
                  <MeterList>
                    {profile.families.map((family) => (
                      <Meter
                        key={`${profile.typology}-${family.family}`}
                        label={family.family}
                        note={family.note || family.family}
                        value={family.weight.toFixed(2)}
                        ratio={family.weight * 100}
                        tone={family.neutral ? 'clear' : 'info'}
                        mono
                        labelWidth="10rem"
                      />
                    ))}
                  </MeterList>
                </section>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="hair-l flex min-h-0 w-full shrink-0 flex-col xl:w-[23rem] 2xl:w-[27rem]">
        <Panel collapseId="models.volume" className="hair-b min-h-0 flex-1 border-0">
          <PanelHead
            title={series === null ? 'alert volume' : 'transaction volume'}
            meta={
              <span className="truncate text-label text-faint">
                {series === null ? '12 weeks · demo data' : 'from the loaded dataset'}
              </span>
            }
          />
          <VizRenderer spec={series === null ? demoAlertSpec : volumeSpec(series)} />
        </Panel>

        <Panel collapseId="models.explanations" className="hair-b min-h-0 flex-1 border-0">
          <PanelHead
            title={catalogue !== null && catalogue.outcomes.length > 0 ? 'explanations' : 'typology mix'}
            meta={
              <span className="truncate text-label text-faint">
                {catalogue !== null && catalogue.outcomes.length > 0
                  ? 'which hypothesis won, this session'
                  : catalogue === null
                    ? 'quarter to date'
                    : 'run a query to populate outcomes'}
              </span>
            }
          />
          <VizRenderer
            spec={
              catalogue !== null && catalogue.outcomes.length > 0
                ? outcomeSpec(catalogue)
                : demoMixSpec
            }
          />
        </Panel>

        <Panel collapseId="models.funnel" className="shrink-0 border-0">
          <PanelHead
            title="alert funnel"
            meta={
              <span className="truncate text-label text-faint">
                {catalogue?.funnel.available === true
                  ? `from run “${catalogue.funnel.query ?? ''}”`
                  : (catalogue?.funnel.reason ?? 'screened → flagged → reviewable → reportable')}
              </span>
            }
          />
          <Pyramid
            steps={
              catalogue?.funnel.available === true ? funnelSteps(catalogue) : pyramid
            }
          />
        </Panel>
      </div>
    </div>
  );
};
