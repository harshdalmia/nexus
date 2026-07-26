import { useState } from 'react';
import type { ReactNode } from 'react';
import { Ban, Check, ChevronDown, ChevronRight, CircleSlash, Cpu, ListFilter } from 'lucide-react';
import { ScoreValue, SeverityTag, Tone } from '@/components/primitives/Severity';
import { detailFor } from '@/data/agentDetail';
import { scenarios } from '@/data/scenarios';
import { useAgent } from '@/store/agentStore';
import type { PlanningStage, Scenario, TraceStep } from '@/types/aml';

/* ------------------------------------------------------------------
   The blocks that make the agent's own reasoning legible: what it
   understood, what it chose to run, what it built, what it found and
   how it graded the result. Everything here is derived from the same
   trace the execution stage replays — nothing is asserted twice.
   ------------------------------------------------------------------ */

const Row = ({
  label,
  children,
  wide,
}: {
  readonly label: string;
  readonly children: ReactNode;
  readonly wide?: boolean;
}) => (
  <div className={wide === true ? 'col-span-2' : undefined}>
    <p className="eyebrow pb-2">{label}</p>
    {children}
  </div>
);

const toolLabel = (step: TraceStep): string => step.label;

/* ========================= execution summary ========================= */

export const ExecutionSummaryBlock = ({ scenario }: { readonly scenario: Scenario }) => {
  const { query, totalMs } = useAgent();
  const detail = detailFor(scenario);
  const selected = scenario.steps.filter((step) => step.status !== 'skipped');
  const skipped = scenario.steps.filter((step) => step.status === 'skipped');
  const eda = scenario.steps.find((step) => step.tool === 'eda_profiler');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-x-8 gap-y-4 px-6 py-5 sm:grid-cols-2 xl:grid-cols-4">
        <Row label="original query">
          <p className="max-w-[46ch] text-body-lg leading-snug text-ink">“{query || scenario.query}”</p>
        </Row>
        <Row label="detected intent">
          <p className="num text-body-lg text-model">{scenario.action}</p>
          <p className="pt-1 text-meta text-faint">classified by intent_classifier</p>
        </Row>
        <Row label="detected AML pattern">
          <p className="max-w-[34ch] text-label leading-relaxed text-ink">{detail.amlPattern}</p>
        </Row>
        <Row label="execution time">
          <p className="metric text-metric text-ink">{(totalMs / 1000).toFixed(1)}s</p>
          <p className="pt-1 text-meta text-faint">
            {selected.length} tools invoked · {skipped.length} declined of {scenario.steps.length}
          </p>
        </Row>

        <Row label="detected entities">
          <ul className="flex flex-col gap-1">
            {detail.entities.map((item) => (
              <li key={item} className="num text-label text-ink">
                {item}
              </li>
            ))}
          </ul>
        </Row>
        <Row label={`detected filters · ${String(detail.filters.length)}`}>
          <ul className="flex flex-wrap gap-1">
            {detail.filters.map((item) => (
              <li key={item}>
                <Tone kind="info" className="num">
                  {item}
                </Tone>
              </li>
            ))}
          </ul>
        </Row>
        <Row label="selective EDA" wide>
          <p className="flex flex-wrap items-center gap-2">
            {eda === undefined ? (
              <Tone kind="neutral">not in roster</Tone>
            ) : eda.status === 'skipped' ? (
              <>
                <SeverityTag severity="clear">skipped</SeverityTag>
                <span className="text-label text-muted">{eda.reason}</span>
              </>
            ) : (
              <>
                <SeverityTag severity="review">executed</SeverityTag>
                <span className="text-label text-muted">{eda.reason}</span>
              </>
            )}
          </p>
        </Row>
      </div>

      <div className="hair-t grid gap-x-8 gap-y-4 px-6 py-5 md:grid-cols-2">
        <div>
          <p className="eyebrow pb-2">selected tools · {selected.length}</p>
          <ul className="flex flex-wrap gap-1.5">
            {selected.map((step) => (
              <li
                key={step.tool}
                className={`inline-flex items-center gap-1.5 rounded-[2px] border px-2 py-1 text-label ${
                  step.status === 'failed'
                    ? 'border-rev-line bg-rev-bg/40 text-rev'
                    : 'border-ok-line bg-ok-bg/30 text-ink'
                }`}
                title={step.reason}
              >
                <Check className="size-3 shrink-0 text-ok" aria-hidden="true" />
                {toolLabel(step)}
                <span className="num text-meta text-faint">
                  {step.durationMs >= 1000
                    ? `${(step.durationMs / 1000).toFixed(1)}s`
                    : `${String(step.durationMs)}ms`}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow pb-2">skipped tools · {skipped.length}</p>
          <ul className="flex flex-col gap-1.5">
            {skipped.map((step) => (
              <li key={step.tool} className="flex items-start gap-2">
                <Ban className="mt-1 size-3 shrink-0 text-faint" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="text-label font-medium text-ink">{toolLabel(step)}</span>
                  <span className="block max-w-[64ch] text-label leading-relaxed text-muted">{step.reason}</span>
                </span>
              </li>
            ))}
            {skipped.length === 0 && (
              <li className="text-label text-muted">
                Nothing was declined on this run — the query gave the planner nothing it could prune safely.
              </li>
            )}
          </ul>
        </div>
      </div>

      <div className="hair-t px-6 py-5">
        <p className="eyebrow pb-2">investigation summary</p>
        <p className="max-w-[104ch] text-read text-ink">{detail.investigationSummary}</p>
      </div>
    </div>
  );
};

/* ============================== planning ============================== */

const stageCaption: Record<PlanningStage, string> = {
  intent_extraction: '1 · intent extraction',
  entity_extraction: '2 · entity extraction',
  filter_detection: '3 · filter detection',
  pattern_detection: '4 · AML pattern detection',
  tool_selection: '5 · dynamic tool selection',
  execution_planning: '6 · execution planning',
};

export const PlanningBlock = ({ scenario }: { readonly scenario: Scenario }) => {
  const detail = detailFor(scenario);
  const [openDecisions, setOpenDecisions] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-5 px-6 py-5 md:grid-cols-2 xl:grid-cols-3">
        {detail.planning.map((decision) => (
          <article
            key={decision.stage}
            className="flex flex-col gap-1 rounded-[2px] border border-line bg-raise px-3.5 py-3 shadow-[var(--elev-1)]"
          >
            <p className="eyebrow flex items-center gap-1.5">
              <ListFilter className="size-3 shrink-0 text-model" aria-hidden="true" />
              {stageCaption[decision.stage]}
            </p>
            <p className="num text-card leading-snug text-ink">{decision.value}</p>
            <p className="max-w-[52ch] text-label leading-relaxed text-muted">{decision.detail}</p>
            {decision.confidence !== undefined && (
              <p className="num mt-auto pt-1 text-meta text-faint">
                confidence {decision.confidence.toFixed(2)}
              </p>
            )}
          </article>
        ))}
      </div>

      <div className="hair-t px-6 py-4.5">
        <button
          type="button"
          onClick={() => setOpenDecisions((open) => !open)}
          aria-expanded={openDecisions}
          className="flex w-full items-center gap-2 text-left"
        >
          {openDecisions ? (
            <ChevronDown className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
          )}
          <span className="text-card text-ink">Per-tool decision record</span>
          <span className="num text-meta text-faint">
            why each of the {scenario.steps.length} tools was invoked or declined
          </span>
        </button>

        {openDecisions && (
          <ul className="flex flex-col gap-1.5 pt-3">
            {scenario.steps.map((step) => (
              <li
                key={step.tool}
                className="grid gap-x-3 gap-y-1 rounded-[2px] border border-line bg-raise px-4.5 py-3 md:grid-cols-[10rem_5.5rem_minmax(0,1fr)] md:items-baseline"
              >
                <span className="text-label font-medium text-ink">{toolLabel(step)}</span>
                <span>
                  {step.status === 'skipped' ? (
                    <SeverityTag severity="clear">declined</SeverityTag>
                  ) : step.status === 'failed' ? (
                    <SeverityTag severity="review">degraded</SeverityTag>
                  ) : (
                    <SeverityTag severity="severe">invoked</SeverityTag>
                  )}
                </span>
                <span className="max-w-[92ch] text-label leading-relaxed text-muted">{step.reason}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

/* ========================= feature engineering ========================= */

export const FeatureBlock = ({ scenario, note }: { readonly scenario: Scenario; readonly note?: string }) => {
  const detail = detailFor(scenario);
  const [open, setOpen] = useState(false);
  const built = detail.features.filter((feature) => feature.included);
  const declined = detail.features.filter((feature) => !feature.included);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-6 py-5 text-left transition-colors hover:bg-raise/60"
      >
        {open ? (
          <ChevronDown className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        )}
        <span className="text-card text-ink">
          {built.length} AML features engineered
          {declined.length > 0 && ` · ${String(declined.length)} deliberately not computed`}
        </span>
        <span className="num ml-auto text-meta text-faint">{open ? 'collapse' : 'expand'}</span>
      </button>

      {!open && (
        <ul className="flex flex-wrap gap-1.5 px-4 pb-4">
          {(built.length > 0 ? built : declined).slice(0, 10).map((feature) => (
            <li
              key={feature.name}
              className={`inline-flex items-baseline gap-2 rounded-[2px] border px-2 py-1 ${
                feature.included
                  ? 'border-model-line bg-model-bg/40'
                  : 'border-line bg-sunken/70'
              }`}
              title={feature.description}
            >
              <span className={`text-label ${feature.included ? 'text-ink' : 'text-faint line-through'}`}>
                {feature.display}
              </span>
              {feature.included && <span className="num text-meta text-model">{feature.value}</span>}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="scroll min-h-0 flex-1 px-4 pb-4">
          <table className="w-full min-w-[46rem] border-collapse text-left">
            <thead>
              <tr className="hair-b">
                <th className="eyebrow py-2 pr-3">feature</th>
                <th className="eyebrow py-2 pr-3">pattern</th>
                <th className="eyebrow py-2 pr-3">value</th>
                <th className="eyebrow py-2">rationale</th>
              </tr>
            </thead>
            <tbody>
              {detail.features.map((feature) => (
                <tr key={feature.name} className="border-b border-line/50 align-top">
                  <td className="py-2.5 pr-3">
                    <span className={`block text-body ${feature.included ? 'text-ink' : 'text-faint'}`}>
                      {feature.display}
                    </span>
                    <span className="num block text-meta text-ghost">{feature.name}</span>
                  </td>
                  <td className="py-2.5 pr-3">
                    <Tone kind={feature.included ? 'model' : 'neutral'}>{feature.pattern}</Tone>
                  </td>
                  <td className="num py-2.5 pr-3 text-body text-ink">
                    {feature.included ? (
                      feature.value
                    ) : (
                      <span className="inline-flex items-center gap-1 text-faint">
                        <CircleSlash className="size-3" aria-hidden="true" />
                        not computed
                      </span>
                    )}
                  </td>
                  <td className="max-w-[52ch] py-2.5 text-label leading-relaxed text-muted">
                    {feature.included ? feature.description : feature.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="hair-t mt-auto px-6 py-4 text-meta leading-relaxed text-faint">
        {note ??
          'Features are tagged to typologies, so the builder computes only the subset the detected pattern needs. The rest are listed with the reason they were left alone.'}
      </p>
    </div>
  );
};

/* ========================== anomaly detection ========================== */

const kindTone = {
  rules: 'neutral',
  supervised: 'model',
  unsupervised: 'model',
  graph: 'info',
} as const;

export const DetectionBlock = ({ scenario }: { readonly scenario: Scenario }) => {
  const detail = detailFor(scenario);
  const detection = detail.detection;

  if (detection === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-6 py-5">
        <Tone kind="neutral">no model ran</Tone>
        <p className="max-w-[86ch] text-read text-muted">
          The detection engine was declined for this query, so there is no model, score or threshold to report.
          Inventing one would attribute risk the analyst never asked about.
        </p>
      </div>
    );
  }

  /* A live engine may report a score without a threshold, or neither. Absent
     numbers are stated as unreported rather than defaulted to zero. */
  const score = detection.score;
  const threshold = detection.threshold;
  const over = score !== undefined && threshold !== undefined && score >= threshold;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid gap-x-8 gap-y-4 px-6 py-5 sm:grid-cols-2">
        <Row label="anomaly type">
          <p className="max-w-[34ch] text-card leading-snug text-ink">{detection.anomalyType}</p>
        </Row>
        <Row label="execution time">
          <p className="metric text-metric text-ink">{(detection.durationMs / 1000).toFixed(2)}s</p>
          <p className="num pt-1 text-meta text-faint">
            {detection.evaluated.toLocaleString()} evaluated · {detection.flagged} flagged
          </p>
        </Row>
        <Row label="anomaly score">
          {score === undefined ? (
            <>
              <p className="metric text-metric text-faint">—</p>
              <p className="pt-1 text-meta text-faint">no numeric score published for this run</p>
            </>
          ) : (
            <>
              <p className={`metric text-metric-lg ${over ? 'text-sev' : 'text-ok'}`}>
                {score.toFixed(2)}
              </p>
              <div className="relative mt-2 h-1.5 w-full rounded-[1px] bg-rule" aria-hidden="true">
                <span
                  className={`absolute inset-y-0 left-0 rounded-[1px] ${over ? 'bg-sev' : 'bg-ok'}`}
                  style={{ width: `${String(Math.min(100, Math.abs(score) * 100))}%` }}
                />
                {threshold !== undefined && (
                  <span
                    className="absolute inset-y-[-3px] w-px bg-ink"
                    style={{ left: `${String(threshold * 100)}%` }}
                  />
                )}
              </div>
              <p className="num pt-1.5 text-meta text-faint">
                {threshold === undefined
                  ? 'no decision threshold published'
                  : `threshold ${threshold.toFixed(2)} · ${over ? 'exceeded' : 'below'}`}
              </p>
            </>
          )}
        </Row>
        <Row label="confidence">
          <p className="metric text-metric-lg text-ink">
            {typeof detection.confidence === 'number'
              ? `${String(Math.round(detection.confidence * 100))}%`
              : detection.confidence}
          </p>
          <p className="pt-1 text-meta text-faint">rule and model agreement</p>
        </Row>
      </div>

      <div className="hair-t px-6 py-5">
        <p className="eyebrow pb-2">models used</p>
        <ul className="flex flex-col gap-1.5">
          {detection.models.map((model) => (
            <li key={model.name} className="flex flex-wrap items-baseline gap-2">
              <Cpu className="size-3 shrink-0 text-model" aria-hidden="true" />
              <span className="num text-label font-medium text-ink">{model.name}</span>
              <Tone kind={kindTone[model.kind]}>{model.kind}</Tone>
              <span className="max-w-[64ch] text-label leading-relaxed text-muted">{model.role}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="hair-t px-6 py-5">
        <p className="eyebrow pb-2">top contributing features</p>
        <ul className="flex flex-col gap-2">
          {detection.topFeatures.map((item) => (
            <li key={item.feature} className="grid grid-cols-[minmax(0,1fr)_4rem] items-center gap-3">
              <span className="min-w-0">
                <span className="num block truncate text-label text-ink">{item.feature}</span>
                <span className="mt-1 block h-1.5 rounded-[1px] bg-rule" aria-hidden="true">
                  <span
                    className="block h-full rounded-[1px] bg-model"
                    style={{ width: `${String(Math.min(100, item.contribution * 250))}%` }}
                  />
                </span>
              </span>
              <span className="num text-right text-label text-model">+{item.contribution.toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

/* ========================= risk classification ========================= */

export const RiskBlock = ({ scenario }: { readonly scenario: Scenario }) => {
  const detail = detailFor(scenario);
  const risk = detail.risk;

  if (risk === null) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2 px-6 py-5">
        <Tone kind="neutral">no risk assigned</Tone>
        <p className="max-w-[86ch] text-read text-muted">
          The risk engine was declined because nothing was detected. Any score shown elsewhere in this dossier is
          a cached value from the overnight pass, labelled as such.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-4 px-6 py-5">
        <div>
          <p className="eyebrow pb-2">risk score</p>
          <p
            className={`metric text-display ${
              risk.severity === 'severe' ? 'text-sev' : risk.severity === 'review' ? 'text-rev' : 'text-ok'
            }`}
          >
            {risk.score}
            <span className="text-metric text-faint"> / 100</span>
          </p>
        </div>
        <div>
          <p className="eyebrow pb-2">risk category</p>
          <p className="flex items-center gap-2">
            <SeverityTag severity={risk.severity}>{risk.level}</SeverityTag>
            <ScoreValue score={risk.score} />
          </p>
          <p className="num pt-1.5 text-meta text-faint">band {risk.band}</p>
        </div>
        <div>
          <p className="eyebrow pb-2">confidence</p>
          <p className="metric text-metric text-ink">
            {typeof risk.confidence === 'number'
              ? `${String(Math.round(risk.confidence * 100))}%`
              : risk.confidence}
          </p>
        </div>
      </div>

      <div className="hair-t px-6 py-5">
        <p className="eyebrow pb-2">reason</p>
        <p className="max-w-[100ch] text-read text-ink">{risk.reason}</p>
      </div>

      <div className="hair-t grid gap-x-8 gap-y-4 px-6 py-5 md:grid-cols-2">
        <div>
          <p className="eyebrow pb-2">supporting evidence</p>
          <ul className="flex flex-col gap-1.5">
            {risk.evidence.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-sev" aria-hidden="true" />
                <span className="max-w-[68ch] text-label leading-relaxed text-muted">{item}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="eyebrow pb-2">score composition</p>
          <ul className="flex flex-col gap-2">
            {risk.components.map((component) => (
              <li key={component.label} className="grid grid-cols-[minmax(0,1fr)_3rem_3rem] items-center gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-label text-ink">{component.label}</span>
                  <span className="mt-1 block h-1.5 rounded-[1px] bg-rule" aria-hidden="true">
                    <span
                      className="block h-full rounded-[1px] bg-model"
                      style={{ width: `${String(component.value)}%` }}
                    />
                  </span>
                </span>
                <span className="num text-right text-meta text-faint">
                  ×{component.weight.toFixed(2)}
                </span>
                <span className="num text-right text-label text-ink">{component.value}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

/* ======================== judge-facing capability strip ======================== */

const capabilities: ReadonlyArray<readonly [string, string]> = [
  ['Understands natural language', 'Plain English in. No filter builder, no query language, no dropdowns.'],
  ['Plans its own investigation', 'Six derivations from your sentence: intent, entities, filters, pattern, tools, order.'],
  ['Selects tools intelligently', 'Between 7 and 13 of 14 nodes run. Declined nodes stay on screen with the reason.'],
  ['Runs EDA only when needed', 'Profiling is declined for targeted questions and invoked for open-ended ones.'],
  ['Engineers AML features', 'Structuring, velocity, rolling sums, cash-out timing, smurfing, centrality.'],
  ['Detects anomalies', 'Deterministic rules, XGBoost probability and isolation-forest novelty together.'],
  ['Classifies risk 0–100', 'Weighted composite, banded low / medium / high, weights read from config.'],
  ['Explains every decision', 'Rule reasons lead, SHAP supports, and the narrative answers your question.'],
  ['Recommends an action', 'Monitor, review or report — with the regulatory clock attached.'],
  ['Visualises what matters', 'Charts are chosen per query, so a counting answer never fakes a risk gauge.'],
];

/* prompt cards are derived from the scenarios themselves, so the tool counts
   and latencies on them can never drift from what the run actually does */
const promptExamples = scenarios.map((item) => {
  const invoked = item.steps.filter((step) => step.status !== 'skipped').length;
  const total = item.steps.reduce(
    (sum, step) => sum + (step.status === 'skipped' ? 0 : step.durationMs),
    0,
  );

  return {
    query: item.query,
    meta: `${item.action} · ${String(invoked)} of ${String(item.steps.length)} tools · ~${(total / 1000).toFixed(0)}s`,
  };
});

export const CapabilityStrip = ({ onAsk }: { readonly onAsk: (query: string) => void }) => (
  <div className="hair-t bg-panel px-5 py-5">
    <p className="flex flex-wrap items-baseline gap-2 pb-3">
      <span className="display text-section text-ink">What this agent does</span>
      <span className="text-label text-muted">
        every claim below is evidenced in the dossier the moment you run a query
      </span>
    </p>

    <ol className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-5">
      {capabilities.map(([title, body], index) => (
        <li
          key={title}
          className="flex min-w-0 flex-col gap-1 rounded-[2px] border border-line bg-raise px-4.5 py-3.5 shadow-[var(--elev-1)]"
        >
          <p className="flex items-baseline gap-2">
            <span className="num text-meta text-model">{String(index + 1).padStart(2, '0')}</span>
            <span className="text-card leading-snug text-ink">{title}</span>
          </p>
          <p className="text-label leading-relaxed text-muted">{body}</p>
        </li>
      ))}
    </ol>

    <div className="hair-t mt-4 pt-3">
      <p className="eyebrow pb-2">realistic prompts · each one takes a different route through the tools</p>
      <ul className="flex flex-wrap gap-2">
        {promptExamples.map((example) => (
          <li key={example.query}>
            <button
              type="button"
              onClick={() => onAsk(example.query)}
              className="group flex max-w-[26rem] flex-col items-start gap-0.5 rounded-[2px] border border-line bg-raise px-4.5 py-3 text-left transition-colors hover:border-info-line hover:bg-info-bg/40"
            >
              <span className="text-body text-ink">“{example.query}”</span>
              <span className="num text-meta text-faint">{example.meta}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  </div>
);
